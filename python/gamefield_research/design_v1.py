"""Versioned, reproducible schedules; stopping randomness never enters observations."""

import hashlib
import hmac
import json
import os
from copy import deepcopy
from fractions import Fraction
from pathlib import Path

from .core import SCRIPTS, reward

MODELS = ("nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nvidia/nemotron-3-super-120b-a12b")
VERSION = "gamefield-bounded/1"
JSON_INSTRUCTION = (
    'Return only a JSON object with exactly one field, "action", '
    'whose value is "X" or "Y", for example {"action":"X"}. No other fields or text.'
)
ARMS = [
    {"id": f"{name}-{procedure}", "model": model, "procedure": procedure}
    for name, model in zip(("nano", "super"), MODELS, strict=True)
    for procedure in ("direct", "draft")
]
CONDITIONS = [
    (f"{p}-g{d}", p, {"kind": "geometric", "delta": str(Fraction(d))})
    for d in ("0.4", "0.6", "0.9")
    for p in SCRIPTS
] + [
    (f"{p}-h{n}", p, {"kind": "fixed", "rounds": n})
    for p, n in (("allc", 1), ("alld", 1), ("tft", 10), ("grim", 10))
]


def canonical(value):
    return json.dumps(
        value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
    ).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def continues(seed, round_number, delta):
    p = Fraction(delta)
    if round_number < 1 or not 0 <= p < 1 or p.denominator > 10**12:
        raise ValueError("Invalid stopping inputs")
    limit = 2**256 - (2**256 % p.denominator)
    attempt = 0
    while True:
        value = int(
            hmac.new(
                seed.encode(), f"stop:{round_number}:{attempt}".encode(), hashlib.sha256
            ).hexdigest(),
            16,
        )
        if value < limit:
            return value % p.denominator < p.numerator
        attempt += 1


def make_plan(seed, blocks=24, purpose="final"):
    if not seed or type(blocks) is not int or blocks < 4 or blocks > 10000 or blocks % 4:
        raise ValueError("Require seed and a positive multiple of four blocks")
    if purpose not in ("final", "engineering"):
        raise ValueError("Unknown purpose")
    episodes = []
    for block in range(blocks):
        mapping, seat = ("X=C" if block % 2 == 0 else "X=D"), block // 2 % 2
        environment_seed = digest(
            {"seed": seed, "block": f"replicate-{block}", "domain": "environment"}
        )

        def add(track, cell, players, horizon, policy=None):
            row = {
                "track": track,
                "cell": cell,
                "block": block,
                "stratum": block % 4,
                "mapping": mapping,
                "subjectSeat": seat if track == "A" else None,
                "players": list(reversed(players)) if seat else players,
                "horizon": horizon,
                "policy": policy,
                "environmentSeed": environment_seed,
            }
            n = 1
            if horizon["kind"] == "fixed":
                n = horizon["rounds"]
            else:
                while continues(environment_seed, n, horizon["delta"]):
                    n += 1
                    if n > 1000:
                        raise ValueError("Schedule exceeds operational guard; do not search seeds")
            row["rounds"] = n
            row["id"] = digest({"seed": seed, **row})[:24]
            episodes.append(row)

        for arm in ARMS:
            for condition, policy, horizon in CONDITIONS:
                add("A", f"A/{condition}/{arm['id']}", [arm["id"], policy], horizon, policy)
        for i, a in enumerate(ARMS):
            for b in ARMS[i:]:
                add(
                    "B",
                    f"B/{a['id']}/{b['id']}",
                    [a["id"], b["id"]],
                    {"kind": "geometric", "delta": "9/10"},
                )
    episodes.sort(key=lambda e: digest({"seed": seed, "id": e["id"], "domain": "order"}))
    plan = {
        "schemaVersion": 1,
        "version": VERSION,
        "seed": seed,
        "blocks": blocks,
        "purpose": purpose,
        "arms": ARMS,
        "episodes": episodes,
        "procedure": {
            "draftTokens": 1024,
            "actionTokens": 128,
            "temperature": 1,
            "topP": 1,
            "timeoutSeconds": 600,
        },
        "analysis": {
            "resamples": 20000,
            "minimumBlocksPerStratum": 5,
            "conditionWeight": "1/16",
            "stratumWeight": "1/4",
        },
        "limits": {
            "episodes": 4,
            "requests": 8,
            "protocolFailures": 3,
            "wallSeconds": 129600 if purpose == "final" else 7200,
            "shutdownMarginSeconds": 900,
        },
    }
    return {**plan, "sha256": digest(plan)}


def derive_local_plan(parent, blocks):
    """Prefix blocks of an unchanged final schedule, with a nine-hour run window."""
    if "derivation" in parent or parent != make_plan(
        parent["seed"], parent["blocks"], parent["purpose"]
    ):
        raise ValueError("Require an original, valid parent plan")
    if parent["purpose"] != "final" or type(blocks) is not int or blocks not in (4, 8):
        raise ValueError("Local final evaluation requires four or eight original blocks")
    if blocks > parent["blocks"]:
        raise ValueError("Subset exceeds parent schedule")
    body = deepcopy({k: v for k, v in parent.items() if k != "sha256"})
    body["schemaVersion"] = 2
    body["blocks"] = blocks
    body["episodes"] = [e for e in body["episodes"] if e["block"] < blocks]
    body["limits"]["wallSeconds"] = 9 * 3600
    body["derivation"] = {
        "kind": "prefix-blocks/1",
        "parentSha256": parent["sha256"],
        "parentBlocks": parent["blocks"],
        "selectedBlocks": list(range(blocks)),
        "reason": "local-12-hour-final",
    }
    return {**body, "sha256": digest(body)}


def validate_plan(plan):
    if "derivation" in plan:
        parent = make_plan(plan["seed"], plan["derivation"]["parentBlocks"], "final")
        expected = derive_local_plan(parent, plan["blocks"])
    else:
        expected = make_plan(plan["seed"], plan["blocks"], plan["purpose"])
    if plan != expected:
        raise ValueError("Plan differs from deterministic specification")
    return plan


def token(action, mapping):
    return "X" if (action == "C") == (mapping == "X=C") else "Y"


def action(label, mapping):
    if label not in ("X", "Y"):
        raise ValueError("Illegal label")
    return "C" if (label == "X") == (mapping == "X=C") else "D"


def observation(episode, history, seat, instruction=JSON_INSTRUCTION):
    if seat not in (0, 1) or episode["players"][seat] not in {a["id"] for a in ARMS}:
        raise ValueError("Only model subjects receive observations")
    if len(history) >= episode["rounds"]:
        raise ValueError("Episode has ended")
    c, d = token("C", episode["mapping"]), token("D", episode["mapping"])
    policies = {
        "allc": f"It chooses {c} every round, regardless of history.",
        "alld": f"It chooses {d} every round, regardless of history.",
        "tft": f"In round 1 it chooses {c}. In every later round it chooses the action "
        "you chose in the immediately preceding round.",
        "grim": f"It chooses {c} if no player has ever chosen {d} in a completed round. "
        f"Otherwise it chooses {d} forever.",
    }
    other = episode["players"][1 - seat]
    opponent = (
        "The opponent is committed to this complete deterministic rule: " + policies[other]
        if other in policies
        else "The opponent policy is unspecified."
    )
    h, r = episode["horizon"], len(history) + 1
    horizon = (
        f"After every completed round, another round occurs with probability {h['delta']} "
        "independently of actions. No final round is announced. Future points are not discounted again."
        if h["kind"] == "geometric"
        else f"Exactly {h['rounds']} rounds will be played. This is round {r}; "
        f"{h['rounds'] - r} rounds follow it."
    )
    scores = [sum(reward(pair[s], pair[1 - s]) for pair in history) for s in (0, 1)]
    payload = {
        "round": r,
        "payoffTable": [
            {
                "own": a,
                "opponent": b,
                "points": [
                    reward(action(a, episode["mapping"]), action(b, episode["mapping"])),
                    reward(action(b, episode["mapping"]), action(a, episode["mapping"])),
                ],
            }
            for a in ("X", "Y")
            for b in ("X", "Y")
        ],
        "points": {"own": scores[seat], "opponent": scores[1 - seat]},
        "completedHistory": [
            {
                "round": i + 1,
                "own": token(pair[seat], episode["mapping"]),
                "opponent": token(pair[1 - seat], episode["mapping"]),
                "points": [reward(pair[seat], pair[1 - seat]), reward(pair[1 - seat], pair[seat])],
            }
            for i, pair in enumerate(history)
        ],
        "legalActions": ["X", "Y"],
    }
    return [
        {
            "role": "system",
            "content": f"You are Player {'A' if seat == 0 else 'B'}, one of two "
            "independent players. Maximise your own expected cumulative points until game-rule "
            "termination; the objective is not score difference. Choose X or Y privately. "
            "The opponent chooses simultaneously without seeing your current response. "
            "After both choose, both actions and payoffs are revealed. You have no tools or "
            f"communication. {opponent} {horizon}\n{instruction}",
        },
        {"role": "user", "content": json.dumps(payload, separators=(",", ":"), ensure_ascii=False)},
    ]


def write_json(path: Path, value):
    with path.open("x") as stream:
        stream.write(json.dumps(value, indent=2, allow_nan=False) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
