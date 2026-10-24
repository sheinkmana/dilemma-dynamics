"""Offline preparation/analysis; only launch can send paid requests."""

import argparse
import asyncio
import fcntl
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

from gamefield_research.design import digest

from evaluation_v2.design import read
from evaluation_v2.runner import public_rate_check, stage_completed

from .protocol import prepare, verify


def execute(directory):
    from .runner import evaluate
    from .tracking import analyse, record

    verify(directory)
    receipt = read(Path(directory) / "amendment.json")
    parent = Path(receipt["parentDirectory"])
    with (parent / "execution.lock").open("r") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Recheck after taking the same lock as the original launcher.
        _, receipt, events = verify(directory, include_events=True)
        event_count = len(events)
        del events
        if stage_completed(parent):
            from evaluation_v2.tracking import track

            report = analyse(directory)
            track(parent, "final")
            report["tracking"] = record(directory, "final")
            return report
        if time.time() >= receipt["finalClock"]["deadlineUnix"]:
            raise ValueError("Original final deadline expired; only offline analysis is allowed")
        if not os.environ.get("NEBIUS_API_KEY"):
            raise ValueError("Use the launch shell with NEBIUS_API_KEY privately available")
        if shutil.disk_usage(parent).free < 8 * 1024**3:
            raise ValueError("Keep at least 8 GiB free for evidence")
        public_rate_check(parent)
        record(directory, "preflight")
        session = f"session-{event_count}"
        error = None
        try:
            asyncio.run(evaluate(parent, receipt))
        except BaseException as caught:
            error = caught
            raise
        finally:
            try:
                record(directory, session, failed=error is not None)
            except BaseException as tracking_error:
                if error is None:
                    raise
                print(
                    f"Tracking also needs offline repair: {type(tracking_error).__name__}",
                    file=sys.stderr,
                )
        from evaluation_v2.tracking import track

        report = analyse(directory)
        track(parent, "final")
        report["tracking"] = record(directory, "final")
        return report


def release_check(directory):
    from evaluation_v2.__main__ import release_check as base_check

    from .tracking import analyse

    _, receipt, events = verify(directory, check_runtime=False, include_events=True)
    evidence_head = events[-1]["sha256"]
    del events
    report = analyse(directory)
    result = base_check(Path(receipt["parentDirectory"]))
    tracking = Path(directory) / f"tracking-{digest('final')[:10]}-{evidence_head[:12]}.json"
    if not tracking.exists() or read(tracking).get("identity") != receipt["sha256"] + "/final":
        result["reasons"].append("The amendment's own final MLflow export needs offline repair")
        result["ready"] = False
    # Keep every original gate, especially the zero-unresolved-reservations rule.
    result["amendmentSha256"] = receipt["sha256"]
    result["amendmentRecord"] = report["amendmentRecord"]
    result["sourceProvenance"] = "Original frozen source plus separately frozen recovery amendment"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("prepare")
    p.add_argument("parent", type=Path)
    p.add_argument("directory", type=Path)
    for command in ("verify", "launch", "_execute", "analyse", "release-check"):
        p = commands.add_parser(command)
        p.add_argument("directory", type=Path)
    args = parser.parse_args()
    directory = args.directory.resolve()
    if args.command == "prepare":
        result = prepare(args.parent, directory)
    elif args.command == "verify":
        result = verify(directory)
    elif args.command == "analyse":
        from .tracking import analyse

        result = analyse(directory)
    elif args.command == "release-check":
        result = release_check(directory)
    elif args.command == "_execute":

        def shutdown(signum, frame):
            raise KeyboardInterrupt("Recovery supervisor requested shutdown")

        signal.signal(signal.SIGTERM, shutdown)
        result = execute(directory)
    else:
        verify(directory)
        receipt = read(directory / "amendment.json")
        parent = Path(receipt["parentDirectory"])
        if stage_completed(parent):
            result = execute(directory)
        else:
            remaining = receipt["finalClock"]["deadlineUnix"] - time.time()
            if remaining <= 0:
                parser.error("Original final deadline expired; use analyse")
            if not os.environ.get("NEBIUS_API_KEY"):
                parser.error("Use the original launch shell; keep its NEBIUS_API_KEY private")
            command = [sys.executable, "-m", "evaluation_recovery", "_execute", str(directory)]
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
                parser.exit(2, "Recovery stopped; all original clocks and limits are retained.\n")
            if status:
                parser.exit(
                    status,
                    "Recovery stopped. Preserve evidence; inspect the recorded reason before resuming.\n",
                )
            result = {"launchFinished": True, "directory": str(directory)}
    print(json.dumps(result, indent=2))
    if args.command == "release-check" and not result["ready"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
