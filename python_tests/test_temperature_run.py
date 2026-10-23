"""Budget and user-launch lifecycle tests. All HTTP traffic is mocked."""

import json
from pathlib import Path

import pytest
from gamefield_research.artifacts import hash_file, verify_export
from gamefield_research.design import digest, write_json
from gamefield_research.gateway import money, read_events
from gamefield_research.local import read
from gamefield_research.successor import execute_successor, finalise_successor
from gamefield_research.temperature_run import (
    CAPS,
    PRICE_REFERENCE,
    execute_temperature,
    finalise_temperature,
    prepare_temperature,
    temperature_authority,
    verify_temperature,
)
from test_gateway import mock_response
from test_successor import successor as successor


@pytest.fixture
async def temperature_bundle(successor, monkeypatch):
    # Lifecycle assertions need byte preservation, not thousands of physical
    # flushes of mocked traffic. The existing gateway suite exercises real fsync.
    monkeypatch.setattr("os.fsync", lambda fd: None)
    root, _, reference, _ = successor
    await execute_successor(reference, "engineering", root)
    finalise_successor(reference, root)
    await execute_successor(reference, "final", root)
    before = {str(p): hash_file(p) for p in reference.rglob("*") if p.is_file()}
    directory = reference.parent / "temperature-zero"
    result = prepare_temperature(directory, reference, root, PRICE_REFERENCE)
    assert result["paidCallsMade"] == 0 and not (directory / "claims/window.json").exists()
    yield root, directory, result
    assert all(hash_file(Path(name)) == sha for name, sha in before.items())


@pytest.mark.parametrize(
    "successor",
    ["gamefield-engineering-2026-10-20-44068710156a13eb30f2690896e38c72"],
    indirect=True,
)
async def test_complete_mocked_temperature_pipeline_with_reconciled_budget(temperature_bundle):
    root, directory, result = temperature_bundle
    record = verify_temperature(directory, root)
    prior = sum(money(record["accounting"][k]) for k in ("priorValidationUsd", "priorFinalUsd"))
    assert prior > 0
    assert (
        prior + money("8") + sum(map(money, CAPS.values())) + money(result["unallocatedUsd"]) == 30
    )
    plan = read(directory / "plan.json")
    assert plan["samplingAmendment"]["poolReferenceObservations"] is False
    with pytest.raises(FileNotFoundError):
        finalise_temperature(directory, root)
    with pytest.raises(ValueError, match="already prepared"):
        prepare_temperature(
            directory.parent / "duplicate", Path(record["referenceRoot"]), root, PRICE_REFERENCE
        )
    report = await execute_temperature(directory, "engineering", root)
    assert report["passed"] and report["temperature"] == 0
    assert finalise_temperature(directory, root)["finalReady"]
    result = await execute_temperature(directory, "final", root)
    assert result["completed"] == result["scheduled"] == 1776
    exported = Path(result["export"])
    assert verify_export(exported)["scientificObservations"] == 1776  # HTTP is mocked.
    requests = [
        e
        for e in read_events(directory / "evidence/final/events.jsonl")
        if e["event"] == "request-sent"
    ]
    assert requests and all(e["request"]["temperature"] == 0 for e in requests)
    with pytest.raises(FileExistsError):
        await execute_temperature(directory, "final", root)
    await execute_temperature(directory, "final", root, resume=True)
    after = [
        e
        for e in read_events(directory / "evidence/final/events.jsonl")
        if e["event"] == "request-sent"
    ]
    assert len(after) == len(requests)


@pytest.mark.parametrize(
    "successor",
    ["gamefield-engineering-2026-10-20-44068710156a13eb30f2690896e38c72"],
    indirect=True,
)
async def test_modified_receipt_synthetic_check_and_changed_source_cannot_unlock(
    temperature_bundle,
):
    root, directory, _ = temperature_bundle
    path = directory / "engineering-deployment.json"
    original = path.read_bytes()
    receipt = read(path)
    receipt["capUsd"] = "30"
    path.write_text(json.dumps(receipt))
    with pytest.raises(ValueError, match="receipt"):
        await execute_temperature(directory, "engineering", root)
    assert not (directory / "claims/window.json").exists()
    path.write_bytes(original)
    report = await execute_temperature(directory, "engineering", root, transport=mock_response)
    assert report["passed"] and report["execution"] == "synthetic"
    with pytest.raises(ValueError, match="synthetic"):
        finalise_temperature(directory, root)
    (root / "python/gamefield_research/temperature_run.py").write_text("# changed source\n")
    with pytest.raises(ValueError, match="source changed"):
        verify_temperature(directory, root)


def test_budget_rejects_insufficient_total_before_creating_authority(tmp_path, monkeypatch):
    from gamefield_research import temperature_run as module
    from gamefield_research.design import ARMS, make_plan

    root = tmp_path / "root"
    (root / "fixtures").mkdir(parents=True)
    reference = tmp_path / "reference"
    reference.mkdir()
    prices = read(Path("fixtures/prices-2026-10-20.json"))
    write_json(reference / "prices.json", prices)
    write_json(root / "fixtures/prices-2026-10-20.json", prices)
    technical = {
        "requestTelemetry": [
            {"model": arm["model"], "phase": phase, "seconds": 0.01, "promptTokens": 100}
            for arm in ARMS[::2]
            for phase in ("draft", "action")
            for _ in range(2)
        ]
    }
    monkeypatch.setattr(
        module,
        "completed_reference",
        lambda *args: (
            make_plan("budget-reference"),
            make_plan("budget-engineering", 4, "engineering"),
            {"priorValidationUsd": "1", "priorFinalUsd": "10", "otherChargesReserveUsd": "8"},
            {},
            technical,
        ),
    )
    directory = tmp_path / "new-preparation"
    with pytest.raises(ValueError, match="do not fit"):
        prepare_temperature(directory, reference, root, PRICE_REFERENCE)
    assert not directory.exists() and not temperature_authority(root).exists()


def test_temperature_supervisor_keeps_original_window(tmp_path, monkeypatch):
    import time

    from gamefield_research import successor_supervisor as supervisor

    (tmp_path / "claims").mkdir()
    window = {"startedAtUnix": time.time() - 10, "deadlineUnix": time.time() + 600}
    write_json(tmp_path / "claims/window.json", window)
    commands = []

    class Finished:
        pid = 1
        returncode = 0

        def poll(self):
            return 0

    monkeypatch.setattr(
        supervisor.subprocess,
        "Popen",
        lambda command, **kwargs: commands.append(command) or Finished(),
    )
    assert supervisor.launch(tmp_path, command_suffix="temperature")["originalClockPreserved"]
    assert commands[0][3] == "verify-temperature"
    assert commands[-1][3] == "export-temperature"
    assert digest(read(tmp_path / "claims/window.json")) == digest(window)
    monkeypatch.setattr(supervisor.time, "time", lambda: window["deadlineUnix"] + 1)
    commands.clear()
    with pytest.raises(ValueError, match="expired"):
        supervisor.launch(tmp_path, command_suffix="temperature")
    assert not commands
