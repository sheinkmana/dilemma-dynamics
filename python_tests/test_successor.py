import json
import shutil
import time
from pathlib import Path

import httpx
import pytest
from gamefield_research.artifacts import (
    export_run,
    freeze_source,
    hash_file,
    source_index,
    verify_export,
)
from gamefield_research.campaign import claim_local_stage
from gamefield_research.design import digest, write_json
from gamefield_research.gateway import Ledger, read_events
from gamefield_research.local import execute_local, prepare_local, read, review_local
from gamefield_research.recovery_runner import execute_recoverable, rebuild_engineering
from gamefield_research.successor import (
    claim_stage,
    execute_successor,
    finalise_successor,
    prepare_successor,
    stage_lock,
    successor_authority,
    verify_successor,
)
from test_gateway import mock_response


@pytest.fixture
async def successor(tmp_path, monkeypatch, request):
    from gamefield_research.design import make_plan

    root = tmp_path / "checkout"
    root.mkdir()
    for name in ("python", "deploy", "fixtures"):
        shutil.copytree(Path.cwd() / name, root / name)
    for name in ("pyproject.toml", "uv.lock"):
        shutil.copyfile(Path.cwd() / name, root / name)
    write_json(tmp_path / "parent.json", make_plan("successor-parent", 24))
    engineering_seed = getattr(request, "param", "successor-engineering")
    write_json(tmp_path / "engineering.json", make_plan(engineering_seed, 4, "engineering"))
    old = tmp_path / "old"
    prepare_local(
        old,
        tmp_path / "parent.json",
        tmp_path / "engineering.json",
        root / "fixtures/prices-2026-10-20.json",
        root,
    )
    review_local(
        old,
        {
            "pricesConfirmed": True,
            "priceReference": "mock fixture, never public price evidence",
            "priorValidationUsd": "0",
            "priorFinalUsd": "0",
            "otherChargesReserveUsd": "8",
        },
        root,
    )
    original = httpx.AsyncClient

    async def handle(request):
        return httpx.Response(200, json=await mock_response(json.loads(request.content)))

    def client(**kwargs):
        kwargs["transport"] = httpx.MockTransport(handle)
        return original(**kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    monkeypatch.setenv("NEBIUS_API_KEY", "test-only-never-real-network")
    await execute_local(old, "engineering", root)
    plan = read(old / "candidate-8.json")
    claim_local_stage(old, "final", plan["sha256"])
    final = old / "evidence/final"
    final.mkdir()
    write_json(final / "plan.json", plan)
    provenance = freeze_source(root, final)
    ledger = Ledger(final / "events.jsonl", "18")
    ledger.event(
        "run-started",
        execution="tokenfactory",
        planSha256=plan["sha256"],
        sourceSha256=provenance["sourceSha256"],
        prices=read(old / "prices.json")["prices"],
    )
    ledger.reserve_joint([("unresolved", ".0002544")])
    ledger.before_send("unresolved", {"model": "test"})
    ledger.event("run-ended", halted="fixture 502", spentUsd="0", reservedUsd=".0002544")
    ledger.close()
    export_run(final, old / "evidence/final-export")
    before = {str(p): hash_file(p) for p in old.rglob("*") if p.is_file()}
    packet = tmp_path / "successor"
    prepare_successor(packet, old, root)
    yield root, old, packet, before
    assert all(hash_file(Path(p)) == sha for p, sha in before.items())


async def test_reconciliation_receipts_and_exclusive_successor(successor):
    root, old, packet, _ = successor
    record = verify_successor(packet, root)
    assert record["capUsd"]["final"] == "17.9997456"
    assert read(packet / "plan.json") == read(old / "parent-plan.json")
    assert record["scientificAmendment"]["poolPredecessorObservations"] is False
    assert not (packet / "claims/window.json").exists()
    with pytest.raises(ValueError, match="already claimed"):
        prepare_successor(packet.parent / "another", old, root)
    assert successor_authority(root).exists()
    record = read(packet / "engineering-deployment.json")
    record["capUsd"] = "1"
    (packet / "engineering-deployment.json").write_text(json.dumps(record))
    with pytest.raises(ValueError, match="receipt"):
        await execute_successor(packet, "engineering", root, transport=mock_response)
    assert not (packet / "claims/window.json").exists()


async def test_full_mocked_pipeline_1776_episodes_and_export(successor):
    root, _, packet, _ = successor
    technical = await execute_successor(packet, "engineering", root)
    assert technical["passed"] and technical["bankCompleted"] == 142
    engineering_head = hash_file(packet / "evidence/engineering/events.jsonl")
    assert await execute_successor(packet, "engineering", root, resume=True) == technical
    assert hash_file(packet / "evidence/engineering/events.jsonl") == engineering_head
    assert technical == rebuild_engineering(
        packet / "evidence/engineering", read(root / "fixtures/engineering-bank.json")
    )
    assert finalise_successor(packet, root)["blocks"] == 24
    outcome = await execute_successor(packet, "final", root)
    assert outcome["completed"] == outcome["scheduled"] == 1776
    report = verify_export(Path(outcome["export"]))
    assert report["scientificObservations"] == 1776  # HTTP is explicitly mocked in this test.
    assert report["evaluationAmendment"]["poolPredecessorObservations"] is False
    assert all(c["eligibleBlocksByStratum"] == [6, 6, 6, 6] for c in report["primaryContrasts"])
    assert all(c["approximateInterval95"] is not None for c in report["primaryContrasts"])
    with pytest.raises(FileExistsError):
        await execute_successor(packet, "final", root)
    # Explicit resume of a complete checkpoint makes zero additional transmissions.
    path = packet / "evidence/final/events.jsonl"
    sends = sum(e["event"] == "request-sent" for e in read_events(path))
    await execute_successor(packet, "final", root, resume=True)
    assert sum(e["event"] == "request-sent" for e in read_events(path)) == sends


async def test_synthetic_check_cannot_unlock_paid_final(successor):
    root, _, packet, _ = successor
    result = await execute_successor(packet, "engineering", root, transport=mock_response)
    assert result["passed"] and result["scientificObservations"] == 0
    with pytest.raises(ValueError, match="synthetic"):
        finalise_successor(packet, root)


async def test_original_clocks_and_stage_lock_cannot_be_reset(successor):
    root, _, packet, _ = successor
    with stage_lock(packet):
        with pytest.raises(BlockingIOError):
            with stage_lock(packet):
                pass
    clock = claim_stage(packet, "engineering", False)
    assert claim_stage(packet, "engineering", True) == clock
    with pytest.raises(FileExistsError):
        claim_stage(packet, "engineering", False)
    clock["deadlineUnix"] = time.time() - 1
    (packet / "claims/engineering.json").write_text(json.dumps(clock))
    with pytest.raises(ValueError, match="expired"):
        claim_stage(packet, "engineering", True)


async def test_source_and_predecessor_tampering_block_execution(successor):
    root, _, packet, _ = successor
    path = root / "python/gamefield_research/recovery.py"
    path.write_text(path.read_text() + "\n# changed\n")
    with pytest.raises(ValueError, match="source changed"):
        verify_successor(packet, root)


async def test_stage_checkpoint_resume_is_identical_to_uninterrupted(tmp_path):
    from gamefield_research.design import make_plan

    root = Path.cwd()
    plan = make_plan("resumable-complete", 4)
    directory = tmp_path / "stage"
    prices = read(root / "fixtures/prices-2026-10-20.json")["prices"]
    record = {
        "sourceFiles": source_index(root),
        "sourceSha256": digest(source_index(root)),
    }
    calls = 0

    async def interrupted(body):
        nonlocal calls
        calls += 1
        if calls >= 20:
            raise ValueError("Simulated coordinator crash")
        return await mock_response(body)

    deadline = time.time() + 600
    with pytest.raises(ValueError, match="crash"):
        await execute_recoverable(
            plan, directory, prices, root, record, deadline, "18", "final", interrupted
        )
    # Resume cannot change execution mode, cap or deadline, even with intact evidence.
    with pytest.raises(ValueError, match="identity"):
        await execute_recoverable(
            plan,
            directory,
            prices,
            root,
            record,
            deadline + 1,
            "18",
            "final",
            mock_response,
            resume=True,
        )
    from gamefield_research.analysis import analyse_file
    from gamefield_research.gateway import read_events

    before = [r for r in read_events(directory / "events.jsonl") if r["event"] == "request-sent"]
    outcome = await execute_recoverable(
        plan, directory, prices, root, record, deadline, "18", "final", mock_response, resume=True
    )
    assert outcome["completed"] == 296
    report, rows = analyse_file(plan, directory / "events.jsonl")
    assert report["scientificObservations"] == 0 and report["reservedUsd"] != "0"
    ledger = read_events(directory / "events.jsonl")
    sent = [e["key"] for e in ledger if e["event"] == "request-sent"]
    assert len(sent) == len(set(sent)) and set(r["key"] for r in before) <= set(sent)
    assert all(len(r["history"]) == r["rounds"] for r in rows)


def test_supervisor_reuses_claims_and_always_exports(tmp_path, monkeypatch):
    from gamefield_research import successor_supervisor as supervisor

    (tmp_path / "claims").mkdir()
    for name in ("engineering-report.json", "final-deployment.json", "claims/final.json"):
        write_json(tmp_path / name, {})
    window = {"deadlineUnix": time.time() + 60}
    write_json(tmp_path / "claims/window.json", window)
    commands = []

    class Finished:
        pid = 1
        returncode = 0

        def poll(self):
            return 0

    def process(command, **kwargs):
        commands.append(command)
        assert kwargs["start_new_session"]
        return Finished()

    monkeypatch.setattr(supervisor.subprocess, "Popen", process)
    assert supervisor.launch(tmp_path)["originalClockPreserved"]
    assert any("--resume" in c and "final" in c for c in commands)
    assert commands[-1][3] == "export-successor"
    assert read(tmp_path / "claims/window.json") == window
    commands.clear()
    monkeypatch.setattr(supervisor.time, "time", lambda: window["deadlineUnix"] + 1)
    with pytest.raises(ValueError, match="expired"):
        supervisor.launch(tmp_path)
    assert not commands
