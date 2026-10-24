"""Build the additive public temperature-zero package from a verified local export.

Offline only. Never edits execution code, evidence, or the original public dataset.
Run with the project environment and pass --export PATH to the completed export.
The checksum manifest is refreshed separately after reviewing report/document edits.
"""

import argparse
import csv
import json
import shutil
from collections import Counter
from decimal import Decimal
from pathlib import Path
from statistics import mean

from gamefield_research.analysis import paired_interval
from gamefield_research.artifacts import verify_export
from gamefield_research.gateway import read_events

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public/research"


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def csv_file(path, records):
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(records)


def block_means(rows, arm):
    return [
        mean(
            r["normalisedOracleLoss"]
            for r in rows
            if r["track"] == "A" and r["block"] == block and r["cell"].endswith("/" + arm)
        )
        for block in range(24)
    ]


def comparison(plan0, rows0, plan1, rows1):
    if plan0["episodes"] != plan1["episodes"] or plan0["arms"] != plan1["arms"]:
        raise ValueError("Temperature schedules/arms must match exactly")
    prefix = f"temperature-comparison/1/{plan0['sha256']}/{plan1['sha256']}"
    deltas, changes, interactions = {}, {}, {}
    for arm in (a["id"] for a in plan0["arms"]):
        deltas[arm] = [a - b for a, b in zip(block_means(rows0, arm), block_means(rows1, arm))]
        estimate, interval = paired_interval(
            [deltas[arm][s::4] for s in range(4)], f"{prefix}/{arm}"
        )
        changes[arm] = {"temperature0Minus1": estimate, "approximateInterval95": interval}
    for model in ("nano", "super"):
        delta = [a - b for a, b in zip(deltas[model + "-draft"], deltas[model + "-direct"])]
        estimate, interval = paired_interval(
            [delta[s::4] for s in range(4)], f"{prefix}/{model}/interaction"
        )
        interactions[model] = {
            "changeInDraftMinusDirect": estimate,
            "approximateInterval95": interval,
        }
    return {
        "schemaVersion": 1,
        "studyDates": {"temperature1": "2026-10-22", "temperature0": "2026-10-23"},
        "planSha256": {"temperature0": plan0["sha256"], "temperature1": plan1["sha256"]},
        "completedEpisodes": 3552,
        "episodesPerTemperature": 1776,
        "matchedBlocks": 24,
        "resamples": 20000,
        "method": "Stratified paired whole-block bootstrap; six matched blocks per stratum; temperature 0 minus temperature 1. No pooling of the two studies or interrupted observations.",
        "interpretation": "Descriptive sensitivity analysis after reviewing earlier outcomes. Different dates, provider/backend windows and recovery policies confound temperature attribution. Approximate intervals, no multiplicity correction; temperature zero does not guarantee deterministic hosted inference.",
        "temperatureChanges": changes,
        "changeInDraftingEffect": interactions,
    }


def figure():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 11,
            "svg.hashsalt": "dilemma-temperature-release-2026-10-24",
        }
    )
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.25), sharex=True)
    for ax, model in zip(axes, ("nano", "super")):
        for y, (temp, directory, colour) in enumerate(
            ((1, PUBLIC, "#243b53"), (0, PUBLIC / "temperature-zero", "#087f8c"))
        ):
            row = next(
                r for r in read(directory / "summary.json")["primary"] if r["model"] == model
            )
            lo, hi = row["approximateInterval95"]
            ax.errorbar(
                row["estimate"],
                y,
                xerr=[[row["estimate"] - lo], [hi - row["estimate"]]],
                fmt="o",
                capsize=5,
                color=colour,
                markersize=7,
            )
            ax.annotate(
                f"{row['estimate']:.4f}",
                (row["estimate"], y),
                xytext=(0, 13),
                textcoords="offset points",
                ha="center",
                color=colour,
            )
        ax.set_yticks([0, 1], ["Temperature 1", "Temperature 0"])
        ax.set_ylim(1.6, -0.6)
        ax.set_xlim(-0.36, 0.025)
        ax.axvline(0, color="#8c99a5", linewidth=1)
        ax.grid(axis="x", alpha=0.2)
        ax.set_xlabel("Draft − direct mean oracle loss")
        ax.set_title("Nemotron " + model.title(), fontweight="bold", pad=18)
        ax.spines[["top", "right", "left"]].set_visible(False)
    fig.tight_layout(pad=1.5)
    for extension in ("png", "svg"):
        metadata = {"Date": None} if extension == "svg" else None
        fig.savefig(
            PUBLIC / f"figures/temperature-comparison.{extension}", dpi=200, metadata=metadata
        )
    plt.close(fig)


def build(export):
    report = verify_export(export)
    if report["completed"] != report["scheduled"] or report["completed"] != 1776:
        raise ValueError("Require the complete 1,776-episode export")
    plan, rows = read(export / "plan.json"), read(export / "episodes.json")
    if plan["procedure"]["temperature"] != 0:
        raise ValueError("Require the temperature-zero study")
    if (
        plan["sha256"] != "1e3ffff884f80e67c4d398e2e0d65a45d92d3d76e19f99dafe5e3dc85b8c7d76"
        or report["evidenceHead"]
        != "8abf539cd902475bdb94477ea585455ebad1ccf409e467635d2d683bd037b14e"
    ):
        raise ValueError("This release builder requires the reviewed 23 October recovery export")
    events = read_events(export / "events.jsonl")
    if events[-1]["event"] != "run-ended" or events[-1]["halted"] is not None:
        raise ValueError("Require a successfully terminated run")
    if any(e["event"] in ("attempt-failed", "global-stop", "accounting-overrun") for e in events):
        raise ValueError("Review unexpected request failures before public derivation")
    out = PUBLIC / "temperature-zero"
    out.mkdir(exist_ok=True)
    for name in ("plan.json", "episodes.json"):
        shutil.copyfile(export / name, out / name)
    provenance = read(export / "provenance.json")
    write(out / "executed-source-index.json", provenance["sourceFiles"])
    arms = {
        a["id"]: {"requests": 0, "promptTokens": 0, "completionTokens": 0, "costUsd": Decimal(0)}
        for a in plan["arms"]
    }
    episodes = {e["id"]: e for e in plan["episodes"]}
    attempts, responses = {}, {}
    for e in events:
        if e["event"] == "joint-reservation":
            attempts.update(e["attempts"])
        elif e["event"] == "response-received":
            responses[e["key"]] = e["response"]
        elif e["event"] == "settled":
            eid, _, seat, _ = attempts[e["key"]]["logicalKey"].split("/")
            usage = responses[e["key"]]["usage"]
            target = arms[episodes[eid]["players"][int(seat)]]
            target["requests"] += 1
            target["promptTokens"] += usage["prompt_tokens"]
            target["completionTokens"] += usage["completion_tokens"]
            target["costUsd"] += Decimal(e["costUsd"])
    for value in arms.values():
        value["costUsd"] = str(value["costUsd"])
    cost = read(PUBLIC / "execution-costs.json")
    cost["arms"] = arms
    cost["pricingSource"] = "../../../fixtures/prices-2026-10-20.json"
    write(out / "execution-costs.json", cost)
    benchmark = [r for r in rows if r["track"] == "A"]
    arm_summary = {}
    for arm in arms:
        losses = [r["normalisedOracleLoss"] for r in benchmark if r["cell"].endswith("/" + arm)]
        arm_summary[arm] = {
            "episodes": len(losses),
            "meanOracleLoss": mean(losses),
            "zeroLossEpisodes": losses.count(0),
        }
    conditions = []
    for name in sorted({r["cell"].split("/")[1] for r in benchmark}):
        values = {"condition": name}
        for arm in arms:
            values[arm] = mean(
                r["normalisedOracleLoss"] for r in benchmark if r["cell"] == f"A/{name}/{arm}"
            )
        for model in ("nano", "super"):
            values[model + "Difference"] = values[model + "-draft"] - values[model + "-direct"]
        conditions.append(values)
    policies = [
        {
            "policy": policy,
            **{
                model: mean(
                    c[model + "Difference"]
                    for c in conditions
                    if c["condition"].startswith(policy + "-")
                )
                for model in ("nano", "super")
            },
        }
        for policy in ("allc", "alld", "grim", "tft")
    ]
    blocks = []
    for primary in report["primaryContrasts"]:
        model = primary["model"]
        for procedure in ("direct", "draft"):
            primary[procedure + "Mean"] = arm_summary[f"{model}-{procedure}"]["meanOracleLoss"]
        primary["relativeReductionPercent"] = -100 * primary["estimate"] / primary["directMean"]
        primary["stratumMeans"] = []
        for block in range(24):
            direct = block_means(rows, model + "-direct")[block]
            draft = block_means(rows, model + "-draft")[block]
            blocks.append(
                {
                    "model": model,
                    "block": block,
                    "stratum": block % 4,
                    "directLoss": direct,
                    "draftLoss": draft,
                    "difference": draft - direct,
                }
            )
        primary["stratumMeans"] = [
            mean(b["difference"] for b in blocks if b["model"] == model and b["stratum"] == s)
            for s in range(4)
        ]
    cross = [r for r in rows if r["track"] == "B"]
    scope = read(PUBLIC / "summary.json")["publicEvidenceScope"]
    decisions = sum(len(r["history"]) * sum(p in arms for p in r["players"]) for r in rows)
    drafts = sum(len(r["history"]) * sum(p.endswith("-draft") for p in r["players"]) for r in rows)
    summary = {
        "schemaVersion": 1,
        "temperature": 0,
        "studyDate": "2026-10-23",
        "studyId": "temperature-zero-recovery-01-2026-10-23",
        "interpretation": "Descriptive matched temperature sensitivity; not a confirmatory preregistration.",
        "publicEvidenceScope": scope,
        "sourceSha256": report["sourceSha256"],
        "planSha256": plan["sha256"],
        "evidenceHead": report["evidenceHead"],
        "completed": len(rows),
        "scheduled": len(plan["episodes"]),
        "requestCount": sum(a["requests"] for a in arms.values()),
        "decisionCount": decisions,
        "draftCount": drafts,
        "roundCount": sum(len(r["history"]) for r in rows),
        "failures": 0,
        "retries": 0,
        "sessions": sum(e["event"] == "session-started" for e in events),
        "unresolvedSuccessorUsd": report["reservedUsd"],
        "primary": report["primaryContrasts"],
        "arms": arm_summary,
        "policyEffects": policies,
        "conditions": conditions,
        "crossplay": report["crossplay"],
        "jointActionCounts": dict(Counter("".join(p) for r in cross for p in r["history"])),
        "firstRoundCC": sum(r["firstCC"] for r in cross),
        "finalEstimatedUsd": report["spentUsd"],
    }
    write(out / "summary.json", summary)
    csv_file(out / "condition-losses.csv", conditions)
    csv_file(out / "block-contrasts.csv", blocks)
    csv_file(out / "policy-effects.csv", policies)
    csv_file(
        out / "crossplay.csv",
        [
            {
                "pairing": p["cell"],
                "scheduledDyads": p["scheduled"],
                "completedDyads": p["completed"],
                "meanNormalisedJointReturn": p["meanNormalisedJointReturn"],
                **{
                    f"{m}_{k}": p[m][k]
                    for m in ("firstCC", "mutualCooperation", "breakdown", "recovery")
                    for k in ("count", "opportunities")
                },
            }
            for p in report["crossplay"]
        ],
    )
    result = comparison(plan, rows, read(PUBLIC / "plan.json"), read(PUBLIC / "episodes.json"))
    write(PUBLIC / "temperature-comparison.json", result)
    csv_file(
        PUBLIC / "temperature-comparison.csv",
        [
            {
                "contrast": arm,
                "temperature0Minus1": value["temperature0Minus1"],
                "interval95Low": value["approximateInterval95"][0],
                "interval95High": value["approximateInterval95"][1],
            }
            for arm, value in result["temperatureChanges"].items()
        ]
        + [
            {
                "contrast": model + "-drafting-interaction",
                "temperature0Minus1": value["changeInDraftMinusDirect"],
                "interval95Low": value["approximateInterval95"][0],
                "interval95High": value["approximateInterval95"][1],
            }
            for model, value in result["changeInDraftingEffect"].items()
        ],
    )
    figure()
    print("Prepared additive temperature-zero public scores and comparison. No inference.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path, required=True)
    build(parser.parse_args().export.resolve())
