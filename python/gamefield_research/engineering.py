"""Frozen response bank plus independent interactive engineering episodes."""

import asyncio
import time
from decimal import Decimal as D

from .artifacts import freeze_source
from .design import ARMS, canonical, digest, write_json
from .gateway import Gateway, Ledger, fsync_directory, money
from .runner import Coordinator

OLD_CONCISE = (
    "Keep any private reasoning concise. Aim for no more than 512 reasoning tokens "
    "and then provide the requested final JSON object."
)


def check_manifest(plan, bank):
    # One episode for each of 16 conditions, cycling all four arms; ten pairings.
    episodes = []
    block = [e for e in plan["episodes"] if e["block"] == 0]
    cells = sorted({e["cell"].split("/")[1] for e in block if e["track"] == "A"})
    for i, cell in enumerate(cells):
        episodes.append(next(e for e in block if e["cell"] == f"A/{cell}/{ARMS[i % 4]['id']}"))
    episodes += sorted([e for e in block if e["track"] == "B"], key=lambda e: e["cell"])
    body = {
        "schemaVersion": 1,
        "bankSha256": digest(bank),
        "interactiveEpisodes": episodes,
        "procedureVersion": plan["version"],
        "maxHours": 2,
        "capUsd": "1",
        "scientificObservations": 0,
    }
    return {**body, "sha256": digest(body)}


def engineering_forecast(plan, bank, prices):
    from .budget import forecast

    check = check_manifest(plan, bank)
    result = forecast({**plan, "episodes": check["interactiveEpisodes"]}, prices)
    by_model = {p["model"]: p for p in prices}
    cost, requests = D(0), 0
    for task in bank["tasks"]:
        price = by_model[task["model"]]
        # Bank prompts have known lengths; four bytes/token is a scenario assumption.
        original = (len(canonical(task["messages"])) + 3) // 4
        draft = task.get("draftTokens", 1024) if task["reasoning"] else 0
        inputs = 2 * original + draft + 64 if draft else original
        outputs = 128 + draft
        cost += (
            inputs * money(price["inputRate"]) + outputs * money(price["outputRate"])
        ) / 1_000_000
        requests += 2 if draft else 1
    total = money(result["inferenceScenarioUsd"]) + cost
    return {
        **result,
        "checkSha256": check["sha256"],
        "bankDecisions": len(bank["tasks"]),
        "interactiveEpisodes": len(check["interactiveEpisodes"]),
        "scheduledRequests": result["scheduledRequests"] + requests,
        "scheduledDecisions": result["scheduledDecisions"] + len(bank["tasks"]),
        "serialHours": (result["scheduledRequests"] + requests) * 20 / 3600,
        "idealisedEightRequestHours": (result["scheduledRequests"] + requests) * 20 / (8 * 3600),
        "inferenceScenarioUsd": str(total),
        "with25PercentReserveUsd": str(total * D("1.25")),
        "technicalCapUsd": "1",
        "bankBytesPerInputTokenAssumption": 4,
    }


async def check_provider(
    plan,
    bank,
    directory,
    prices,
    root,
    transport=None,
    deployment=None,
    wall_seconds=None,
    cap_usd="1",
    wall_deadline=None,
):
    if not 0 < money(cap_usd) <= 1:
        raise ValueError("Engineering cap must be positive and at most $1")
    check = check_manifest(plan, bank)
    directory.mkdir(exist_ok=False)
    fsync_directory(directory.parent)
    write_json(directory / "check-plan.json", check)
    provenance = freeze_source(root, directory, deployment)
    ledger = Ledger(directory / "events.jsonl", cap_usd)
    seconds = 6300 if wall_seconds is None else min(6300, wall_seconds)
    gateway = Gateway(ledger, prices, time.monotonic() + seconds, transport, wall_deadline)
    results, failure = [], None
    ledger.event(
        "run-started",
        execution="synthetic" if transport else "tokenfactory",
        planSha256=check["sha256"],
        sourceSha256=provenance["sourceSha256"],
        prices=prices,
    )
    try:
        for task in bank["tasks"]:
            arm = {"model": task["model"], "procedure": "draft" if task["reasoning"] else "direct"}
            messages = [dict(m) for m in task["messages"]]
            messages[0]["content"] = messages[0]["content"].replace("\n" + OLD_CONCISE, "")
            tokens = task.get("draftTokens", 1024)
            keys = gateway.reserve_round([(task["id"], messages, arm, tokens)])
            try:
                result = await gateway.decide(messages, arm, task["id"], tokens)
                row = {
                    "id": task["id"],
                    "action": result,
                    "expectedCorrect": result in task["expectedLabels"],
                }
                results.append(row)
                ledger.event("engineering-decision", **row)
            finally:
                ledger.release_unsent(keys)
        coordinator = Coordinator(gateway)
        episodes = check["interactiveEpisodes"]
        for offset in range(0, len(episodes), 4):
            outcomes = await asyncio.gather(
                *(coordinator.episode(e) for e in episodes[offset : offset + 4]),
                return_exceptions=True,
            )
            for outcome in outcomes:
                if isinstance(outcome, BaseException):
                    raise outcome
            if any(o["status"] != "completed" for o in outcomes):
                raise ValueError("Interactive engineering episode failed")
    except BaseException as error:
        failure = f"{type(error).__name__}: {error}"
        gateway.stop(failure)
    ledger.event(
        "run-ended", halted=failure, spentUsd=str(ledger.spent), reservedUsd=str(ledger.reserved)
    )
    ledger.close()
    from .gateway import read_events

    events = read_events(directory / "events.jsonl")
    report = summarise_check(check, bank, events, provenance["sourceSha256"])
    write_json(directory / "engineering-report.json", report)
    return report


def summarise_check(check, bank, events, source_sha256):
    """Reconstruct the technical report and timing telemetry from the ledger."""
    ended = events[-1] if events and events[-1]["event"] == "run-ended" else None
    failure = ended["halted"] if ended else "Engineering ledger has no terminal record"
    results = [e for e in events if e["event"] == "engineering-decision"]
    responses = {e["key"]: e["response"] for e in events if e["event"] == "response-received"}
    forced = [t for t in bank["tasks"] if t.get("draftTokens") == 32]
    forced_passed = len(forced) == 2 and all(
        responses.get(t["id"] + "/draft", {}).get("choices", [{}])[0].get("finish_reason")
        == "length"
        for t in forced
    )
    reasoning = {a["model"]: False for a in ARMS}
    for t in bank["tasks"]:
        response = responses.get(t["id"] + "/draft", {})
        message = response.get("choices", [{}])[0].get("message", {})
        if message.get("reasoning_content") or message.get("reasoning"):
            reasoning[t["model"]] = True
    requests = {e["key"]: e["request"] for e in events if e["event"] == "request-sent"}
    telemetry = []
    for e in events:
        if e["event"] != "request-timing":
            continue
        key = e["key"]
        usage = responses[key]["usage"]
        telemetry.append(
            {
                "key": key,
                "model": requests[key]["model"],
                "phase": key.rsplit("/", 1)[-1],
                "seconds": e["seconds"],
                "promptTokens": usage["prompt_tokens"],
                "completionTokens": usage["completion_tokens"],
            }
        )
    return {
        "schemaVersion": 1,
        "checkSha256": check["sha256"],
        "sourceSha256": source_sha256,
        "execution": events[0]["execution"],
        "scientificObservations": 0,
        "passed": ended is not None
        and failure is None
        and len(results) == 142
        and forced_passed
        and all(reasoning.values()),
        "failure": failure,
        "bankCompleted": len(results),
        "forcedBudgetProbesPassed": forced_passed,
        "reasoningEvidence": reasoning,
        "spentUsd": ended["spentUsd"] if ended else None,
        "reservedUsd": ended["reservedUsd"] if ended else None,
        "evidenceHead": events[-1]["sha256"],
        "requestTelemetry": telemetry,
        "requestSeconds": [e["seconds"] for e in events if e["event"] == "request-timing"],
        "promptTokens": [t["promptTokens"] for t in telemetry],
    }
