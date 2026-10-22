import json
from fractions import Fraction as F
from itertools import product
from pathlib import Path

import pytest
from gamefield_research.core import episode_oracle, loss_bounds, metrics, oracle, reward
from gamefield_research.design import (
    JSON_INSTRUCTION,
    action,
    continues,
    make_plan,
    observation,
    token,
    validate_plan,
)
from hypothesis import given
from hypothesis import strategies as st

FIXTURES = json.loads(Path("fixtures/typescript-parity.json").read_text())


@pytest.mark.parametrize("fixture", FIXTURES["refs"])
def test_exact_typescript_oracle_parity(fixture):
    h = fixture["horizon"]
    result = oracle(fixture["policy"], h["kind"], h.get("delta", h.get("rounds")))
    assert result.values == tuple(map(F, fixture["values"]))
    assert result.q == tuple({a: F(v) for a, v in row.items()} for row in fixture["q"])


@pytest.mark.parametrize("fixture", FIXTURES["stopping"])
def test_stopping_parity(fixture):
    assert [continues(fixture["seed"], i + 1, fixture["delta"]) for i in range(80)] == fixture[
        "draws"
    ]


@pytest.mark.parametrize("fixture", FIXTURES["prompts"])
def test_prompt_parity_except_declared_json_format(fixture):
    players = ["nano-direct", fixture["policy"]]
    if fixture["seat"]:
        players.reverse()
    e = {
        "players": players,
        "mapping": fixture["mapping"],
        "rounds": 10,
        "horizon": {"kind": "fixed", "rounds": 10},
    }
    actual = observation(e, fixture["history"], fixture["seat"])
    expected = fixture["messages"]
    assert actual[0]["content"] == expected[0]["content"].replace(
        "Return exactly one line: ACTION: X or ACTION: Y. No other text.", JSON_INSTRUCTION
    )
    assert json.loads(actual[1]["content"]) == json.loads(expected[1]["content"])


def test_final_design_counts_and_tamper_rejection():
    plan = make_plan("fixed-final-seed")
    assert len(plan["episodes"]) == 1776
    assert sum(e["track"] == "A" for e in plan["episodes"]) == 1536
    assert {s: sum(e["stratum"] == s for e in plan["episodes"]) for s in range(4)} == {
        s: 444 for s in range(4)
    }
    validate_plan(plan)
    plan["episodes"][0]["rounds"] += 1
    with pytest.raises(ValueError):
        validate_plan(plan)


@given(st.sampled_from(["C", "D"]), st.sampled_from(["X=C", "X=D"]))
def test_label_round_trip(a, mapping):
    assert action(token(a, mapping), mapping) == a


def test_finite_oracle_and_thresholds():
    for policy in ("tft", "grim"):
        assert oracle(policy, "fixed", 10).values[0] == 32
    assert oracle("grim", "geometric", "1/2").optimal(0) == ["C", "D"]
    assert oracle("tft", "geometric", "3/5").optimal(0) == ["D"]
    assert oracle("tft", "geometric", "9/10").optimal(0) == ["C"]


def test_missing_bounds_match_exhaustive_paths():
    from gamefield_research.core import script_action, transition

    e = {
        "track": "A",
        "policy": "tft",
        "subjectSeat": 0,
        "rounds": 4,
        "horizon": {"kind": "geometric", "delta": "3/5"},
    }
    values = []
    for path in product("CD", repeat=4):
        state, history = 0, []
        for a in path:
            history.append([a, script_action("tft", state)])
            state = transition("tft", state, a)
        values.append(metrics(e, history, True)["normalisedOracleLoss"])
    assert loss_bounds(e, []) == [min(values), max(values)]
    # No second discount of realised geometric gaps.
    assert episode_oracle(e).gap(0, "C") > 0
    assert reward("D", "C") == 5
