"""Offline temperature propagation, provenance and recovery regression checks."""

import copy
import hashlib
import json
import time
from pathlib import Path

import pytest
from gamefield_research.artifacts import export_run, source_index, verify_export
from gamefield_research.design import (
    ARMS,
    digest,
    make_plan,
    make_temperature_plan,
    validate_plan,
)
from gamefield_research.engineering import check_manifest, check_provider, summarise_check
from gamefield_research.gateway import Gateway, GlobalStop, Ledger, read_events, request_body
from gamefield_research.recovery import RecoveryGateway, RecoveryLedger
from gamefield_research.recovery_runner import execute_recoverable
from gamefield_research.runner import run
from test_gateway import PRICES, mock_response


def test_completed_design_and_matched_schedule_are_preserved():
    index = json.loads(Path("public/research/executed-source-index.json").read_text())
    frozen = Path("python/gamefield_research/design_v1.py")
    assert (
        hashlib.sha256(frozen.read_bytes()).hexdigest()
        == index["python/gamefield_research/design.py"]
    )
    reference = json.loads(Path("public/research/plan.json").read_text())
    before = copy.deepcopy(reference)
    assert make_plan(reference["seed"], reference["blocks"]) == reference
    plan = make_temperature_plan(reference)
    assert reference == before
    assert plan["sha256"] != reference["sha256"]
    assert plan["episodes"] == reference["episodes"]
    assert plan["procedure"] == {**reference["procedure"], "temperature": 0}
    assert plan["samplingAmendment"]["referencePlanSha256"] == reference["sha256"]
    assert validate_plan(plan) == plan
    assert validate_plan(reference) == reference
    assert len(plan["episodes"]) == 1776
    plan["episodes"][0]["rounds"] += 1
    assert reference == before


@pytest.mark.parametrize("field", ["temperature", "topP", "reference", "schedule"])
def test_temperature_plan_rejects_tampering_even_with_rehashed_body(field):
    plan = make_temperature_plan(make_plan("temperature-tests", 4))
    if field == "reference":
        plan["samplingAmendment"]["referencePlanSha256"] = "0" * 64
    elif field == "schedule":
        plan["episodes"].reverse()
    else:
        plan["procedure"][field] = 1 if field == "temperature" else 0
    plan["sha256"] = digest({k: v for k, v in plan.items() if k != "sha256"})
    with pytest.raises(ValueError):
        validate_plan(plan)


@pytest.mark.parametrize("temperature", [True, False, 0.0, 1.0, -1, 2, None, "0"])
def test_invalid_sampling_is_rejected_before_dispatch(temperature):
    with pytest.raises(ValueError):
        request_body([], ARMS[0], "action", temperature=temperature)


@pytest.mark.parametrize("temperature", [0, 1])
@pytest.mark.parametrize("recoverable", [False, True])
async def test_every_arm_and_phase_uses_requested_temperature(tmp_path, temperature, recoverable):
    calls = []

    async def transport(body):
        calls.append(copy.deepcopy(body))
        return await mock_response(body)

    ledger_class = RecoveryLedger if recoverable else Ledger
    ledger = (
        ledger_class(tmp_path / "events.jsonl", "18", ".50")
        if recoverable
        else ledger_class(tmp_path / "events.jsonl", "18")
    )
    cls = RecoveryGateway if recoverable else Gateway
    gateway = cls(
        ledger,
        PRICES,
        time.monotonic() + 60,
        transport,
        time.time() + 60,
        temperature=temperature,
    )
    messages = [{"role": "system", "content": "test"}, {"role": "user", "content": "test"}]
    for arm in ARMS:
        gateway.reserve_round([(arm["id"], messages, arm, 1024)])
        assert await gateway.decide(messages, arm, arm["id"]) == "X"
    ledger.close()
    assert len(calls) == 6
    assert all(b["temperature"] == temperature and b["top_p"] == 1 for b in calls)
    assert sum(b["chat_template_kwargs"]["enable_thinking"] for b in calls) == 2
    assert [
        e["request"] for e in read_events(tmp_path / "events.jsonl") if e["event"] == "request-sent"
    ] == calls


async def test_recovery_rejects_temperature_change_without_another_send(tmp_path):
    calls = []

    async def transport(body):
        calls.append(body)
        return await mock_response(body)

    path = tmp_path / "events.jsonl"
    messages = [{"role": "system", "content": "test"}, {"role": "user", "content": "test"}]
    ledger = RecoveryLedger(path, "18", ".50")
    gateway = RecoveryGateway(
        ledger, PRICES, time.monotonic() + 60, transport, time.time() + 60, temperature=0
    )
    gateway.reserve_round([("decision", messages, ARMS[0], 1024)])
    await gateway.decide(messages, ARMS[0], "decision")
    ledger.close()
    ledger = RecoveryLedger(path, "18", ".50", resume=True)
    gateway = RecoveryGateway(
        ledger, PRICES, time.monotonic() + 60, transport, time.time() + 60, temperature=1
    )
    with pytest.raises(GlobalStop, match="differs"):
        await gateway.decide(messages, ARMS[0], "decision")
    ledger.close()
    assert len(calls) == 1


async def test_temperature_zero_engineering_is_bound_to_sampling(tmp_path):
    reference = make_plan("temperature-engineering", 4, "engineering")
    plan = make_temperature_plan(reference)
    bank = json.loads(Path("fixtures/engineering-bank.json").read_text())
    check = check_manifest(plan, bank)
    assert check["sha256"] != check_manifest(reference, bank)["sha256"]
    report = await check_provider(
        plan, bank, tmp_path / "engineering", PRICES, Path.cwd(), mock_response
    )
    assert report["passed"] and report["temperature"] == 0
    events = read_events(tmp_path / "engineering/events.jsonl")
    sent = [e for e in events if e["event"] == "request-sent"]
    assert sent and all(e["request"]["temperature"] == 0 for e in sent)
    sent[0]["request"]["temperature"] = 1
    assert not summarise_check(check, bank, events, report["sourceSha256"])["passed"]


@pytest.mark.parametrize("recoverable", [False, True])
async def test_temperature_zero_plan_runs_and_exports_offline(tmp_path, recoverable):
    plan = make_temperature_plan(make_plan("temperature-integration", 4))
    directory = tmp_path / "run"
    if recoverable:
        result = await execute_recoverable(
            plan,
            directory,
            PRICES,
            Path.cwd(),
            {"sourceFiles": source_index(Path.cwd())},
            time.time() + 120,
            "18",
            "final",
            transport=mock_response,
        )
        assert result["completed"] == result["scheduled"] == 296
    else:
        await run(plan, directory, PRICES, transport=mock_response)
    report = export_run(directory, tmp_path / "export")
    assert report["completed"] == 296 and report["scientificObservations"] == 0
    assert verify_export(tmp_path / "export") == report
    assert "Requested temperature: 0" in (tmp_path / "export/report.md").read_text()
    sent = [e for e in read_events(directory / "events.jsonl") if e["event"] == "request-sent"]
    assert sent and all(e["request"]["temperature"] == 0 for e in sent)
