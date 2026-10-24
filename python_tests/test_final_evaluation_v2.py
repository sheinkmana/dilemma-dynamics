"""Network-free checks for prospective scheduling, native logs, replay and gates."""

import json
import time
from collections import Counter

import pytest
from gamefield_research.design import ARMS, write_json
from gamefield_research.gateway import GlobalStop, read_events
from inspect_ai.log import read_eval_log
from test_gateway import mock_response

from evaluation_v2.analysis import export, interval, request_rows, summarise, verify_export
from evaluation_v2.design import engineering_samples, joint_episodes, make_spec, prepare, verify
from evaluation_v2.runner import engineering_report, evaluate_stage, exclusive_json, stage_completed


def test_paired_nested_schedules_and_presentations():
    small = joint_episodes("prospective-test", 24)
    large = joint_episodes("prospective-test", 48)
    assert len(small) == 3552 and len(large) == 7104
    assert small == [e for e in large if e["block"] < 24]
    assert len({e["id"] for e in large}) == len(large)
    assert Counter(e["stratum"] for e in large) == {s: 1776 for s in range(4)}
    pair_orders = Counter()
    for a, b in zip(large[::2], large[1::2], strict=True):
        assert {a["temperature"], b["temperature"]} == {0, 1}
        assert a["matchedId"] == b["matchedId"]
        assert {k: v for k, v in a.items() if k not in ("id", "temperature")} == {
            k: v for k, v in b.items() if k not in ("id", "temperature")
        }
        pair_orders[a["temperature"]] += 1
    assert all(pair_orders[t] > 0 for t in (0, 1))


def test_preparation_refuses_reroll_and_tampering(tmp_path):
    directory = tmp_path / "prepared"
    result = prepare(directory, "one-frozen-seed")
    assert result["verificationProviderCalls"] == 0
    assert not (directory / "clock.json").exists()
    assert verify(directory)["verified"]
    with pytest.raises(FileExistsError):
        prepare(directory, "another-seed")
    spec = json.loads((directory / "spec.json").read_text())
    spec["additionalBudgetUsd"] = "400"
    (directory / "spec.json").write_text(json.dumps(spec))
    with pytest.raises(ValueError, match="bytes changed"):
        verify(directory)


def test_engineering_is_disjoint_and_covers_both_temperatures():
    samples = engineering_samples("separate-engineering")
    assert Counter((s["temperature"], s["kind"]) for s in samples) == {
        (0, "bank"): 142,
        (1, "bank"): 142,
        (0, "episode"): 26,
        (1, "episode"): 26,
    }
    final_ids = {e["id"] for e in joint_episodes("separate-engineering", 24)}
    assert not final_ids & {s["id"] for s in samples}


async def test_native_inspect_and_checkpoint_replay_at_both_temperatures(tmp_path):
    spec = make_spec("native-test")
    write_json(tmp_path / "spec.json", spec)
    write_json(tmp_path / "preparation.json", {"sourceSha256": "synthetic"})
    prices = {
        "prices": [
            {"model": a["model"], "inputRate": ".06", "outputRate": ".24"} for a in ARMS[::2]
        ]
    }
    write_json(tmp_path / "prices.json", prices)
    exclusive_json(tmp_path / "clock.json", {"deadlineUnix": time.time() + 3600})
    samples = []
    # Exercise every arm and both temperatures, including interactive dyads.
    episodes = joint_episodes("native-test", 4)
    for temperature in (0, 1):
        for arm in ARMS:
            e = next(
                e
                for e in episodes
                if e["temperature"] == temperature
                and e["track"] == "A"
                and e["players"][e["subjectSeat"]] == arm["id"]
                and e["rounds"] == 1
            )
            samples.append(
                {"id": e["id"], "temperature": temperature, "kind": "episode", "episode": e}
            )
        e = next(
            e
            for e in episodes
            if e["temperature"] == temperature and e["track"] == "B" and e["rounds"] <= 4
        )
        samples.append({"id": e["id"], "temperature": temperature, "kind": "episode", "episode": e})
    calls = []

    async def transport(body):
        calls.append(body)
        return await mock_response(body)

    await evaluate_stage(tmp_path, "final", samples, transport=transport)
    assert {b["temperature"] for b in calls} == {0, 1}
    assert all(b["top_p"] == 1 for b in calls)
    assert all(
        b["max_tokens"] == (1024 if b["chat_template_kwargs"]["enable_thinking"] else 128)
        for b in calls
    )
    count = len(calls)
    await evaluate_stage(tmp_path, "final", samples, transport=transport)
    assert len(calls) == count
    events = read_events(tmp_path / "final/events.jsonl")
    assert len([e for e in events if e["event"] == "episode-ended"]) == len(samples)
    assert float(events[-1]["reservedUsd"]) == 0
    logs = list((tmp_path / "final/inspect").glob("*.eval"))
    assert len(logs) == 2
    first = read_eval_log(logs[0])
    assert first.status == "success"
    assert len(first.samples) == len(samples)
    assert all(s.scores for s in first.samples)
    # Same-second file names contain random IDs; filesystem order is not session order.
    all_logs = [read_eval_log(path) for path in logs]
    assert any(e.event == "model" for log in all_logs for s in log.samples for e in s.events)
    assert any(e.event == "info" for log in all_logs for s in log.samples for e in s.events)
    assert any(
        e.event == "info" and e.source == "joint-reveal"
        for log in all_logs
        for s in log.samples
        for e in s.events
    )
    assert request_rows(events)
    # No synthetic evidence may be relabelled as paid provider execution.
    with pytest.raises(ValueError, match="identity"):
        await evaluate_stage(tmp_path, "final", samples)


def test_stratified_intervals_and_replication_floor():
    complete = {b: float(b % 4) for b in range(24)}
    result = interval(complete, "fixed", 0.9875, draws=1000)
    assert result["estimate"] == 1.5 and result["interval"] == [1.5, 1.5]
    assert interval(complete, "fixed", 0.9875, draws=1000) == result
    assert interval({b: 1.0 for b in range(16)}, "few", 0.9875)["interval"] is None


async def test_full_mocked_campaign_exports_and_local_mlflow(tmp_path):
    """All cells and temperatures, real native logs, real SQLite, no network."""
    from evaluation_v2.tracking import track

    spec = make_spec("full-offline-integration")
    write_json(tmp_path / "spec.json", spec)
    write_json(tmp_path / "preparation.json", {"sourceSha256": "synthetic"})
    write_json(tmp_path / "source-index.json", {})
    write_json(tmp_path / "runtime.json", {})
    prices = {
        "prices": [
            {"model": a["model"], "inputRate": ".06", "outputRate": ".24"} for a in ARMS[::2]
        ]
    }
    write_json(tmp_path / "prices.json", prices)
    exclusive_json(tmp_path / "clock.json", {"deadlineUnix": time.time() + 3600})
    episodes = joint_episodes(spec["seed"], 4)
    write_json(tmp_path / "schedule-4.json", episodes)
    write_json(tmp_path / "selection.json", {"selectedBlocks": 4})
    samples = [
        {"id": e["id"], "temperature": e["temperature"], "kind": "episode", "episode": e}
        for e in episodes
    ]
    first = track(tmp_path, "preflight")
    assert first["runId"] == track(tmp_path, "preflight")["runId"]
    await evaluate_stage(tmp_path, "final", samples, transport=mock_response)
    assert stage_completed(tmp_path)
    result = export(tmp_path)
    report = verify_export(tmp_path, result["export"])
    assert report["execution"] == "synthetic"
    assert report["complete"] and report["completed"] == 592
    assert len(report["contrasts"]) == 10
    assert len(report["cooperation"]) == 20
    receipt = track(tmp_path, "final")
    assert track(tmp_path, "final")["runId"] == receipt["runId"]
    assert receipt["evidenceHead"] == report["evidenceHead"]
    output = tmp_path / ("export-" + report["evidenceHead"][:12])
    with (output / "decisions.csv").open("a") as stream:
        stream.write("tampered\n")
    with pytest.raises(ValueError, match="checksum"):
        verify_export(tmp_path, output)
    (tmp_path / "selection.json").write_text(json.dumps({"selectedBlocks": 4, "altered": True}))
    with pytest.raises(ValueError, match="identity"):
        summarise(tmp_path)


async def test_synthetic_engineering_cannot_unlock_final(tmp_path):
    spec = make_spec("engineering-gate")
    write_json(tmp_path / "spec.json", spec)
    write_json(tmp_path / "preparation.json", {"sourceSha256": "synthetic"})
    write_json(
        tmp_path / "prices.json",
        {
            "prices": [
                {"model": a["model"], "inputRate": ".06", "outputRate": ".24"} for a in ARMS[::2]
            ]
        },
    )
    exclusive_json(tmp_path / "clock.json", {"deadlineUnix": time.time() + 3600})
    samples = engineering_samples(spec["seed"])
    write_json(tmp_path / "engineering.json", samples)
    await evaluate_stage(tmp_path, "engineering", samples, transport=mock_response)
    report = engineering_report(tmp_path)
    assert report["bankCompleted"] == 284 and report["interactiveCompleted"] == 52
    assert not report["passed"] and report["execution"] == "synthetic"


async def test_invalid_success_is_not_regenerated_on_resume(tmp_path):
    spec = make_spec("invalid-output")
    write_json(tmp_path / "spec.json", spec)
    write_json(tmp_path / "preparation.json", {"sourceSha256": "synthetic"})
    write_json(
        tmp_path / "prices.json",
        {
            "prices": [
                {"model": a["model"], "inputRate": ".06", "outputRate": ".24"} for a in ARMS[::2]
            ]
        },
    )
    exclusive_json(tmp_path / "clock.json", {"deadlineUnix": time.time() + 3600})
    e = next(
        e
        for e in joint_episodes(spec["seed"], 4)
        if e["temperature"] == 0
        and e["track"] == "A"
        and e["players"][e["subjectSeat"]] == "nano-direct"
        and e["rounds"] == 1
    )
    samples = [{"id": e["id"], "kind": "episode", "temperature": 0, "episode": e}]
    calls = 0

    async def invalid(body):
        nonlocal calls
        calls += 1
        response = await mock_response(body)
        response["choices"][0]["message"]["content"] = '{"action":"invalid"}'
        return response

    with pytest.raises(GlobalStop):
        await evaluate_stage(tmp_path, "final", samples, transport=invalid)
    assert calls == 1
    with pytest.raises(GlobalStop):
        await evaluate_stage(tmp_path, "final", samples, transport=invalid)
    assert calls == 1


def test_technical_schedule_selection_never_uses_outcomes(tmp_path, monkeypatch):
    import evaluation_v2.runner as runner

    seed = "technical-selection"
    write_json(tmp_path / "clock.json", {"deadlineUnix": 1000000.0})
    write_json(tmp_path / "engineering.json", engineering_samples(seed))
    write_json(
        tmp_path / "prices.json",
        {
            "prices": [
                {"model": a["model"], "inputRate": ".06", "outputRate": ".24"} for a in ARMS[::2]
            ]
        },
    )
    for blocks in (24, 32, 48):
        write_json(tmp_path / f"schedule-{blocks}.json", joint_episodes(seed, blocks))
    monkeypatch.setattr(
        runner, "engineering_report", lambda _: {"passed": True, "evidenceHead": "technical-head"}
    )
    monkeypatch.setattr(runner, "read_events", lambda _: [])
    # No action, score, expectedCorrect or draft text is present in this telemetry.
    groups = {
        (t, a["model"], a["procedure"], phase): [
            {
                "key": "technical/request",
                "usage": {"prompt_tokens": 100, "completion_tokens": 10},
                "seconds": 1.0,
            }
        ]
        for t in (0, 1)
        for a in ARMS
        for phase in (("draft", "action") if a["procedure"] == "draft" else ("action",))
    }
    monkeypatch.setattr(runner, "telemetry", lambda _: groups)
    selected = runner.choose_schedule(tmp_path, selection_unix=1000.0)
    assert selected["selectedBlocks"] == 48
    assert selected == runner.choose_schedule(tmp_path, selection_unix=1000.0)
    assert not (tmp_path / "final").exists()
