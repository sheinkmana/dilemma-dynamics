"""Actual local MLflow records; evidence and statistics remain authoritative."""

import json
import os
import tempfile
from pathlib import Path

from gamefield_research.gateway import read_events

from .design import read


def track(directory, stage):
    os.environ["MLFLOW_DISABLE_TELEMETRY"] = "true"
    from mlflow.tracking import MlflowClient

    directory = Path(directory).resolve()
    spec = read(directory / "spec.json")
    client = MlflowClient(tracking_uri="sqlite:///" + str(directory / "tracking.sqlite"))
    name = "dilemma-final-v3"
    experiment = client.get_experiment_by_name(name)
    eid = (
        experiment.experiment_id
        if experiment
        else client.create_experiment(
            name, artifact_location=(directory / "tracking-artifacts").as_uri()
        )
    )
    identity = spec["sha256"] + "/" + stage
    runs = client.search_runs([eid], f"tags.evaluation_identity = '{identity}'")
    if len(runs) > 1:
        raise ValueError("Duplicate tracker identities; reconcile without repeating inference")
    run_id = (
        runs[0].info.run_id
        if runs
        else client.create_run(
            eid,
            tags={
                "evaluation_identity": identity,
                "stage": stage,
                "mlflow.runName": f"{stage}-{spec['sha256'][:12]}",
            },
        ).info.run_id
    )
    client.log_param(run_id, "spec_sha256", spec["sha256"])
    client.log_param(run_id, "source_sha256", read(directory / "preparation.json")["sourceSha256"])
    for key, value in {
        "temperatures": "0,1",
        "draft_tokens": 1024,
        "action_tokens": 128,
        "additional_budget_usd": 40,
        "models": ",".join(dict.fromkeys(a["model"] for a in spec["arms"])),
    }.items():
        client.log_param(run_id, key, value)
    for name in ("spec.json", "preparation.json", "runtime.json", "source-index.json"):
        client.log_artifact(run_id, str(directory / name))
    if stage != "preflight":
        events = read_events(directory / stage / "events.jsonl")
        for key in ("spentUsd", "reservedUsd", "retryExposureUsd"):
            client.log_metric(run_id, key, float(events[-1][key]))
        client.set_tag(run_id, "evidence_head", events[-1]["sha256"])
        if stage == "final":
            from .analysis import export

            result = export(directory)
            report = read(Path(result["export"]) / "summary.json")
            client.log_param(
                run_id, "blocks_per_temperature", report["selectedBlocksPerTemperature"]
            )
            client.log_metric(run_id, "completed", report["completed"])
            client.log_metric(run_id, "request_count", report["requestCount"])
            for i, contrast in enumerate(report["contrasts"]):
                if contrast["estimate"] is not None:
                    client.log_metric(run_id, f"contrast_{i}_estimate", contrast["estimate"])
                if contrast["interval"] is not None:
                    client.log_metric(run_id, f"contrast_{i}_lower", contrast["interval"][0])
                    client.log_metric(run_id, f"contrast_{i}_upper", contrast["interval"][1])
            for path in Path(result["export"]).iterdir():
                if path.is_file():
                    client.log_artifact(run_id, str(path))
            client.set_terminated(run_id, status="FINISHED" if report["complete"] else "FAILED")
        else:
            client.set_terminated(
                run_id, status="FINISHED" if events[-1]["halted"] is None else "FAILED"
            )
    else:
        client.set_terminated(run_id)
    receipt = {
        "runId": run_id,
        "identity": identity,
        "trackingUri": "sqlite:///" + str(directory / "tracking.sqlite"),
    }
    if stage != "preflight":
        receipt["evidenceHead"] = events[-1]["sha256"]
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False) as stream:
        json.dump(receipt, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
        temporary = Path(stream.name)
    os.replace(temporary, directory / f"tracking-{stage}.json")
    return receipt
