"""Forecasts are separate from conservative per-request spending reservations."""

from decimal import Decimal as D

from .design import ARMS, MODELS
from .gateway import money

ENVELOPE = {"total": "30", "validation": "1", "inference": "18", "cloud": "8", "contingency": "3"}


def forecast(plan, prices, input_tokens=2000, seconds_per_request=20):
    if len(prices) != 2 or {p["model"] for p in prices} != set(MODELS):
        raise ValueError("Require prices for both exact models")
    if input_tokens < 1 or seconds_per_request <= 0:
        raise ValueError("Invalid forecast assumption")
    by_model = {p["model"]: p for p in prices}
    arms = {a["id"]: a for a in ARMS}
    total, requests, decisions = D(0), 0, 0
    for e in plan["episodes"]:
        for player in e["players"]:
            if player not in arms:
                continue
            arm = arms[player]
            price = by_model[arm["model"]]
            draft = arm["procedure"] == "draft"
            count = 2 if draft else 1
            input_count = 2 * input_tokens + 1024 + 64 if draft else input_tokens
            output_count = 1152 if draft else 128
            total += (
                e["rounds"]
                * (
                    input_count * money(price["inputRate"])
                    + output_count * money(price["outputRate"])
                )
                / 1_000_000
            )
            requests += count * e["rounds"]
            decisions += e["rounds"]
    return {
        "schemaVersion": 1,
        "planSha256": plan["sha256"],
        "scheduledRequests": requests,
        "scheduledDecisions": decisions,
        "inferenceScenarioUsd": str(total),
        "with25PercentReserveUsd": str(total * D("1.25")),
        "assumedOriginalInputTokens": input_tokens,
        "assumedSecondsPerRequest": seconds_per_request,
        "serialHours": requests * seconds_per_request / 3600,
        "idealisedEightRequestHours": requests * seconds_per_request / (8 * 3600),
        "completionGuaranteed": False,
        "limitation": "Exact scheduled counts, assumed input lengths and latency; not an invoice bound.",
        "envelope": ENVELOPE,
    }
