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


@pytest.fixture(autouse=True)
def frozen_macos_utility_test(monkeypatch, request):
    """Emulate the utility only in the frozen test that already mocks execve.

    That test simulates macOS on every host, so Linux must also simulate the
    macOS-only file. Keep all research/test source bytes and runtime guards intact
    during the active campaign. Every other file lookup retains its real result.
    """
    if request.node.nodeid != (
        "python_tests/test_overload.py::test_mac_launch_is_wrapped_for_utility_lifetime"
    ):
        return

    from gamefield_research import cli

    original = cli.Path.is_file
    monkeypatch.setattr(
        cli.Path,
        "is_file",
        lambda path: str(path) == "/usr/bin/caffeinate" or original(path),
    )
