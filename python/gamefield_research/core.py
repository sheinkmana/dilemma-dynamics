"""Pure game mechanics and exact best responses to committed policies."""

from dataclasses import dataclass
from fractions import Fraction as F
from functools import lru_cache
from itertools import product
from typing import Protocol

ACTIONS = ("C", "D")
SCRIPTS = ("allc", "alld", "tft", "grim")
PAYOFF = {"CC": 3, "CD": 0, "DC": 5, "DD": 1}


class Environment(Protocol):
    def step(self, actions: tuple[str, str]) -> tuple[int, int]: ...


class DecisionProcedure(Protocol):
    async def decide(self, observation: list[dict], arm: dict, key: str) -> str: ...


def reward(own, other):
    return PAYOFF[own + other]


def states(policy):
    if policy not in SCRIPTS:
        raise ValueError("Unknown committed policy")
    return 2 if policy in ("tft", "grim") else 1


def script_action(policy, state):
    if state not in range(states(policy)):
        raise ValueError("Invalid policy state")
    return "D" if policy == "alld" or state == 1 else "C"


def transition(policy, state, action):
    script_action(policy, state)
    if action not in ACTIONS:
        raise ValueError("Invalid action")
    if policy == "tft":
        return int(action == "D")
    if policy == "grim":
        return int(state == 1 or action == "D")
    return 0


@dataclass(frozen=True)
class Reference:
    values: tuple[F, ...]
    q: tuple[dict[str, F], ...]

    def gap(self, state, action):
        return self.values[state] - self.q[state][action]

    def optimal(self, state):
        return [a for a in ACTIONS if self.gap(state, a) == 0]


def reference(policy, discount, future):
    q = tuple(
        {
            a: F(reward(a, script_action(policy, s))) + discount * future[transition(policy, s, a)]
            for a in ACTIONS
        }
        for s in range(states(policy))
    )
    return Reference(tuple(max(row.values()) for row in q), q)


def solve(matrix, rhs):
    rows = [list(row) + [value] for row, value in zip(matrix, rhs, strict=True)]
    for col in range(len(rows)):
        pivot = next(i for i in range(col, len(rows)) if rows[i][col])
        rows[col], rows[pivot] = rows[pivot], rows[col]
        scale = rows[col][col]
        rows[col] = [v / scale for v in rows[col]]
        for i in range(len(rows)):
            if i != col:
                scale = rows[i][col]
                rows[i] = [v - scale * w for v, w in zip(rows[i], rows[col], strict=True)]
    return tuple(row[-1] for row in rows)


@lru_cache(maxsize=512)
def oracle(policy, kind, value, elapsed=0):
    n = states(policy)
    if kind == "fixed":
        remaining = int(value) - elapsed
        if not 1 <= remaining <= 1000:
            raise ValueError("Invalid remaining horizon")
        future = (F(0),) * n
        for _ in range(remaining):
            result = reference(policy, F(1), future)
            future = result.values
        return result
    if kind != "geometric":
        raise ValueError("Unknown horizon")
    discount = F(value)
    if not 0 <= discount < 1:
        raise ValueError("Invalid continuation probability")
    for policy_actions in product(ACTIONS, repeat=n):
        matrix = [
            [F(s == j) - discount * (transition(policy, s, a) == j) for j in range(n)]
            for s, a in enumerate(policy_actions)
        ]
        values = solve(
            matrix, [F(reward(a, script_action(policy, s))) for s, a in enumerate(policy_actions)]
        )
        result = reference(policy, discount, values)
        if result.values == values:
            return result
    raise AssertionError("No Bellman-certified policy")


def episode_oracle(episode, elapsed=0):
    horizon = episode["horizon"]
    return oracle(
        episode["policy"],
        horizon["kind"],
        horizon.get("delta", horizon.get("rounds")),
        elapsed if horizon["kind"] == "fixed" else 0,
    )


def weight(episode):
    h = episode["horizon"]
    return F(1, h["rounds"]) if h["kind"] == "fixed" else 1 - F(h["delta"])


def metrics(episode, history, completed):
    if len(history) > episode["rounds"] or any(
        len(pair) != 2 or any(a not in ACTIONS for a in pair) for pair in history
    ):
        raise ValueError("Invalid joint trace")
    if completed != (len(history) == episode["rounds"]):
        raise ValueError("Status disagrees with frozen stopping schedule")
    scores = [0, 0]
    gap, state = F(0), 0
    seat = episode["subjectSeat"]
    for i, pair in enumerate(history):
        for s in (0, 1):
            scores[s] += reward(pair[s], pair[1 - s])
        if seat is not None:
            if pair[1 - seat] != script_action(episode["policy"], state):
                raise ValueError("Trace violates committed policy")
            gap += episode_oracle(episode, i).gap(state, pair[seat])
            state = transition(episode["policy"], state, pair[seat])
    cc = [p == ["C", "C"] or p == ("C", "C") for p in history]
    return {
        "rounds": len(history),
        "scores": scores,
        "normalisedOracleLoss": float(gap * weight(episode))
        if completed and seat is not None
        else None,
        "normalisedJointReturn": float(sum(scores) * weight(episode)) if completed else None,
        "firstCC": cc[0] if cc else None,
        "firstSubjectC": history[0][seat] == "C" if history and seat is not None else None,
        "mutualCooperation": {"count": sum(cc), "opportunities": len(cc)},
        "breakdown": {
            "count": sum(a and not b for a, b in zip(cc, cc[1:])),
            "opportunities": sum(cc[:-1]),
        },
        "recovery": {
            "count": sum(not a and b for a, b in zip(cc, cc[1:])),
            "opportunities": len(cc[:-1]) - sum(cc[:-1]),
        },
    }


def loss_bounds(episode, history):
    """Exact feasible bounds for this scheduled length, conditional on committed history."""
    if episode["track"] != "A":
        raise ValueError("Oracle loss applies only to Track A")
    state, accrued = 0, F(0)
    for i, pair in enumerate(history):
        action = pair[episode["subjectSeat"]]
        accrued += episode_oracle(episode, i).gap(state, action)
        state = transition(episode["policy"], state, action)
    lows = highs = [F(0)] * states(episode["policy"])
    for i in reversed(range(len(history), episode["rounds"])):
        ref = episode_oracle(episode, i)
        lows = [
            min(ref.gap(s, a) + lows[transition(episode["policy"], s, a)] for a in ACTIONS)
            for s in range(len(lows))
        ]
        highs = [
            max(ref.gap(s, a) + highs[transition(episode["policy"], s, a)] for a in ACTIONS)
            for s in range(len(highs))
        ]
    return [float((accrued + bound[state]) * weight(episode)) for bound in (lows, highs)]
