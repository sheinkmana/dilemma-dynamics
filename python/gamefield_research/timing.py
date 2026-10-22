"""Four-episode critical paths based on engineering telemetry, never outcomes."""

import heapq
import math

from .design import ARMS


def episode_slot_seconds(plan, phase_seconds):
    arms = {a["id"]: a for a in ARMS}
    slots = [0.0] * 4
    for episode in plan["episodes"]:
        durations = []
        for player in episode["players"]:
            if player not in arms:
                continue
            arm = arms[player]
            seconds = phase_seconds[(arm["model"], "action")]
            if arm["procedure"] == "draft":
                seconds += phase_seconds[(arm["model"], "draft")]
            durations.append(seconds)
        heapq.heapreplace(slots, slots[0] + episode["rounds"] * max(durations))
    return max(slots)


def measured_forecast(plan, report):
    groups = {}
    for row in report["requestTelemetry"]:
        seconds = row["seconds"]
        if type(seconds) not in (int, float) or not math.isfinite(seconds) or seconds <= 0:
            raise ValueError("Invalid engineering timing")
        groups.setdefault((row["model"], row["phase"]), []).append(seconds)
    phase_seconds = {}
    for arm in ARMS:
        for phase in ("draft", "action"):
            key = (arm["model"], phase)
            values = sorted(groups.get(key, []))
            if len(values) < 2:
                raise ValueError("Insufficient timing for both phases of both exact models")
            phase_seconds[key] = values[math.ceil(0.9 * len(values)) - 1]
    seconds = episode_slot_seconds(plan, phase_seconds)
    # Prompt maximum deliberately also includes draft-conditioned action prompts.
    inputs = max(2000, max(row["promptTokens"] for row in report["requestTelemetry"]))
    return {
        "method": "four-episode-slots/model-phase-p90/1",
        "phaseSeconds": [
            {"model": model, "phase": phase, "seconds": seconds}
            for (model, phase), seconds in sorted(phase_seconds.items())
        ],
        "criticalPathSeconds": seconds,
        "with25PercentMarginSeconds": seconds * 1.25,
        "forecastOriginalInputTokens": inputs,
        "completionGuaranteed": False,
    }
