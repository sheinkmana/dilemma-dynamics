"""Check explicit final-publication authority without altering any scientific guard.

The frozen release check remains authoritative for scientific verification. An
explicit, head/amount-bound user amendment permits only its accounting-review
reason; transmitted reservations stay unresolved in the original ledger.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from evaluation_recovery.__main__ import release_check  # noqa: E402


def check_local_records(scientific_directory, records_directory):
    """Check retained release authority independently of public numeric replay."""
    if not __debug__:
        raise RuntimeError("Publication review requires Python assertions; do not use -O")
    assert not records_directory.resolve().is_relative_to(scientific_directory.resolve())
    summary = json.loads((scientific_directory / "summary.json").read_text())
    accounting = json.loads((records_directory / "accounting.json").read_text())
    receipt = json.loads((records_directory / "publication-review.json").read_text())
    assert summary["complete"] and summary["completed"] == 7104
    assert accounting["finalUsageEstimate"] == summary["spentUsd"]
    assert accounting["unresolvedMaximumExposure"] == summary["reservedUsd"]
    assert not accounting["billingReconciled"] and not accounting["settledLedgerAltered"]
    assert receipt["ready"] and receipt["newInference"] == 0
    assert receipt["evidenceHead"] == summary["evidenceHead"]
    amendment = receipt["accountingAmendment"]
    assert amendment["evidenceHead"] == summary["evidenceHead"]
    assert amendment["unresolvedMaximumExposureUsd"] == summary["reservedUsd"]
    assert amendment["campaignCapUsd"] == accounting["additionalCampaignCap"] == "40"
    assert amendment["approval"] == "Approve disclosed accounting amendment"
    assert amendment["authoritySource"] == "Direct human reply in this Codex chat, 25 October 2026"
    assert amendment["ledgerReservationsRemainUnresolved"] is True
    assert receipt["originalFrozenGate"] == {
        "ready": False,
        "reasons": ["Unresolved final reservations require explicit accounting review"],
    }
    return receipt


def review(directory, authority):
    if not __debug__:
        raise RuntimeError("Publication review requires Python assertions; do not use -O")
    result = release_check(directory)
    amendment = json.loads(authority.read_text())
    parent = json.loads((directory / "amendment.json").read_text())
    export = Path(result["export"])
    summary = json.loads((export / "summary.json").read_text())
    assert summary["complete"] and summary["completed"] == 7104
    assert result["reasons"] == ["Unresolved final reservations require explicit accounting review"]
    assert amendment["evidenceHead"] == summary["evidenceHead"]
    assert amendment["unresolvedMaximumExposureUsd"] == summary["reservedUsd"]
    assert amendment["campaignCapUsd"] == parent["campaignCeilingUsd"] == "40"
    assert amendment["approval"] == "Approve disclosed accounting amendment"
    assert amendment["authoritySource"] == "Direct human reply in this Codex chat, 25 October 2026"
    assert amendment["ledgerReservationsRemainUnresolved"] is True
    return {
        "ready": True,
        "scientificChecks": "Complete hosted campaign, native scored coverage, original and amendment source, canonical reconstruction, final MLflow head and exports verified by unchanged frozen release-check",
        "originalFrozenGate": {"ready": result["ready"], "reasons": result["reasons"]},
        "accountingAmendment": amendment,
        "evidenceHead": summary["evidenceHead"],
        "amendmentSha256": result["amendmentSha256"],
        "newInference": 0,
        "disclosure": "Publication authorised with unresolved maximum billing exposure retained; this does not reconcile billing, clear a reservation or change any scientific check.",
    }


if __name__ == "__main__":
    if sys.argv[1] == "--check-records":
        scientific_directory = Path(sys.argv[2])
        records_directory = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / "output/release-polish/private"
        check_local_records(scientific_directory, records_directory)
        print("Local release authority and unchanged accounting assertions verified.")
        sys.exit(0)
    directory, authority, output = map(Path, sys.argv[1:4])
    if output.resolve().is_relative_to(ROOT / "public"):
        raise ValueError("Release authority records must stay outside the public export")
    receipt = review(directory, authority)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(receipt, indent=2) + "\n")
    print(
        json.dumps(
            {
                "ready": receipt["ready"],
                "evidenceHead": receipt["evidenceHead"],
                "output": str(output),
            }
        )
    )
