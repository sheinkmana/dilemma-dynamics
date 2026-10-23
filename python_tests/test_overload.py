"""Prospective overload handling and macOS sleep prevention, without inference."""

import copy
import time

import httpx
import pytest
from gamefield_research.cli import keep_mac_awake
from gamefield_research.design import ARMS
from gamefield_research.gateway import GlobalStop, read_events
from gamefield_research.recovery import OVERLOAD_POLICY, POLICY, RecoveryGateway, RecoveryLedger
from test_gateway import PRICES, mock_response


@pytest.mark.parametrize("amended", [False, True])
async def test_http_529_is_only_retried_under_prospective_policy(tmp_path, monkeypatch, amended):
    before = copy.deepcopy(POLICY)
    policy = OVERLOAD_POLICY if amended else POLICY
    if amended:
        monkeypatch.setitem(OVERLOAD_POLICY, "backoffSeconds", [0, 0])
    calls = []
    original = httpx.AsyncClient

    async def handle(request):
        import json

        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            return httpx.Response(529, json={"error": {"message": "worker overloaded"}})
        return httpx.Response(200, json=await mock_response(body))

    def client(**kwargs):
        kwargs["transport"] = httpx.MockTransport(handle)
        return original(**kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    monkeypatch.setenv("NEBIUS_API_KEY", "test-only-no-real-http")
    ledger = RecoveryLedger(tmp_path / "events.jsonl", "1", ".50", policy=policy)
    gateway = RecoveryGateway(
        ledger, PRICES, time.monotonic() + 60, None, time.time() + 60, temperature=0, policy=policy
    )
    messages = [{"role": "system", "content": "test"}, {"role": "user", "content": "test"}]
    gateway.reserve_round([("decision", messages, ARMS[0], 1024)])
    if amended:
        assert await gateway.decide(messages, ARMS[0], "decision") == "X"
        assert len(calls) == 2 and calls[0] == calls[1] and calls[1]["temperature"] == 0
        assert ledger.reserved > 0 and ledger.retry_exposure > 0 and ledger.spent > 0
        assert (
            ledger.attempts["decision/action/attempt-1"]["decisionDeadlineUnix"]
            == ledger.attempts["decision/action/attempt-2"]["decisionDeadlineUnix"]
        )
    else:
        with pytest.raises(GlobalStop, match="policy exhausted"):
            await gateway.decide(messages, ARMS[0], "decision")
        assert len(calls) == 1
    ledger.close()
    assert POLICY == before


async def test_recorded_policy_cannot_be_changed_on_resume(tmp_path):
    path = tmp_path / "events.jsonl"
    ledger = RecoveryLedger(path, "1", ".5")
    ledger.event("run-started", recoveryPolicy=POLICY)
    ledger.close()
    before = path.read_bytes()
    with pytest.raises(ValueError, match="recorded recovery policy"):
        RecoveryLedger(path, "1", ".5", resume=True, policy=OVERLOAD_POLICY)
    assert path.read_bytes() == before


async def test_overload_remains_bounded_and_reserves_every_attempt(tmp_path, monkeypatch):
    monkeypatch.setitem(OVERLOAD_POLICY, "backoffSeconds", [0, 0])
    original = httpx.AsyncClient

    def client(**kwargs):
        kwargs["transport"] = httpx.MockTransport(
            lambda r: httpx.Response(529, text="worker overloaded")
        )
        return original(**kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    monkeypatch.setenv("NEBIUS_API_KEY", "test-only-no-real-http")
    ledger = RecoveryLedger(tmp_path / "events.jsonl", "1", ".5", policy=OVERLOAD_POLICY)
    gateway = RecoveryGateway(
        ledger, PRICES, time.monotonic() + 60, None, time.time() + 60, policy=OVERLOAD_POLICY
    )
    messages = [{"role": "system", "content": "test"}, {"role": "user", "content": "test"}]
    gateway.reserve_round([("decision", messages, ARMS[0], 1024)])
    with pytest.raises(GlobalStop, match="policy exhausted"):
        await gateway.decide(messages, ARMS[0], "decision")
    assert len(ledger.sent) == len(ledger.pending) == 3 and ledger.reserved > 0
    ledger.close()
    assert sum(e["event"] == "attempt-failed" for e in read_events(tmp_path / "events.jsonl")) == 3


def test_mac_launch_is_wrapped_for_utility_lifetime(monkeypatch):
    from gamefield_research import cli

    monkeypatch.setattr(cli.sys, "platform", "darwin")
    monkeypatch.setattr(cli.sys, "argv", ["gamefield-study", "launch-temperature", "/tmp/example"])
    monkeypatch.delenv("GAMEFIELD_CAFFEINATED", raising=False)
    calls = []
    monkeypatch.setattr(cli.os, "execve", lambda *args: calls.append(args))
    keep_mac_awake("launch-temperature")
    executable, arguments, environment = calls[0]
    assert executable == "/usr/bin/caffeinate" and arguments[1] == "-i"
    assert arguments[-2:] == ["launch-temperature", "/tmp/example"]
    assert environment["GAMEFIELD_CAFFEINATED"] == "1"
    monkeypatch.setenv("GAMEFIELD_CAFFEINATED", "1")
    keep_mac_awake("launch-temperature")
    assert len(calls) == 1


@pytest.mark.parametrize(
    "command,platform", [("verify-temperature", "darwin"), ("launch-temperature", "linux")]
)
def test_offline_commands_and_other_platforms_do_not_wrap(monkeypatch, command, platform):
    from gamefield_research import cli

    monkeypatch.setattr(cli.sys, "platform", platform)
    calls = []
    monkeypatch.setattr(cli.os, "execve", lambda *args: calls.append(args))
    keep_mac_awake(command)
    assert not calls
