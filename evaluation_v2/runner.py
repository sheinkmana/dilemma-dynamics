"""Native Inspect samples on the existing audited, recoverable gateway."""

import asyncio
import fcntl
import json
import os
import shutil
import time
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
from statistics import mean

import httpx
from gamefield_research.core import metrics
from gamefield_research.design import ARMS, digest
from gamefield_research.engineering import OLD_CONCISE
from gamefield_research.gateway import GlobalStop, read_events
from gamefield_research.recovery import RecoveryGateway, RecoveryLedger
from gamefield_research.recovery_runner import RecoveryCoordinator
from inspect_ai import Task, eval_async
from inspect_ai.dataset import Sample
from inspect_ai.log import transcript
from inspect_ai.model import ChatMessageAssistant, GenerateConfig, ModelOutput
from inspect_ai.scorer import Score, scorer
from inspect_ai.solver import solver

from .design import ALLOCATION, CANDIDATES, read, verify


def exclusive_json(path, value):
    with Path(path).open("x") as stream:
        stream.write(json.dumps(value, indent=2) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def public_rate_check(directory):
    """Public unauthenticated GET only; never discovers account resources."""
    source = read(directory / "prices.json")
    with httpx.Client(timeout=30, trust_env=False, follow_redirects=False) as client:
        response = client.get(source["source"])
        response.raise_for_status()
        catalog = response.json()
    by_id = {f["model_id"]: f for model in catalog for f in model.get("flavors", [])}
    for price in source["prices"]:
        item = by_id[price["model"]]
        for stored, remote in (
            ("inputRate", "input_price_per_million_tokens"),
            ("outputRate", "output_price_per_million_tokens"),
        ):
            if Decimal(price[stored]) != Decimal(str(item[remote])):
                raise ValueError(
                    "Provider public prices changed; prepare a separately reviewed rate book"
                )
    target = directory / f"public-prices-{time.time_ns()}.json"
    exclusive_json(
        target,
        {
            "checkedUnix": time.time(),
            "source": source["source"],
            "catalog": catalog,
            "inferenceRequests": 0,
        },
    )


@scorer(metrics=[])
def exact_score():
    async def score(state, target):
        result = state.metadata["result"]
        if result["status"] != "completed":
            return Score.unscored(reason="incomplete", explanation=result["status"])
        values = {
            k: v
            for k, v in result.items()
            if k in ("normalisedOracleLoss", "normalisedJointReturn") and v is not None
        }
        if not values:
            values = {"protocolValid": 1}
        return Score(
            value=values,
            answer=result.get("answer", ""),
            explanation="Exact game-engine scoring; aggregate inference is stratified by whole block.",
            metadata={"temperature": state.metadata["temperature"], "kind": state.metadata["kind"]},
        )

    return score


async def evaluate_stage(directory, stage, samples, *, transport=None):
    """Every invocation gets native logs; successful provider completions are durable."""
    directory = Path(directory)
    spec = read(directory / "spec.json")
    packet = read(directory / "preparation.json")
    clock = read(directory / "clock.json")
    work = directory / stage
    work.mkdir(exist_ok=True)
    now = time.time()
    clock_path = work / "clock.json"
    if not clock_path.exists():
        deadline = clock["deadlineUnix"] - 900
        if stage == "engineering":
            deadline = min(deadline, now + spec["clock"]["engineeringSeconds"])
        exclusive_json(clock_path, {"startedUnix": now, "deadlineUnix": deadline})
    deadline = read(clock_path)["deadlineUnix"]
    if now >= deadline:
        raise ValueError("The original stage clock has expired; no renewal")
    path = work / "events.jsonl"
    policy = spec["recoveryPolicy"]
    ledger = RecoveryLedger(
        path,
        ALLOCATION[stage],
        policy["retryExposureUsd"][stage],
        resume=path.exists(),
        policy=policy,
    )
    identity = {
        "specSha256": spec["sha256"],
        "sourceSha256": packet["sourceSha256"],
        "scheduleSha256": digest(samples),
        "purpose": stage,
        "execution": "synthetic" if transport else "tokenfactory",
        "deadlineUnix": deadline,
        "capUsd": ALLOCATION[stage],
        "prices": read(directory / "prices.json")["prices"],
        "recoveryPolicy": policy,
    }
    if ledger.rows:
        if any(ledger.rows[0].get(k) != v for k, v in identity.items()):
            ledger.close()
            raise ValueError("Stage identity, runtime mode, schedule, prices, cap or clock changed")
    else:
        ledger.event("run-started", **identity)
    ledger.event("session-started", atUnix=now, resumed=len(ledger.rows) > 2)
    gateways = {
        t: RecoveryGateway(
            ledger,
            identity["prices"],
            time.monotonic() + deadline - now,
            transport,
            deadline,
            temperature=t,
            policy=policy,
        )
        for t in (0, 1)
    }
    semaphore = asyncio.Semaphore(8)
    for gateway in gateways.values():
        gateway.semaphore = semaphore
    episodes = [s["episode"] for s in samples if s["kind"] == "episode"]
    coordinators = {t: RecoveryCoordinator(g, episodes) for t, g in gateways.items()}
    bank_done = {r["sampleId"]: r for r in ledger.rows if r["event"] == "bank-completed"}

    @solver
    def play():
        async def solve(state, generate):
            s = state.metadata
            gateway = gateways[s["temperature"]]
            try:
                if s["kind"] == "bank":
                    task = s["task"]
                    if s["id"] in bank_done:
                        answer = bank_done[s["id"]]["action"]
                        transcript().info({"replayedCheckpoint": s["id"]})
                    else:
                        arm = {
                            "model": task["model"],
                            "procedure": "draft" if task["reasoning"] else "direct",
                        }
                        messages = [dict(m) for m in task["messages"]]
                        messages[0]["content"] = messages[0]["content"].replace(
                            "\n" + OLD_CONCISE, ""
                        )
                        tokens = task.get("draftTokens", 1024)
                        gateway.reserve_round([(s["id"], messages, arm, tokens)])
                        answer = await gateway.decide(messages, arm, s["id"], tokens)
                        ledger.event(
                            "bank-completed",
                            sampleId=s["id"],
                            action=answer,
                            temperature=s["temperature"],
                        )
                    result = {"status": "completed", "answer": answer}
                else:
                    e = s["episode"]
                    coordinator = coordinators[s["temperature"]]
                    status = await coordinator.episode(e)
                    history = coordinator.histories[e["id"]]
                    result = {
                        "status": status,
                        "answer": " ".join("".join(p) for p in history),
                        **metrics(e, history, status == "completed"),
                    }
                    transcript().info(
                        {
                            "episodeId": e["id"],
                            "history": history,
                            "temperature": s["temperature"],
                            "metrics": result,
                        },
                        source="exact-game-engine",
                    )
                if result["status"] != "completed":
                    raise GlobalStop(
                        "Sample incomplete; no regeneration of invalid successful responses"
                    )
                state.metadata["result"] = result
                state.output = ModelOutput.from_content("exact-game-engine", json.dumps(result))
                state.messages.append(ChatMessageAssistant(content=state.output.completion))
                return state
            except BaseException:
                for g in gateways.values():
                    g.stop("Stage interrupted; retain all reservations and checkpoints")
                raise

        return solve

    task = Task(
        name=f"dilemma-final-v3-{stage}",
        version=3,
        dataset=[
            Sample(id=s["id"], input="Frozen simultaneous repeated-game evaluation.", metadata=s)
            for s in samples
        ],
        solver=play(),
        scorer=exact_score(),
        model=gateways[0].models[ARMS[0]["model"]],
        fail_on_error=True,
        epochs=1,
        config=GenerateConfig(max_retries=0, cache=False, adaptive_connections=False),
        metadata={
            **identity,
            "canonicalEvidence": str(path),
            "note": "Session logs include replayed checkpoints; keep all sessions. Private drafts stay local.",
        },
    )
    failure = None
    try:
        logs = await eval_async(
            task,
            log_dir=str(work / "inspect"),
            max_samples=4,
            max_tasks=1,
            max_retries=0,
            retry_on_error=0,
            log_model_api=False,
            notification=False,
            sample_shuffle=False,
            ctl_server=False,
        )
        if any(log.status != "success" for log in logs):
            raise GlobalStop(
                "Inspect did not complete; supported resume retains the original clock"
            )
    except BaseException as error:
        failure = f"{type(error).__name__}: {error}"
        raise
    finally:
        ledger.event(
            "run-ended",
            halted=failure,
            spentUsd=str(ledger.spent),
            reservedUsd=str(ledger.reserved),
            retryExposureUsd=str(ledger.retry_exposure),
            atUnix=time.time(),
        )
        ledger.close()


def telemetry(events):
    """Only successful measured requests, indexed by temperature/model/phase."""
    requests = {r["key"]: r["request"] for r in events if r["event"] == "request-sent"}
    timings = {r["key"]: r["seconds"] for r in events if r["event"] == "request-timing"}
    groups = defaultdict(list)
    for r in events:
        if r["event"] != "response-received":
            continue
        body = requests[r["key"]]
        phase = "draft" if body["chat_template_kwargs"]["enable_thinking"] else "action"
        groups[(body["temperature"], body["model"], phase)].append(
            {
                "key": r["key"],
                "usage": r["response"]["usage"],
                "seconds": timings.get(r["key"]),
                "response": r["response"],
                "body": body,
            }
        )
    return groups


def engineering_report(directory):
    directory = Path(directory)
    samples = read(directory / "engineering.json")
    events = read_events(directory / "engineering/events.jsonl")
    groups = telemetry(events)
    completed_bank = {r["sampleId"] for r in events if r["event"] == "bank-completed"}
    completed_episodes = {
        r["episodeId"]
        for r in events
        if r["event"] == "episode-ended" and r["status"] == "completed"
    }
    valid = events[0]["execution"] == "tokenfactory" and events[-1]["halted"] is None
    valid &= len(completed_bank) == 284 and len(completed_episodes) == 52
    for t in (0, 1):
        for arm in ARMS:
            drafts = groups[(t, arm["model"], "draft")]
            valid &= any(
                r["response"]["choices"][0]["message"].get("reasoning_content")
                or r["response"]["choices"][0]["message"].get("reasoning")
                for r in drafts
            )
    for s in samples:
        if s["kind"] == "bank" and s["task"].get("draftTokens") == 32:
            valid &= any(
                r["key"].startswith(s["id"] + "/draft/")
                and r["response"]["choices"][0]["finish_reason"] == "length"
                for rows in groups.values()
                for r in rows
            )
    valid &= Decimal(events[-1]["reservedUsd"]) == 0
    return {
        "passed": bool(valid),
        "execution": events[0]["execution"],
        "bankCompleted": len(completed_bank),
        "interactiveCompleted": len(completed_episodes),
        "spentUsd": events[-1]["spentUsd"],
        "evidenceHead": events[-1]["sha256"],
    }


def choose_schedule(directory, selection_unix=None):
    directory = Path(directory)
    report = engineering_report(directory)
    if not report["passed"]:
        raise ValueError("Fresh hosted engineering must pass at both temperatures")
    groups = telemetry(read_events(directory / "engineering/events.jsonl"))
    prices = {p["model"]: p for p in read(directory / "prices.json")["prices"]}
    arms = {a["id"]: a for a in ARMS}
    forecasts = []
    selection_unix = time.time() if selection_unix is None else selection_unix
    for blocks in CANDIDATES:
        cost, seconds = 0.0, 0.0
        for e in read(directory / f"schedule-{blocks}.json"):
            for player in e["players"]:
                if player not in arms:
                    continue
                arm = arms[player]
                for phase in ("draft", "action") if arm["procedure"] == "draft" else ("action",):
                    rows = groups[(e["temperature"], arm["model"], phase)]
                    price = prices[arm["model"]]
                    cost += e["rounds"] * mean(
                        (
                            r["usage"]["prompt_tokens"] * float(price["inputRate"])
                            + r["usage"]["completion_tokens"] * float(price["outputRate"])
                        )
                        / 1e6
                        for r in rows
                    )
                    seconds += e["rounds"] * mean(
                        r["seconds"] for r in rows if r["seconds"] is not None
                    )
        # Four sample workers, rather than assuming ideal eight-request scaling.
        forecast = {
            "blocksPerTemperature": blocks,
            "episodes": blocks * 148,
            "estimatedUsdWith50PercentMargin": cost * 1.5,
            "estimatedSecondsWith50PercentMargin": seconds / 4 * 1.5,
        }
        available = read(directory / "clock.json")["deadlineUnix"] - selection_unix - 1500
        forecast["fits"] = (
            cost * 1.5 + 0.5 <= float(ALLOCATION["final"]) and seconds / 4 * 1.5 <= available
        )
        forecasts.append(forecast)
    feasible = [f for f in forecasts if f["fits"]]
    if not feasible:
        raise ValueError(
            "No complete balanced candidate fits measured cost/time; no final inference"
        )
    return {
        "selectedBlocks": feasible[-1]["blocksPerTemperature"],
        "forecasts": forecasts,
        "selectionUnix": selection_unix,
        "engineeringEvidenceHead": report["evidenceHead"],
        "selectionInputs": "usage and latency only; never actions, scores, cooperation or draft content",
        "forecastLimitation": "50% margin is a scenario, not guaranteed completion or a provider invoice cap",
    }


def execute(directory):
    """Called only by the user's explicit launch command, never by preparation."""
    directory = Path(directory).resolve()
    verify(directory)
    from .analysis import export
    from .tracking import track

    if stage_completed(directory):
        result = export(directory)
        track(directory, "final")
        return result
    if not os.environ.get("NEBIUS_API_KEY"):
        raise ValueError("Privately inject NEBIUS_API_KEY in the launch shell")
    if shutil.disk_usage(directory).free < 8 * 1024**3:
        raise ValueError("Keep at least 8 GiB free for private native logs and evidence")
    with (directory / "execution.lock").open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        public_rate_check(directory)
        track(directory, "preflight")  # Required local tracker capability check before paid work.
        clock_path = directory / "clock.json"
        if not clock_path.exists():
            exclusive_json(
                clock_path, {"startedUnix": time.time(), "deadlineUnix": time.time() + 36 * 3600}
            )
        if time.time() >= read(clock_path)["deadlineUnix"] - 900:
            raise ValueError("Original campaign clock expired; no new clock")
        if not (directory / "selection.json").exists():
            asyncio.run(
                evaluate_stage(directory, "engineering", read(directory / "engineering.json"))
            )
            track(directory, "engineering")
            exclusive_json(directory / "selection.json", choose_schedule(directory))
        else:
            report = engineering_report(directory)
            selected = read(directory / "selection.json")
            if not report["passed"] or selected != choose_schedule(
                directory, selected["selectionUnix"]
            ):
                raise ValueError("Selected schedule does not bind passing engineering")
        blocks = read(directory / "selection.json")["selectedBlocks"]
        episodes = read(directory / f"schedule-{blocks}.json")
        samples = [
            {"id": e["id"], "kind": "episode", "temperature": e["temperature"], "episode": e}
            for e in episodes
        ]
        asyncio.run(evaluate_stage(directory, "final", samples))
        result = export(directory)
        track(directory, "final")
        return result


def stage_completed(directory):
    """Detect an already settled final before credentials, pricing or clock checks."""
    directory = Path(directory)
    if (
        not (directory / "selection.json").exists()
        or not (directory / "final/events.jsonl").exists()
    ):
        return False
    selected = read(directory / "selection.json")["selectedBlocks"]
    expected = {e["id"] for e in read(directory / f"schedule-{selected}.json")}
    events = read_events(directory / "final/events.jsonl")
    completed = {
        r["episodeId"]
        for r in events
        if r["event"] == "episode-ended" and r["status"] == "completed"
    }
    return (
        expected == completed
        and events[-1]["event"] == "run-ended"
        and events[-1]["halted"] is None
    )
