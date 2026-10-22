"""Offline estimates from authenticated event chains. No inference imports."""

from collections import defaultdict
from statistics import mean

import numpy as np

from .core import loss_bounds, metrics
from .design import digest, validate_plan
from .gateway import read_events


def episode_rows(plan, events):
    """Recover even a crash between joint reveal and episode completion."""
    histories = defaultdict(list)
    statuses = {}
    scheduled = {e["id"]: e for e in plan["episodes"]}
    for event in events:
        if event["event"] == "round-revealed":
            eid = event["episodeId"]
            if eid not in scheduled or eid in statuses:
                raise ValueError("Unknown or already terminal episode")
            if event["round"] != len(histories[eid]) + 1:
                raise ValueError("Noncontiguous round sequence")
            histories[eid].append(event["actions"])
        elif event["event"] == "episode-ended":
            eid = event["episodeId"]
            if eid not in scheduled or eid in statuses:
                raise ValueError("Duplicate or unknown outcome")
            statuses[eid] = event["status"]
    rows = []
    for e in plan["episodes"]:
        history = histories[e["id"]]
        completed = len(history) == e["rounds"]
        status = statuses.get(
            e["id"], "completed" if completed else ("interrupted" if history else "unstarted")
        )
        if (status == "completed") != completed:
            raise ValueError("Terminal status disagrees with evidence")
        row = {**e, "status": status, "history": history, **metrics(e, history, completed)}
        if e["track"] == "A":
            row["lossBounds"] = loss_bounds(e, history)
        rows.append(row)
    return rows


def paired_interval(strata, seed, resamples=20000):
    estimate = mean([mean(s) for s in strata]) if all(strata) else None
    if any(len(s) < 5 for s in strata):
        return estimate, None
    rng = np.random.Generator(np.random.PCG64(int(digest(seed)[:16], 16)))
    draws = (
        sum(
            np.asarray(s)[rng.integers(len(s), size=(resamples, len(s)))].mean(axis=1)
            for s in strata
        )
        / 4
    )
    return estimate, np.quantile(draws, [0.025, 0.975]).tolist()


def analyse(plan, events):
    validate_plan(plan)
    rows = episode_rows(plan, events)
    contrasts = []
    for model in ("nano", "super"):
        strata = [[] for _ in range(4)]
        bounds_by_block = []
        incomplete = []
        for block in range(plan["blocks"]):
            arms = {}
            for procedure in ("direct", "draft"):
                arms[procedure] = [
                    r
                    for r in rows
                    if r["block"] == block
                    and r["track"] == "A"
                    and r["cell"].endswith("/" + model + "-" + procedure)
                ]
                if len(arms[procedure]) != 16:
                    raise ValueError("Incomplete design")
            lo = mean(r["lossBounds"][0] for r in arms["draft"]) - mean(
                r["lossBounds"][1] for r in arms["direct"]
            )
            hi = mean(r["lossBounds"][1] for r in arms["draft"]) - mean(
                r["lossBounds"][0] for r in arms["direct"]
            )
            bounds_by_block.append([lo, hi])
            if all(r["status"] == "completed" for group in arms.values() for r in group):
                difference = mean(r["normalisedOracleLoss"] for r in arms["draft"]) - mean(
                    r["normalisedOracleLoss"] for r in arms["direct"]
                )
                strata[block % 4].append(difference)
            else:
                incomplete.append(block)
        estimate, interval = paired_interval(
            strata, f"{plan['sha256']}/{model}", plan["analysis"]["resamples"]
        )
        contrasts.append(
            {
                "model": model,
                "direction": "draft-minus-direct; negative favours draft",
                "estimate": estimate,
                "approximateInterval95": interval,
                "eligibleBlocksByStratum": [len(s) for s in strata],
                "incompleteBlocks": incomplete,
                "scheduledOutcomeBounds": [mean(b[i] for b in bounds_by_block) for i in (0, 1)],
                "inference": "conditional on complete within-model blocks; descriptive, not confirmatory",
                "intervalStatus": "approximate" if interval else "insufficient replication",
            }
        )
    crossplay = []
    for cell in sorted({r["cell"] for r in rows if r["track"] == "B"}):
        all_rows = [r for r in rows if r["cell"] == cell]
        complete = [r for r in all_rows if r["status"] == "completed"]
        first = [r for r in all_rows if r["firstCC"] is not None]
        crossplay.append(
            {
                "cell": cell,
                "scheduled": len(all_rows),
                "completed": len(complete),
                "firstCC": {"count": sum(r["firstCC"] for r in first), "opportunities": len(first)},
                "meanNormalisedJointReturn": mean(r["normalisedJointReturn"] for r in complete)
                if complete
                else None,
                **{
                    metric: {
                        key: sum(r[metric][key] for r in all_rows)
                        for key in ("count", "opportunities")
                    }
                    for metric in ("mutualCooperation", "breakdown", "recovery")
                },
            }
        )
    costs = [e for e in events if e["event"] == "settled"]
    from decimal import Decimal

    spent = sum((Decimal(e["costUsd"]) for e in costs), Decimal(0))
    pending = {}
    for e in events:
        if e["event"] == "joint-reservation":
            pending.update(e["entries"])
        elif e["event"] == "settled":
            pending.pop(e["key"])
        elif e["event"] == "released-unsent":
            for key in e["entries"]:
                pending.pop(key)
    execution = next((e["execution"] for e in events if e["event"] == "run-started"), "unknown")
    source_sha = next((e.get("sourceSha256") for e in events if e["event"] == "run-started"), None)
    report = {
        "schemaVersion": 1,
        "planSha256": plan["sha256"],
        "execution": execution,
        "sourceSha256": source_sha,
        "purpose": plan["purpose"],
        "scientificObservations": sum(r["status"] == "completed" for r in rows)
        if execution == "tokenfactory" and plan["purpose"] == "final"
        else 0,
        "scheduled": len(rows),
        "completed": sum(r["status"] == "completed" for r in rows),
        "statusCounts": {
            s: sum(r["status"] == s for r in rows) for s in sorted({r["status"] for r in rows})
        },
        "spentUsd": str(spent),
        "reservedUsd": str(sum(map(Decimal, pending.values()), Decimal(0))),
        "primaryContrasts": contrasts,
        "crossplay": crossplay,
        "evidenceHead": events[-1]["sha256"] if events else None,
        "limitations": [
            "Approximate bootstrap intervals may be unreliable with few or skewed blocks.",
            "Missingness bounds concern realised scheduled lengths, not population uncertainty.",
            "Draft procedure changes compute, request count and conditioning.",
            "Cooperation is not a certificate of equilibrium or universal rationality.",
        ],
    }
    if "derivation" in plan:
        report["planAmendment"] = plan["derivation"]
        report["limitations"].append(
            "This smaller final evaluation uses original prefix blocks; replication is descriptive "
            "and no bootstrap interval is reported below five complete blocks per stratum."
        )
    amendment = next(
        (e.get("scientificAmendment") for e in events if e["event"] == "run-started"), None
    )
    if amendment is not None:
        report["evaluationAmendment"] = amendment
        report["limitations"].append(
            "Fresh successor after inspection of interrupted results; predecessor observations "
            "are excluded. Recovery policy was amended before successor inference."
        )
    return report, rows


def analyse_file(plan, ledger):
    return analyse(plan, read_events(ledger))
