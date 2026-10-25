"""Reproduce final public scores, uncertainty and telemetry offline, without inference.

Private native/provider evidence was checked at release. Public integrity and
numeric reproducibility do not independently authenticate that private evidence.
"""

import csv
import gzip
import hashlib
import io
import json
import math
import sys
from collections import Counter
from decimal import Decimal
from pathlib import Path
from statistics import mean

import numpy as np
import pyarrow.parquet as pq
from final_results import ARMS, ROOT, check_actions, diagnostics
from gamefield_research.core import metrics
from gamefield_research.design import digest

from evaluation_v2.analysis import decision_rows, interval
from evaluation_v2.design import joint_episodes


def equal(actual, expected):
    if isinstance(expected, float):
        assert math.isclose(actual, expected, abs_tol=1e-10, rel_tol=0), (actual, expected)
    elif isinstance(expected, dict):
        assert actual.keys() == expected.keys()
        for key in expected:
            equal(actual[key], expected[key])
    elif isinstance(expected, list):
        assert len(actual) == len(expected)
        for a, b in zip(actual, expected, strict=True):
            equal(a, b)
    else:
        assert actual == expected, (actual, expected)


def verify(directory):
    if not __debug__:
        raise RuntimeError("Verification requires Python assertions; do not use -O")

    def read(name):
        return json.loads((directory / name).read_text())

    manifest = read("manifest.json")
    files = {p.relative_to(directory).as_posix() for p in directory.rglob("*") if p.is_file()}
    assert files == set(manifest["files"]) | {"manifest.json"}
    for name, sha in manifest["files"].items():
        assert not Path(name).is_absolute() and ".." not in Path(name).parts
        assert hashlib.sha256((directory / name).read_bytes()).hexdigest() == sha, name
    summary, spec = read("summary.json"), read("spec.json")
    assert summary["complete"] and summary["execution"] == "tokenfactory"
    assert summary["completed"] == summary["scheduled"] == 7104
    equal(digest({k: v for k, v in spec.items() if k != "sha256"}), spec["sha256"])
    equal(spec["sha256"], summary["specSha256"])
    provenance = read("provenance.json")
    for filename, key in [
        ("source-index.json", "parentSourceSha256"),
        ("recovery-source-index.json", "amendmentSourceSha256"),
    ]:
        index = read(filename)
        equal(digest(index), provenance[key])
        for name, sha in index.items():
            path = ROOT / name
            if name == "docs/FINAL_EVALUATION_V2.md":
                path = ROOT / "evaluation_v2/frozen/protocol-2026-10-24.snapshot"
            assert hashlib.sha256(path.read_bytes()).hexdigest() == sha, name
    schedule = read("schedule.json")
    equal(joint_episodes(spec["seed"], 48), schedule)
    episodes = read("temperature-zero/episodes.json") + read("temperature-one/episodes.json")
    check_actions(episodes)
    by_id = {e["id"]: e for e in episodes}
    for planned in schedule:
        episode = by_id[planned["id"]]
        for k, value in planned.items():
            equal(episode[k], value)
        calculated = metrics(planned, episode["history"], True)
        equal({k: episode[k] for k in calculated}, calculated)
    ds = read("diagnostics.json")
    for k, value in diagnostics(episodes, spec["sha256"]).items():
        equal(ds[k], value)
    block_means = {}
    for t in (0, 1):
        for arm in ARMS:
            for b in range(48):
                es = [
                    e
                    for e in episodes
                    if e["temperature"] == t
                    and e["block"] == b
                    and e["track"] == "A"
                    and e["players"][e["subjectSeat"]] == arm
                ]
                assert len(es) == 16
                block_means[t, arm, b] = mean(e["normalisedOracleLoss"] for e in es)
    for c in summary["contrasts"]:
        if c["family"] == "primary":
            m, t = c["model"], c["temperature"]
            values = {
                b: block_means[t, m + "-draft", b] - block_means[t, m + "-direct", b]
                for b in range(48)
            }
            result = interval(values, [spec["sha256"], m, t, "primary"], 0.9875)
        elif c["contrast"] == "temperature-0-minus-1":
            arm = c["arm"]
            values = {b: block_means[0, arm, b] - block_means[1, arm, b] for b in range(48)}
            result = interval(values, [spec["sha256"], arm, "temperature"], 0.95)
        else:
            m = c["model"]
            values = {
                b: (block_means[0, m + "-draft", b] - block_means[0, m + "-direct", b])
                - (block_means[1, m + "-draft", b] - block_means[1, m + "-direct", b])
                for b in range(48)
            }
            result = interval(values, [spec["sha256"], m, "interaction"], 0.95)
        equal({k: c[k] for k in result}, result)
    for c in summary["cooperation"]:
        es = [
            e for e in episodes if e["temperature"] == c["temperature"] and e["cell"] == c["cell"]
        ]
        counts = Counter("".join(p) for e in es for p in e["history"])
        equal(len(es), c["completed"])
        for pair in ("CC", "CD", "DC", "DD"):
            equal(counts[pair], c[pair])
        equal(sum(counts.values()), c["rounds"])
        equal(counts["CC"] / c["rounds"], c["roundWeightedCC"])
        equal(
            mean(e["mutualCooperation"]["count"] / e["rounds"] for e in es), c["episodeWeightedCC"]
        )
        equal(mean(e["normalisedJointReturn"] for e in es), c["meanNormalisedJointReturn"])
        equal(sum(e["firstCC"] for e in es), c["firstCC"])
        for key in ("breakdown", "recovery"):
            equal(sum(e[key]["count"] for e in es), c[key + "Count"])
            equal(sum(e[key]["opportunities"] for e in es), c[key + "Opportunities"])

    conditions = [
        {
            "temperature": t,
            "cell": cell,
            "completed": 48,
            "meanLoss": mean(
                e["normalisedOracleLoss"]
                for e in episodes
                if e["temperature"] == t and e["cell"] == cell
            ),
        }
        for t in (0, 1)
        for cell in sorted({e["cell"] for e in episodes if e["track"] == "A"})
    ]
    for name, rows in {
        "arms.csv": summary["arms"],
        "conditions.csv": conditions,
        "crossplay.csv": summary["cooperation"],
        "contrasts.csv": [
            {**c, "interval": json.dumps(c["interval"])} for c in summary["contrasts"]
        ],
    }.items():
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(
            stream, fieldnames=list(dict.fromkeys(k for row in rows for k in row))
        )
        writer.writeheader()
        writer.writerows(rows)
        assert (directory / name).read_bytes() == stream.getvalue().encode(), name
    requests = pq.read_table(directory / "requests.parquet").to_pylist()
    decisions = pq.read_table(directory / "decisions.parquet").to_pylist()
    assert len(requests) == summary["requestCount"] == 62852
    # Restore frozen schedule order before rebuilding exact decision rows.
    ordered = [by_id[e["id"]] for e in schedule]
    equal(decision_rows(ordered, requests), decisions)
    assert len(decisions) == 41888
    for name, rows in [("requests", requests), ("decisions", decisions)]:
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(
            stream, fieldnames=list(dict.fromkeys(k for row in rows for k in row))
        )
        writer.writeheader()
        writer.writerows(rows)
        assert (
            gzip.decompress((directory / f"{name}.csv.gz").read_bytes())
            == stream.getvalue().encode()
        )
    prices = {p["model"]: p for p in read("prices.json")["prices"]}
    costs = Decimal(0)
    logical = Counter()
    for request in requests:
        if request["estimatedUsd"] is None:
            continue
        rate = prices[request["model"]]
        value = (
            Decimal(request["promptTokens"]) * Decimal(rate["inputRate"])
            + Decimal(request["completionTokens"]) * Decimal(rate["outputRate"])
        ) / Decimal(1_000_000)
        equal(value, Decimal(request["estimatedUsd"]))
        costs += value
        logical[request["logicalId"]] += 1
    assert len(logical) == 62832 and set(logical.values()) == {1}
    for d in decisions:
        key = f"{d['episodeId']}/{d['round']}/{d['seat']}/"
        assert logical[key + "action"] == 1
        assert logical[key + "draft"] == (1 if d["arm"].endswith("draft") else 0)
    equal(costs, Decimal(summary["spentUsd"]))
    for arm in summary["arms"]:
        t, name = arm["temperature"], arm["arm"]
        es = [
            e
            for e in episodes
            if e["temperature"] == t
            and e["track"] == "A"
            and e["players"][e["subjectSeat"]] == name
        ]
        acts = [
            d for d in decisions if d["temperature"] == t and d["arm"] == name and d["track"] == "A"
        ]
        calls = [r for r in requests if r["temperature"] == t and r["arm"] == name]
        drafts = [r for r in calls if r["phase"] == "draft"]
        durations = [r["seconds"] for r in calls if r["seconds"] is not None]
        calculated = {
            "benchmarkCompleted": len(es),
            "meanOracleLoss": mean(e["normalisedOracleLoss"] for e in es),
            "zeroLossEpisodes": sum(e["normalisedOracleLoss"] == 0 for e in es),
            "benchmarkDecisions": len(acts),
            "zeroGapDecisions": sum(d["oracleGap"] == 0 for d in acts),
            "requests": len(calls),
            "promptTokens": sum(r["promptTokens"] or 0 for r in calls),
            "completionTokens": sum(r["completionTokens"] or 0 for r in calls),
            "drafts": len(drafts),
            "cappedDrafts": sum(r["draftCapped"] for r in drafts),
            "requestMedianSeconds": float(np.median(durations)),
            "requestP95Seconds": float(np.quantile(durations, 0.95)),
            "estimatedUsd": str(
                sum(
                    (Decimal(r["estimatedUsd"]) for r in calls if r["estimatedUsd"] is not None),
                    Decimal(0),
                )
            ),
        }
        equal({k: arm[k] for k in calculated}, calculated)
    # These are explicit publication authority and retained uncertainty, not invoices.
    accounting, review = read("accounting.json"), read("publication-review.json")
    equal(accounting["finalUsageEstimate"], summary["spentUsd"])
    equal(accounting["unresolvedMaximumExposure"], summary["reservedUsd"])
    assert not accounting["billingReconciled"] and not accounting["settledLedgerAltered"]
    assert review["ready"] and review["newInference"] == 0
    equal(review["evidenceHead"], summary["evidenceHead"])
    equal(review["accountingAmendment"]["unresolvedMaximumExposureUsd"], summary["reservedUsd"])
    equal(review["accountingAmendment"]["approval"], "Approve disclosed accounting amendment")
    equal(
        review["originalFrozenGate"],
        {
            "ready": False,
            "reasons": ["Unresolved final reservations require explicit accounting review"],
        },
    )
    print(
        "Verified 7,104 final episodes, exact scoring, paired schedule, 4 primary/6 secondary contrasts, exploratory slices, 41,888 decisions and 62,852 request records. Billing uncertainty is retained; private native evidence is attested separately."
    )


if __name__ == "__main__":
    verify(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "public/research")
