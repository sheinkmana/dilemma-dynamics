"""Four episode workers with append-only round checkpoints and sealed response replay."""

import asyncio
import time

from .analysis import episode_rows
from .artifacts import freeze_source
from .core import script_action, transition
from .design import ARMS, action, digest, observation, write_json
from .engineering import OLD_CONCISE, check_manifest, summarise_check
from .gateway import GlobalStop, ProtocolFailure, read_events
from .recovery import POLICY, RecoveryGateway, RecoveryLedger, projected_engineering_events


class RecoveryCoordinator:
    def __init__(self, gateway, episodes):
        self.gateway = gateway
        self.arms = {a["id"]: a for a in ARMS}
        self.histories = {e["id"]: [] for e in episodes}
        self.terminal = {}
        self.failures = 0
        for row in gateway.ledger.rows:
            if row["event"] == "round-revealed":
                history = self.histories[row["episodeId"]]
                if row["round"] != len(history) + 1:
                    raise ValueError("Noncontiguous recovery history")
                history.append(row["actions"])
            elif row["event"] == "episode-ended":
                eid = row["episodeId"]
                if eid in self.terminal:
                    raise ValueError("Duplicate terminal episode")
                self.terminal[eid] = row["status"]
                self.failures = self.failures + 1 if row["status"] == "protocol-failed" else 0

    async def episode(self, episode):
        eid = episode["id"]
        history = self.histories[eid]
        if eid in self.terminal:
            return self.terminal[eid]
        if self.failures >= 3:
            self.gateway.stop("Three consecutive protocol failures; no continuation allowed")
        state = 0
        for pair in history:
            if episode["track"] == "A":
                seat = episode["subjectSeat"]
                if pair[1 - seat] != script_action(episode["policy"], state):
                    raise ValueError("Checkpoint opponent differs from committed policy")
                state = transition(episode["policy"], state, pair[seat])
        status, reason = "completed", None
        keys = []
        try:
            while len(history) < episode["rounds"]:
                self.gateway.check()
                jobs = [
                    (
                        seat,
                        f"{eid}/{len(history) + 1}/{seat}",
                        observation(episode, history, seat),
                        self.arms[player],
                    )
                    for seat, player in enumerate(episode["players"])
                    if player in self.arms
                ]
                # Both seats and both phases are reserved before any transmission.
                keys = self.gateway.reserve_round([(k, m, a, 1024) for _, k, m, a in jobs])
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
                    pair[seat] = action(label, episode["mapping"])
                if episode["track"] == "A":
                    seat = episode["subjectSeat"]
                    pair[1 - seat] = script_action(episode["policy"], state)
                    state = transition(episode["policy"], state, pair[seat])
                self.gateway.ledger.event(
                    "round-revealed", episodeId=eid, round=len(history) + 1, actions=pair
                )
                history.append(pair)
        except ProtocolFailure as error:
            status, reason = "protocol-failed", str(error)
            self.failures += 1
            self.gateway.ledger.abandon_unsent(keys)
            if self.failures >= 3:
                self.gateway.stop("Three consecutive episode protocol failures (completion order)")
        except GlobalStop as error:
            self.gateway.stop(str(error))
            self.gateway.ledger.event("episode-paused", episodeId=eid, reason=str(error))
            return "interrupted"
        except BaseException as error:
            self.gateway.stop(f"Coordinator fault: {type(error).__name__}")
            raise
        if status == "completed":
            self.failures = 0
        self.gateway.ledger.event("episode-ended", episodeId=eid, status=status, reason=reason)
        self.terminal[eid] = status
        return status


async def execute_recoverable(
    plan,
    directory,
    prices,
    root,
    deployment,
    deadline,
    cap,
    purpose,
    transport=None,
    resume=False,
    bank=None,
):
    """A stage has one original deadline and cap, across every process session."""
    check = check_manifest(plan, bank) if purpose == "engineering" else plan
    if not resume:
        directory.mkdir(exist_ok=False)
        write_json(directory / "plan.json", plan)
        if bank is not None:
            write_json(directory / "check-plan.json", check)
        provenance = freeze_source(root, directory, deployment)
    else:
        from .local import read

        provenance = read(directory / "provenance.json")
        if (
            provenance["deployment"] != deployment
            or provenance["sourceSha256"] != deployment["sourceSha256"]
            or read(directory / "plan.json") != plan
        ):
            raise ValueError("Resume provenance differs from the frozen stage")
    ledger = RecoveryLedger(
        directory / "events.jsonl", cap, POLICY["retryExposureUsd"][purpose], resume=resume
    )
    execution = "synthetic" if transport is not None else "tokenfactory"
    failure = None
    try:
        if not resume:
            ledger.event(
                "run-started",
                execution=execution,
                planSha256=check["sha256"],
                sourceSha256=provenance["sourceSha256"],
                prices=prices,
                recoveryPolicy=POLICY,
                deadlineUnix=deadline,
                capUsd=str(cap),
                evaluationId=deployment.get("scientificAmendment", {}).get("kind"),
                scientificAmendment=deployment.get("scientificAmendment"),
            )
        first = ledger.rows[0]
        if (
            first["execution"] != execution
            or first["planSha256"] != check["sha256"]
            or first["prices"] != prices
            or first["recoveryPolicy"] != POLICY
            or first["deadlineUnix"] != deadline
            or first["capUsd"] != str(cap)
        ):
            raise ValueError("Original stage identity, cap or deadline changed")
        ledger.event("session-started", resumed=resume, atUnix=time.time())
        gateway = RecoveryGateway(
            ledger, prices, time.monotonic() + max(0, deadline - time.time()), transport, deadline
        )
        if purpose == "engineering":
            completed = {e["id"] for e in ledger.rows if e["event"] == "engineering-decision"}
            for task in bank["tasks"]:
                if task["id"] in completed:
                    continue
                arm = {
                    "model": task["model"],
                    "procedure": "draft" if task["reasoning"] else "direct",
                }
                messages = [dict(m) for m in task["messages"]]
                messages[0]["content"] = messages[0]["content"].replace("\n" + OLD_CONCISE, "")
                tokens = task.get("draftTokens", 1024)
                gateway.reserve_round([(task["id"], messages, arm, tokens)])
                label = await gateway.decide(messages, arm, task["id"], tokens)
                ledger.event(
                    "engineering-decision",
                    id=task["id"],
                    action=label,
                    expectedCorrect=label in task["expectedLabels"],
                )
            episodes = check["interactiveEpisodes"]
        else:
            episodes = plan["episodes"]
        coordinator = RecoveryCoordinator(gateway, episodes)
        queue = iter(episodes)

        async def worker():
            for episode in queue:
                gateway.check()
                await coordinator.episode(episode)

        outcomes = await asyncio.gather(*(worker() for _ in range(4)), return_exceptions=True)
        for outcome in outcomes:
            if isinstance(outcome, BaseException):
                raise outcome
        if gateway.halted:
            raise GlobalStop(gateway.halted)
        if purpose == "engineering" and any(
            s != "completed" for s in coordinator.terminal.values()
        ):
            raise GlobalStop("Interactive engineering episode failed")
    except (GlobalStop, ProtocolFailure) as error:
        failure = f"{type(error).__name__}: {error}"
    except BaseException as error:
        failure = f"{type(error).__name__}: interrupted; preserve checkpoint"
        raise
    finally:
        ledger.event(
            "run-ended",
            halted=failure,
            spentUsd=str(ledger.spent),
            reservedUsd=str(ledger.reserved),
            retryExposureUsd=str(ledger.retry_exposure),
        )
        if purpose == "engineering":
            report = summarise_check(
                check, bank, projected_engineering_events(ledger), provenance["sourceSha256"]
            )
            # Strengthen the legacy technical summary with all 26 terminal episodes.
            terminals = [e for e in ledger.rows if e["event"] == "episode-ended"]
            report["passed"] = (
                report["passed"]
                and len(terminals) == 26
                and all(e["status"] == "completed" for e in terminals)
            )
            report["recoveryPolicySha256"] = digest(POLICY)
        else:
            rows = episode_rows(plan, ledger.rows)
            report = {
                "completed": sum(r["status"] == "completed" for r in rows),
                "scheduled": len(rows),
                "failure": failure,
            }
        ledger.close()
    return report


def rebuild_engineering(directory, bank):
    """Reproduce the technical report without inference or ledger mutation."""
    from .local import read

    rows = read_events(directory / "events.jsonl")
    attempts = {}
    for row in rows:
        attempts.update(row.get("attempts", {}))
    projected = [
        {**r, "key": attempts[r["key"]]["logicalKey"]} if r.get("key") in attempts else r
        for r in rows
    ]
    provenance = read(directory / "provenance.json")
    report = summarise_check(
        read(directory / "check-plan.json"), bank, projected, provenance["sourceSha256"]
    )
    terminals = [e for e in rows if e["event"] == "episode-ended"]
    report["passed"] = (
        report["passed"]
        and len(terminals) == 26
        and all(e["status"] == "completed" for e in terminals)
    )
    report["recoveryPolicySha256"] = digest(POLICY)
    return report
