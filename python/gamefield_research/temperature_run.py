"""One additive, user-launched temperature-zero evaluation inside the original $30."""

import asyncio
import hashlib
import os
import shutil
import tarfile
import time
from pathlib import Path

from .artifacts import bundle, export_run, hash_file, source_index, verify_export
from .campaign import CAMPAIGN, authority_path
from .design import digest, make_temperature_plan, validate_plan, write_json
from .engineering import engineering_forecast
from .gateway import money, read_events
from .local import MIN_FREE_BYTES, absolute_directory, probe_local, read, runtime_record
from .recovery import OVERLOAD_POLICY, POLICY
from .recovery_runner import execute_recoverable, rebuild_engineering
from .successor import (
    FINAL_SECONDS,
    WINDOW_SECONDS,
    claim_stage,
    reconcile_predecessor,
    stage_lock,
    successor_authority,
)
from .timing import measured_forecast

EVALUATION = "temperature-zero-2026-10-23"
CAPS = {"engineering": "0.35", "final": "15.30"}
RECOVERY_EVALUATION = "temperature-zero-recovery-01-2026-10-23"
RECOVERY_CAPS = {"engineering": "0.30", "final": "15.09"}
PRICE_REFERENCE = (
    "https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference"
)


def temperature_authority(root, evaluation=EVALUATION):
    return authority_path(root).with_name(f"{CAMPAIGN}-{evaluation}.json")


def evaluation_spec(evaluation):
    if evaluation == EVALUATION:
        return CAPS, POLICY
    if evaluation == RECOVERY_EVALUATION:
        return RECOVERY_CAPS, OVERLOAD_POLICY
    raise ValueError("Unsupported temperature evaluation")


def interrupted_reference(directory, root):
    """Verify the stopped attempt against its archived source, never rebind it."""
    directory = absolute_directory(directory)
    record = read(directory / "temperature.json")
    if (
        record["evaluationId"] != EVALUATION
        or record != read(temperature_authority(root))
        or record["preparationRoot"] != str(directory)
    ):
        raise ValueError("Require the original interrupted temperature-zero authority")
    for name, sha in read(directory / "integrity.json")["files"].items():
        if Path(name).name != name or hash_file(directory / name) != sha:
            raise ValueError("Interrupted preparation integrity changed")
    files = dict(record["referenceFiles"])
    for name, sha in files.items():
        if hash_file(Path(name)) != sha:
            raise ValueError("Historical evidence changed")
    source = read(directory / "source-index.json")
    recovered = {}
    with tarfile.open(directory / "source.tar.gz") as archive:
        for member in archive:
            if not member.isfile() or member.name in recovered:
                raise ValueError("Invalid interrupted source archive")
            recovered[member.name] = hashlib.file_digest(
                archive.extractfile(member), "sha256"
            ).hexdigest()
    if recovered != source or digest(source) != record["sourceSha256"]:
        raise ValueError("Interrupted frozen source differs")
    technical = rebuild_engineering(
        directory / "evidence/engineering", read(root / "fixtures/engineering-bank.json")
    )
    if technical != read(directory / "engineering-report.json") or not (
        technical["passed"]
        and technical["execution"] == "tokenfactory"
        and technical.get("temperature") == 0
        and technical["sourceSha256"] == record["sourceSha256"]
    ):
        raise ValueError("Interrupted run's engineering does not reproduce")
    events = read_events(directory / "evidence/final/events.jsonl")
    if events[-1]["event"] != "run-ended" or events[-1]["halted"] is None:
        raise ValueError("Require a stopped incomplete reference; never overlap coordinators")
    exported = directory / f"evidence/final-export-{events[-1]['sha256'][:12]}"
    report = verify_export(exported)
    if (
        report["execution"] != "tokenfactory"
        or report["completed"] == report["scheduled"]
        or hash_file(exported / "events.jsonl")
        != hash_file(directory / "evidence/final/events.jsonl")
    ):
        raise ValueError("Require the canonical interrupted export")
    failures = [e for e in events if e["event"] == "attempt-failed"]
    if not any(e["reason"] == "HTTP 529" and not e["retryable"] for e in failures):
        raise ValueError("This amendment specifically reconciles the recorded HTTP 529 stop")
    plan = validate_plan(read(directory / "plan.json"))
    engineering = validate_plan(read(directory / "engineering-plan.json"))
    if (
        plan["sha256"] != record["planSha256"]
        or plan != read(exported / "plan.json")
        or engineering["sha256"] != record["engineeringPlanSha256"]
    ):
        raise ValueError("Interrupted schedules changed")
    receipt = read(directory / "final-deployment.json")
    unsigned = {k: v for k, v in receipt.items() if k != "approvedPlanBoundReceipt"}
    if receipt["approvedPlanBoundReceipt"]["deploymentSha256"] != digest(unsigned) or read(
        directory / "evidence/final/provenance.json"
    )["deployment"] != {**receipt, "clock": read(directory / "claims/final.json")}:
        raise ValueError("Interrupted receipt or clock changed")
    prior = record["accounting"]
    accounting = {
        "priorValidationUsd": str(
            money(prior["priorValidationUsd"])
            + money(technical["spentUsd"])
            + money(technical["reservedUsd"])
        ),
        "priorFinalUsd": str(
            money(prior["priorFinalUsd"]) + money(report["spentUsd"]) + money(report["reservedUsd"])
        ),
        "otherChargesReserveUsd": prior["otherChargesReserveUsd"],
        "basis": "Includes all predecessor spending and every retained reservation, including the HTTP 529 attempt",
    }
    for path in (
        temperature_authority(root),
        *sorted(p for p in directory.rglob("*") if p.is_file()),
    ):
        files[str(path)] = hash_file(path)
    return plan, engineering, accounting, files, technical


def completed_reference(directory, root):
    """Reconcile authentic completed evidence without rebinding its old source."""
    directory = absolute_directory(directory)
    record = read(directory / "successor.json")
    if record != read(successor_authority(root)) or record["preparationRoot"] != str(directory):
        raise ValueError("Completed reference differs from its preserved authority")
    for name, sha in record["predecessorFiles"].items():
        if hash_file(Path(name)) != sha:
            raise ValueError("Historical predecessor evidence changed")
    prior = reconcile_predecessor(Path(record["predecessorRoot"]), root)
    if prior != record["accounting"]:
        raise ValueError("Completed reference accounting does not reconcile")
    bank = read(root / "fixtures/engineering-bank.json")
    technical = rebuild_engineering(directory / "evidence/engineering", bank)
    if technical != read(directory / "engineering-report.json") or not (
        technical["passed"] and technical["execution"] == "tokenfactory"
    ):
        raise ValueError("Reference engineering evidence does not reproduce")
    events = read_events(directory / "evidence/final/events.jsonl")
    if events[-1]["event"] != "run-ended" or events[-1]["halted"] is not None:
        raise ValueError("Reference must have completed; never overlap coordinators")
    exported = directory / f"evidence/final-export-{events[-1]['sha256'][:12]}"
    report = verify_export(exported)
    if not (
        report["execution"] == "tokenfactory"
        and report["completed"] == report["scheduled"] == 1776
        and hash_file(exported / "events.jsonl")
        == hash_file(directory / "evidence/final/events.jsonl")
    ):
        raise ValueError("Require the complete canonical reference export")
    plan = validate_plan(read(directory / "plan.json"))
    engineering = validate_plan(read(directory / "engineering-plan.json"))
    if (
        plan != read(exported / "plan.json")
        or plan["sha256"] != record["planSha256"]
        or engineering["sha256"] != record["engineeringPlanSha256"]
        or "samplingAmendment" in plan
    ):
        raise ValueError("Reference plans differ from the completed study")
    accounting = {
        "priorValidationUsd": str(
            money(prior["priorValidationUsd"])
            + money(technical["spentUsd"])
            + money(technical["reservedUsd"])
        ),
        "priorFinalUsd": str(
            money(prior["priorFinalUsd"]) + money(report["spentUsd"]) + money(report["reservedUsd"])
        ),
        "otherChargesReserveUsd": prior["otherChargesReserveUsd"],
        "basis": "Retained usage-priced spending plus every unresolved reservation; not an invoice",
    }
    files = dict(record["predecessorFiles"])
    for path in (
        successor_authority(root),
        directory / "successor.json",
        directory / "plan.json",
        directory / "engineering-plan.json",
        directory / "engineering-report.json",
        directory / "prices.json",
        directory / "evidence/engineering/events.jsonl",
        directory / "evidence/engineering/check-plan.json",
        directory / "evidence/engineering/provenance.json",
        directory / "evidence/engineering/source.tar.gz",
        directory / "evidence/final/events.jsonl",
        directory / "evidence/final/provenance.json",
        directory / "evidence/final/source.tar.gz",
        directory / "claims/window.json",
        directory / "claims/engineering.json",
        directory / "claims/final.json",
        *sorted(p for p in exported.iterdir() if p.is_file()),
    ):
        files[str(path)] = hash_file(path)
    return plan, engineering, accounting, files, technical


def prepare_temperature(directory, reference, root, price_reference, *, recovery=False):
    evaluation = RECOVERY_EVALUATION if recovery else EVALUATION
    caps, policy = evaluation_spec(evaluation)
    directory = Path(directory).absolute()
    if directory != directory.resolve() or not directory.parent.is_dir():
        raise ValueError("Require a new absolute preparation path without symlinks")
    if directory.exists() or temperature_authority(root, evaluation).exists():
        raise ValueError(
            "Temperature evaluation already prepared; preserve its authority and claims"
        )
    if price_reference != PRICE_REFERENCE:
        raise ValueError("Use the reviewed public Nemotron pricing reference")
    reference_reader = interrupted_reference if recovery else completed_reference
    parent, engineering, accounting, historical, technical = reference_reader(reference, root)
    plan = parent if recovery else make_temperature_plan(parent)
    check_plan = engineering if recovery else make_temperature_plan(engineering)
    prices = read(reference / "prices.json")
    # Rates checked publicly on 23 October; any changed price book needs explicit review.
    if prices["prices"] != read(root / "fixtures/prices-2026-10-20.json")["prices"]:
        raise ValueError("Price records changed; review before preparing a receipt")
    exposure = money(accounting["priorValidationUsd"]) + money(accounting["priorFinalUsd"])
    unallocated = (
        money("30")
        - exposure
        - money(accounting["otherChargesReserveUsd"])
        - sum(map(money, caps.values()))
    )
    if unallocated < 0 or money(accounting["otherChargesReserveUsd"]) != 8:
        raise ValueError("New allocations do not fit $30 with all retained exposure and reserve")
    from .budget import forecast

    timing = measured_forecast(plan, technical)
    cost = forecast(plan, prices["prices"], timing["forecastOriginalInputTokens"])
    check_cost = engineering_forecast(
        check_plan, read(root / "fixtures/engineering-bank.json"), prices["prices"]
    )
    for stage, estimate in (("engineering", check_cost), ("final", cost)):
        if money(estimate["with25PercentReserveUsd"]) + money(
            policy["retryExposureUsd"][stage]
        ) > money(caps[stage]):
            raise ValueError(
                f"{stage.capitalize()} forecast plus retry exposure exceeds the new stage allocation"
            )
    if timing["with25PercentMarginSeconds"] + 600 > FINAL_SECONDS - 900:
        raise ValueError("Reference timing does not support the full schedule within nine hours")
    files = source_index(root)
    record = {
        "schemaVersion": 1,
        "campaignId": CAMPAIGN,
        "evaluationId": evaluation,
        "mode": "local-temperature",
        "preparationRoot": str(directory),
        "referenceRoot": str(reference),
        "referenceFiles": historical,
        "sourceSha256": digest(files),
        "planSha256": plan["sha256"],
        "engineeringPlanSha256": check_plan["sha256"],
        "accounting": accounting,
        "capUsd": caps,
        "unallocatedUsd": str(unallocated),
        "totalCeilingUsd": "30",
        "windowSeconds": WINDOW_SECONDS,
        "stageSeconds": {"engineering": 6300, "final": FINAL_SECONDS},
        "recoveryPolicy": policy,
        "samplingAmendment": plan["samplingAmendment"],
        "allocationAmendment": "User approved full 24-block temperature-zero bundle within $30 on 23 October 2026",
        "pricesReviewed": {
            "checkedDate": "2026-10-23",
            "reference": price_reference,
            "pricesSha256": digest(prices),
        },
    }
    if recovery:
        record["executionAmendment"] = {
            "kind": "fresh-temperature-recovery/1",
            "failedEvaluationId": EVALUATION,
            "poolFailedObservations": False,
            "reason": "HTTP 529 worker overload was non-retryable under policy v1",
            "interpretation": "Fresh full matched schedule after reviewing the interruption; descriptive",
            "oldClocksRenewed": False,
        }
    directory.mkdir(exist_ok=False)
    (directory / "claims").mkdir()
    (directory / "evidence").mkdir(mode=0o700)
    write_json(temperature_authority(root, evaluation), record)
    write_json(directory / "temperature.json", record)
    for name, value in (
        ("plan.json", plan),
        ("engineering-plan.json", check_plan),
        ("prices.json", prices),
        ("source-index.json", files),
        ("runtime.json", runtime_record()),
        (
            "forecast.json",
            {
                "inference": cost,
                "referenceTiming": timing,
                "basis": "Prior engineering telemetry only; fresh source-bound temperature-zero check required",
            },
        ),
        ("engineering-forecast.json", check_cost),
    ):
        write_json(directory / name, value)
    probe_local(directory / "evidence", directory / "storage-probe.json")
    write_json(directory / "source-packet.json", bundle(root, directory / "source.tar.gz"))
    write_json(
        directory / "integrity.json",
        {
            "schemaVersion": 1,
            "files": {p.name: hash_file(p) for p in sorted(directory.iterdir()) if p.is_file()},
        },
    )
    verify_temperature(directory, root)
    write_json(directory / "engineering-deployment.json", stage_record(directory, "engineering"))
    return {
        "prepared": str(directory),
        "episodes": 1776,
        "temperature": 0,
        "capUsd": caps,
        "unallocatedUsd": str(unallocated),
        "paidCallsMade": 0,
    }


def verify_temperature(directory, root):
    directory = absolute_directory(directory)
    record = read(directory / "temperature.json")
    caps, policy = evaluation_spec(record["evaluationId"])
    if record != read(temperature_authority(root, record["evaluationId"])) or record[
        "preparationRoot"
    ] != str(directory):
        raise ValueError("Temperature authority differs from preparation")
    if (
        record["capUsd"] != caps
        or record["recoveryPolicy"] != policy
        or record["totalCeilingUsd"] != "30"
    ):
        raise ValueError("Unsupported temperature evaluation or allocation")
    for name, sha in read(directory / "integrity.json")["files"].items():
        if Path(name).name != name or hash_file(directory / name) != sha:
            raise ValueError("Temperature preparation integrity mismatch")
    for name, sha in record["referenceFiles"].items():
        if hash_file(Path(name)) != sha:
            raise ValueError("Historical reference evidence or authority changed")
    files = source_index(root)
    if files != read(directory / "source-index.json") or digest(files) != record["sourceSha256"]:
        raise ValueError("Temperature source changed; refuse dispatch or rebinding")
    if runtime_record() != read(directory / "runtime.json"):
        raise ValueError("Temperature runtime changed")
    if shutil.disk_usage(directory / "evidence").free < MIN_FREE_BYTES:
        raise ValueError("Insufficient free evidence storage")
    return record


def stage_record(directory, purpose, report=None):
    record = read(directory / "temperature.json")
    plan = read(directory / ("engineering-plan.json" if purpose == "engineering" else "plan.json"))
    unsigned = {
        "schemaVersion": 1,
        "mode": "local-temperature",
        "preparationRoot": str(directory),
        "evaluationId": record["evaluationId"],
        "purpose": purpose,
        "planSha256": plan["sha256"],
        "sourceFiles": read(directory / "source-index.json"),
        "sourceSha256": record["sourceSha256"],
        "runtime": read(directory / "runtime.json"),
        "accounting": record["accounting"],
        "prices": read(directory / "prices.json"),
        "recoveryPolicy": record["recoveryPolicy"],
        "capUsd": record["capUsd"][purpose],
        "stageSeconds": record["stageSeconds"][purpose],
        "episodeWorkers": 2 if purpose == "engineering" else 4,
        "temperaturePreparationSha256": digest(record),
        "samplingAmendment": plan["samplingAmendment"],
        "engineeringReportSha256": digest(report) if report is not None else None,
        "measuredForecast": measured_forecast(plan, report) if report is not None else None,
    }
    if "executionAmendment" in record:
        unsigned["executionAmendment"] = record["executionAmendment"]
    return {
        **unsigned,
        "approvedPlanBoundReceipt": {
            "deploymentSha256": digest(unsigned),
            "purpose": purpose,
            "totalCeilingUsd": "30",
        },
    }


def verified_engineering(directory, root):
    verify_temperature(directory, root)
    report = read(directory / "engineering-report.json")
    evidence = directory / "evidence/engineering"
    if report != rebuild_engineering(
        evidence, read(root / "fixtures/engineering-bank.json")
    ) or not (
        report["passed"]
        and report["execution"] == "tokenfactory"
        and report.get("temperature") == 0
        and report["recoveryPolicySha256"]
        == digest(read(directory / "temperature.json")["recoveryPolicy"])
    ):
        raise ValueError(
            "Passing hosted temperature-zero engineering required; synthetic is excluded"
        )
    clock = read(directory / "claims/engineering.json")
    expected = {**stage_record(directory, "engineering"), "clock": clock}
    if read(evidence / "provenance.json")["deployment"] != expected or clock[
        "windowSha256"
    ] != digest(read(directory / "claims/window.json")):
        raise ValueError("Temperature engineering clock or receipt changed")
    return report


def finalise_temperature(directory, root):
    report = verified_engineering(directory, root)
    record = stage_record(directory, "final", report)
    from .budget import forecast

    estimate = forecast(
        read(directory / "plan.json"),
        record["prices"]["prices"],
        record["measuredForecast"]["forecastOriginalInputTokens"],
    )
    if money(estimate["with25PercentReserveUsd"]) + money(
        record["recoveryPolicy"]["retryExposureUsd"]["final"]
    ) > money(record["capUsd"]):
        raise ValueError("Measured forecast plus retry exposure exceeds temperature allocation")
    require_time(directory, record)
    write_json(directory / "final-deployment.json", record)
    return {"finalReady": True, "blocks": 24, "temperature": 0, "paidCallsMade": 0}


def require_time(directory, record):
    available = min(
        FINAL_SECONDS - 900,
        read(directory / "claims/window.json")["deadlineUnix"] - time.time() - 900,
    )
    if record["measuredForecast"]["with25PercentMarginSeconds"] + 600 > available:
        raise ValueError("Full temperature-zero schedule does not fit the original window")


def export_temperature(directory):
    evidence = directory / "evidence/final"
    head = read_events(evidence / "events.jsonl")[-1]["sha256"]
    output = directory / f"evidence/final-export-{head[:12]}"
    if not output.exists():
        export_run(evidence, output)
    return output, verify_export(output)


async def execute_temperature(directory, purpose, root, resume=False, transport=None):
    if purpose not in ("engineering", "final"):
        raise ValueError("Unknown temperature stage")
    directory = absolute_directory(directory)
    with stage_lock(directory):
        verify_temperature(directory, root)
        if purpose == "engineering" and (directory / "engineering-report.json").exists():
            if not resume:
                raise FileExistsError("Engineering already completed; preserve its report")
            return verified_engineering(directory, root)
        report = verified_engineering(directory, root) if purpose == "final" else None
        record = read(directory / f"{purpose}-deployment.json")
        if record != stage_record(directory, purpose, report):
            raise ValueError("Temperature receipt differs from verified inputs")
        if transport is None and not os.environ.get("NEBIUS_API_KEY"):
            raise ValueError("Privately inject NEBIUS_API_KEY; do not paste it into chat")
        if purpose == "final" and not resume:
            require_time(directory, record)
        clock = claim_stage(directory, purpose, resume)
        if (
            resume
            and read(directory / f"evidence/{purpose}/provenance.json")["deployment"]["clock"]
            != clock
        ):
            raise ValueError("Temperature stage clock changed since dispatch")
        result = await execute_recoverable(
            read(
                directory / ("engineering-plan.json" if purpose == "engineering" else "plan.json")
            ),
            directory / f"evidence/{purpose}",
            record["prices"]["prices"],
            root,
            {**record, "clock": clock},
            clock["deadlineUnix"],
            record["capUsd"],
            purpose,
            transport=transport,
            resume=resume,
            bank=read(root / "fixtures/engineering-bank.json")
            if purpose == "engineering"
            else None,
            episode_workers=record["episodeWorkers"],
            recovery_policy=record["recoveryPolicy"],
        )
        if purpose == "engineering":
            if result["passed"]:
                write_json(directory / "engineering-report.json", result)
            else:
                head = read_events(directory / "evidence/engineering/events.jsonl")[-1]["sha256"]
                write_json(
                    directory / f"evidence/engineering/session-{head[:12]}-report.json", result
                )
        else:
            output, _ = export_temperature(directory)
            result["export"] = str(output)
        return result


def add_temperature_commands(sub):
    for name in (
        "prepare-temperature",
        "verify-temperature",
        "finalise-temperature",
        "execute-temperature",
        "launch-temperature",
        "export-temperature",
    ):
        parser = sub.add_parser(name)
        parser.add_argument("directory", type=Path)
        if name == "prepare-temperature":
            reference = parser.add_mutually_exclusive_group(required=True)
            reference.add_argument("--reference-successor", type=Path)
            reference.add_argument("--reference-interrupted", type=Path)
            parser.add_argument("--price-reference", required=True)
        if name == "execute-temperature":
            parser.add_argument("--stage", choices=["engineering", "final"], required=True)
            parser.add_argument("--resume", action="store_true")


def temperature_command(args, root):
    directory = args.directory.resolve()
    if args.command == "prepare-temperature":
        return prepare_temperature(
            directory,
            (args.reference_interrupted or args.reference_successor).resolve(),
            root,
            args.price_reference,
            recovery=args.reference_interrupted is not None,
        )
    if args.command == "verify-temperature":
        record = verify_temperature(directory, root)
        return {
            "prepared": True,
            "paidCallsMade": 0,
            "temperature": 0,
            "blocks": 24,
            "hostedEngineeringPassed": (directory / "engineering-report.json").exists(),
            "capUsd": record["capUsd"],
            "unallocatedUsd": record["unallocatedUsd"],
        }
    if args.command == "finalise-temperature":
        with stage_lock(directory):
            return finalise_temperature(directory, root)
    if args.command == "export-temperature":
        with stage_lock(directory):
            verify_temperature(directory, root)
            output, report = export_temperature(directory)
            return {
                "export": str(output),
                "completed": report["completed"],
                "scheduled": report["scheduled"],
                "paidCallsMade": 0,
            }
    if args.command == "launch-temperature":
        from .successor_supervisor import launch

        return launch(directory, command_suffix="temperature")
    return asyncio.run(execute_temperature(directory, args.stage, root, args.resume))
