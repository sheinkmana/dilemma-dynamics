"""Portable settled exports and optional, idempotent MLflow publication."""

import hashlib
import json
import os
import tarfile
from pathlib import Path

from .analysis import analyse_file
from .design import digest, write_json


def hash_file(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def export_run(directory, output):
    import pyarrow as pa
    import pyarrow.parquet as pq

    directory, output = Path(directory), Path(output)
    plan = json.loads((directory / "plan.json").read_text())
    report, rows = analyse_file(plan, directory / "events.jsonl")
    output.mkdir(exist_ok=False)
    write_json(output / "report.json", report)
    write_json(output / "plan.json", plan)
    (output / "events.jsonl").write_bytes((directory / "events.jsonl").read_bytes())
    for name in ("provenance.json", "source.tar.gz"):
        if (directory / name).exists():
            (output / name).write_bytes((directory / name).read_bytes())
    table = [
        {
            k: row[k]
            for k in (
                "id",
                "track",
                "cell",
                "block",
                "stratum",
                "status",
                "rounds",
                "normalisedOracleLoss",
                "normalisedJointReturn",
                "firstCC",
            )
        }
        for row in rows
    ]
    pq.write_table(pa.Table.from_pylist(table), output / "episodes.parquet")
    write_json(output / "episodes.json", rows)
    text = [
        "# Cooperation evaluation report",
        "",
        f"Execution: **{report['execution']}**. Purpose: **{report['purpose']}**.",
        f"Completed {report['completed']} of {report['scheduled']} scheduled episodes.",
        f"Usage-priced cost: ${report['spentUsd']}; unresolved reservations: ${report['reservedUsd']}.",
        "",
        "| Model | Draft minus direct loss | Approximate 95% interval |",
        "|---|---:|---|",
    ]
    if "planAmendment" in report:
        amendment = report["planAmendment"]
        text[5:5] = [
            "",
            f"Amended final study: original blocks {amendment['selectedBlocks']}; "
            f"parent plan `{amendment['parentSha256']}`. This is a smaller final evaluation.",
        ]
    for c in report["primaryContrasts"]:
        text.append(f"| {c['model']} | {c['estimate']} | {c['approximateInterval95']} |")
    text += [
        "",
        "## Interpretation",
        "",
        "Track A measures best-response quality against committed policies. Track B "
        "describes autonomous interaction; cooperation does not establish equilibrium.",
        "",
        *[f"- {s}" for s in report["limitations"]],
    ]
    (output / "report.md").write_text("\n".join(text) + "\n")
    from .figures import render

    render(report, output)
    files = {p.name: hash_file(p) for p in sorted(output.iterdir()) if p.is_file()}
    write_json(output / "integrity.json", {"schemaVersion": 1, "files": files})
    return report


def verify_export(directory):
    directory = Path(directory)
    index = json.loads((directory / "integrity.json").read_text())
    required = {
        "report.json",
        "plan.json",
        "events.jsonl",
        "episodes.json",
        "episodes.parquet",
        "report.md",
    }
    if not required <= set(index["files"]):
        raise ValueError("Incomplete export")
    for name, sha in index["files"].items():
        if Path(name).name != name or hash_file(directory / name) != sha:
            raise ValueError("Export integrity mismatch")
    plan = json.loads((directory / "plan.json").read_text())
    report, rows = analyse_file(plan, directory / "events.jsonl")
    if report != json.loads((directory / "report.json").read_text()):
        raise ValueError("Report does not reproduce from evidence")
    if rows != json.loads((directory / "episodes.json").read_text()):
        raise ValueError("Episode table does not reproduce")
    if report.get("sourceSha256"):
        provenance = json.loads((directory / "provenance.json").read_text())
        with tarfile.open(directory / "source.tar.gz") as archive:
            recovered = {}
            for member in archive:
                if not member.isfile():
                    raise ValueError("Unexpected source archive entry")
                recovered[member.name] = hashlib.file_digest(
                    archive.extractfile(member), "sha256"
                ).hexdigest()
        if recovered != provenance["sourceFiles"] or digest(recovered) != report["sourceSha256"]:
            raise ValueError("Frozen source does not match execution provenance")
    return report


def export_mlflow(directory, uri, experiment, client=None):
    """Offline inference-wise. Only this explicit command contacts a tracking service."""
    directory = Path(directory)
    report = verify_export(directory)
    lock = directory / ".mlflow-export.lock"
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        if client is None:
            from mlflow.tracking import MlflowClient

            client = MlflowClient(tracking_uri=uri)
        identity = digest({"plan": report["planSha256"], "head": report["evidenceHead"]})
        exp = client.get_experiment_by_name(experiment)
        if exp:
            eid = exp.experiment_id
        elif uri.startswith("sqlite:///"):
            database = Path(uri.removeprefix("sqlite:///")).resolve()
            artifact_root = database.parent / "mlflow-artifacts" / digest(experiment)[:12]
            eid = client.create_experiment(experiment, artifact_location=artifact_root.as_uri())
        else:
            eid = client.create_experiment(experiment)
        found = client.search_runs([eid], f"tags.gamefield_identity = '{identity}'")
        if len(found) > 1:
            raise ValueError("Duplicate MLflow identities; reconciliation required")
        run_id = (
            found[0].info.run_id
            if found
            else client.create_run(
                eid,
                tags={
                    "gamefield_identity": identity,
                    "execution": report["execution"],
                    "purpose": report["purpose"],
                    "plan_sha256": report["planSha256"],
                },
            ).info.run_id
        )
        receipt = directory / ("mlflow-" + digest(uri)[:12] + ".json")
        # Persist the remote identity before uploading; a retry finds this same run by tag.
        receipt.write_text(json.dumps({"runId": run_id, "identity": identity}) + "\n")
        client.log_param(run_id, "plan_sha256", report["planSha256"])
        for name in ("scheduled", "completed", "spentUsd", "reservedUsd"):
            client.log_metric(run_id, name, float(report[name]))
        for contrast in report["primaryContrasts"]:
            if contrast["estimate"] is not None:
                client.log_metric(
                    run_id, contrast["model"] + "_loss_difference", contrast["estimate"]
                )
        for name in (
            "plan.json",
            "report.json",
            "report.md",
            "episodes.parquet",
            "integrity.json",
            "primary-contrasts.svg",
            "primary-contrasts.png",
        ):
            client.log_artifact(run_id, str(directory / name))
        client.set_terminated(run_id, status="FINISHED")
        return {"runId": run_id, "identity": identity}
    finally:
        os.close(fd)
        lock.unlink()


def source_index(root):
    root = Path(root)
    paths = [
        *root.glob("python/**/*.py"),
        *root.glob("deploy/*"),
        *root.glob("fixtures/*.json"),
        root / "pyproject.toml",
        root / "uv.lock",
    ]
    return {str(p.relative_to(root)): hash_file(p) for p in sorted(paths) if p.is_file()}


def bundle(root, output):
    root, output = Path(root), Path(output)
    files = source_index(root)
    with output.open("xb") as stream:
        with tarfile.open(fileobj=stream, mode="w:gz") as tar:
            for name in files:
                tar.add(root / name, arcname=name, recursive=False)
        stream.flush()
        os.fsync(stream.fileno())
    return {"sha256": hash_file(output), "files": files}


def freeze_source(root, directory, deployment=None):
    frozen = bundle(root, directory / "source.tar.gz")
    files = frozen["files"]
    if deployment is not None and deployment["sourceFiles"] != files:
        raise ValueError("Source changed before dispatch")
    provenance = {
        "schemaVersion": 1,
        "sourceFiles": files,
        "sourceSha256": digest(files),
        "archiveSha256": frozen["sha256"],
        "deployment": deployment,
    }
    if deployment is not None and deployment.get("mode") == "local":
        preparation = Path(deployment["preparationRoot"])
        purpose = "engineering" if deployment["stageSeconds"] == 6300 else "final"
        provenance["executionContext"] = {
            "campaignWindow": json.loads((preparation / "claims/window.json").read_text()),
            "stageClaim": json.loads((preparation / "claims" / f"{purpose}.json").read_text()),
        }
    write_json(directory / "provenance.json", provenance)
    return provenance
