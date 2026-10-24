"""Offline commands never make model calls. Only launch dispatches paid inference."""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from .design import prepare, read, verify


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("prepare", "verify", "launch", "_execute", "analyse", "release-check"):
        p = commands.add_parser(command)
        p.add_argument("directory", type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    if args.command == "prepare":
        result = prepare(directory)
    elif args.command == "verify":
        result = verify(directory)
    elif args.command == "analyse":
        from .analysis import export

        result = export(directory)
    elif args.command == "release-check":
        result = release_check(directory)
    elif args.command == "_execute":
        from .runner import execute

        def shutdown(signum, frame):
            raise KeyboardInterrupt("Evaluation supervisor requested shutdown")

        signal.signal(signal.SIGTERM, shutdown)
        result = execute(directory)
    else:
        # A watchdog is separate from request timeouts and dollar accounting.
        verify(directory)
        from .runner import execute, stage_completed

        if stage_completed(directory):
            print(json.dumps(execute(directory), indent=2))
            return
        if not os.environ.get("NEBIUS_API_KEY"):
            parser.error("Privately inject NEBIUS_API_KEY before launch; never paste it into chat")
        remaining = 36 * 3600
        if (directory / "clock.json").exists():
            remaining = read(directory / "clock.json")["deadlineUnix"] - time.time()
        if remaining <= 0:
            parser.error("Original campaign clock expired; use analyse for offline exports")
        command = [sys.executable, "-m", "evaluation_v2", "_execute", str(directory)]
        if sys.platform == "darwin":
            command = ["/usr/bin/caffeinate", "-i", *command]
        process = subprocess.Popen(command, start_new_session=True)
        try:
            status = process.wait(timeout=remaining)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            parser.exit(2, "Campaign stopped. Preserve evidence; the original clock is retained.\n")
        if status:
            parser.exit(
                status,
                "Evaluation stopped; preserve evidence and use the same launch command to resume.\n",
            )
        result = {"launchFinished": True, "directory": str(directory)}
    print(json.dumps(result, indent=2))
    if args.command == "release-check" and not result["ready"]:
        raise SystemExit(2)


def release_check(directory):
    """Offline only. Never publishes partial/synthetic runs or rewrites old results."""
    directory = Path(directory)
    verify(directory, check_runtime=False)
    reasons = []
    if not (directory / "final/events.jsonl").exists():
        return {"ready": False, "reasons": ["New final evaluation has not run"]}
    from inspect_ai.log import read_eval_log

    from .analysis import export, verify_export

    result = export(directory)
    report = verify_export(directory, result["export"])
    if report["execution"] != "tokenfactory" or not report["complete"]:
        reasons.append(
            "A complete hosted final campaign is required; partial and synthetic evidence cannot publish"
        )
    from decimal import Decimal

    if Decimal(report["reservedUsd"] or "0") != 0:
        reasons.append("Unresolved final reservations require explicit accounting review")
    observed = set()
    success = False
    for path in (directory / "final/inspect").glob("*.eval"):
        log = read_eval_log(path, exclude_fields={"events", "messages", "attachments", "store"})
        success |= log.status == "success"
        for sample in log.samples or []:
            if sample.scores and sample.error is None:
                observed.add(str(sample.id))
    expected = {
        e["id"] for e in read(directory / f"schedule-{report['selectedBlocksPerTemperature']}.json")
    }
    if not success or not expected <= observed:
        reasons.append("Native Inspect scored-sample coverage is incomplete")
    if (
        not (directory / "tracking-final.json").exists()
        or read(directory / "tracking-final.json").get("evidenceHead") != report["evidenceHead"]
    ):
        reasons.append(
            "Local MLflow final export has not completed; repair tracking without rerunning inference"
        )
    return {
        "ready": not reasons,
        "reasons": reasons,
        "export": result["export"],
        "completed": report["completed"],
        "next": "Prepare the sole final public dataset, report and app cutover from this verified export; retain historical records privately",
    }


if __name__ == "__main__":
    main()
