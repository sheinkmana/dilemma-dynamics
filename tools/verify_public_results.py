"""Verify public scores and estimates offline; no model or provider calls.

The public action data cannot authenticate privately retained raw responses,
request/transport accounting, or provider billing. See public/research/README.md.
"""

import csv
import hashlib
import json
import math
from collections import Counter
from decimal import Decimal
from pathlib import Path
from statistics import mean

from gamefield_research.analysis import paired_interval
from gamefield_research.core import metrics
from gamefield_research.design import digest, validate_plan

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public/research"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def equal(actual, expected):
    if isinstance(expected, float):
        require(math.isclose(actual, expected, abs_tol=1e-10, rel_tol=0), "Numeric mismatch")
    elif isinstance(expected, dict):
        require(set(actual) == set(expected), "Object keys differ")
        for key, value in expected.items():
            equal(actual[key], value)
    elif isinstance(expected, list):
        require(len(actual) == len(expected), "List lengths differ")
        for a, b in zip(actual, expected, strict=True):
            equal(a, b)
    else:
        require(actual == expected, "Value mismatch")


def read(name):
    return json.loads((DATA / name).read_text())


def verify():
    manifest = read("manifest.json")
    files = {p.relative_to(DATA).as_posix() for p in DATA.rglob("*") if p.is_file()}
    require(files == set(manifest["files"]) | {"manifest.json"}, "Public file set changed")
    for name, expected in manifest["files"].items():
        require(hashlib.sha256((DATA / name).read_bytes()).hexdigest() == expected, name)
    plan, rows, summary = read("plan.json"), read("episodes.json"), read("summary.json")
    costs = read("execution-costs.json")
    prices = json.loads((ROOT / "fixtures/prices-2026-10-20.json").read_text())["prices"]
    prices_by_model = {row["model"]: row for row in prices}
    arm_models = {arm["id"]: arm["model"] for arm in plan["arms"]}
    require(set(costs["arms"]) == set(arm_models), "Cost arms differ")
    total_cost = Decimal(0)
    total_requests = 0
    for arm, usage in costs["arms"].items():
        price = prices_by_model[arm_models[arm]]
        calculated = (
            Decimal(usage["promptTokens"]) * Decimal(price["inputRate"])
            + Decimal(usage["completionTokens"]) * Decimal(price["outputRate"])
        ) / Decimal(1_000_000)
        require(calculated == Decimal(usage["costUsd"]), "Usage cost differs: " + arm)
        decisions = sum(
            len(row["history"]) * row["players"].count(arm) for row in rows
        )
        require(
            usage["requests"] == decisions * (2 if arm.endswith("-draft") else 1),
            "Request count differs from recorded actions: " + arm,
        )
        total_cost += calculated
        total_requests += usage["requests"]
    require(total_cost == Decimal(summary["finalEstimatedUsd"]), "Total cost differs")
    equal(total_requests, summary["requestCount"])
    executed_source = read("executed-source-index.json")
    require(digest(executed_source) == summary["sourceSha256"], "Executed source index differs")
    for name in (
        "python/gamefield_research/core.py",
        "python/gamefield_research/analysis.py",
        "python/gamefield_research/design.py",
        "uv.lock",
    ):
        require(
            hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == executed_source[name],
            "Scoring/design/dependency source differs from executed study: " + name,
        )
    validate_plan(plan)
    require(plan["sha256"] == summary["planSha256"], "Wrong plan")
    require(len(rows) == len(plan["episodes"]) == summary["completed"] == 1776, "Wrong count")
    require(summary["scheduled"] == 1776, "Wrong schedule count")
    require({r["id"] for r in rows} == {e["id"] for e in plan["episodes"]}, "Episode IDs differ")
    by_id = {r["id"]: r for r in rows}
    for episode in plan["episodes"]:
        row = by_id[episode["id"]]
        require(row["status"] == "completed", "Incomplete public episode")
        for key, value in episode.items():
            equal(row[key], value)
        for key, value in metrics(episode, row["history"], True).items():
            equal(row[key], value)
        if episode["track"] == "A":
            equal(row["lossBounds"], [row["normalisedOracleLoss"]] * 2)
    benchmark = [r for r in rows if r["track"] == "A"]
    require(len(benchmark) == 1536, "Wrong benchmark count")
    for arm, expected in summary["arms"].items():
        group = [r for r in benchmark if r["cell"].endswith("/" + arm)]
        equal(len(group), expected["episodes"])
        equal(mean(r["normalisedOracleLoss"] for r in group), expected["meanOracleLoss"])
        equal(sum(r["normalisedOracleLoss"] == 0 for r in group), expected["zeroLossEpisodes"])
    blocks = {}
    for primary in summary["primary"]:
        model = primary["model"]
        strata = [[] for _ in range(4)]
        for block in range(24):
            means = {}
            for procedure in ("direct", "draft"):
                group = [
                    r
                    for r in benchmark
                    if r["block"] == block and r["cell"].endswith(f"/{model}-{procedure}")
                ]
                require(len(group) == 16, "Unbalanced block")
                means[procedure] = mean(r["normalisedOracleLoss"] for r in group)
            difference = means["draft"] - means["direct"]
            blocks[(model, block)] = {
                "directLoss": means["direct"],
                "draftLoss": means["draft"],
                "difference": difference,
            }
            strata[block % 4].append(difference)
        estimate, interval = paired_interval(strata, f"{plan['sha256']}/{model}", 20000)
        equal(primary["estimate"], estimate)
        equal(primary["approximateInterval95"], interval)
        equal(primary["stratumMeans"], list(map(mean, strata)))
        equal(primary["eligibleBlocksByStratum"], [6] * 4)
        for procedure in ("direct", "draft"):
            equal(
                primary[procedure + "Mean"],
                summary["arms"][f"{model}-{procedure}"]["meanOracleLoss"],
            )
        equal(primary["relativeReductionPercent"], -100 * estimate / primary["directMean"])
    conditions = {}
    for condition in summary["conditions"]:
        name = condition["condition"]
        values = {"condition": name}
        for arm in summary["arms"]:
            group = [r for r in benchmark if r["cell"] == f"A/{name}/{arm}"]
            require(len(group) == 24, "Unbalanced condition")
            values[arm] = mean(r["normalisedOracleLoss"] for r in group)
        for model in ("nano", "super"):
            values[model + "Difference"] = values[model + "-draft"] - values[model + "-direct"]
        equal(condition, values)
        conditions[name] = values
    for policy in summary["policyEffects"]:
        for model in ("nano", "super"):
            equal(
                policy[model],
                mean(
                    c[model + "Difference"]
                    for key, c in conditions.items()
                    if key.startswith(policy["policy"] + "-")
                ),
            )
    crossplay = [r for r in rows if r["track"] == "B"]
    require(len(crossplay) == 240, "Wrong dyad count")
    joint = Counter("".join(pair) for r in crossplay for pair in r["history"])
    equal(dict(joint), summary["jointActionCounts"])
    equal(sum(r["firstCC"] for r in crossplay), summary["firstRoundCC"])
    equal(sum(len(r["history"]) for r in rows), summary["roundCount"])
    for pairing in summary["crossplay"]:
        group = [r for r in crossplay if r["cell"] == pairing["cell"]]
        equal(len(group), pairing["completed"])
        equal(pairing["scheduled"], 24)
        equal(mean(r["normalisedJointReturn"] for r in group), pairing["meanNormalisedJointReturn"])
        equal(pairing["firstCC"], {"count": sum(r["firstCC"] for r in group), "opportunities": 24})
        for metric in ("mutualCooperation", "breakdown", "recovery"):
            equal(
                pairing[metric],
                {k: sum(r[metric][k] for r in group) for k in ("count", "opportunities")},
            )
    for name in ("condition-losses", "block-contrasts", "policy-effects", "crossplay"):
        with (DATA / (name + ".csv")).open() as file:
            records = list(csv.DictReader(file))
        if name == "condition-losses":
            require(len(records) == 16, "Wrong condition CSV count")
            for row in records:
                equal(
                    {k: v if k == "condition" else float(v) for k, v in row.items()},
                    conditions[row["condition"]],
                )
        elif name == "block-contrasts":
            require(len(records) == 48, "Wrong block CSV count")
            for row in records:
                block = int(row["block"])
                equal(int(row["stratum"]), block % 4)
                equal(
                    {k: float(row[k]) for k in ("directLoss", "draftLoss", "difference")},
                    blocks[(row["model"], block)],
                )
        elif name == "policy-effects":
            equal(
                [{k: v if k == "policy" else float(v) for k, v in row.items()} for row in records],
                summary["policyEffects"],
            )
        else:
            require(len(records) == 10, "Wrong crossplay CSV count")
            for row, pairing in zip(records, summary["crossplay"], strict=True):
                equal(row["pairing"], pairing["cell"])
                for source, target in (
                    ("scheduledDyads", "scheduled"),
                    ("completedDyads", "completed"),
                    ("meanNormalisedJointReturn", "meanNormalisedJointReturn"),
                ):
                    equal(float(row[source]), float(pairing[target]))
                for metric in ("firstCC", "mutualCooperation", "breakdown", "recovery"):
                    for key in ("count", "opportunities"):
                        equal(int(row[f"{metric}_{key}"]), pairing[metric][key])
    print(
        "Public results verified: 1,776 episodes, all scores, both intervals and four CSVs. No inference."
    )


if __name__ == "__main__":
    verify()
