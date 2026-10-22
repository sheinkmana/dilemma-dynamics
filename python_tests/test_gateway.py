import asyncio
import time

import pytest
from gamefield_research.design import ARMS, make_plan, observation
from gamefield_research.gateway import (
    Gateway,
    GlobalStop,
    Ledger,
    ProtocolFailure,
    read_events,
    strict_json,
)
from gamefield_research.runner import Coordinator

PRICES = [{"model": a["model"], "inputRate": ".06", "outputRate": ".24"} for a in ARMS[::2]]


async def mock_response(body):
    draft = body["chat_template_kwargs"]["enable_thinking"]
    return {
        "model": body["model"],
        "choices": [
            {
                "finish_reason": "length" if draft else "stop",
                "message": {
                    "content": "" if draft else '{"action":"X"}',
                    "reasoning_content": "private draft" if draft else "",
                },
            }
        ],
        "usage": {"prompt_tokens": 100, "completion_tokens": body["max_tokens"] if draft else 7},
    }


def setup(tmp_path, transport=mock_response, cap="18", seconds=30):
    ledger = Ledger(tmp_path / "events.jsonl", cap)
    return Gateway(ledger, PRICES, time.monotonic() + seconds, transport)


@pytest.mark.parametrize(
    "raw",
    [
        '{"action":"X","action":"Y"}',
        '{"action":"X","extra":1}',
        'blah {"action":"X"}',
        '{"action":"C"}',
        "[]",
    ],
)
def test_strict_action(raw):
    with pytest.raises(ProtocolFailure):
        strict_json(raw)


async def test_draft_always_then_action_and_original_observation_preserved(tmp_path):
    calls = []

    async def transport(body):
        calls.append(body)
        return await mock_response(body)

    gateway = setup(tmp_path, transport)
    e = next(
        e
        for e in make_plan("test", 4)["episodes"]
        if e["track"] == "A" and e["players"][e["subjectSeat"]] == "nano-draft"
    )
    messages = observation(e, [], e["subjectSeat"])
    gateway.reserve_round([("key", messages, ARMS[1], 1024)])
    assert await gateway.decide(messages, ARMS[1], "key") == "X"
    assert len(calls) == 2
    assert calls[1]["messages"][1] == messages[1]
    assert "private draft" in calls[1]["messages"][2]["content"]
    assert gateway.ledger.reserved == 0
    gateway.ledger.close()
    events = read_events(tmp_path / "events.jsonl")
    assert events[0]["event"] == "joint-reservation"
    assert len([e for e in events if e["event"] == "request-sent"]) == 2


async def test_no_retry_on_transport_or_unknown_usage(tmp_path):
    count = 0

    async def transport(body):
        nonlocal count
        count += 1
        raise TimeoutError("ambiguous")

    gateway = setup(tmp_path, transport)
    messages = [{"role": "system", "content": "test"}, {"role": "user", "content": "test"}]
    gateway.reserve_round([("key", messages, ARMS[0], 1024)])
    with pytest.raises(GlobalStop):
        await gateway.decide(messages, ARMS[0], "key")
    assert count == 1 and gateway.ledger.reserved > 0 and gateway.halted
    with pytest.raises(GlobalStop):
        gateway.reserve_round([("next", messages, ARMS[0], 1024)])
    gateway.ledger.close()


async def test_received_response_with_missing_usage_retains_reservation(tmp_path):
    calls = 0

    async def missing_usage(body):
        nonlocal calls
        calls += 1
        response = await mock_response(body)
        del response["usage"]
        return response

    gateway = setup(tmp_path, missing_usage)
    messages = [{"role": "system", "content": "test"}, {"role": "user", "content": "test"}]
    gateway.reserve_round([("key", messages, ARMS[0], 1024)])
    with pytest.raises(GlobalStop):
        await gateway.decide(messages, ARMS[0], "key")
    assert calls == 1 and gateway.ledger.reserved > 0 and gateway.ledger.spent == 0
    gateway.ledger.close()
    assert any(e["event"] == "response-received" for e in read_events(gateway.ledger.path))


async def test_simultaneous_sealed_choices_and_joint_reservation(tmp_path):
    waiting, entered = asyncio.Event(), asyncio.Event()
    calls = []

    async def transport(body):
        calls.append(body)
        if len(calls) == 2:
            entered.set()
            await waiting.wait()
        return await mock_response(body)

    gateway = setup(tmp_path, transport)
    e = next(
        e
        for e in make_plan("test", 4)["episodes"]
        if e["track"] == "B"
        and e["players"] == ["nano-direct", "super-direct"]
        and e["rounds"] >= 1
    )
    coordinator = Coordinator(gateway)
    task = asyncio.create_task(coordinator.episode(e))
    await asyncio.wait_for(entered.wait(), 5)
    assert not [r for r in read_events(gateway.ledger.path) if r["event"] == "round-revealed"]
    assert len(read_events(gateway.ledger.path)[0]["entries"]) == 2
    assert all(json_history(b) == [] for b in calls)
    waiting.set()
    result = await task
    assert result["status"] == "completed"
    gateway.ledger.close()


def json_history(body):
    import json

    return json.loads(body["messages"][1]["content"])["completedHistory"]


async def test_budget_and_deadline_stop_before_send(tmp_path):
    gateway = setup(tmp_path, cap=".000001")
    with pytest.raises(GlobalStop):
        gateway.reserve_round([("a", [{"role": "system", "content": "test"}], ARMS[0], 1024)])
    assert not gateway.ledger.sent
    gateway.deadline = time.monotonic() - 1
    with pytest.raises(GlobalStop):
        gateway.check()
    gateway.ledger.close()


async def test_invalid_response_settled_before_failure_and_three_failures_stop(tmp_path):
    async def invalid(body):
        raw = await mock_response(body)
        raw["choices"][0]["message"]["content"] = "invalid"
        return raw

    gateway = setup(tmp_path, invalid)
    coordinator = Coordinator(gateway)
    episodes = [
        e
        for e in make_plan("test", 4)["episodes"]
        if e["track"] == "A" and "nano-direct" in e["players"]
    ][:3]
    for e in episodes:
        assert (await coordinator.episode(e))["status"] == "protocol-failed"
    assert gateway.halted and gateway.ledger.spent > 0 and gateway.ledger.reserved == 0
    gateway.ledger.close()


def test_hash_chain_and_duplicate_claim(tmp_path):
    ledger = Ledger(tmp_path / "events.jsonl", "1")
    ledger.event("test")
    with pytest.raises(FileExistsError):
        Ledger(ledger.path, "1")
    ledger.close()
    ledger.path.write_text(ledger.path.read_text().replace('"test"', '"changed"'))
    with pytest.raises(ValueError):
        read_events(ledger.path)
