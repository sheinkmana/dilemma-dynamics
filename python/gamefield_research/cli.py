"""Inference requires an explicit execution mode and verified deployment gates."""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from .analysis import analyse_file
from .artifacts import bundle, export_mlflow, export_run, verify_export
from .budget import forecast
from .campaign import authority_path, claim_route, require_route
from .design import make_plan, make_temperature_plan, validate_plan, write_json
from .engineering import check_manifest, check_provider, engineering_forecast
from .local import add_local_commands, local_command
from .paths import source_root
from .readiness import deployment_template, require_remote, verify_deployment
from .runner import run
from .successor import add_successor_commands, successor_command
from .temperature_run import add_temperature_commands, temperature_command

ROOT = source_root()


def read(path):
    return json.loads(Path(path).read_text())


def keep_mac_awake(command):
    """Scope the macOS idle-sleep assertion to the user-launched supervisor."""
    if (
        command
        not in (
            "launch-local",
            "launch-successor",
            "launch-temperature",
            "execute-successor",
            "execute-temperature",
            "run-local",
            "check-provider-local",
            "run",
            "check-provider",
        )
        or sys.platform != "darwin"
        or os.environ.get("GAMEFIELD_CAFFEINATED") == "1"
    ):
        return
    executable = "/usr/bin/caffeinate"
    if not Path(executable).is_file():
        raise ValueError("macOS caffeinate is required before launching the experiment")
    environment = {**os.environ, "GAMEFIELD_CAFFEINATED": "1"}
    os.execve(
        executable,
        [executable, "-i", sys.executable, "-m", "gamefield_research.cli", *sys.argv[1:]],
        environment,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    add_local_commands(sub)
    add_successor_commands(sub)
    add_temperature_commands(sub)
    p = sub.add_parser("plan")
    p.add_argument("output", type=Path)
    p.add_argument("--seed", required=True)
    p.add_argument("--blocks", type=int, default=24)
    p.add_argument("--purpose", choices=["final", "engineering"], default="final")
    p.add_argument("--prices", type=Path, default=ROOT / "fixtures/prices-2026-10-20.json")
    p = sub.add_parser("temperature-plan", help="Prepare a matched temperature-zero plan offline")
    p.add_argument("output", type=Path)
    p.add_argument("--reference-plan", type=Path, required=True)
    p.add_argument("--prices", type=Path, default=ROOT / "fixtures/prices-2026-10-20.json")
    p = sub.add_parser("verify")
    p.add_argument("plan", type=Path)
    p.add_argument("--deployment", type=Path)
    for name in ("run", "check-provider"):
        p = sub.add_parser(name)
        p.add_argument("plan", type=Path)
        p.add_argument("--deployment", type=Path, required=True)
        p.add_argument("--durable-mount", type=Path, required=True)
        p.add_argument("--campaign", default="final-evaluation-2026-10")
    p = sub.add_parser("analyse")
    p.add_argument("directory", type=Path)
    p.add_argument("--output", type=Path, required=True)
    p = sub.add_parser("export")
    p.add_argument("directory", type=Path)
    p.add_argument("output", type=Path)
    p = sub.add_parser("export-mlflow")
    p.add_argument("directory", type=Path)
    p.add_argument("--tracking-uri", required=True)
    p.add_argument("--experiment", default="gamefield-cooperation")
    p = sub.add_parser("bundle")
    p.add_argument("output", type=Path)
    p = sub.add_parser("probe-storage")
    p.add_argument("mount", type=Path)
    p.add_argument("--filesystem-id", required=True)
    p.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    keep_mac_awake(args.command)
    if args.command.endswith(("-successor", "-temperature")):
        try:
            result = (
                temperature_command(args, ROOT)
                if args.command.endswith("-temperature")
                else successor_command(args, ROOT)
            )
            print(json.dumps(result, indent=2))
            if args.command in ("execute-successor", "execute-temperature") and (
                (args.stage == "engineering" and not result["passed"])
                or (args.stage == "final" and result["completed"] != result["scheduled"])
            ):
                parser.exit(
                    2, "Stage incomplete; preserve evidence and use supported resume only.\n"
                )
        except (ValueError, OSError, KeyError) as error:
            parser.exit(
                2, json.dumps({"launchable": False, "blockingReasons": [str(error)]}) + "\n"
            )
        except KeyboardInterrupt:
            parser.exit(130, "Interrupted; preserve evaluation clock, claims and checkpoints.\n")
    elif args.command.endswith("-local"):
        try:
            print(json.dumps(local_command(args, ROOT), indent=2))
        except (ValueError, OSError, KeyError) as error:
            parser.exit(
                2, json.dumps({"launchable": False, "blockingReasons": [str(error)]}) + "\n"
            )
        except KeyboardInterrupt:
            parser.exit(
                130, "Interrupted; preserve campaign claims and evidence. No automatic retry.\n"
            )
    elif args.command in ("plan", "temperature-plan"):
        plan = (
            make_temperature_plan(read(args.reference_plan))
            if args.command == "temperature-plan"
            else make_plan(args.seed, args.blocks, args.purpose)
        )
        args.output.mkdir(parents=True, exist_ok=False)
        write_json(args.output / "plan.json", plan)
        bank = read(ROOT / "fixtures/engineering-bank.json")
        prices = read(args.prices)["prices"]
        scenario = (
            engineering_forecast(plan, bank, prices)
            if plan["purpose"] == "engineering"
            else forecast(plan, prices)
        )
        write_json(args.output / "forecast.json", scenario)
        write_json(args.output / "deployment.json", deployment_template(plan, ROOT))
        write_json(
            args.output / "engineering-plan.json",
            check_manifest(plan, read(ROOT / "fixtures/engineering-bank.json")),
        )
        print(json.dumps({"planSha256": plan["sha256"], "launchable": False}))
    elif args.command == "verify":
        plan = validate_plan(read(args.plan))
        errors = []
        if args.deployment:
            errors, _ = verify_deployment(plan, read(args.deployment), ROOT, plan["purpose"])
        print(
            json.dumps(
                {
                    "planValid": True,
                    "launchable": bool(args.deployment) and not errors,
                    "blockingReasons": errors,
                },
                indent=2,
            )
        )
        if errors:
            raise SystemExit(2)
    elif args.command in ("run", "check-provider"):
        plan = validate_plan(read(args.plan))
        purpose = "final" if args.command == "run" else "engineering"
        if plan["purpose"] != purpose:
            parser.error("Plan purpose differs from requested paid command")
        deployment = read(args.deployment)
        errors, prices = verify_deployment(plan, deployment, ROOT, purpose)
        if errors:
            parser.error("; ".join(errors))
        require_remote(args.durable_mount)
        if Path(args.campaign).name != args.campaign or args.campaign in (".", ".."):
            parser.error("Campaign must be a single directory name")
        campaign = args.durable_mount / args.campaign
        campaign.mkdir(exist_ok=True)
        if authority_path(ROOT).exists():
            require_route(ROOT, "cloud", campaign)
        else:
            claim_route(ROOT, "cloud", campaign, deployment["sourceSha256"])
        directory = campaign / ("final" if purpose == "final" else "validation")
        # Fixed allocation directory names prevent spending the same allocation twice.
        if purpose == "engineering":
            print(
                json.dumps(
                    asyncio.run(
                        check_provider(
                            plan,
                            read(ROOT / "fixtures/engineering-bank.json"),
                            directory,
                            prices,
                            ROOT,
                            deployment=deployment,
                        )
                    )
                )
            )
        else:
            asyncio.run(run(plan, directory, prices, deployment=deployment, source_root=ROOT))
            export_run(directory, campaign / "final-export")
    elif args.command == "analyse":
        report, _ = analyse_file(
            read(args.directory / "plan.json"), args.directory / "events.jsonl"
        )
        write_json(args.output, report)
    elif args.command == "export":
        export_run(args.directory, args.output)
        verify_export(args.output)
    elif args.command == "export-mlflow":
        print(json.dumps(export_mlflow(args.directory, args.tracking_uri, args.experiment)))
    elif args.command == "probe-storage":
        from .storage import probe

        probe(args.mount, args.filesystem_id, args.output)
    else:
        print(json.dumps(bundle(ROOT, args.output)))


if __name__ == "__main__":
    main()
