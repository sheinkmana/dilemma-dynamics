"""Append-only recovery using the original gateway, native Inspect and exact engine."""

import asyncio
import json
import time

import httpx
from gamefield_research.core import metrics
from gamefield_research.design import ARMS
from gamefield_research.gateway import Gateway, GlobalStop, request_body, reservation
from gamefield_research.recovery import AttemptFailure, RecoveryGateway
from gamefield_research.recovery_runner import RecoveryCoordinator
from inspect_ai import Task, eval_async
from inspect_ai.dataset import Sample
from inspect_ai.log import transcript
from inspect_ai.model import ChatMessageAssistant, GenerateConfig, ModelOutput
from inspect_ai.solver import solver

from evaluation_v2.design import read
from evaluation_v2.runner import InspectLedger, exact_score

from .protocol import POLICY, validate_extension


class AmendmentLedger(InspectLedger):
    """Replay original accounting first, then apply separately recorded authority."""

    def __init__(self, path, receipt):
        self.receipt = receipt
        self.admissions = {}
        self.cooldown_until = 0
        # Replay with the unchanged policy recorded in the original first event.
        from gamefield_research.recovery import OVERLOAD_POLICY

        super().__init__(path, "34", "0.50", resume=True, policy=OVERLOAD_POLICY)
        try:
            self.activated = validate_extension(self.rows, receipt)
            self.policy = POLICY
        except BaseException:
            self.close()
            raise

    def activate(self, now=None):
        if not self.activated:
            self.event(
                "recovery-amendment",
                amendmentSha256=self.receipt["sha256"],
                amendmentSourceSha256=self.receipt["amendmentSourceSha256"],
                parentEvidenceHead=self.receipt["parentEvidenceHead"],
                policy=POLICY,
                atUnix=time.time() if now is None else now,
            )
            self.activated = True

    def _apply(self, row):
        super()._apply(row)
        if row["event"] in ("recovery-decision-admitted", "overload-cooldown"):
            if row.get("amendmentSha256") != self.receipt["sha256"]:
                raise ValueError("Unrecognised recovery authority in the canonical chain")
        if row["event"] == "recovery-decision-admitted":
            key = row["decisionId"]
            if key in self.admissions:
                raise ValueError("A recovery decision deadline was renewed")
            expected = min(
                row["atUnix"] + POLICY["decisionSeconds"],
                self.receipt["finalClock"]["deadlineUnix"],
            )
            if row["deadlineUnix"] != expected:
                raise ValueError("Recovery decision exceeds its approved time window")
            self.admissions[key] = row["deadlineUnix"]
        elif row["event"] == "overload-cooldown":
            expected = min(
                row["atUnix"] + POLICY["overloadCooldownSeconds"],
                self.receipt["finalClock"]["deadlineUnix"],
            )
            if row["untilUnix"] != expected:
                raise ValueError("Overload cooldown differs from the approved policy")
            self.cooldown_until = max(self.cooldown_until, row["untilUnix"])

    def admit(self, key, now):
        if not self.activated:
            raise GlobalStop("Recovery authority has not been recorded")
        if key not in self.admissions:
            self.event(
                "recovery-decision-admitted",
                amendmentSha256=self.receipt["sha256"],
                decisionId=key,
                atUnix=now,
                deadlineUnix=min(
                    now + POLICY["decisionSeconds"],
                    self.receipt["finalClock"]["deadlineUnix"],
                ),
            )
        return self.admissions[key]


class BoundedGateway(RecoveryGateway):
    """Explicit extension, with no monkey-patching of the frozen implementation."""

    def __init__(self, ledger, prices, *, temperature, transport=None, clock=None, sleep=None):
        self.policy = POLICY
        self.clock = clock or time.time
        self.sleep = sleep or asyncio.sleep
        deadline = ledger.receipt["finalClock"]["deadlineUnix"]
        Gateway.__init__(
            self,
            ledger,
            prices,
            time.monotonic() + max(0, deadline - self.clock()),
            transport,
            deadline,
            temperature=temperature,
        )

    def check(self):
        super().check()
        if self.clock() >= self.wall_deadline:
            raise GlobalStop("Original final deadline reached")

    def reserve_round(self, decisions):
        self.check()
        entries = []
        for key, messages, arm, tokens in decisions:
            phases = ["draft", "action"] if arm["procedure"] == "draft" else ["action"]
            durable = lambda logical: any(  # noqa: E731
                k in self.ledger.responses or self.ledger.http.get(k, {}).get("status") == 200
                for k in self.ledger.logical.get(logical, [])
            )
            if all(durable(key + "/" + phase) for phase in phases):
                continue
            deadline = self.ledger.admit(key, self.clock())
            for phase in phases:
                logical = key + "/" + phase
                if logical not in self.ledger.logical:
                    amount = reservation(
                        request_body(
                            messages, arm, phase, draft_tokens=tokens, temperature=self.temperature
                        ),
                        self.prices[arm["model"]],
                        6 * 32768 + 512 if phase == "action" and arm["procedure"] == "draft" else 0,
                    )
                    entries.append((logical, amount, deadline))
        return self.ledger.reserve_attempts(entries) if entries else []

    def _record_failure(self, key, reason, retryable):
        now = self.clock()
        number = self.ledger.attempts[key]["number"]
        delay = POLICY["backoffSeconds"][min(number - 1, 1)]
        self.ledger.event(
            "attempt-failed",
            key=key,
            reason=reason,
            retryable=retryable,
            nextEligibleUnix=now + delay,
        )
        if reason == "HTTP 529":
            self.ledger.event(
                "overload-cooldown",
                key=key,
                amendmentSha256=self.ledger.receipt["sha256"],
                atUnix=now,
                untilUnix=min(now + POLICY["overloadCooldownSeconds"], self.wall_deadline),
            )

    async def wait_ready(self, decision_deadline, retry_at=0):
        while True:
            self.check()
            now = self.clock()
            until = max(retry_at, self.ledger.cooldown_until)
            if now >= decision_deadline or until >= decision_deadline:
                raise GlobalStop("Recovery decision deadline reached; no renewal on resume")
            if until <= now:
                return
            # Short waits preserve interruptibility; another 529 may extend the shared cooldown.
            await self.sleep(min(until - now, 30))

    async def transmit(self, logical, body, deadline):
        async with self.semaphore:
            while True:
                for saved in self.ledger.logical[logical]:
                    if (
                        saved in self.ledger.responses
                        or self.ledger.http.get(saved, {}).get("status") == 200
                    ):
                        return self._replay(saved, body)
                key = self.ledger.logical[logical][-1]
                meta = self.ledger.attempts[key]
                if key in self.ledger.sent:
                    raw = self._replay(key, body)
                    if raw is not None:
                        return raw
                    if key not in self.ledger.failures:
                        status = self.ledger.http.get(key, {}).get("status")
                        self._record_failure(
                            key,
                            "Unresolved transmission recovered",
                            status is None or status in POLICY["retryHttpStatuses"],
                        )
                decision = logical.rsplit("/", 1)[0]
                if decision not in self.ledger.admissions:
                    raise GlobalStop("Missing durable recovery decision admission")
                decision_deadline = self.ledger.admissions[decision]
                if key in self.ledger.failures:
                    failure = self.ledger.failures[key]
                    if not failure["retryable"] or meta["number"] >= POLICY["maximumAttempts"]:
                        raise GlobalStop("Six-attempt policy exhausted; no automatic extension")
                    await self.wait_ready(decision_deadline, failure["nextEligibleUnix"])
                    self.ledger.reserve_attempts(
                        [
                            (
                                logical,
                                reservation(body, self.prices[body["model"]]),
                                decision_deadline,
                            )
                        ]
                    )
                    continue
                await self.wait_ready(decision_deadline)
                remaining = min(
                    decision_deadline - self.clock(),
                    self.wall_deadline - self.clock(),
                    self.deadline - time.monotonic(),
                    POLICY["attemptTimeoutSeconds"],
                )
                if remaining <= 0:
                    raise GlobalStop("Original campaign or recovery decision deadline reached")
                if reservation(body, self.prices[body["model"]]) > self.ledger.pending[key]:
                    raise GlobalStop("Request exceeds its pre-reserved envelope")
                try:
                    return await self._send(key, body, remaining)
                except AttemptFailure as error:
                    self._record_failure(key, str(error), error.retryable)
                except (httpx.TransportError, TimeoutError) as error:
                    self._record_failure(key, type(error).__name__, True)


async def evaluate(parent, receipt, *, transport=None):
    """Run the frozen samples with two workers, retaining native logs from every session."""
    selected = read(parent / "selection.json")["selectedBlocks"]
    episodes = read(parent / f"schedule-{selected}.json")
    prices = read(parent / "prices.json")["prices"]
    ledger = AmendmentLedger(parent / "final/events.jsonl", receipt)
    if (ledger.rows[0]["execution"] == "tokenfactory") != (transport is None):
        ledger.close()
        raise ValueError("Synthetic transport cannot extend hosted scientific evidence")
    failure = None
    gateways = {}
    try:
        ledger.activate()
        ledger.event(
            "session-started",
            resumed=True,
            atUnix=time.time(),
            amendmentSha256=receipt["sha256"],
        )
        gateways = {
            t: BoundedGateway(ledger, prices, temperature=t, transport=transport) for t in (0, 1)
        }
        semaphore = asyncio.Semaphore(POLICY["concurrentRequests"])
        for g in gateways.values():
            g.semaphore = semaphore
        coordinators = {t: RecoveryCoordinator(g, episodes) for t, g in gateways.items()}

        @solver
        def play():
            async def solve(state, generate):
                e = state.metadata["episode"]
                coordinator = coordinators[e["temperature"]]
                try:
                    status = await coordinator.episode(e)
                    history = coordinator.histories[e["id"]]
                    if status != "completed":
                        raise GlobalStop("Recovery stopped; preserve all successful checkpoints")
                    result = {
                        "status": status,
                        "answer": " ".join("".join(p) for p in history),
                        **metrics(e, history, True),
                    }
                    state.metadata["result"] = result
                    transcript().info(
                        {
                            "episodeId": e["id"],
                            "history": history,
                            "metrics": result,
                            "temperature": e["temperature"],
                            "amendmentSha256": receipt["sha256"],
                        },
                        source="exact-game-engine",
                    )
                    state.output = ModelOutput.from_content("exact-game-engine", json.dumps(result))
                    state.messages.append(ChatMessageAssistant(content=state.output.completion))
                    return state
                except BaseException:
                    for g in gateways.values():
                        g.stop("Recovery session interrupted; retain all accounting and evidence")
                    raise

            return solve

        task = Task(
            name="dilemma-final-v3-bounded-recovery",
            version=1,
            dataset=[
                Sample(
                    id=e["id"],
                    input="Frozen simultaneous repeated-game evaluation.",
                    metadata={"episode": e, "temperature": e["temperature"], "kind": "episode"},
                )
                for e in episodes
            ],
            solver=play(),
            scorer=exact_score(),
            model=gateways[0].models[ARMS[0]["model"]],
            fail_on_error=True,
            epochs=1,
            config=GenerateConfig(max_retries=0, cache=False, adaptive_connections=False),
            metadata={
                "execution": "synthetic" if transport else "tokenfactory",
                "specSha256": receipt["parentSpecSha256"],
                "sourceSha256": receipt["parentSourceSha256"],
                "amendmentSha256": receipt["sha256"],
                "amendmentSourceSha256": receipt["amendmentSourceSha256"],
                "canonicalEvidence": str(parent / "final/events.jsonl"),
                "note": "Saved completions replay as checkpoints; retain all original sessions.",
            },
        )
        logs = await eval_async(
            task,
            log_dir=str(parent / "final/inspect"),
            max_samples=2,
            max_tasks=1,
            max_retries=0,
            retry_on_error=0,
            log_model_api=False,
            notification=False,
            sample_shuffle=False,
            ctl_server=False,
        )
        if any(log.status != "success" for log in logs):
            raise GlobalStop("Inspect recovery stopped; original global clock is retained")
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
            amendmentSha256=receipt["sha256"],
            atUnix=time.time(),
        )
        ledger.close()
