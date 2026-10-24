"""No-network regression checks for the approved amendment and preserved evidence."""

import json
import time
from copy import deepcopy
from decimal import Decimal

import pytest
from gamefield_research.design import ARMS, write_json
from gamefield_research.gateway import (
    GlobalStop,
    ProtocolFailure,
    read_events,
    request_body,
    reservation,
)
from gamefield_research.recovery import OVERLOAD_POLICY, AttemptFailure, RecoveryLedger
from inspect_ai.log import read_eval_log

from evaluation_recovery.protocol import POLICY, accounting, prefix_hash, validate_extension
from evaluation_recovery.runner import AmendmentLedger, BoundedGateway, evaluate
from evaluation_v2.design import joint_episodes

PRICES = [{"model": a["model"], "inputRate": ".06", "outputRate": ".24"} for a in ARMS[::2]]
MESSAGES = [{"role": "system", "content": "Choose."}, {"role": "user", "content": "X or Y"}]


async def response(body):
    draft = body["chat_template_kwargs"]["enable_thinking"]
    return {
        "model": body["model"],
        "choices": [
            {
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": "draft" if draft else '{"action":"X"}',
                    "reasoning_content": "reasoning" if draft else "",
                },
            }
        ],
        "usage": {"prompt_tokens": 20, "completion_tokens": 5, "total_tokens": 25},
    }


class Clock:
    def __init__(self):
        self.value = time.time()
        self.sleeps = []

    def now(self):
        return self.value

    async def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.value += seconds


def seed(path, *, attempts=0, saved=None, logical="a/action", body=None):
    body = body or request_body(MESSAGES, ARMS[0], "action", temperature=0)
    ledger = RecoveryLedger(path, "34", ".50", policy=OVERLOAD_POLICY)
    ledger.event("run-started", recoveryPolicy=deepcopy(OVERLOAD_POLICY), execution="synthetic")
    amount = reservation(body, PRICES[0])
    for _ in range(attempts):
        key = ledger.reserve_attempts([(logical, amount, time.time() - 100)])[0]
        ledger.before_send(key, body)
        ledger.event("http-response", key=key, status=529, responseBody='{"error":"overloaded"}')
        ledger.event(
            "attempt-failed", key=key, reason="HTTP 529", retryable=True, nextEligibleUnix=0
        )
    if saved is not None:
        key = ledger.reserve_attempts([(logical, amount, time.time() - 100)])[0]
        ledger.before_send(key, body)
        ledger.event("http-response", key=key, status=200, responseBody=json.dumps(saved))
    ledger.event(
        "run-ended",
        halted="test interruption",
        spentUsd=str(ledger.spent),
        reservedUsd=str(ledger.reserved),
        retryExposureUsd=str(ledger.retry_exposure),
    )
    events = ledger.rows[:]
    ledger.close()
    receipt = {
        "sha256": "test-amendment",
        "amendmentSourceSha256": "test-source",
        "parentEvidenceHead": events[-1]["sha256"],
        "parentEventCount": len(events),
        "parentSpecSha256": "test-spec",
        "parentSourceSha256": "test-base-source",
        "finalClock": {"deadlineUnix": time.time() + 20000},
    }
    return receipt, body


def gateway(path, receipt, transport, clock, *, temperature=0):
    ledger = AmendmentLedger(path, receipt)
    ledger.activate(clock.now())
    return BoundedGateway(
        ledger,
        PRICES,
        temperature=temperature,
        transport=transport,
        clock=clock.now,
        sleep=clock.sleep,
    )


async def test_exhausted_original_request_recovers_without_rewriting_prefix(tmp_path):
    path = tmp_path / "events.jsonl"
    receipt, body = seed(path, attempts=3)
    before = path.read_bytes()
    calls = []

    async def transport(request):
        calls.append(request)
        return await response(request)

    clock = Clock()
    g = gateway(path, receipt, transport, clock)
    inherited = g.ledger.reserved
    g.reserve_round([("a", MESSAGES, ARMS[0], 1024)])
    assert await g.decide(MESSAGES, ARMS[0], "a") == "X"
    assert calls == [body]
    assert g.ledger.logical["a/action"][-1].endswith("attempt-4")
    assert g.ledger.reserved == inherited  # Failed/ambiguous attempts are never erased.
    g.ledger.close()
    assert path.read_bytes().startswith(before)
    assert validate_extension(read_events(path), receipt)


async def test_six_attempt_limit_and_global_cooldown_survive_restart(tmp_path):
    path = tmp_path / "events.jsonl"
    receipt, _ = seed(path, attempts=3)
    calls = []
    clock = Clock()

    async def overload(body):
        calls.append(clock.now())
        raise AttemptFailure("HTTP 529", True)

    g = gateway(path, receipt, overload, clock)
    g.reserve_round([("a", MESSAGES, ARMS[0], 1024)])
    with pytest.raises(GlobalStop, match="Six-attempt"):
        await g.decide(MESSAGES, ARMS[0], "a")
    assert len(calls) == 3
    assert all(b - a >= 300 for a, b in zip(calls, calls[1:]))
    deadline = g.ledger.admissions["a"]
    g.ledger.close()
    g = gateway(path, receipt, overload, clock)
    g.reserve_round([("a", MESSAGES, ARMS[0], 1024)])
    assert g.ledger.admissions["a"] == deadline
    with pytest.raises(GlobalStop, match="Six-attempt"):
        await g.decide(MESSAGES, ARMS[0], "a")
    assert len(calls) == 3
    g.ledger.close()


async def test_529_cooldown_applies_across_both_temperature_gateways(tmp_path):
    path = tmp_path / "events.jsonl"
    receipt, _ = seed(path)
    clock = Clock()
    g = gateway(path, receipt, response, clock)
    other = BoundedGateway(
        g.ledger, PRICES, temperature=1, transport=response, clock=clock.now, sleep=clock.sleep
    )
    start = clock.now()
    # Use a real reserved request so the failure has its original identity.
    g.reserve_round([("a", MESSAGES, ARMS[0], 1024)])
    key = g.ledger.logical["a/action"][0]
    g.ledger.before_send(key, request_body(MESSAGES, ARMS[0], "action", temperature=0))
    g.ledger.event("http-response", key=key, status=529, responseBody='{"error":"overloaded"}')
    g._record_failure(key, "HTTP 529", True)
    other.reserve_round([("b", MESSAGES, ARMS[0], 1024)])
    await other.decide(MESSAGES, ARMS[0], "b")
    assert clock.now() - start >= 300
    g.ledger.close()


@pytest.mark.parametrize("malformation", [None, "usage", "action"])
async def test_saved_200_never_replaced_even_when_invalid(tmp_path, malformation):
    body = request_body(MESSAGES, ARMS[0], "action", temperature=0)
    raw = await response(body)
    if malformation == "usage":
        del raw["usage"]
    elif malformation == "action":
        raw["choices"][0]["message"]["content"] = "invalid"
    path = tmp_path / "events.jsonl"
    receipt, _ = seed(path, saved=raw)

    async def forbidden(body):
        pytest.fail("A durable HTTP 200 must not trigger a new completion")

    g = gateway(path, receipt, forbidden, Clock())
    g.reserve_round([("a", MESSAGES, ARMS[0], 1024)])
    if malformation:
        with pytest.raises((GlobalStop, ProtocolFailure)):
            await g.decide(MESSAGES, ARMS[0], "a")
    else:
        assert await g.decide(MESSAGES, ARMS[0], "a") == "X"
    g.ledger.close()


async def test_request_identity_budget_and_deadline_guards_precede_new_calls(tmp_path):
    path = tmp_path / "events.jsonl"
    receipt, body = seed(path, attempts=3)
    calls = []

    async def transport(body):
        calls.append(body)
        return await response(body)

    clock = Clock()
    g = gateway(path, receipt, transport, clock)
    g.reserve_round([("a", MESSAGES, ARMS[0], 1024)])
    with pytest.raises(GlobalStop, match="differs"):
        await g.decide([{"role": "system", "content": "changed"}], ARMS[0], "a")
    g.ledger.retry_cap = g.ledger.retry_exposure
    with pytest.raises(GlobalStop, match="Retry exposure"):
        await g.decide(MESSAGES, ARMS[0], "a")
    g.ledger.retry_cap = Decimal(POLICY["retryExposureUsd"]["final"])
    g.ledger.cap = g.ledger.spent + g.ledger.reserved
    with pytest.raises(GlobalStop, match="allocation"):
        await g.decide(MESSAGES, ARMS[0], "a")
    clock.value = g.ledger.admissions["a"] + 1
    with pytest.raises(GlobalStop, match="deadline"):
        await g.decide(MESSAGES, ARMS[0], "a")
    assert not calls
    g.ledger.close()


def test_duplicate_admissions_unauthorised_extension_and_prefix_change_refused(tmp_path):
    path = tmp_path / "events.jsonl"
    receipt, _ = seed(path)
    size = path.stat().st_size
    initial = prefix_hash(path, size)
    g = gateway(path, receipt, response, Clock())
    g.ledger.admit("a", time.time())
    rows = g.ledger.rows[:]
    g.ledger.close()
    assert prefix_hash(path, size) == initial
    with pytest.raises(ValueError, match="different recovery"):
        validate_extension(rows, {**receipt, "sha256": "other"})
    damaged = deepcopy(rows)
    damaged[receipt["parentEventCount"] - 1]["sha256"] = "changed"
    with pytest.raises(ValueError, match="head changed"):
        validate_extension(damaged, receipt)


async def test_native_inspect_reuses_revealed_episodes_and_scores_both_temperatures(tmp_path):
    parent = tmp_path
    (parent / "final").mkdir()
    path = parent / "final/events.jsonl"
    receipt, _ = seed(path)
    source = joint_episodes("native-amendment-test", 4)
    episodes = []
    for t in (0, 1):
        for arm in ("nano-direct", "super-draft"):
            episodes.append(
                next(
                    e
                    for e in source
                    if e["temperature"] == t
                    and e["track"] == "A"
                    and e["players"][e["subjectSeat"]] == arm
                    and e["rounds"] == 1
                )
            )
    write_json(parent / "selection.json", {"selectedBlocks": 4})
    write_json(parent / "schedule-4.json", episodes)
    write_json(parent / "prices.json", {"prices": PRICES})
    calls = []

    async def transport(body):
        calls.append(body)
        return await response(body)

    await evaluate(parent, receipt, transport=transport)
    count = len(calls)
    assert count == 6 and {b["temperature"] for b in calls} == {0, 1}
    await evaluate(parent, receipt, transport=transport)
    assert len(calls) == count
    events = read_events(path)
    assert sum(r["event"] == "episode-ended" for r in events) == 4
    logs = [read_eval_log(p) for p in (parent / "final/inspect").glob("*.eval")]
    assert len(logs) == 2 and all(log.status == "success" for log in logs)
    assert all(s.scores and s.error is None for log in logs for s in log.samples)
    assert any(
        e.event == "info" and e.source == "joint-reveal"
        for log in logs
        for s in log.samples
        for e in s.events
    )
    assert all(log.eval.metadata["amendmentSha256"] == receipt["sha256"] for log in logs)
    before = path.read_bytes()
    with pytest.raises(ValueError, match="Synthetic transport"):
        await evaluate(parent, receipt)
    assert path.read_bytes() == before


async def test_expired_recovery_admission_is_never_renewed_on_resume(tmp_path):
    path = tmp_path / "events.jsonl"
    receipt, _ = seed(path, attempts=3)
    clock = Clock()
    g = gateway(path, receipt, response, clock)
    g.reserve_round([("a", MESSAGES, ARMS[0], 1024)])
    original = g.ledger.admissions["a"]
    g.ledger.close()
    clock.value = original + 1
    calls = []

    async def forbidden(body):
        calls.append(body)
        pytest.fail("Expired admission must not call the provider")

    g = gateway(path, receipt, forbidden, clock)
    g.reserve_round([("a", MESSAGES, ARMS[0], 1024)])
    assert g.ledger.admissions["a"] == original
    with pytest.raises(GlobalStop, match="deadline"):
        await g.decide(MESSAGES, ARMS[0], "a")
    g.ledger.close()
    assert not calls


async def test_original_final_deadline_blocks_new_reservations(tmp_path):
    path = tmp_path / "events.jsonl"
    receipt, _ = seed(path)
    clock = Clock()
    receipt["finalClock"]["deadlineUnix"] = clock.now() - 1
    g = gateway(path, receipt, response, clock)
    before = g.ledger.sequence
    with pytest.raises(GlobalStop, match="deadline"):
        g.reserve_round([("a", MESSAGES, ARMS[0], 1024)])
    assert g.ledger.sequence == before
    g.ledger.close()


def test_accounting_retains_parent_exposure_and_rejects_overrun(tmp_path):
    path = tmp_path / "events.jsonl"
    seed(path, attempts=3)
    rows = read_events(path)
    result = accounting(rows)
    assert Decimal(result["reservedUsd"]) > 0
    assert Decimal(result["retryExposureUsd"]) > 0
    assert result["reservedUsd"] == rows[-1]["reservedUsd"]
    with pytest.raises(ValueError, match="overrun"):
        accounting(rows + [{"event": "accounting-overrun"}])


async def test_durable_old_draft_conditions_only_one_new_action(tmp_path):
    path = tmp_path / "events.jsonl"
    draft_body = request_body(MESSAGES, ARMS[1], "draft", temperature=0)
    receipt, _ = seed(path, logical="a/draft", body=draft_body, saved=await response(draft_body))
    calls = []

    async def action_only(body):
        calls.append(body)
        assert not body["chat_template_kwargs"]["enable_thinking"]
        assert json.loads(body["messages"][2]["content"])["privateDraft"] == "reasoning"
        return await response(body)

    g = gateway(path, receipt, action_only, Clock())
    g.reserve_round([("a", MESSAGES, ARMS[1], 1024)])
    assert await g.decide(MESSAGES, ARMS[1], "a") == "X"
    assert len(calls) == 1
    g.ledger.close()


def test_local_mlflow_records_amendment_source_and_inherited_exposure(tmp_path):
    from mlflow.tracking import MlflowClient

    from evaluation_recovery.tracking import record

    parent = tmp_path / "parent"
    (parent / "final").mkdir(parents=True)
    receipt, _ = seed(parent / "final/events.jsonl", attempts=3)
    receipt["parentDirectory"] = str(parent)
    directory = tmp_path / "recovery"
    directory.mkdir()
    write_json(directory / "amendment.json", receipt)
    write_json(directory / "source-index.json", {})
    write_json(directory / "preparation.json", {})
    (directory / "source.tar.gz").write_bytes(b"offline-test-artifact")
    client = MlflowClient(tracking_uri="sqlite:///" + str(parent / "tracking.sqlite"))
    client.create_experiment(
        "dilemma-final-v3", artifact_location=(tmp_path / "artifacts").as_uri()
    )
    first = record(directory, "preflight")
    assert record(directory, "preflight")["runId"] == first["runId"]
    run = client.get_run(first["runId"])
    assert run.data.params["maximum_attempts_total"] == "6"
    assert run.data.params["additional_budget_usd"] == "0"
    assert run.data.params["amendment_source_sha256"] == receipt["amendmentSourceSha256"]
    assert run.data.metrics["reservedUsd"] > 0


def test_transport_segments_do_not_pool_pre_and_post_amendment_failures(tmp_path):
    from evaluation_recovery.tracking import transport_diagnostics

    path = tmp_path / "events.jsonl"
    receipt, body = seed(path, attempts=3)
    rows = read_events(path)
    original = transport_diagnostics(rows, receipt["parentEventCount"])
    assert original[0]["requests"] == 3
    assert original[0]["httpStatuses"] == {"529": 3}
    tail = [{"event": "request-sent", "sequence": len(rows), "key": "future", "request": body}]
    result = transport_diagnostics(rows + tail, receipt["parentEventCount"])
    assert result[1]["segment"] == "approved-recovery"
    assert result[1]["httpStatuses"] == {"no-durable-http-response": 1}
