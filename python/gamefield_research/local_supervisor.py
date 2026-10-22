"""User-invoked paid pipeline with a process-group watchdog and no retries."""

import os
import signal
import subprocess
import sys
import time
from contextlib import contextmanager


@contextmanager
def termination_as_interrupt():
    def interrupt(signum, frame):
        raise KeyboardInterrupt()

    previous = signal.signal(signal.SIGTERM, interrupt)
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, previous)


def supervised_pipeline(directory):
    with termination_as_interrupt():
        return _pipeline(directory)


def _pipeline(directory):
    commands = [
        ["verify-local", str(directory)],
        ["check-provider-local", str(directory)],
        ["finalise-local", str(directory)],
        ["verify-local", str(directory), "--stage", "final"],
        ["run-local", str(directory)],
    ]
    wall_end = time.time() + 12 * 3600
    monotonic_end = time.monotonic() + 12 * 3600
    for command in commands:
        process = subprocess.Popen(
            [sys.executable, "-m", "gamefield_research.cli", *command],
            start_new_session=True,
        )
        try:
            while process.poll() is None:
                remaining = min(wall_end - time.time(), monotonic_end - time.monotonic())
                if remaining <= 15:
                    raise TimeoutError(
                        "12-hour process window reached; preserve all claims and evidence"
                    )
                time.sleep(min(1, remaining - 15))
            if process.returncode:
                raise ValueError(
                    f"Local stage {command[0]} stopped with exit {process.returncode}; no retry"
                )
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGINT)
                try:
                    process.wait(
                        timeout=max(
                            0, min(10, wall_end - time.time(), monotonic_end - time.monotonic())
                        )
                    )
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
    return {"pipelineFinished": True, "claimsPreserved": True}
