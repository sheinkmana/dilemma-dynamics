"""Exclusive campaign ownership and allocation claims; never cleared on failure."""

import json
import os
import time
from pathlib import Path

from .design import write_json

CAMPAIGN = "final-evaluation-2026-10"


def authority_path(root):
    return Path(root) / "output" / "campaign-authority" / f"{CAMPAIGN}.json"


def claim_route(root, mode, preparation, source_sha256):
    path = authority_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "schemaVersion": 1,
        "campaignId": CAMPAIGN,
        "mode": mode,
        "preparationRoot": str(Path(preparation).resolve()),
        "sourceSha256": source_sha256,
    }
    # Exclusive file creation is intentional, including after a failed preparation.
    write_json(path, record)
    return record


def require_route(root, mode, preparation=None):
    record = json.loads(authority_path(root).read_text())
    if record["mode"] != mode or record["campaignId"] != CAMPAIGN:
        raise ValueError("Campaign is owned by another execution mode; do not launch")
    if preparation is not None and record["preparationRoot"] != str(Path(preparation).resolve()):
        raise ValueError("Campaign is bound to another preparation directory")
    return record


def claim_local_stage(preparation, purpose, plan_sha256):
    preparation = Path(preparation)
    claims = preparation / "claims"
    if purpose == "engineering":
        # A failed/crashed validation cannot reset the campaign clock or allocation.
        now = time.time()
        window = {
            "schemaVersion": 1,
            "startedAtUnix": now,
            "inferenceDeadlineUnix": now + 11 * 3600,
            "windowDeadlineUnix": now + 12 * 3600,
        }
        write_json(claims / "window.json", window)
    else:
        window = json.loads((claims / "window.json").read_text())
    if time.time() >= window["inferenceDeadlineUnix"] - 900:
        raise ValueError("Shared campaign dispatch window has expired")
    record = {
        "schemaVersion": 1,
        "purpose": purpose,
        "planSha256": plan_sha256,
        "pid": os.getpid(),
        "claimedAtUnix": time.time(),
    }
    write_json(claims / f"{purpose}.json", record)
    return window
