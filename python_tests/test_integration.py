import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from gamefield_research.artifacts import export_mlflow, export_run, verify_export
from gamefield_research.design import make_plan
from gamefield_research.engineering import check_provider
from gamefield_research.readiness import deployment_template, verify_deployment
from gamefield_research.runner import run
from test_gateway import PRICES, mock_response


async def test_inspect_end_to_end_and_export(tmp_path):
    plan = make_plan("integration", 4, "engineering")
    directory = tmp_path / "run"
    await run(plan, directory, PRICES, transport=mock_response)
    assert list((directory / "inspect").glob("*.eval"))
    report = export_run(directory, tmp_path / "export")
    assert report["completed"] == 296
    assert report["scientificObservations"] == 0
    assert report["sourceSha256"]
    assert (tmp_path / "export/source.tar.gz").is_file()
    assert verify_export(tmp_path / "export") == report
    with pytest.raises(FileExistsError):
        await run(plan, directory, PRICES, transport=mock_response)

    class Client:
        def __init__(self):
            self.runs = []

        def get_experiment_by_name(self, name):
            return SimpleNamespace(experiment_id="1")

        def search_runs(self, ids, filter):
            return self.runs

        def create_run(self, eid, tags):
            run = SimpleNamespace(info=SimpleNamespace(run_id="one"))
            self.runs.append(run)
            return run

        def log_param(self, *args):
            pass

        def log_metric(self, *args):
            pass

        def log_artifact(self, *args):
            pass

        def set_terminated(self, *args, **kwargs):
            pass

    client = Client()
    first = export_mlflow(tmp_path / "export", "file:test", "study", client)
    second = export_mlflow(tmp_path / "export", "file:test", "study", client)
    assert first == second and len(client.runs) == 1

    # Exercise the optional integration against a real local SQLite MLflow store.
    pytest.importorskip("mlflow")
    real_uri = "sqlite:///" + str(tmp_path / "tracking.sqlite")
    real_first = export_mlflow(tmp_path / "export", real_uri, "cooperation-test")
    real_second = export_mlflow(tmp_path / "export", real_uri, "cooperation-test")
    assert real_first == real_second


async def test_full_engineering_bank_synthetic(tmp_path):
    bank = json.loads(Path("fixtures/engineering-bank.json").read_text())
    report = await check_provider(
        make_plan("check", 4, "engineering"),
        bank,
        tmp_path / "engineering",
        PRICES,
        Path.cwd(),
        mock_response,
    )
    assert report["passed"]
    assert report["bankCompleted"] == 142
    assert report["execution"] == "synthetic"


def test_readiness_template_fails_closed():
    plan = make_plan("gates", 4)
    record = deployment_template(plan, Path.cwd())
    errors, _ = verify_deployment(plan, record, Path.cwd())
    assert record["profile"] is None and record["projectId"] is None
    assert "Explicit cloud profile missing" in errors
    assert "Explicit cloud project missing" in errors
    assert "Container image digest missing" in errors
    assert "Passing hosted engineering report for this source missing" in errors
    assert "Reviewed plan-bound budget receipt missing" in errors
