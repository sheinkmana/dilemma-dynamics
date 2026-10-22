"""Explicit laptop execution with frozen plans, receipts and a shared 12-hour clock."""

import asyncio
import fcntl
import importlib.metadata
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from .artifacts import bundle, export_run, hash_file, source_index, verify_export
from .budget import forecast
from .campaign import authority_path, claim_local_stage, claim_route, require_route
from .design import derive_local_plan, digest, validate_plan, write_json
from .engineering import check_manifest, check_provider, engineering_forecast, summarise_check
from .gateway import fsync_directory, money, read_events
from .runner import run
from .timing import measured_forecast

MIN_FREE_BYTES = 1024**3


def read(path):
    return json.loads(Path(path).read_text())


def runtime_record():
    return {
        "python": sys.version,
        "platform": sys.platform,
        "machine": platform.machine(),
        "packages": dict(
            sorted(
                (d.metadata["Name"].lower().replace("_", "-"), d.version)
                for d in importlib.metadata.distributions()
            )
        ),
    }


def absolute_directory(path):
    path = Path(path)
    if not path.is_absolute() or path != path.resolve() or not path.is_dir():
        raise ValueError("Require an absolute existing directory without symlink components")
    return path


def probe_local(directory, output):
    directory = absolute_directory(directory)
    if shutil.disk_usage(directory).free < MIN_FREE_BYTES:
        raise ValueError("Require at least 1 GiB free for evidence")
    with tempfile.TemporaryDirectory(prefix=".local-probe-", dir=directory) as name:
        work = Path(name)
        path = work / "exclusive"
        with path.open("x") as stream:
            stream.write("local-evidence-probe\n")
            stream.flush()
            os.fsync(stream.fileno())
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "import fcntl,sys; f=open(sys.argv[1]);\n"
                    "try: fcntl.flock(f, fcntl.LOCK_EX|fcntl.LOCK_NB)\n"
                    "except BlockingIOError: sys.exit(0)\n"
                    "sys.exit(1)\n",
                    str(path),
                ],
                check=True,
                timeout=10,
            )
        try:
            path.open("x").close()
        except FileExistsError:
            pass
        else:
            raise ValueError("Exclusive creation is not enforced")
        path.rename(work / "renamed")
        fsync_directory(work)
        if (work / "renamed").read_text() != "local-evidence-probe\n":
            raise ValueError("Local evidence readback failed")
    report = {
        "schemaVersion": 1,
        "mode": "local",
        "directory": str(directory),
        "platform": sys.platform,
        "passed": True,
        "minimumFreeBytes": MIN_FREE_BYTES,
        "checks": ["fsync", "exclusive-create", "cross-process-lock", "rename-readback"],
        "limitation": "Functional local check; no claim of cloud durability or power-loss protection",
    }
    write_json(output, report)
    return report


def prepare_local(directory, parent_path, engineering_path, prices_path, root):
    directory = Path(directory).absolute()
    if directory != directory.resolve() or not directory.parent.is_dir():
        raise ValueError("Preparation parent must exist and contain no symlink components")
    parent, engineering = validate_plan(read(parent_path)), validate_plan(read(engineering_path))
    if engineering["purpose"] != "engineering" or "derivation" in engineering:
        raise ValueError("Require the original engineering plan")
    candidates = {n: derive_local_plan(parent, n) for n in (4, 8)}
    prices = read(prices_path)
    engineering_forecast(
        engineering, read(Path(root) / "fixtures/engineering-bank.json"), prices["prices"]
    )
    if authority_path(root).exists():
        raise ValueError("Campaign already has an owner; preserve its claim and inspect it")
    directory.mkdir(exist_ok=False)
    (directory / "evidence").mkdir(mode=0o700)
    (directory / "claims").mkdir()
    files = source_index(root)
    owner = claim_route(root, "local", directory, digest(files))
    write_json(directory / "campaign.json", owner)
    write_json(directory / "parent-plan.json", parent)
    write_json(directory / "engineering-plan.json", engineering)
    write_json(directory / "prices.json", prices)
    write_json(directory / "runtime.json", runtime_record())
    probe_local(directory / "evidence", directory / "storage-probe.json")
    for n, plan in candidates.items():
        write_json(directory / f"candidate-{n}.json", plan)
        write_json(directory / f"forecast-{n}.json", forecast(plan, prices["prices"]))
    write_json(
        directory / "engineering-forecast.json",
        engineering_forecast(
            engineering,
            read(Path(root) / "fixtures/engineering-bank.json"),
            prices["prices"],
        ),
    )
    write_json(directory / "source-index.json", files)
    packet = bundle(root, directory / "source.tar.gz")
    write_json(directory / "source-packet.json", packet)
    write_json(
        directory / "review-inputs.example.json",
        {
            "pricesConfirmed": False,
            "priceReference": None,
            "priorValidationUsd": None,
            "priorFinalUsd": None,
            "otherChargesReserveUsd": None,
            "notes": "Reconcile charges and retained resources; no keys or credentials belong here.",
        },
    )
    write_json(
        directory / "preparation-integrity.json",
        {
            "schemaVersion": 1,
            "files": {p.name: hash_file(p) for p in sorted(directory.iterdir()) if p.is_file()},
        },
    )
    return {"prepared": str(directory), "sourceSha256": digest(files), "launchable": False}


def verify_preparation(directory, root):
    directory = absolute_directory(directory)
    owner = require_route(root, "local", directory)
    if owner != read(directory / "campaign.json"):
        raise ValueError("Campaign owner differs from preparation")
    for name, sha in read(directory / "preparation-integrity.json")["files"].items():
        if Path(name).name != name or hash_file(directory / name) != sha:
            raise ValueError("Preparation integrity mismatch")
    files = source_index(root)
    if files != read(directory / "source-index.json") or owner["sourceSha256"] != digest(files):
        raise ValueError("Source changed since preparation; no paid execution is allowed")
    if runtime_record() != read(directory / "runtime.json"):
        raise ValueError("Python runtime or installed dependency versions changed")
    evidence = absolute_directory(directory / "evidence")
    probe = read(directory / "storage-probe.json")
    if (
        probe
        != {
            **probe,
            "mode": "local",
            "directory": str(evidence),
            "platform": sys.platform,
            "passed": True,
            "minimumFreeBytes": MIN_FREE_BYTES,
            "checks": ["fsync", "exclusive-create", "cross-process-lock", "rename-readback"],
        }
        or shutil.disk_usage(evidence).free < MIN_FREE_BYTES
    ):
        raise ValueError("Local storage check failed or insufficient free space")
    return directory


def deployment_record(directory, plan, accounting):
    files = read(directory / "source-index.json")
    return {
        "schemaVersion": 1,
        "mode": "local",
        "preparationRoot": str(directory),
        "planSha256": plan["sha256"],
        "sourceFiles": files,
        "sourceSha256": digest(files),
        "runtime": read(directory / "runtime.json"),
        "storageProbe": read(directory / "storage-probe.json"),
        "prices": read(directory / "prices.json"),
        "pricesSha256": hash_file(directory / "prices.json"),
        "accounting": accounting,
        "windowPolicy": {"totalSeconds": 43200, "inferenceSeconds": 39600},
        "stageSeconds": 6300 if plan["purpose"] == "engineering" else 32400,
        "capUsd": str(
            money("1" if plan["purpose"] == "engineering" else "18")
            - money(
                accounting[
                    "priorValidationUsd" if plan["purpose"] == "engineering" else "priorFinalUsd"
                ]
            )
        ),
        "engineeringReportSha256": None,
        "measuredForecast": None,
        "approvedPlanBoundReceipt": None,
    }


def hosted_report(directory, root):
    run_dir = directory / "evidence" / "validation"
    report = read(run_dir / "engineering-report.json")
    provenance = read(run_dir / "provenance.json")
    if provenance["sourceFiles"] != source_index(root):
        raise ValueError("Engineering source differs from current source")
    context = provenance["executionContext"]
    if (
        provenance["deployment"] != read(directory / "engineering-deployment.json")
        or context["campaignWindow"] != read(directory / "claims/window.json")
        or context["stageClaim"] != read(directory / "claims/engineering.json")
    ):
        raise ValueError("Engineering deployment, claim or shared campaign clock changed")
    bank = read(Path(root) / "fixtures/engineering-bank.json")
    check = check_manifest(read(directory / "engineering-plan.json"), bank)
    if check != read(run_dir / "check-plan.json"):
        raise ValueError("Engineering manifest changed")
    events = read_events(run_dir / "events.jsonl")
    if (
        events[0]["prices"] != read(directory / "prices.json")["prices"]
        or events[0]["planSha256"] != check["sha256"]
    ):
        raise ValueError("Engineering used different prices or plan")
    rebuilt = summarise_check(check, bank, events, digest(source_index(root)))
    if report != rebuilt or not report["passed"] or report["execution"] != "tokenfactory":
        raise ValueError(
            "Passing hosted engineering evidence is required; synthetic evidence is excluded"
        )
    spent = money(report["spentUsd"]) + money(report["reservedUsd"])
    accounting = read(directory / "accounting.json")
    if spent > 1 - money(accounting["priorValidationUsd"]):
        raise ValueError("Engineering allocation was exceeded")
    return report


def verify_local_deployment(directory, plan, record, root, receipt=True):
    directory = verify_preparation(directory, root)
    validate_plan(plan)
    accounting = read(directory / "accounting.json")
    if accounting.get("pricesConfirmed") is not True or not accounting.get("priceReference"):
        raise ValueError("Current prices need an explicit non-secret review reference")
    if (
        money(accounting["priorValidationUsd"]) >= 1
        or money(accounting["priorFinalUsd"]) >= 18
        or money(accounting["otherChargesReserveUsd"]) > 8
    ):
        raise ValueError("Reconciled exposure does not fit the existing allocations")
    expected = deployment_record(directory, plan, accounting)
    if plan["purpose"] == "engineering":
        if plan != read(directory / "engineering-plan.json"):
            raise ValueError("Engineering schedule changed")
        estimate = engineering_forecast(
            plan, read(Path(root) / "fixtures/engineering-bank.json"), expected["prices"]["prices"]
        )
    else:
        if plan != derive_local_plan(read(directory / "parent-plan.json"), plan["blocks"]):
            raise ValueError("Final plan does not preserve the parent schedule")
        report = hosted_report(directory, root)
        expected["engineeringReportSha256"] = hash_file(
            directory / "evidence/validation/engineering-report.json"
        )
        expected["measuredForecast"] = measured_forecast(plan, report)
        timing = expected["measuredForecast"]
        window = read(directory / "claims/window.json")
        available = min(32400 - 900, window["inferenceDeadlineUnix"] - time.time() - 900)
        if timing["with25PercentMarginSeconds"] > available:
            raise ValueError("Measured final runtime does not fit the remaining dispatch window")
        estimate = forecast(
            plan, expected["prices"]["prices"], timing["forecastOriginalInputTokens"]
        )
    if money(estimate["with25PercentReserveUsd"]) > money(expected["capUsd"]):
        raise ValueError("Inference forecast exceeds the remaining stage allocation")
    unsigned = {k: v for k, v in record.items() if k != "approvedPlanBoundReceipt"}
    if unsigned != {k: v for k, v in expected.items() if k != "approvedPlanBoundReceipt"}:
        raise ValueError("Local deployment record differs from verified inputs")
    if receipt and record.get("approvedPlanBoundReceipt") != {
        "deploymentSha256": digest(unsigned),
        "purpose": plan["purpose"],
        "totalCeilingUsd": "30",
    }:
        raise ValueError("Reviewed plan-bound receipt is missing or changed")
    return expected["prices"]["prices"]


def seal_receipt(record):
    unsigned = {k: v for k, v in record.items() if k != "approvedPlanBoundReceipt"}
    record["approvedPlanBoundReceipt"] = {
        "deploymentSha256": digest(unsigned),
        "purpose": "engineering" if record["stageSeconds"] == 6300 else "final",
        "totalCeilingUsd": "30",
    }
    return record


def review_local(directory, inputs, root):
    directory = verify_preparation(directory, root)
    if (directory / "accounting.json").exists():
        raise ValueError("Accounting review already exists; preserve it and its receipt")
    # Validate all input amounts before writing the irreversible review marker.
    if inputs.get("pricesConfirmed") is not True or not inputs.get("priceReference"):
        raise ValueError("Confirm the price snapshot and supply its review reference")
    for field, limit in (
        ("priorValidationUsd", 1),
        ("priorFinalUsd", 18),
        ("otherChargesReserveUsd", 8),
    ):
        amount = money(inputs[field])
        if amount > limit or (field != "otherChargesReserveUsd" and amount == limit):
            raise ValueError(f"{field} exceeds or exhausts its allocation")
    accounting = {
        k: inputs[k]
        for k in (
            "pricesConfirmed",
            "priceReference",
            "priorValidationUsd",
            "priorFinalUsd",
            "otherChargesReserveUsd",
        )
    }
    accounting["reviewedAtUnix"] = time.time()
    plan = read(directory / "engineering-plan.json")
    estimate = engineering_forecast(
        plan,
        read(Path(root) / "fixtures/engineering-bank.json"),
        read(directory / "prices.json")["prices"],
    )
    if money(estimate["with25PercentReserveUsd"]) > 1 - money(accounting["priorValidationUsd"]):
        raise ValueError("Engineering forecast exceeds remaining validation allocation")
    write_json(directory / "accounting.json", accounting)
    record = deployment_record(directory, plan, accounting)
    verify_local_deployment(directory, plan, record, root, receipt=False)
    write_json(directory / "engineering-deployment.json", seal_receipt(record))
    return {"engineeringReady": True, "paidCallsMade": 0}


def finalise_local(directory, root, blocks=None):
    directory = verify_preparation(directory, root)
    report = hosted_report(directory, root)
    accounting = read(directory / "accounting.json")
    failures = {}
    for count in (blocks,) if blocks is not None else (8, 4):
        plan = read(directory / f"candidate-{count}.json")
        record = deployment_record(directory, plan, accounting)
        record["engineeringReportSha256"] = hash_file(
            directory / "evidence/validation/engineering-report.json"
        )
        record["measuredForecast"] = measured_forecast(plan, report)
        try:
            verify_local_deployment(directory, plan, record, root, receipt=False)
        except ValueError as error:
            failures[count] = str(error)
            continue
        selected = directory / "selected"
        selected.mkdir(exist_ok=False)
        write_json(selected / "plan.json", plan)
        write_json(selected / "deployment.json", seal_receipt(record))
        write_json(
            selected / "selection.json",
            {
                "rule": "largest feasible of eight then four; timing and budget only",
                "blocks": count,
                "planSha256": plan["sha256"],
                "rejectedCandidates": failures,
            },
        )
        return {"selectedBlocks": count, "planSha256": plan["sha256"], "paidCallsMade": 0}
    raise ValueError(f"No requested candidate fits: {failures}")


async def execute_local(directory, purpose, root, transport=None):
    directory = Path(directory).resolve()
    plan_path = directory / (
        "engineering-plan.json" if purpose == "engineering" else "selected/plan.json"
    )
    record_path = directory / (
        "engineering-deployment.json" if purpose == "engineering" else "selected/deployment.json"
    )
    plan, record = read(plan_path), read(record_path)
    prices = verify_local_deployment(directory, plan, record, root)
    if transport is None and not os.environ.get("NEBIUS_API_KEY"):
        raise ValueError(
            "Privately inject NEBIUS_API_KEY into this process; do not paste it into chat"
        )
    window = claim_local_stage(directory, purpose, plan["sha256"])
    margin = 900 if purpose == "final" else 0
    deadline = min(
        time.time() + record["stageSeconds"] - margin, window["inferenceDeadlineUnix"] - 900
    )
    evidence = directory / "evidence"
    if purpose == "engineering":
        report = await check_provider(
            plan,
            read(Path(root) / "fixtures/engineering-bank.json"),
            evidence / "validation",
            prices,
            root,
            transport=transport,
            deployment=record,
            wall_seconds=deadline - time.time(),
            cap_usd=record["capUsd"],
            wall_deadline=deadline,
        )
        if not report["passed"]:
            raise ValueError("Engineering did not pass; preserve evidence and do not retry")
        return {
            "engineeringPassed": True,
            "execution": report["execution"],
            "spentUsd": report["spentUsd"],
        }
    await run(
        plan,
        evidence / "final",
        prices,
        transport=transport,
        deployment=record,
        source_root=root,
        wall_seconds=deadline - time.time(),
        cap_usd=record["capUsd"],
        wall_deadline=deadline,
    )
    export_run(evidence / "final", evidence / "final-export")
    report = verify_export(evidence / "final-export")
    return {
        "completed": report["completed"],
        "scheduled": report["scheduled"],
        "spentUsd": report["spentUsd"],
    }


def add_local_commands(sub):
    p = sub.add_parser("prepare-local", help="Offline local preparation; no model calls")
    p.add_argument("directory", type=Path)
    p.add_argument("--parent-plan", type=Path, required=True)
    p.add_argument("--engineering-plan", type=Path, required=True)
    p.add_argument("--prices", type=Path, required=True)
    p = sub.add_parser(
        "review-local", help="Bind reviewed prices/accounting to the engineering receipt"
    )
    p.add_argument("directory", type=Path)
    p.add_argument("--inputs", type=Path, required=True)
    p = sub.add_parser(
        "finalise-local", help="Select and receipt a final plan using hosted technical telemetry"
    )
    p.add_argument("directory", type=Path)
    p.add_argument("--blocks", type=int, choices=[4, 8])
    for name in (
        "verify-local",
        "check-provider-local",
        "run-local",
        "status-local",
        "launch-local",
    ):
        p = sub.add_parser(name)
        p.add_argument("directory", type=Path)
        if name == "verify-local":
            p.add_argument("--stage", choices=["engineering", "final"], default="engineering")


def local_command(args, root):
    if args.command == "launch-local":
        from .local_supervisor import supervised_pipeline

        return supervised_pipeline(args.directory.resolve())
    if args.command == "prepare-local":
        return prepare_local(
            args.directory, args.parent_plan, args.engineering_plan, args.prices, root
        )
    if args.command == "review-local":
        return review_local(args.directory, read(args.inputs), root)
    if args.command == "finalise-local":
        return finalise_local(args.directory, root, args.blocks)
    if args.command == "status-local":
        directory = args.directory.resolve()
        status = {"campaign": read(directory / "campaign.json"), "paidCallsMade": 0}
        if (directory / "claims/window.json").exists():
            window = read(directory / "claims/window.json")
            status["window"] = {
                **window,
                "remainingInferenceSeconds": max(0, window["inferenceDeadlineUnix"] - time.time()),
            }
        for purpose, name in (("engineering", "validation"), ("final", "final")):
            path = directory / "evidence" / name / "events.jsonl"
            if path.exists():
                events = read_events(path)
                status[purpose] = {
                    "events": len(events),
                    "completedEpisodes": sum(
                        e["event"] == "episode-ended" and e["status"] == "completed" for e in events
                    ),
                    "engineeringDecisions": sum(
                        e["event"] == "engineering-decision" for e in events
                    ),
                    "terminal": events[-1]
                    if events and events[-1]["event"] == "run-ended"
                    else None,
                }
        return status
    if args.command == "verify-local":
        directory = args.directory.resolve()
        paths = (
            ("engineering-plan.json", "engineering-deployment.json")
            if args.stage == "engineering"
            else ("selected/plan.json", "selected/deployment.json")
        )
        verify_local_deployment(
            directory, read(directory / paths[0]), read(directory / paths[1]), root
        )
        return {"planValid": True, "launchable": True, "stage": args.stage, "paidCallsMade": 0}
    return asyncio.run(
        execute_local(
            args.directory,
            "engineering" if args.command == "check-provider-local" else "final",
            root,
        )
    )
