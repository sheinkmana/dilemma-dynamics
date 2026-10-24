"""Record the amendment alongside the existing local MLflow experiment."""

import os
from pathlib import Path

from gamefield_research.design import digest
from gamefield_research.gateway import read_events

from evaluation_v2.design import read
from evaluation_v2.runner import exclusive_json


def transport_diagnostics(events, boundary):
    """Descriptive pre/post interruption exposure, without inspecting game outcomes."""
    statuses = {r["key"]: r["status"] for r in events if r["event"] == "http-response"}
    groups = {}
    for row in events:
        if row["event"] != "request-sent":
            continue
        body = row["request"]
        segment = "original" if row["sequence"] < boundary else "approved-recovery"
        key = (segment, body["temperature"], body["model"])
        if key not in groups:
            groups[key] = {
                "segment": segment,
                "temperature": body["temperature"],
                "model": body["model"],
                "requests": 0,
                "httpStatuses": {},
            }
        group = groups[key]
        group["requests"] += 1
        status = str(statuses.get(row["key"], "no-durable-http-response"))
        group["httpStatuses"][status] = group["httpStatuses"].get(status, 0) + 1
    return list(groups.values())


def record(directory, stage, *, failed=False):
    os.environ["MLFLOW_DISABLE_TELEMETRY"] = "true"
    from mlflow.tracking import MlflowClient

    directory = Path(directory)
    receipt = read(directory / "amendment.json")
    parent = Path(receipt["parentDirectory"])
    client = MlflowClient(tracking_uri="sqlite:///" + str(parent / "tracking.sqlite"))
    experiment = client.get_experiment_by_name("dilemma-final-v3")
    if experiment is None:
        raise ValueError("Original local tracking experiment is missing; preserve and reconcile")
    identity = receipt["sha256"] + "/" + stage
    runs = client.search_runs(
        [experiment.experiment_id], f"tags.evaluation_identity = '{identity}'"
    )
    if len(runs) > 1:
        raise ValueError("Duplicate amendment tracker identities")
    run_id = (
        runs[0].info.run_id
        if runs
        else client.create_run(
            experiment.experiment_id,
            tags={
                "evaluation_identity": identity,
                "stage": stage,
                "mlflow.runName": f"recovery-{stage}-{receipt['sha256'][:12]}",
            },
        ).info.run_id
    )
    for key, value in {
        "parent_spec_sha256": receipt["parentSpecSha256"],
        "parent_source_sha256": receipt["parentSourceSha256"],
        "amendment_sha256": receipt["sha256"],
        "amendment_source_sha256": receipt["amendmentSourceSha256"],
        "maximum_attempts_total": 6,
        "decision_seconds": 1800,
        "overload_cooldown_seconds": 300,
        "sample_workers": 2,
        "maximum_concurrent_requests": 4,
        "additional_budget_usd": 0,
        "original_final_deadline_unix": receipt["finalClock"]["deadlineUnix"],
    }.items():
        client.log_param(run_id, key, value)
    for name in ("amendment.json", "source-index.json", "source.tar.gz", "preparation.json"):
        client.log_artifact(run_id, str(directory / name), artifact_path="recovery")
    events = read_events(parent / "final/events.jsonl")
    for key in ("spentUsd", "reservedUsd", "retryExposureUsd"):
        client.log_metric(run_id, key, float(events[-1][key]))
    completed = sum(r["event"] == "episode-ended" and r["status"] == "completed" for r in events)
    client.log_metric(run_id, "completed_episodes", completed)
    analysis_path = directory / f"analysis-{events[-1]['sha256'][:12]}.json"
    if stage == "final" and analysis_path.exists():
        client.log_artifact(run_id, str(analysis_path), artifact_path="recovery/analysis")
    client.set_tag(run_id, "evidence_head", events[-1]["sha256"])
    client.set_terminated(run_id, status="FAILED" if failed else "FINISHED")
    result = {"runId": run_id, "identity": identity, "evidenceHead": events[-1]["sha256"]}
    # Every distinct evidence head gets its own immutable tracker receipt.
    path = directory / f"tracking-{digest(stage)[:10]}-{events[-1]['sha256'][:12]}.json"
    if path.exists():
        if read(path) != result:
            raise ValueError("Existing tracking receipt differs")
    else:
        exclusive_json(path, result)
    return result


def analyse(directory):
    from evaluation_v2.analysis import export

    from .protocol import verify

    _, receipt, events = verify(directory, check_runtime=False, include_events=True)
    parent = Path(receipt["parentDirectory"])
    evidence_head = events[-1]["sha256"]
    diagnostics = transport_diagnostics(events, receipt["parentEventCount"])
    del events
    result = export(parent)
    supplement = {
        **result,
        "amendmentSha256": receipt["sha256"],
        "parentSourceSha256": receipt["parentSourceSha256"],
        "amendmentSourceSha256": receipt["amendmentSourceSha256"],
        "evidenceHead": evidence_head,
        "policy": receipt["policy"],
        "preservedEpisodesAtAmendment": receipt["preservedCompletedEpisodes"],
        "transportBySegment": diagnostics,
        "newInferenceForAnalysis": 0,
        "disclosure": "Provider overload interrupted the run. A user-approved prospective transport amendment retained all previous evidence, the scientific protocol, budget and original global deadline.",
        "publication": "Base export and this amendment receipt/source must accompany one another; no public release while accounting or native-log coverage is unresolved.",
    }
    path = Path(directory) / f"analysis-{evidence_head[:12]}.json"
    if path.exists():
        if read(path) != supplement:
            raise ValueError("Analysis amendment record does not reproduce")
    else:
        exclusive_json(path, supplement)
    return {**supplement, "amendmentRecord": str(path)}
