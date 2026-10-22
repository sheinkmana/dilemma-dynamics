"""Inspect tasks run episodes through the same bounded, durable gateway."""

import asyncio
import time

from inspect_ai import Task, eval_async
from inspect_ai.dataset import Sample
from inspect_ai.model import ChatMessageAssistant, GenerateConfig, ModelOutput
from inspect_ai.scorer import Score, scorer
from inspect_ai.solver import solver

from .core import metrics, script_action, transition
from .design import ARMS, action, observation, validate_plan, write_json
from .gateway import Gateway, GlobalStop, Ledger, ProtocolFailure, fsync_directory


@scorer(metrics=[])
def game_score():
    async def score(state, target):
        result = state.metadata["outcome"]
        return Score(
            value={
                "oracle_loss": result["normalisedOracleLoss"],
                "joint_return": result["normalisedJointReturn"],
            },
            metadata={"status": result["status"], "episodeId": state.sample_id},
        )

    return score


class Coordinator:
    def __init__(self, gateway):
        self.gateway = gateway
        self.arms = {a["id"]: a for a in ARMS}
        self.failures = 0

    async def episode(self, e):
        history, policy_state = [], 0
        status, reason = "interrupted", None
        try:
            while len(history) < e["rounds"]:
                self.gateway.check()
                jobs = []
                for seat, player in enumerate(e["players"]):
                    if player in self.arms:
                        key = f"{e['id']}/{len(history) + 1}/{seat}"
                        jobs.append((seat, key, observation(e, history, seat), self.arms[player]))
                keys = self.gateway.reserve_round([(k, m, a, 1024) for _, k, m, a in jobs])
                try:
                    results = await asyncio.gather(
                        *(self.gateway.decide(m, a, k) for _, k, m, a in jobs),
                        return_exceptions=True,
                    )
                    for result in results:
                        if isinstance(result, GlobalStop):
                            raise result
                    for result in results:
                        if isinstance(result, BaseException):
                            raise result
                    pair = [None, None]
                    for (seat, _, _, _), label in zip(jobs, results, strict=True):
                        pair[seat] = action(label, e["mapping"])
                    if e["track"] == "A":
                        seat = e["subjectSeat"]
                        pair[1 - seat] = script_action(e["policy"], policy_state)
                        policy_state = transition(e["policy"], policy_state, pair[seat])
                    self.gateway.ledger.event(
                        "round-revealed", episodeId=e["id"], round=len(history) + 1, actions=pair
                    )
                    history.append(pair)
                finally:
                    self.gateway.ledger.release_unsent(keys)
            status = "completed"
            self.failures = 0
        except ProtocolFailure as error:
            status, reason = "protocol-failed", str(error)
            self.failures += 1
            if self.failures >= 3:
                self.gateway.stop("Three consecutive episode protocol failures (completion order)")
        except GlobalStop as error:
            reason = str(error)
            self.gateway.stop(reason)
        except BaseException as error:
            self.gateway.stop(f"Coordinator fault: {type(error).__name__}")
            raise
        self.gateway.ledger.event("episode-ended", episodeId=e["id"], status=status, reason=reason)
        return {"status": status, **metrics(e, history, status == "completed")}


@solver
def game_solver(coordinator):
    async def solve(state, generate):
        outcome = await coordinator.episode(state.metadata["episode"])
        state.metadata["outcome"] = outcome
        state.messages.append(ChatMessageAssistant(content=str(outcome)))
        state.output = ModelOutput.from_content("gamefield", str(outcome))
        return state

    return solve


async def run(
    plan,
    directory,
    prices,
    transport=None,
    wall_seconds=None,
    deployment=None,
    source_root=None,
    cap_usd=None,
    wall_deadline=None,
):
    validate_plan(plan)
    directory.mkdir(parents=False, exist_ok=False)
    fsync_directory(directory.parent)
    write_json(directory / "plan.json", plan)
    from .artifacts import freeze_source

    if source_root is None:
        from .paths import source_root as locate_source

        source_root = locate_source()
    provenance = freeze_source(source_root, directory, deployment)
    cap = "18" if plan["purpose"] == "final" else "1"
    if cap_usd is not None:
        from .gateway import money

        if money(cap_usd) > money(cap):
            raise ValueError("Cannot enlarge the plan's inference allocation")
        cap = cap_usd
    ledger = Ledger(directory / "events.jsonl", cap)
    seconds = plan["limits"]["wallSeconds"] - plan["limits"]["shutdownMarginSeconds"]
    if wall_seconds is not None:
        seconds = min(seconds, wall_seconds)
    gateway = Gateway(ledger, prices, time.monotonic() + seconds, transport, wall_deadline)
    ledger.event(
        "run-started",
        planSha256=plan["sha256"],
        execution="synthetic" if transport else "tokenfactory",
        prices=prices,
        sourceSha256=provenance["sourceSha256"],
    )
    coordinator = Coordinator(gateway)
    task = Task(
        name="gamefield-cooperation",
        version=1,
        dataset=[
            Sample(id=e["id"], input="Frozen repeated game episode.", metadata={"episode": e})
            for e in plan["episodes"]
        ],
        solver=game_solver(coordinator),
        scorer=game_score(),
        model=gateway.models[ARMS[0]["model"]],
        fail_on_error=True,
        epochs=1,
        config=GenerateConfig(max_retries=0, cache=False, adaptive_connections=False),
        metadata={"planSha256": plan["sha256"], "purpose": plan["purpose"]},
    )
    try:
        logs = await eval_async(
            task,
            log_dir=str(directory / "inspect"),
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
            gateway.stop("Inspect task did not finish successfully")
    except BaseException as error:
        gateway.stop(f"Run interrupted: {type(error).__name__}")
        raise
    finally:
        ledger.event(
            "run-ended",
            halted=gateway.halted,
            spentUsd=str(ledger.spent),
            reservedUsd=str(ledger.reserved),
        )
        ledger.close()
    return directory
