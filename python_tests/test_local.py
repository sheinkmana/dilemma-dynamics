import copy
import json
import shutil
import time
from pathlib import Path

import httpx
import pytest
from gamefield_research.artifacts import verify_export
from gamefield_research.campaign import (
    authority_path,
    claim_local_stage,
    claim_route,
    require_route,
)
from gamefield_research.design import (
    derive_local_plan,
    digest,
    make_plan,
    validate_plan,
    write_json,
)
from gamefield_research.gateway import Gateway, GlobalStop, Ledger
from gamefield_research.local import (
    execute_local,
    finalise_local,
    hosted_report,
    prepare_local,
    read,
    review_local,
    verify_local_deployment,
    verify_preparation,
)
from gamefield_research.readiness import deployment_template, verify_deployment
from gamefield_research.timing import episode_slot_seconds, measured_forecast
from test_gateway import PRICES, mock_response


@pytest.fixture
def prepared(tmp_path):
    root = tmp_path / "checkout"
    root.mkdir()
    for directory in ("python", "deploy", "fixtures"):
        shutil.copytree(Path.cwd() / directory, root / directory)
    for name in ("pyproject.toml", "uv.lock"):
        shutil.copyfile(Path.cwd() / name, root / name)
    parent, engineering = (
        make_plan("local-parent", 24),
        make_plan("local-engineering", 4, "engineering"),
    )
    write_json(tmp_path / "parent.json", parent)
    write_json(tmp_path / "engineering.json", engineering)
    packet = tmp_path / "packet"
    prepare_local(
        packet,
        tmp_path / "parent.json",
        tmp_path / "engineering.json",
        root / "fixtures/prices-2026-10-20.json",
        root,
    )
    return root, packet


def review(packet, root):
    return review_local(
        packet,
        {
            "pricesConfirmed": True,
            "priceReference": "test fixture, never a real price review",
            "priorValidationUsd": "0",
            "priorFinalUsd": "0",
            "otherChargesReserveUsd": "8",
        },
        root,
    )


def test_subset_provenance_order_and_tampering():
    parent = make_plan("unchanged-parent", 24)
    saved = copy.deepcopy(parent)
    child = derive_local_plan(parent, 8)
    assert parent == saved
    assert child["episodes"] == [e for e in parent["episodes"] if e["block"] < 8]
    assert child["derivation"]["parentSha256"] == parent["sha256"]
    assert child["limits"]["wallSeconds"] == 32400
    assert validate_plan(child) == child
    assert child["sha256"] != parent["sha256"]
    for change in ("rounds", "mapping", "order", "parent", "wall"):
        invalid = copy.deepcopy(child)
        if change == "rounds":
            invalid["episodes"][0]["rounds"] += 1
        elif change == "mapping":
            invalid["episodes"][0]["mapping"] = (
                "X=D" if invalid["episodes"][0]["mapping"] == "X=C" else "X=C"
            )
        elif change == "order":
            invalid["episodes"].reverse()
        elif change == "wall":
            invalid["limits"]["wallSeconds"] = 43200
        else:
            invalid["derivation"]["parentSha256"] = "0" * 64
        invalid["sha256"] = digest({k: v for k, v in invalid.items() if k != "sha256"})
        with pytest.raises(ValueError):
            validate_plan(invalid)
    for size in (True, 3, 12):
        with pytest.raises(ValueError):
            derive_local_plan(parent, size)


def test_prepare_review_source_storage_and_receipt_guards(prepared):
    root, packet = prepared
    assert verify_preparation(packet, root) == packet
    assert not (packet / "claims/window.json").exists()
    with pytest.raises(FileNotFoundError):
        verify_local_deployment(packet, read(packet / "engineering-plan.json"), {}, root)
    assert review(packet, root)["paidCallsMade"] == 0
    record = read(packet / "engineering-deployment.json")
    plan = read(packet / "engineering-plan.json")
    assert verify_local_deployment(packet, plan, record, root) == record["prices"]["prices"]
    record["capUsd"] = "2"
    with pytest.raises(ValueError, match="differs"):
        verify_local_deployment(packet, plan, record, root)
    record = read(packet / "engineering-deployment.json")
    record["approvedPlanBoundReceipt"] = None
    with pytest.raises(ValueError, match="receipt"):
        verify_local_deployment(packet, plan, record, root)
    with pytest.raises(ValueError, match="already exists"):
        review(packet, root)
    (root / "python/gamefield_research/design.py").write_text("# changed\n")
    with pytest.raises(ValueError, match="Source changed"):
        verify_preparation(packet, root)


def test_campaign_exclusivity_and_monotonic_claims(prepared):
    root, packet = prepared
    with pytest.raises(ValueError, match="another execution mode"):
        require_route(root, "cloud")
    with pytest.raises(FileExistsError):
        claim_route(root, "cloud", packet, "ignored")
    with pytest.raises(ValueError, match="already has an owner"):
        prepare_local(
            packet.parent / "other",
            packet / "parent-plan.json",
            packet / "engineering-plan.json",
            packet / "prices.json",
            root,
        )
    cloud_plan = read(packet / "parent-plan.json")
    errors, _ = verify_deployment(cloud_plan, deployment_template(cloud_plan, root), root)
    assert any("cloud launch prohibited" in e for e in errors)
    window = claim_local_stage(packet, "engineering", "a")
    assert window["windowDeadlineUnix"] - window["startedAtUnix"] == 43200
    with pytest.raises(FileExistsError):
        claim_local_stage(packet, "engineering", "a")
    claim_local_stage(packet, "final", "b")
    with pytest.raises(FileExistsError):
        claim_local_stage(packet, "final", "c")
    assert authority_path(root).is_file()


async def test_synthetic_validation_cannot_unlock_final_and_repeat_is_refused(prepared):
    root, packet = prepared
    review(packet, root)
    result = await execute_local(packet, "engineering", root, transport=mock_response)
    assert result["execution"] == "synthetic"
    with pytest.raises(ValueError, match="synthetic evidence"):
        hosted_report(packet, root)
    with pytest.raises(ValueError, match="synthetic evidence"):
        finalise_local(packet, root)
    with pytest.raises(FileExistsError):
        await execute_local(packet, "engineering", root, transport=mock_response)


async def test_mocked_http_engineering_and_final_export(prepared, monkeypatch):
    root, packet = prepared
    review(packet, root)
    original = httpx.AsyncClient
    calls = []

    async def handle(request):
        body = json.loads(request.content)
        calls.append(body["model"])
        return httpx.Response(200, json=await mock_response(body))

    def client(**kwargs):
        kwargs["transport"] = httpx.MockTransport(handle)
        return original(**kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    monkeypatch.setenv("NEBIUS_API_KEY", "test-only-no-real-network")
    result = await execute_local(packet, "engineering", root)
    assert result["engineeringPassed"]
    report = hosted_report(packet, root)
    assert report["requestTelemetry"] and len(calls) > 142
    original_window = read(packet / "claims/window.json")
    changed_window = {
        **original_window,
        "inferenceDeadlineUnix": original_window["inferenceDeadlineUnix"] + 3600,
    }
    (packet / "claims/window.json").write_text(json.dumps(changed_window))
    with pytest.raises(ValueError, match="clock changed"):
        hosted_report(packet, root)
    (packet / "claims/window.json").write_text(json.dumps(original_window))
    assert finalise_local(packet, root, blocks=4)["selectedBlocks"] == 4
    with pytest.raises(FileExistsError):
        finalise_local(packet, root, blocks=8)
    outcome = await execute_local(packet, "final", root)
    assert outcome["completed"] == outcome["scheduled"] == 296
    exported = verify_export(packet / "evidence/final-export")
    assert exported["planAmendment"]["selectedBlocks"] == [0, 1, 2, 3]
    assert all(c["approximateInterval95"] is None for c in exported["primaryContrasts"])
    provenance = read(packet / "evidence/final-export/provenance.json")
    assert provenance["deployment"]["mode"] == "local"
    assert provenance["executionContext"]["stageClaim"]["purpose"] == "final"
    with pytest.raises(FileExistsError):
        await execute_local(packet, "final", root)


def test_timing_has_four_episode_slots_and_phase_specific_telemetry():
    plan = make_plan("timing", 4)
    durations = {(p["model"], phase): 20 for p in plan["arms"] for phase in ("draft", "action")}
    seconds = episode_slot_seconds(plan, durations)
    telemetry = [
        {"model": model, "phase": phase, "seconds": value, "promptTokens": 700}
        for (model, phase), value in durations.items()
        for _ in range(2)
    ]
    report = measured_forecast(plan, {"requestTelemetry": telemetry})
    assert report["criticalPathSeconds"] == seconds
    assert report["with25PercentMarginSeconds"] == seconds * 1.25
    assert report["forecastOriginalInputTokens"] == 2000
    with pytest.raises(ValueError, match="Insufficient timing"):
        measured_forecast(plan, {"requestTelemetry": []})


async def test_sleep_or_expired_wall_clock_prevents_any_transmission(tmp_path):
    ledger = Ledger(tmp_path / "events.jsonl", "1")
    gateway = Gateway(
        ledger, PRICES, time.monotonic() + 100, mock_response, wall_deadline=time.time() - 1
    )
    with pytest.raises(GlobalStop, match="deadline"):
        gateway.check()
    assert not ledger.sent
    ledger.close()


def test_invalid_accounting_does_not_create_review(prepared):
    root, packet = prepared
    with pytest.raises(ValueError):
        review_local(
            packet,
            {
                "pricesConfirmed": True,
                "priceReference": "fixture",
                "priorValidationUsd": "0",
                "priorFinalUsd": "0",
                "otherChargesReserveUsd": "8.01",
            },
            root,
        )
    assert not (packet / "accounting.json").exists()


def test_stage_budget_subtracts_prior_exposure(prepared):
    root, packet = prepared
    review_local(
        packet,
        {
            "pricesConfirmed": True,
            "priceReference": "test fixture",
            "priorValidationUsd": "0.1",
            "priorFinalUsd": "0.2",
            "otherChargesReserveUsd": "8",
        },
        root,
    )
    record = read(packet / "engineering-deployment.json")
    assert record["capUsd"] == "0.9"
    verify_local_deployment(packet, read(packet / "engineering-plan.json"), record, root)


def test_expired_shared_clock_refuses_claim(prepared):
    root, packet = prepared
    window = claim_local_stage(packet, "engineering", "a")
    window["inferenceDeadlineUnix"] = time.time() - 1
    (packet / "claims/window.json").write_text(json.dumps(window))
    with pytest.raises(ValueError, match="expired"):
        claim_local_stage(packet, "final", "b")
    assert not (packet / "claims/final.json").exists()


def test_supervisor_stops_after_failure_and_kills_timed_out_group(monkeypatch, tmp_path):
    from gamefield_research import local_supervisor as supervisor

    commands = []

    class FailedProcess:
        pid = 12345
        returncode = 2

        def poll(self):
            return self.returncode

    def failed(command, **kwargs):
        commands.append(command)
        assert kwargs["start_new_session"] is True
        return FailedProcess()

    monkeypatch.setattr(supervisor.subprocess, "Popen", failed)
    with pytest.raises(ValueError, match="no retry"):
        supervisor.supervised_pipeline(tmp_path)
    assert len(commands) == 1

    class HangingProcess(FailedProcess):
        returncode = None

        def wait(self, timeout=None):
            self.returncode = 130

    signals = []
    monkeypatch.setattr(supervisor.subprocess, "Popen", lambda *a, **k: HangingProcess())
    monkeypatch.setattr(supervisor.os, "killpg", lambda pid, sig: signals.append((pid, sig)))
    wall = iter([0, 43200, 43200])
    monotonic = iter([0, 43200, 43200])
    monkeypatch.setattr(supervisor.time, "time", lambda: next(wall))
    monkeypatch.setattr(supervisor.time, "monotonic", lambda: next(monotonic))
    with pytest.raises(TimeoutError, match="12-hour"):
        supervisor.supervised_pipeline(tmp_path)
    assert signals == [(12345, supervisor.signal.SIGINT)]
