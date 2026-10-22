from gamefield_research.analysis import analyse, paired_interval
from gamefield_research.core import episode_oracle, script_action, transition
from gamefield_research.design import make_plan
from gamefield_research.gateway import Ledger, read_events


def test_fixed_stratum_weights_and_minimum_replication():
    estimate, interval = paired_interval([[0] * 5, [1] * 6, [2] * 7, [3] * 8], "test")
    assert estimate == 1.5 and interval == [1.5, 1.5]
    assert paired_interval([[0] * 4, [1] * 6, [2] * 7, [3] * 8], "test")[1] is None


def test_interval_diagnostic_on_seeded_independent_synthetic_blocks():
    import numpy as np

    rng = np.random.default_rng(20261020)
    covered = 0
    for trial in range(100):
        # Known population contrast is zero; presentation strata have unequal variances.
        strata = [rng.normal(0, sd, 6).tolist() for sd in (0.5, 1, 1.5, 2)]
        _, interval = paired_interval(strata, f"diagnostic/{trial}", resamples=2000)
        covered += interval[0] <= 0 <= interval[1]
    # A broad diagnostic catches broken intervals; it does not certify final-study coverage.
    assert 80 <= covered <= 100


def test_other_model_failure_does_not_remove_valid_contrast(tmp_path):
    plan = make_plan("analysis-fixture", 4)
    ledger = Ledger(tmp_path / "events.jsonl", "1")
    ledger.event("run-started", execution="synthetic", planSha256=plan["sha256"])
    for e in plan["episodes"]:
        if e["track"] != "A" or not e["cell"].split("/")[-1].startswith("nano"):
            continue
        state = 0
        for i in range(e["rounds"]):
            a = episode_oracle(e, i).optimal(state)[0]
            pair = [a, script_action(e["policy"], state)]
            if e["subjectSeat"] == 1:
                pair.reverse()
            state = transition(e["policy"], state, a)
            ledger.event("round-revealed", episodeId=e["id"], round=i + 1, actions=pair)
        ledger.event("episode-ended", episodeId=e["id"], status="completed")
    ledger.close()
    report, rows = analyse(plan, read_events(ledger.path))
    assert report["primaryContrasts"][0]["eligibleBlocksByStratum"] == [1] * 4
    assert report["primaryContrasts"][0]["estimate"] == 0
    assert report["primaryContrasts"][0]["scheduledOutcomeBounds"] == [0, 0]
    assert report["primaryContrasts"][1]["eligibleBlocksByStratum"] == [0] * 4
    assert report["scientificObservations"] == 0
    assert len(rows) == 296
