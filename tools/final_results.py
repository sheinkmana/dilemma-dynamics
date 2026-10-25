"""Reproduce the final release's exploratory diagnostics from public action data.

No inference or private draft content is used. Frozen primary inference remains
in evaluation_v2; these additional slices were chosen after viewing the results.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gamefield_research.core import episode_oracle, reward, transition, weight  # noqa: E402

from evaluation_v2.analysis import interval  # noqa: E402

ARMS = ("nano-direct", "nano-draft", "super-direct", "super-draft")


def diagnostics(episodes, spec_sha):
    benchmark = [e for e in episodes if e["track"] == "A"]
    conditions = []
    policies = []
    strata = []
    first = []
    finite = []
    for t in (0, 1):
        group = [e for e in benchmark if e["temperature"] == t]
        for condition in sorted({e["cell"].split("/")[1] for e in group}):
            selected = [e for e in group if e["cell"].split("/")[1] == condition]
            row = {"temperature": t, "condition": condition, "episodesPerArm": 48}
            for arm in ARMS:
                es = [e for e in selected if e["players"][e["subjectSeat"]] == arm]
                row[arm] = mean(e["normalisedOracleLoss"] for e in es)
                first.append(
                    {
                        "temperature": t,
                        "condition": condition,
                        "arm": arm,
                        "cooperate": sum(e["history"][0][e["subjectSeat"]] == "C" for e in es),
                        "episodes": len(es),
                        "optimalFirstActions": [
                            a for a in ("C", "D") if episode_oracle(es[0], 0).gap(0, a) == 0
                        ],
                    }
                )
            for m in ("nano", "super"):
                row[m + "Effect"] = row[m + "-draft"] - row[m + "-direct"]
            conditions.append(row)
        for policy in ("allc", "alld", "grim", "tft"):
            selected = [e for e in group if e["policy"] == policy]
            row = {"temperature": t, "policy": policy, "episodesPerArm": 192}
            for arm in ARMS:
                row[arm] = mean(
                    e["normalisedOracleLoss"]
                    for e in selected
                    if e["players"][e["subjectSeat"]] == arm
                )
            for m in ("nano", "super"):
                row[m + "Effect"] = row[m + "-draft"] - row[m + "-direct"]
            policies.append(row)
        for s in range(4):
            for model in ("nano", "super"):
                vals = {}
                for p in ("direct", "draft"):
                    vals[p] = mean(
                        e["normalisedOracleLoss"]
                        for e in group
                        if e["stratum"] == s and e["players"][e["subjectSeat"]] == model + "-" + p
                    )
                strata.append(
                    {
                        "temperature": t,
                        "stratum": s,
                        "model": model,
                        **vals,
                        "effect": vals["draft"] - vals["direct"],
                    }
                )
        for arm in ARMS:
            for policy in ("tft", "grim"):
                es = [
                    e
                    for e in group
                    if e["horizon"].get("rounds") == 10
                    and e["policy"] == policy
                    and e["players"][e["subjectSeat"]] == arm
                ]
                paths = ["".join(p[e["subjectSeat"]] for p in e["history"]) for e in es]
                finite.append(
                    {
                        "temperature": t,
                        "arm": arm,
                        "policy": policy,
                        "episodes": len(es),
                        "optimalPaths": paths.count("C" * 9 + "D"),
                        "roundCooperations": [sum(p[r] == "C" for p in paths) for r in range(10)],
                        "meanOwnPayoff": mean(e["scores"][e["subjectSeat"]] for e in es),
                    }
                )
    # Shared block schedule makes these paired differences in realised outcomes.
    autonomous = [e for e in episodes if e["track"] == "B"]
    contrasts = []
    for t in (0, 1):
        for model in ("nano", "super"):
            for metric in ("normalisedJointReturn", "episodeCC"):
                values = {}
                for b in range(48):
                    selected = {
                        e["cell"]: e
                        for e in autonomous
                        if e["temperature"] == t and e["block"] == b
                    }

                    def value(p):
                        arm = model + "-" + p
                        e = selected[f"B/{arm}/{arm}"]
                        return (
                            e["normalisedJointReturn"]
                            if metric == "normalisedJointReturn"
                            else e["mutualCooperation"]["count"] / e["rounds"]
                        )

                    values[b] = value("draft") - value("direct")
                contrasts.append(
                    {
                        "temperature": t,
                        "model": model,
                        "metric": metric,
                        "contrast": "draft-self-play-minus-direct-self-play",
                        **interval(values, [spec_sha, t, model, metric, "exploratory"], 0.95),
                    }
                )
    # Measure schedule-matched action differences across temperatures, not seed determinism.
    matched = defaultdict(dict)
    for e in episodes:
        matched[e["matchedId"]][e["temperature"]] = e
    changes = []
    for arm in ARMS:
        pairs = [
            p
            for p in matched.values()
            if p[0]["track"] == "A" and p[0]["players"][p[0]["subjectSeat"]] == arm
        ]
        changes.append(
            {
                "arm": arm,
                "episodes": len(pairs),
                "differentHistories": sum(p[0]["history"] != p[1]["history"] for p in pairs),
            }
        )
    examples = []
    # Outcome-independent locator: the first scheduled block for each finite cell.
    for t in (0, 1):
        for e in benchmark:
            if e["temperature"] == t and e["block"] == 0 and e["horizon"].get("rounds") == 10:
                examples.append(
                    {
                        "temperature": t,
                        "id": e["id"],
                        "cell": e["cell"],
                        "block": 0,
                        "loss": e["normalisedOracleLoss"],
                        "subjectPath": "".join(p[e["subjectSeat"]] for p in e["history"]),
                    }
                )
    return {
        "scope": "Exploratory analyses chosen after inspecting the completed final run; nominal intervals, no multiplicity control.",
        "policyEffects": policies,
        "conditions": conditions,
        "strata": strata,
        "firstActions": first,
        "finiteHorizon": finite,
        "autonomousContrasts": contrasts,
        "temperatureHistoryChanges": changes,
        "metadataSelectedExamples": examples,
    }


def check_actions(episodes):
    """Independently rebuild payoff, committed policy and exact gap aggregates."""
    if not __debug__:
        raise RuntimeError("Verification requires Python assertions; do not use -O")
    assert len(episodes) == 7104
    assert len({e["id"] for e in episodes}) == 7104
    matched = defaultdict(dict)
    for e in episodes:
        assert e["status"] == "completed" and e["rounds"] == len(e["history"])
        matched[e["matchedId"]][e["temperature"]] = e
        scores = [sum(reward(p[s], p[1 - s]) for p in e["history"]) for s in (0, 1)]
        assert e["scores"] == scores
        assert abs(e["normalisedJointReturn"] - float(weight(e)) * sum(scores)) < 1e-10
        if e["track"] == "A":
            state, gap = 0, 0
            for r, pair in enumerate(e["history"]):
                seat = e["subjectSeat"]
                expected = (
                    "C"
                    if e["policy"] == "allc"
                    else "D"
                    if e["policy"] == "alld"
                    else "C"
                    if state == 0
                    else "D"
                )
                assert pair[1 - seat] == expected
                gap += episode_oracle(e, r).gap(state, pair[seat])
                state = transition(e["policy"], state, pair[seat])
            assert abs(e["normalisedOracleLoss"] - float(gap * weight(e))) < 1e-10
        else:
            assert e["normalisedOracleLoss"] is None
    assert len(matched) == 3552
    for pair in matched.values():
        assert set(pair) == {0, 1}
        for k in (
            "cell",
            "block",
            "stratum",
            "mapping",
            "subjectSeat",
            "players",
            "horizon",
            "environmentSeed",
            "rounds",
        ):
            assert pair[0][k] == pair[1][k], k
    return True


if __name__ == "__main__":
    import sys
    from pathlib import Path

    source = Path(sys.argv[1])
    episodes = json.loads((source / "episodes.json").read_text())
    spec = json.loads((source / "spec.json").read_text())
    check_actions(episodes)
    result = diagnostics(episodes, spec["sha256"])
    Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + "\n")
    print("Verified 7,104 action histories; wrote exploratory diagnostics.")
