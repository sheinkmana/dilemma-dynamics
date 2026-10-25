"""Isolate a frozen legacy test's public-path assumption after the final cutover.

The test source stays byte-preserved. Only its working directory receives a
reconstructed historical plan contract; no old action data enters publication.
"""

import json
from pathlib import Path

import pytest
from gamefield_research.design import make_plan

ROOT = Path(__file__).resolve().parent


@pytest.fixture(autouse=True)
def isolated_legacy_public_contract(request, tmp_path, monkeypatch):
    if (
        request.node.nodeid
        != "python_tests/test_temperature.py::test_completed_design_and_matched_schedule_are_preserved"
    ):
        return
    contract = json.loads((ROOT / "evaluation_v2/frozen/legacy-test-contract.json").read_text())
    plan = make_plan(contract["seed"], contract["blocks"])
    assert plan["sha256"] == contract["planSha256"]
    public = tmp_path / "public/research"
    public.mkdir(parents=True)
    (public / "plan.json").write_text(json.dumps(plan))
    (public / "executed-source-index.json").write_text(
        json.dumps({"python/gamefield_research/design.py": contract["designV1Sha256"]})
    )
    (tmp_path / "python").symlink_to(ROOT / "python", target_is_directory=True)
    monkeypatch.chdir(tmp_path)
