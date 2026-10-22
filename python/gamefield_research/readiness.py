"""Explicit launch gates. Missing external evidence never becomes a default approval."""

import json
import os
import re
import sys
from pathlib import Path

from .artifacts import hash_file, source_index
from .budget import forecast
from .design import digest
from .gateway import money


def deployment_template(plan, root):
    files = source_index(root)
    return {
        "schemaVersion": 1,
        "planSha256": plan["sha256"],
        "sourceFiles": files,
        "sourceSha256": digest(files),
        "profile": None,
        "projectId": None,
        "platform": "cpu-d3",
        "preset": "2vcpu-8gb",
        "gpus": 0,
        "restartPolicy": "never",
        "diskGiB": 20,
        "timeoutHours": 2 if plan["purpose"] == "engineering" else 36,
        "image": None,
        "subnetId": None,
        "filesystemId": None,
        "networkEgressVerified": False,
        "storageProbe": None,
        "jobHourlyUsd": None,
        "otherCloudAndRetentionUsd": None,
        "validationCloudUsd": None,
        "ratesVerified": False,
        "pricesFile": None,
        "pricesSha256": None,
        "engineeringReport": None,
        "engineeringReportSha256": None,
        "expectedCompletionHours": None,
        "forecastOriginalInputTokens": None,
        "approvedPlanBoundReceipt": None,
    }


def verify_deployment(plan, deployment, root, purpose="final"):
    errors = []
    from .campaign import authority_path

    authority = authority_path(root)
    if authority.exists():
        try:
            if json.loads(authority.read_text())["mode"] != "cloud":
                errors.append("Campaign is owned by local execution; cloud launch prohibited")
        except (ValueError, KeyError, OSError):
            errors.append("Campaign authority is invalid; explicit reconciliation required")
    files = source_index(root)
    if deployment.get("sourceFiles") != files or deployment.get("sourceSha256") != digest(files):
        errors.append("Source/lock/container/fixtures changed since deployment record")
    if deployment.get("planSha256") != plan["sha256"]:
        errors.append("Deployment is not bound to this plan")
    required = {
        "platform": "cpu-d3",
        "preset": "2vcpu-8gb",
        "gpus": 0,
        "restartPolicy": "never",
    }
    for k, v in required.items():
        if deployment.get(k) != v:
            errors.append(f"Unexpected {k}")
    # Public templates contain no account defaults. The reviewed receipt below
    # binds the explicitly supplied profile and project along with every gate.
    profile = deployment.get("profile")
    if not isinstance(profile, str) or not profile.strip():
        errors.append("Explicit cloud profile missing")
    if not re.fullmatch(r"project-[a-z0-9]+", deployment.get("projectId") or ""):
        errors.append("Explicit cloud project missing")
    if not re.fullmatch(r"[^@\s]+@sha256:[0-9a-f]{64}", deployment.get("image") or ""):
        errors.append("Container image digest missing")
    limit = 36 if purpose == "final" else 2
    timeout = deployment.get("timeoutHours")
    if type(timeout) not in (int, float) or not 1 <= timeout <= limit:
        errors.append("Invalid platform timeout")
    for k in ("subnetId", "filesystemId", "networkEgressVerified", "ratesVerified"):
        if not deployment.get(k):
            errors.append(f"Missing verified {k}")
    if deployment.get("diskGiB") != 20:
        errors.append("Require explicit 20 GiB CPU container disk")
    try:
        cloud = money(deployment["jobHourlyUsd"]) * money(timeout)
        cloud += money(deployment["otherCloudAndRetentionUsd"])
        cloud += money(deployment["validationCloudUsd"])
        if cloud > 8:
            errors.append("Cloud allocation exceeds $8")
    except (ValueError, TypeError, KeyError, ArithmeticError):
        errors.append("Complete Job/storage quote missing")
    prices = None
    try:
        path = Path(deployment["pricesFile"])
        if hash_file(path) != deployment["pricesSha256"]:
            raise ValueError()
        prices = json.loads(path.read_text())["prices"]
    except (ValueError, TypeError, KeyError, OSError):
        errors.append("Price snapshot/hash missing")
    try:
        probe = json.loads(Path(deployment["storageProbe"]).read_text())
        if probe["filesystemId"] != deployment["filesystemId"] or not probe["passed"]:
            raise ValueError()
    except (ValueError, TypeError, KeyError, OSError):
        errors.append("Linux mounted-filesystem probe missing")
    if purpose == "final":
        try:
            path = Path(deployment["engineeringReport"])
            evidence = json.loads(path.read_text())
            if hash_file(path) != deployment["engineeringReportSha256"] or not (
                evidence["execution"] == "tokenfactory"
                and evidence["passed"]
                and evidence["sourceSha256"] == digest(files)
                and money(evidence["spentUsd"]) + money(evidence["reservedUsd"]) <= 1
            ):
                raise ValueError()
        except (ValueError, TypeError, KeyError, OSError):
            errors.append("Passing hosted engineering report for this source missing")
        try:
            hours = float(deployment["expectedCompletionHours"])
            if not 0 < hours <= float(timeout) - 0.25:
                raise ValueError()
            count = int(deployment["forecastOriginalInputTokens"])
            if money(forecast(plan, prices, count)["with25PercentReserveUsd"]) > 18:
                errors.append("Inference forecast exceeds $18")
        except (ValueError, TypeError, KeyError):
            errors.append("Measured throughput/input forecast missing")
    elif prices is not None:
        from .engineering import engineering_forecast

        bank = json.loads((Path(root) / "fixtures/engineering-bank.json").read_text())
        if money(engineering_forecast(plan, bank, prices)["with25PercentReserveUsd"]) > 1:
            errors.append("Engineering forecast exceeds $1; stop for redesign")
    receipt = deployment.get("approvedPlanBoundReceipt")
    unsigned = {k: v for k, v in deployment.items() if k != "approvedPlanBoundReceipt"}
    if (
        not isinstance(receipt, dict)
        or receipt.get("deploymentSha256") != digest(unsigned)
        or (receipt.get("totalCeilingUsd") != "30" or receipt.get("purpose") != purpose)
    ):
        errors.append("Reviewed plan-bound budget receipt missing")
    return errors, prices


def require_remote(root):
    if sys.platform != "linux" or not os.environ.get("NEBIUS_API_KEY"):
        raise ValueError("Paid execution requires Linux and a privately injected NEBIUS_API_KEY")
    if not Path(root).is_absolute() or not os.path.ismount(root):
        raise ValueError("Pass the absolute durable shared-filesystem mount point")
