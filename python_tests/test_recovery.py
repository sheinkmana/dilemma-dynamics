import json
import time

import httpx
import pytest
from gamefield_research.design import ARMS, make_plan, observation
from gamefield_research.gateway import GlobalStop, ProtocolFailure, read_events, request_body
from gamefield_research.recovery import POLICY, RecoveryGateway, RecoveryLedger
from gamefield_research.recovery_runner import RecoveryCoordinator
from test_gateway import PRICES, mock_response


def gateway(tmp_path, transport=mock_response, resume=False, cap="18", retry_cap=".50"):
    ledger = RecoveryLedger(tmp_path / "events.jsonl", cap, retry_cap, resume)
    return RecoveryGateway(ledger, PRICES, time.monotonic() + 60, transport, time.time() + 60)


def messages():
    return [{"role": "system", "content": "test"}, {"role": "user", "content": "test"}]


@pytest.fixture
def no_backoff(monkeypatch):
    monkeypatch.setitem(POLICY, "backoffSeconds", [0, 0])


async def test_502_retry_accounts_every_attempt(tmp_path, monkeypatch, no_backoff):
    original = httpx.AsyncClient
    calls = []

    async def handle(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            return httpx.Response(502, text="nginx Bad Gateway")
        return httpx.Response(200, json=await mock_response(body))

    def client(**kwargs):
        kwargs["transport"] = httpx.MockTransport(handle)
        return original(**kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    monkeypatch.setenv("NEBIUS_API_KEY", "test-only-no-network")
    g = gateway(tmp_path, None)
    g.reserve_round([("a", messages(), ARMS[0], 1024)])
    assert await g.decide(messages(), ARMS[0], "a") == "X"
    assert calls[0] == calls[1]
    assert g.ledger.reserved > 0 and g.ledger.spent > 0 and g.ledger.retry_exposure > 0
    first = g.ledger.logical["a/action"][0]
    assert first in g.ledger.pending and first in g.ledger.sent
    assert len(g.ledger.logical["a/action"]) == 2
    expected = (g.ledger.spent, g.ledger.reserved, g.ledger.retry_exposure)
    g.ledger.close()
    g = gateway(tmp_path, resume=True)
    assert (g.ledger.spent, g.ledger.reserved, g.ledger.retry_exposure) == expected
    g.ledger.close()


async def test_ambiguous_timeout_retries_and_retains_reservation(tmp_path, no_backoff):
    calls = 0

    async def timeout_once(body):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise TimeoutError("ambiguous")
        return await mock_response(body)

    g = gateway(tmp_path, timeout_once)
    g.reserve_round([("a", messages(), ARMS[0], 1024)])
    assert await g.decide(messages(), ARMS[0], "a") == "X" and calls == 2
    assert g.ledger.reserved > 0
    g.ledger.close()


@pytest.mark.parametrize("malformation", ["usage", "action", "reasoning"])
async def test_successful_response_never_replaced_to_fix_content(
    tmp_path, malformation, no_backoff
):
    calls = 0

    async def invalid(body):
        nonlocal calls
        calls += 1
        raw = await mock_response(body)
        if malformation == "usage":
            del raw["usage"]
        elif malformation == "action":
            raw["choices"][0]["message"]["content"] = "invalid"
        else:
            raw["choices"][0]["message"]["reasoning_content"] = "unexpected"
        return raw

    g = gateway(tmp_path, invalid)
    g.reserve_round([("a", messages(), ARMS[0], 1024)])
    with pytest.raises((GlobalStop, ProtocolFailure)):
        await g.decide(messages(), ARMS[0], "a")
    g.ledger.close()
    g = gateway(tmp_path, invalid, resume=True)
    with pytest.raises((GlobalStop, ProtocolFailure)):
        await g.decide(messages(), ARMS[0], "a")
    assert calls == 1
    g.ledger.close()


async def test_retry_limit_survives_resume(tmp_path, no_backoff):
    calls = 0

    async def fail(body):
        nonlocal calls
        calls += 1
        raise TimeoutError()

    g = gateway(tmp_path, fail)
    g.reserve_round([("a", messages(), ARMS[0], 1024)])
    with pytest.raises(GlobalStop, match="exhausted"):
        await g.decide(messages(), ARMS[0], "a")
    assert calls == 3 and len(g.ledger.pending) == 3
    g.ledger.close()
    g = gateway(tmp_path, fail, resume=True)
    with pytest.raises(GlobalStop, match="exhausted"):
        await g.decide(messages(), ARMS[0], "a")
    assert calls == 3
    g.ledger.close()


async def test_crash_after_http_before_settlement_reuses_response(tmp_path):
    g = gateway(tmp_path)
    body = request_body(messages(), ARMS[0], "action")
    g.reserve_round([("a", messages(), ARMS[0], 1024)])
    key = g.ledger.logical["a/action"][0]
    g.ledger.before_send(key, body)
    raw = await mock_response(body)
    g.ledger.event("http-response", key=key, status=200, responseBody=json.dumps(raw))
    g.ledger.close()

    async def forbidden(body):
        pytest.fail("Saved response must never be regenerated")

    g = gateway(tmp_path, forbidden, resume=True)
    assert await g.decide(messages(), ARMS[0], "a") == "X"
    assert g.ledger.reserved == 0 and g.ledger.spent > 0
    assert len([r for r in g.ledger.rows if r["event"] == "settled"]) == 1
    g.ledger.close()


async def test_sealed_partial_round_survives_crash_without_leaking(tmp_path):
    episode = dict(
        next(
            e
            for e in make_plan("test", 4)["episodes"]
            if e["track"] == "B" and e["players"] == ["nano-direct", "super-direct"]
        )
    )
    episode["rounds"] = 1  # One-round unit fixture for the crash boundary.
    g = gateway(tmp_path)
    jobs = [
        (f"{episode['id']}/1/{seat}", observation(episode, [], seat), ARMS[seat * 2], 1024)
        for seat in (0, 1)
    ]
    g.reserve_round(jobs)
    assert await g.decide(jobs[0][1], ARMS[0], jobs[0][0]) == "X"
    assert not [e for e in g.ledger.rows if e["event"] == "round-revealed"]
    saved_spend = g.ledger.spent
    g.ledger.close()
    calls = []

    async def remaining(body):
        calls.append(body)
        assert body["model"] == ARMS[2]["model"]
        assert json.loads(body["messages"][1]["content"])["completedHistory"] == []
        return await mock_response(body)

    g = gateway(tmp_path, remaining, resume=True)
    assert await RecoveryCoordinator(g, [episode]).episode(episode) == "completed"
    assert len(calls) == 1 and g.ledger.spent > saved_spend
    assert len([e for e in g.ledger.rows if e["event"] == "round-revealed"]) == 1
    g.ledger.close()
    g = gateway(tmp_path, remaining, resume=True)
    assert await RecoveryCoordinator(g, [episode]).episode(episode) == "completed"
    assert len(calls) == 1
    g.ledger.close()


async def test_draft_replayed_before_action_and_changed_observation_refused(tmp_path):
    g = gateway(tmp_path)
    g.reserve_round([("a", messages(), ARMS[1], 1024)])
    body = request_body(messages(), ARMS[1], "draft")
    await g.call("a/draft", body, time.monotonic() + 60)
    g.ledger.close()
    calls = []

    async def action_only(body):
        calls.append(body)
        assert not body["chat_template_kwargs"]["enable_thinking"]
        assert "private draft" in body["messages"][2]["content"]
        return await mock_response(body)

    g = gateway(tmp_path, action_only, resume=True)
    assert await g.decide(messages(), ARMS[1], "a") == "X" and len(calls) == 1
    with pytest.raises(GlobalStop, match="differs"):
        await g.decide([{"role": "system", "content": "changed"}], ARMS[1], "a")
    g.ledger.close()


async def test_expired_deadline_and_retry_and_stage_caps_prevent_send(tmp_path, no_backoff):
    calls = 0

    async def fail(body):
        nonlocal calls
        calls += 1
        raise TimeoutError()

    g = gateway(tmp_path, fail, retry_cap="0")
    g.reserve_round([("a", messages(), ARMS[0], 1024)])
    with pytest.raises(GlobalStop, match="Retry exposure"):
        await g.decide(messages(), ARMS[0], "a")
    assert calls == 1
    g.ledger.close()
    g = gateway(tmp_path, fail, resume=True, retry_cap="0")
    g.ledger.attempts[g.ledger.logical["a/action"][0]]["decisionDeadlineUnix"] = time.time() - 1
    with pytest.raises(GlobalStop, match="deadline"):
        await g.decide(messages(), ARMS[0], "a")
    assert calls == 1
    g.ledger.close()
    other = tmp_path / "other"
    other.mkdir()
    g = gateway(other, fail, cap=".0000001")
    with pytest.raises(GlobalStop, match="allocation"):
        g.reserve_round([("a", messages(), ARMS[0], 1024)])
    assert calls == 1
    g.ledger.close()


def test_concurrent_writer_and_partial_tail_refused_without_repair(tmp_path):
    g = gateway(tmp_path)
    g.ledger.event("test")
    with pytest.raises(BlockingIOError):
        gateway(tmp_path, resume=True)
    g.ledger.close()
    path = tmp_path / "events.jsonl"
    with path.open("a") as stream:
        stream.write('{"partial":')
    before = path.read_bytes()
    with pytest.raises(ValueError, match="tail"):
        gateway(tmp_path, resume=True)
    assert path.read_bytes() == before


async def test_crash_after_reveal_before_episode_end_does_not_reissue(tmp_path):
    episode = next(e for e in make_plan("test", 4)["episodes"] if e["rounds"] == 1)
    g = gateway(tmp_path)
    pair = ["C", "C"]
    if episode["track"] == "A" and episode["policy"] == "alld":
        pair[1 - episode["subjectSeat"]] = "D"
    g.ledger.event("round-revealed", episodeId=episode["id"], round=1, actions=pair)
    g.ledger.close()

    async def forbidden(body):
        pytest.fail("Complete revealed episode needs no inference")

    g = gateway(tmp_path, forbidden, resume=True)
    assert await RecoveryCoordinator(g, [episode]).episode(episode) == "completed"
    assert len([r for r in read_events(g.ledger.path) if r["event"] == "episode-ended"]) == 1
    g.ledger.close()


async def test_reported_reservation_overrun_records_actual_cost_and_blocks_resume(tmp_path):
    async def oversized(body):
        raw = await mock_response(body)
        raw["usage"]["completion_tokens"] = 100000
        return raw

    g = gateway(tmp_path, oversized)
    g.reserve_round([("a", messages(), ARMS[0], 1024)])
    with pytest.raises(GlobalStop, match="actual usage"):
        await g.decide(messages(), ARMS[0], "a")
    assert g.ledger.spent > 0 and g.ledger.reserved == 0
    assert g.ledger.violation
    g.ledger.close()
    with pytest.raises(GlobalStop, match="no resume"):
        gateway(tmp_path, resume=True)
