"""A single reconciled successor to the interrupted local final, within its budget.

Preparation never reads a key or calls a service. Paid stages are explicit CLI
commands, with a fixed clock, exclusive writer locks and immutable receipts.
"""

import asyncio
import fcntl
import os
import time
from contextlib import contextmanager
from pathlib import Path

from .artifacts import (
    bundle,
    export_run,
    hash_file,
    source_index,
    verify_export,
)
from .budget import forecast
from .campaign import CAMPAIGN, authority_path, require_route
from .design import digest, validate_plan, write_json
from .engineering import check_manifest, engineering_forecast, summarise_check
from .gateway import money, read_events
from .local import absolute_directory, probe_local, read, runtime_record
from .recovery import POLICY
from .recovery_runner import execute_recoverable, rebuild_engineering
from .timing import measured_forecast

SUCCESSOR = "recovery-successor-01"
WINDOW_SECONDS = 12 * 3600
FINAL_SECONDS = 9 * 3600


def successor_authority(root):
    return authority_path(root).with_name(f"{CAMPAIGN}-{SUCCESSOR}.json")


def predecessor_files(directory, root):
    # Bind both clocks/claims and the actual export, not just a narrative review.
    names = [
        "campaign.json",
        "accounting.json",
        "parent-plan.json",
        "engineering-plan.json",
        "claims/window.json",
        "claims/engineering.json",
        "claims/final.json",
        "evidence/validation/events.jsonl",
        "evidence/validation/engineering-report.json",
        "evidence/validation/provenance.json",
        "evidence/validation/source.tar.gz",
        "evidence/final/events.jsonl",
        "evidence/final/provenance.json",
        "evidence/final/source.tar.gz",
    ]
    files = {str(directory / n): hash_file(directory / n) for n in names}
    files.update(
        {
            str(p): hash_file(p)
            for p in sorted((directory / "evidence/final-export").iterdir())
            if p.is_file()
        }
    )
    files[str(authority_path(root))] = hash_file(authority_path(root))
    return files


def reconcile_predecessor(directory, root):
    directory = absolute_directory(directory)
    require_route(root, "local", directory)
    report = verify_export(directory / "evidence/final-export")
    if report["completed"] == report["scheduled"] or report["execution"] != "tokenfactory":
        raise ValueError("Require the interrupted hosted local final")
    for stage in ("validation", "final"):
        events = read_events(directory / f"evidence/{stage}/events.jsonl")
        if events[-1]["event"] != "run-ended":
            raise ValueError("Predecessor must have stopped; never overlap coordinators")
    if hash_file(directory / "evidence/final/events.jsonl") != hash_file(
        directory / "evidence/final-export/events.jsonl"
    ):
        raise ValueError("Canonical predecessor ledger differs from verified export")
    engineering = read(directory / "evidence/validation/engineering-report.json")
    check = check_manifest(
        read(directory / "engineering-plan.json"), read(root / "fixtures/engineering-bank.json")
    )
    rebuilt = summarise_check(
        check,
        read(root / "fixtures/engineering-bank.json"),
        read_events(directory / "evidence/validation/events.jsonl"),
        engineering["sourceSha256"],
    )
    if (
        rebuilt != engineering
        or not engineering["passed"]
        or engineering["execution"] != "tokenfactory"
    ):
        raise ValueError("Predecessor engineering report does not reproduce")
    accounting = read(directory / "accounting.json")
    if accounting["pricesConfirmed"] is not True:
        raise ValueError("Predecessor price review is missing")
    return {
        "priorValidationUsd": str(
            money(accounting["priorValidationUsd"])
            + money(engineering["spentUsd"])
            + money(engineering["reservedUsd"])
        ),
        "priorFinalUsd": str(
            money(accounting["priorFinalUsd"])
            + money(report["spentUsd"])
            + money(report["reservedUsd"])
        ),
        "otherChargesReserveUsd": str(money(accounting["otherChargesReserveUsd"])),
        "priceReference": accounting["priceReference"],
        "pricesConfirmed": True,
        "basis": "usage-priced predecessor estimates plus all unresolved reservations; not an invoice",
    }


def prepare_successor(directory, predecessor, root):
    directory = Path(directory).absolute()
    predecessor = absolute_directory(predecessor)
    if directory != directory.resolve() or not directory.parent.is_dir():
        raise ValueError("Require an absolute new preparation path without symlinks")
    if successor_authority(root).exists():
        raise ValueError(
            "Successor already claimed; preserve it and use its supported resume command"
        )
    accounting = reconcile_predecessor(predecessor, root)
    parent = validate_plan(read(predecessor / "parent-plan.json"))
    engineering = validate_plan(read(predecessor / "engineering-plan.json"))
    if parent["blocks"] != 24 or parent["purpose"] != "final" or "derivation" in parent:
        raise ValueError("Require the original 24-block final schedule")
    prices = read(predecessor / "prices.json")
    old_report = read(predecessor / "evidence/validation/engineering-report.json")
    timing = measured_forecast(parent, old_report)
    cost = forecast(parent, prices["prices"], timing["forecastOriginalInputTokens"])
    technical = engineering_forecast(
        engineering, read(root / "fixtures/engineering-bank.json"), prices["prices"]
    )
    final_cap = 18 - money(accounting["priorFinalUsd"])
    technical_cap = 1 - money(accounting["priorValidationUsd"])
    if (
        money(cost["with25PercentReserveUsd"]) + money(POLICY["retryExposureUsd"]["final"])
        > final_cap
        or money(technical["with25PercentReserveUsd"])
        + money(POLICY["retryExposureUsd"]["engineering"])
        > technical_cap
        or timing["with25PercentMarginSeconds"] + 600 > FINAL_SECONDS - 900
        or money(accounting["otherChargesReserveUsd"]) != 8
    ):
        raise ValueError("The full schedule does not fit reconciled allocations and time")
    files = source_index(root)
    record = {
        "schemaVersion": 1,
        "campaignId": CAMPAIGN,
        "successorId": SUCCESSOR,
        "mode": "local-successor",
        "preparationRoot": str(directory),
        "predecessorRoot": str(predecessor),
        "predecessorFiles": predecessor_files(predecessor, root),
        "sourceSha256": digest(files),
        "accounting": accounting,
        "planSha256": parent["sha256"],
        "engineeringPlanSha256": engineering["sha256"],
        "capUsd": {"engineering": str(technical_cap), "final": str(final_cap)},
        "windowSeconds": WINDOW_SECONDS,
        "stageSeconds": {"engineering": 6300, "final": FINAL_SECONDS},
        "recoveryPolicy": POLICY,
        "scientificAmendment": {
            "kind": "fresh-successor/1",
            "originalScheduleSha256": parent["sha256"],
            "poolPredecessorObservations": False,
            "reason": "HTTP 502 interrupted the eight-block predecessor; recovery policy amended prospectively",
            "interpretation": "Earlier outcomes were reviewed; descriptive, not a new confirmatory preregistration",
        },
    }
    directory.mkdir(exist_ok=False)
    (directory / "evidence").mkdir(mode=0o700)
    (directory / "claims").mkdir()
    # A single append-only successor authority retains the original owner verbatim.
    write_json(successor_authority(root), record)
    write_json(directory / "successor.json", record)
    for name, value in (
        ("plan.json", parent),
        ("engineering-plan.json", engineering),
        ("prices.json", prices),
        ("source-index.json", files),
        ("runtime.json", runtime_record()),
        (
            "forecast.json",
            {
                "inference": cost,
                "timing": timing,
                "basis": "predecessor technical telemetry only; must pass again before final",
            },
        ),
        ("engineering-forecast.json", technical),
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
    receipt = stage_record(directory, "engineering")
    verify_successor(directory, root)
    write_json(directory / "engineering-deployment.json", receipt)
    return {
        "prepared": str(directory),
        "blocks": 24,
        "episodes": len(parent["episodes"]),
        "finalCapUsd": str(final_cap),
        "engineeringCapUsd": str(technical_cap),
        "forecastWithMarginAndRetryUsd": str(
            money(cost["with25PercentReserveUsd"]) + money("0.50")
        ),
        "forecastHoursWithMargin": timing["with25PercentMarginSeconds"] / 3600,
        "paidCallsMade": 0,
        "hostedEngineeringRequired": True,
    }


def verify_successor(directory, root):
    directory = absolute_directory(directory)
    record = read(directory / "successor.json")
    if record != read(successor_authority(root)) or record["preparationRoot"] != str(directory):
        raise ValueError("Successor authority differs from preparation")
    if record["successorId"] != SUCCESSOR or record["recoveryPolicy"] != POLICY:
        raise ValueError("Unsupported successor or recovery policy")
    for name, sha in read(directory / "integrity.json")["files"].items():
        if Path(name).name != name or hash_file(directory / name) != sha:
            raise ValueError("Successor preparation integrity mismatch")
    for name, sha in record["predecessorFiles"].items():
        if hash_file(Path(name)) != sha:
            raise ValueError("Predecessor evidence or authority changed")
    files = source_index(root)
    if files != read(directory / "source-index.json") or digest(files) != record["sourceSha256"]:
        raise ValueError("Successor source changed; refuse dispatch or rebinding")
    if runtime_record() != read(directory / "runtime.json"):
        raise ValueError("Successor runtime changed")
    import shutil

    from .local import MIN_FREE_BYTES

    if shutil.disk_usage(directory / "evidence").free < MIN_FREE_BYTES:
        raise ValueError("Insufficient free evidence storage")
    return record


def stage_record(directory, purpose, report=None):
    record = read(directory / "successor.json")
    plan = read(directory / ("engineering-plan.json" if purpose == "engineering" else "plan.json"))
    unsigned = {
        "schemaVersion": 1,
        "mode": "local-successor",
        "preparationRoot": str(directory),
        "purpose": purpose,
        "planSha256": plan["sha256"],
        "sourceFiles": read(directory / "source-index.json"),
        "sourceSha256": record["sourceSha256"],
        "runtime": read(directory / "runtime.json"),
        "accounting": record["accounting"],
        "prices": read(directory / "prices.json"),
        "recoveryPolicy": POLICY,
        "capUsd": record["capUsd"][purpose],
        "stageSeconds": record["stageSeconds"][purpose],
        "successorSha256": digest(record),
        "scientificAmendment": record["scientificAmendment"],
        "engineeringReportSha256": digest(report) if report is not None else None,
        "measuredForecast": measured_forecast(plan, report) if report is not None else None,
    }
    return {
        **unsigned,
        "approvedPlanBoundReceipt": {
            "deploymentSha256": digest(unsigned),
            "purpose": purpose,
            "totalCeilingUsd": "30",
        },
    }


def verify_engineering(directory, root):
    verify_successor(directory, root)
    report = read(directory / "engineering-report.json")
    rebuilt = rebuild_engineering(
        directory / "evidence/engineering", read(root / "fixtures/engineering-bank.json")
    )
    if report != rebuilt or not report["passed"] or report["execution"] != "tokenfactory":
        raise ValueError(
            "Passing successor hosted engineering required; synthetic evidence cannot unlock final"
        )
    evidence = directory / "evidence/engineering"
    provenance = read(evidence / "provenance.json")
    if provenance["deployment"] != {
        **read(directory / "engineering-deployment.json"),
        "clock": read(directory / "claims/engineering.json"),
    }:
        raise ValueError("Engineering clock or deployment changed")
    if provenance["deployment"]["clock"]["windowSha256"] != digest(
        read(directory / "claims/window.json")
    ):
        raise ValueError("Successor window changed after engineering")
    return report


def finalise_successor(directory, root):
    directory = absolute_directory(directory)
    report = verify_engineering(directory, root)
    record = stage_record(directory, "final", report)
    estimate = forecast(
        read(directory / "plan.json"),
        record["prices"]["prices"],
        record["measuredForecast"]["forecastOriginalInputTokens"],
    )
    if money(estimate["with25PercentReserveUsd"]) + money("0.50") > money(record["capUsd"]):
        raise ValueError(
            "Measured final forecast plus retry allowance exceeds remaining allocation"
        )
    window = read(directory / "claims/window.json")
    available = min(FINAL_SECONDS - 900, window["deadlineUnix"] - time.time() - 900)
    if record["measuredForecast"]["with25PercentMarginSeconds"] + 600 > available:
        raise ValueError("Full 24-block schedule does not fit the original successor clock")
    write_json(directory / "final-deployment.json", record)
    return {"finalReady": True, "blocks": 24, "paidCallsMade": 0}


@contextmanager
def stage_lock(directory):
    # File remains after release; fcntl is the lock, not deletion or renaming.
    with (directory / "claims/writer.lock").open("a+") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def claim_stage(directory, purpose, resume):
    path = directory / f"claims/{purpose}.json"
    if resume:
        clock = read(path)
    else:
        now = time.time()
        if purpose == "engineering":
            write_json(
                directory / "claims/window.json",
                {"startedAtUnix": now, "deadlineUnix": now + WINDOW_SECONDS},
            )
        window = read(directory / "claims/window.json")
        clock = {
            "startedAtUnix": now,
            "deadlineUnix": min(
                now + (6300 if purpose == "engineering" else FINAL_SECONDS) - 900,
                window["deadlineUnix"] - 900,
            ),
            "windowSha256": digest(window),
            "purpose": purpose,
        }
        write_json(path, clock)
    window = read(directory / "claims/window.json")
    if clock["windowSha256"] != digest(window) or clock["purpose"] != purpose:
        raise ValueError("Frozen successor clock changed")
    if time.time() >= min(clock["deadlineUnix"], window["deadlineUnix"] - 900):
        raise ValueError("Original successor clock expired; resume never resets it")
    return clock


async def execute_successor(directory, purpose, root, resume=False, transport=None):
    directory = absolute_directory(directory)
    with stage_lock(directory):
        verify_successor(directory, root)
        if purpose == "engineering" and (directory / "engineering-report.json").exists():
            if not resume:
                raise FileExistsError("Engineering is already complete; preserve its report")
            return verify_engineering(directory, root)
        report = verify_engineering(directory, root) if purpose == "final" else None
        record = read(directory / f"{purpose}-deployment.json")
        if record != stage_record(directory, purpose, report):
            raise ValueError("Stage receipt differs from verified inputs")
        if transport is None and not os.environ.get("NEBIUS_API_KEY"):
            raise ValueError("Privately inject NEBIUS_API_KEY; do not paste it into chat")
        if purpose == "final" and not resume:
            available = min(
                FINAL_SECONDS - 900,
                read(directory / "claims/window.json")["deadlineUnix"] - time.time() - 900,
            )
            if record["measuredForecast"]["with25PercentMarginSeconds"] + 600 > available:
                raise ValueError("Measured final schedule no longer fits the original window")
        clock = claim_stage(directory, purpose, resume)
        if (
            resume
            and read(directory / f"evidence/{purpose}/provenance.json")["deployment"]["clock"]
            != clock
        ):
            raise ValueError("Stage clock changed since dispatch")
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
        )
        if purpose == "engineering":
            if result["passed"]:
                write_json(directory / "engineering-report.json", result)
            else:
                save = (
                    directory
                    / f"evidence/engineering/session-{len(read_events(directory / 'evidence/engineering/events.jsonl'))}-report.json"
                )
                write_json(save, result)
        else:
            head = read_events(directory / "evidence/final/events.jsonl")[-1]["sha256"]
            output = directory / f"evidence/final-export-{head[:12]}"
            export_run(directory / "evidence/final", output)
            verify_export(output)
            result["export"] = str(output)
        return result


def add_successor_commands(sub):
    for name in (
        "prepare-successor",
        "verify-successor",
        "finalise-successor",
        "execute-successor",
        "launch-successor",
        "export-successor",
    ):
        parser = sub.add_parser(name)
        parser.add_argument("directory", type=Path)
        if name == "prepare-successor":
            parser.add_argument("--predecessor", type=Path, required=True)
        if name == "execute-successor":
            parser.add_argument("--stage", choices=["engineering", "final"], required=True)
            parser.add_argument("--resume", action="store_true")


def successor_command(args, root):
    directory = args.directory.resolve()
    if args.command == "prepare-successor":
        return prepare_successor(directory, args.predecessor.resolve(), root)
    if args.command == "verify-successor":
        record = verify_successor(directory, root)
        return {
            "prepared": True,
            "paidCallsMade": 0,
            "blocks": 24,
            "hostedEngineeringPassed": (directory / "engineering-report.json").exists(),
            "capUsd": record["capUsd"],
        }
    if args.command == "finalise-successor":
        return finalise_successor(directory, root)
    if args.command == "export-successor":
        with stage_lock(directory):
            verify_successor(directory, root)
            evidence = directory / "evidence/final"
            head = read_events(evidence / "events.jsonl")[-1]["sha256"]
            output = directory / f"evidence/final-export-{head[:12]}"
            if not output.exists():
                export_run(evidence, output)
            report = verify_export(output)
            return {
                "export": str(output),
                "completed": report["completed"],
                "scheduled": report["scheduled"],
                "paidCallsMade": 0,
            }
    if args.command == "launch-successor":
        from .successor_supervisor import launch

        return launch(directory)
    return asyncio.run(execute_successor(directory, args.stage, root, args.resume))
