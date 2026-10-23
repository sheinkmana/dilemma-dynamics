"""User-invoked successor pipeline; process restarts cannot renew its clock."""

import fcntl
import os
import signal
import subprocess
import sys
import time

from .analysis import analyse_file
from .local import read
from .local_supervisor import termination_as_interrupt
from .successor import WINDOW_SECONDS


def launch(directory, *, command_suffix="successor"):
    if command_suffix not in ("successor", "temperature"):
        raise ValueError("Unsupported evaluation supervisor")
    with (directory / "claims/supervisor.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with termination_as_interrupt():
            return _launch(directory, command_suffix)


def _launch(directory, command_suffix="successor"):
    window = directory / "claims/window.json"
    wall_end = read(window)["deadlineUnix"] if window.exists() else time.time() + WINDOW_SECONDS
    monotonic_end = time.monotonic() + max(0, wall_end - time.time())
    commands = [[f"verify-{command_suffix}", str(directory)]]
    if not (directory / "engineering-report.json").exists():
        command = [f"execute-{command_suffix}", str(directory), "--stage", "engineering"]
        if (directory / "claims/engineering.json").exists():
            command.append("--resume")
        commands.append(command)
    if not (directory / "final-deployment.json").exists():
        commands.append([f"finalise-{command_suffix}", str(directory)])
    final = directory / "evidence/final/events.jsonl"
    complete = False
    if final.exists():
        report, _ = analyse_file(read(directory / "plan.json"), final)
        complete = report["completed"] == report["scheduled"]
    if not complete:
        command = [f"execute-{command_suffix}", str(directory), "--stage", "final"]
        if (directory / "claims/final.json").exists():
            command.append("--resume")
        commands.append(command)
    commands.append([f"export-{command_suffix}", str(directory)])
    for command in commands:
        if time.time() >= wall_end - 15:
            raise ValueError("Original successor window expired; preserve all evidence")
        process = subprocess.Popen(
            [sys.executable, "-m", "gamefield_research.cli", *command],
            start_new_session=True,
        )
        try:
            while process.poll() is None:
                remaining = min(wall_end - time.time(), monotonic_end - time.monotonic())
                if remaining <= 15:
                    raise TimeoutError("Successor 12-hour process window reached")
                time.sleep(min(1, remaining - 15))
            if process.returncode:
                raise ValueError(
                    f"Stage {command[0]} stopped; checkpoint and original clock retained"
                )
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGINT)
                try:
                    process.wait(timeout=max(0, min(10, wall_end - time.time())))
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
    return {"pipelineFinished": True, "originalClockPreserved": True}
