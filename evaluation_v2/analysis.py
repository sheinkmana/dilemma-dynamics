"""Offline block inference and action/request diagnostics; no new model calls."""

import csv
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path
from statistics import mean

import numpy as np
from gamefield_research.analysis import episode_rows
from gamefield_research.artifacts import hash_file
from gamefield_research.core import episode_oracle, reward, transition, weight
from gamefield_research.design import ARMS, digest, write_json
from gamefield_research.gateway import read_events

from .design import read


def interval(values, seed, coverage, draws=50000):
    strata = [[v for b, v in values.items() if b % 4 == s] for s in range(4)]
    estimate = mean(mean(s) for s in strata) if all(strata) else None
    if any(len(s) < 5 for s in strata):
        return {"estimate": estimate, "interval": None, "blocksPerStratum": list(map(len, strata))}
    rng = np.random.Generator(np.random.PCG64(int(digest(seed)[:16], 16)))
    samples = (
        sum(np.asarray(s)[rng.integers(len(s), size=(draws, len(s)))].mean(axis=1) for s in strata)
        / 4
    )
    tail = (1 - coverage) / 2
    return {
        "estimate": estimate,
        "interval": np.quantile(samples, [tail, 1 - tail]).tolist(),
        "coverage": coverage,
        "blocksPerStratum": list(map(len, strata)),
        "interpretation": "Approximate stratified whole-block bootstrap; coverage is not guaranteed",
    }


def csv_write(path, rows):
    rows = list(rows)
    if not rows:
        return
    fields = list(dict.fromkeys(k for row in rows for k in row))
    with Path(path).open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def request_rows(events):
    attempts, requests, timing, settled = {}, {}, {}, {}
    for row in events:
        if row["event"] == "joint-reservation":
            attempts.update(row["attempts"])
        elif row["event"] == "request-sent":
            requests[row["key"]] = row["request"]
        elif row["event"] == "request-timing":
            timing[row["key"]] = row["seconds"]
        elif row["event"] == "settled":
            settled[row["key"]] = row["costUsd"]
    response_by_key = {r["key"]: r["response"] for r in events if r["event"] == "response-received"}
    rows = []
    for key, body in requests.items():
        response = response_by_key.get(key, {})
        usage = response.get("usage") or {}
        usage = usage if isinstance(usage, dict) else {}
        choice = (response.get("choices") or [{}])[0]
        choice = choice if isinstance(choice, dict) else {}
        phase = "draft" if body["chat_template_kwargs"]["enable_thinking"] else "action"
        logical = attempts[key]["logicalKey"]
        rows.append(
            {
                "requestId": key,
                "episodeId": logical.split("/")[0],
                "temperature": body["temperature"],
                "model": body["model"],
                "phase": phase,
                "attempt": attempts[key]["number"],
                "logicalId": logical,
                "promptTokens": usage.get("prompt_tokens"),
                "completionTokens": usage.get("completion_tokens"),
                "reasoningTokens": (usage.get("completion_tokens_details") or {}).get(
                    "reasoning_tokens"
                ),
                "finishReason": choice.get("finish_reason"),
                "draftCapped": phase == "draft" and choice.get("finish_reason") == "length",
                "seconds": timing.get(key),
                "estimatedUsd": settled.get(key),
                "requestedModel": body["model"],
                "reportedModel": response.get("model"),
                "systemFingerprint": response.get("system_fingerprint"),
                "responseId": response.get("id"),
                "providerCreated": response.get("created"),
            }
        )
    return rows


def decision_rows(rows, requests):
    by_logical = defaultdict(list)
    for request in requests:
        by_logical[request["logicalId"]].append(request)
    result = []
    for e in rows:
        state = 0
        for r, pair in enumerate(e["history"]):
            for seat, arm in enumerate(e["players"]):
                if arm not in {a["id"] for a in ARMS}:
                    continue
                key = f"{e['id']}/{r + 1}/{seat}"
                drafts = by_logical[key + "/draft"]
                calls = drafts + by_logical[key + "/action"]
                gap = (
                    float(episode_oracle(e, r).gap(state, pair[seat]))
                    if e["track"] == "A"
                    else None
                )
                result.append(
                    {
                        "episodeId": e["id"],
                        "matchedId": e["matchedId"],
                        "temperature": e["temperature"],
                        "block": e["block"],
                        "stratum": e["stratum"],
                        "track": e["track"],
                        "cell": e["cell"],
                        "round": r + 1,
                        "seat": seat,
                        "arm": arm,
                        "action": pair[seat],
                        "opponentAction": pair[1 - seat],
                        "payoff": reward(pair[seat], pair[1 - seat]),
                        "state": state if e["track"] == "A" else None,
                        "oracleGap": gap,
                        "normalisedGap": gap * float(weight(e)) if gap is not None else None,
                        "draftCapped": any(d["draftCapped"] for d in drafts),
                        "estimatedUsd": str(
                            sum(
                                (
                                    Decimal(c["estimatedUsd"])
                                    for c in calls
                                    if c["estimatedUsd"] is not None
                                ),
                                Decimal(0),
                            )
                        ),
                        "requestSecondsSum": sum(c["seconds"] or 0 for c in calls),
                    }
                )
            if e["track"] == "A":
                state = transition(e["policy"], state, pair[e["subjectSeat"]])
    return result


def summarise(directory):
    directory = Path(directory)
    spec = read(directory / "spec.json")
    selection = read(directory / "selection.json")
    episodes = read(directory / f"schedule-{selection['selectedBlocks']}.json")
    events = read_events(directory / "final/events.jsonl")
    rows = episode_rows({"episodes": episodes}, events)
    complete = [r for r in rows if r["status"] == "completed"]
    block_means = {}
    for t in (0, 1):
        for arm in ARMS:
            for b in range(selection["selectedBlocks"]):
                group = [
                    r
                    for r in rows
                    if r["temperature"] == t
                    and r["block"] == b
                    and r["track"] == "A"
                    and r["players"][r["subjectSeat"]] == arm["id"]
                ]
                if len(group) == 16 and all(r["status"] == "completed" for r in group):
                    block_means[(t, arm["id"], b)] = mean(r["normalisedOracleLoss"] for r in group)
    contrasts = []
    for t in (0, 1):
        for model in ("nano", "super"):
            values = {
                b: block_means[(t, model + "-draft", b)] - block_means[(t, model + "-direct", b)]
                for b in range(selection["selectedBlocks"])
                if all((t, model + "-" + p, b) in block_means for p in ("direct", "draft"))
            }
            contrasts.append(
                {
                    "family": "primary",
                    "model": model,
                    "temperature": t,
                    "contrast": "draft-minus-direct",
                    "direction": "negative favours draft",
                    **interval(values, [spec["sha256"], model, t, "primary"], 0.9875),
                }
            )
    for arm in ARMS:
        values = {
            b: block_means[(0, arm["id"], b)] - block_means[(1, arm["id"], b)]
            for b in range(selection["selectedBlocks"])
            if all((t, arm["id"], b) in block_means for t in (0, 1))
        }
        contrasts.append(
            {
                "family": "secondary",
                "arm": arm["id"],
                "contrast": "temperature-0-minus-1",
                **interval(values, [spec["sha256"], arm["id"], "temperature"], 0.95),
            }
        )
    for model in ("nano", "super"):
        values = {
            b: (
                (block_means[(0, model + "-draft", b)] - block_means[(0, model + "-direct", b)])
                - (block_means[(1, model + "-draft", b)] - block_means[(1, model + "-direct", b)])
            )
            for b in range(selection["selectedBlocks"])
            if all(
                (t, model + "-" + p, b) in block_means for t in (0, 1) for p in ("direct", "draft")
            )
        }
        contrasts.append(
            {
                "family": "secondary",
                "model": model,
                "contrast": "drafting-temperature-interaction",
                **interval(values, [spec["sha256"], model, "interaction"], 0.95),
            }
        )
    conditions = []
    for t in (0, 1):
        for cell in sorted({r["cell"] for r in rows if r["track"] == "A"}):
            group = [r for r in complete if r["temperature"] == t and r["cell"] == cell]
            conditions.append(
                {
                    "temperature": t,
                    "cell": cell,
                    "completed": len(group),
                    "meanLoss": mean(r["normalisedOracleLoss"] for r in group) if group else None,
                }
            )
    crossplay = []
    for t in (0, 1):
        for cell in sorted({r["cell"] for r in rows if r["track"] == "B"}):
            group = [r for r in complete if r["temperature"] == t and r["cell"] == cell]
            counts = Counter("".join(p) for r in group for p in r["history"])
            rounds = sum(counts.values())
            crossplay.append(
                {
                    "temperature": t,
                    "cell": cell,
                    "completed": len(group),
                    "rounds": rounds,
                    **{p: counts[p] for p in ("CC", "CD", "DC", "DD")},
                    "roundWeightedCC": counts["CC"] / rounds if rounds else None,
                    "episodeWeightedCC": mean(
                        r["mutualCooperation"]["count"] / len(r["history"]) for r in group
                    )
                    if group
                    else None,
                    "firstCC": sum(r["firstCC"] for r in group),
                    "meanNormalisedJointReturn": mean(r["normalisedJointReturn"] for r in group)
                    if group
                    else None,
                    **{
                        m + "Count": sum(r[m]["count"] for r in group)
                        for m in ("breakdown", "recovery")
                    },
                    **{
                        m + "Opportunities": sum(r[m]["opportunities"] for r in group)
                        for m in ("breakdown", "recovery")
                    },
                }
            )
    requests = request_rows(events)
    decisions = decision_rows(rows, requests)
    bounds = []
    for t in (0, 1):
        for model in ("nano", "super"):
            groups = {
                p: [
                    r
                    for r in rows
                    if r["temperature"] == t
                    and r["track"] == "A"
                    and r["cell"].endswith("/" + model + "-" + p)
                ]
                for p in ("direct", "draft")
            }
            bounds.append(
                {
                    "temperature": t,
                    "model": model,
                    "lower": mean(r["lossBounds"][0] for r in groups["draft"])
                    - mean(r["lossBounds"][1] for r in groups["direct"]),
                    "upper": mean(r["lossBounds"][1] for r in groups["draft"])
                    - mean(r["lossBounds"][0] for r in groups["direct"]),
                    "interpretation": "Feasible scheduled-outcome bounds, not confidence intervals",
                }
            )
    complete_run = (
        len(complete) == len(rows)
        and events[-1]["event"] == "run-ended"
        and events[-1]["halted"] is None
    )
    result = {
        "version": spec["version"],
        "specSha256": spec["sha256"],
        "sourceSha256": read(directory / "preparation.json")["sourceSha256"],
        "execution": events[0]["execution"],
        "evidenceHead": events[-1]["sha256"],
        "selectedBlocksPerTemperature": selection["selectedBlocks"],
        "scheduled": len(rows),
        "completed": len(complete),
        "statusCounts": dict(Counter(r["status"] for r in rows)),
        "complete": complete_run,
        "reservedUsd": events[-1].get("reservedUsd"),
        "spentUsd": events[-1].get("spentUsd"),
        "requestCount": len(requests),
        "contrasts": contrasts,
        "scheduledOutcomeBounds": bounds,
        "cooperation": crossplay,
        "limitations": [
            "Prior results informed this prospective replication; they are not pooled.",
            "Hosted weights and sampling are not byte-reproducible; saved scoring is.",
            "Draft changes compute, request count, thinking settings and conditioning together.",
            "Primary 98.75% marginal intervals use approximate Bonferroni family control for four contrasts; no guaranteed coverage or power.",
            "Secondary intervals are nominal 95%; opponent, trace, truncation, cost and timing diagnostics are exploratory.",
            "Temperature pairing and interleaving reduce time confounding but do not pin backend versions.",
            "No general model ranking, equilibrium, latent-belief inference or real-world benefit is established.",
        ],
    }
    return result, rows, requests, decisions, conditions


def export(directory):
    """Write a new derived export; never changes a plan, ledger or public dataset."""
    directory = Path(directory)
    report, rows, requests, decisions, conditions = summarise(directory)
    output = directory / ("export-" + report["evidenceHead"][:12])
    if output.exists():
        verify_export(directory, output)
        return {
            "export": str(output),
            "complete": report["complete"],
            "completed": report["completed"],
        }
    output.mkdir()
    write_json(output / "summary.json", report)
    # Only revealed actions and numerical telemetry go into this release candidate.
    write_json(output / "episodes.json", rows)
    write_json(output / "spec.json", read(directory / "spec.json"))
    csv_write(output / "requests.csv", requests)
    csv_write(output / "decisions.csv", decisions)
    csv_write(output / "conditions.csv", conditions)
    csv_write(output / "crossplay.csv", report["cooperation"])
    csv_write(
        output / "contrasts.csv",
        [{**c, "interval": json.dumps(c["interval"])} for c in report["contrasts"]],
    )
    write_json(
        output / "manifest.json",
        {p.name: hash_file(p) for p in sorted(output.iterdir()) if p.is_file()},
    )
    verify_export(directory, output)
    return {"export": str(output), "complete": report["complete"], "completed": report["completed"]}


def verify_export(directory, output):
    directory, output = Path(directory), Path(output)
    manifest = read(output / "manifest.json")
    if {p.name for p in output.iterdir() if p.is_file()} != set(manifest) | {"manifest.json"}:
        raise ValueError("Unexpected or missing derived file")
    for name, sha in manifest.items():
        if Path(name).name != name or hash_file(output / name) != sha:
            raise ValueError("Derived file checksum mismatch")
    report, rows, requests, decisions, conditions = summarise(directory)
    if read(output / "summary.json") != report or read(output / "episodes.json") != rows:
        raise ValueError("Scores do not reproduce from canonical evidence")
    # CSVs are fully regenerated for comparison, including every derived diagnostic.
    import io

    def csv_bytes(values):
        stream = io.StringIO(newline="")
        fields = list(dict.fromkeys(k for row in values for k in row))
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(values)
        return stream.getvalue().encode()

    tables = {
        "requests.csv": requests,
        "decisions.csv": decisions,
        "conditions.csv": conditions,
        "crossplay.csv": report["cooperation"],
        "contrasts.csv": [
            {**c, "interval": json.dumps(c["interval"])} for c in report["contrasts"]
        ],
    }
    for name, values in tables.items():
        if values and (output / name).read_bytes() != csv_bytes(values):
            raise ValueError("Derived CSV does not reproduce: " + name)
    if read(output / "spec.json") != read(directory / "spec.json"):
        raise ValueError("Exported specification differs")
    return report
