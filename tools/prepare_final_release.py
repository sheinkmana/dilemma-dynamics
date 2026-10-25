"""Prepare a private final-release candidate without inference or public cutover."""

import csv
import gzip
import hashlib
import json
import shutil
import sys
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from statistics import mean

from final_results import ROOT, check_actions, diagnostics
from release_final_results import check_local_records


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def manifest_files(target):
    files = sorted(p for p in target.rglob("*") if p.is_file() and p.name != "manifest.json")
    latex_intermediates = (".aux", ".log", ".fls", ".fdb_latexmk", ".synctex.gz", ".out", ".toc")
    unwanted = [p.relative_to(target).as_posix() for p in files if p.name.endswith(latex_intermediates)]
    if unwanted:
        raise ValueError(
            "Archive LaTeX build intermediates outside the public export before generating "
            "its manifest: " + ", ".join(unwanted)
        )
    return {p.relative_to(target).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}


def prepare(campaign, recovery, target, private_records=None):
    private_records = private_records or ROOT / "output/release-polish/private"
    if private_records.resolve().is_relative_to(target.resolve()) or private_records.resolve().is_relative_to(ROOT / "public"):
        raise ValueError("Local accounting records must stay outside the scientific/public export")
    evidence_head = read(campaign / "tracking-final.json")["evidenceHead"]
    source = campaign / ("export-" + evidence_head[:12])
    summary = read(source / "summary.json")
    assert summary["complete"] and summary["completed"] == 7104
    for name, sha in read(source / "manifest.json").items():
        assert hashlib.sha256((source / name).read_bytes()).hexdigest() == sha
    episodes = read(source / "episodes.json")
    check_actions(episodes)
    target.mkdir(parents=True, exist_ok=False)
    for name in (
        "summary.json",
        "spec.json",
        "arms.csv",
        "conditions.csv",
        "crossplay.csv",
        "contrasts.csv",
        "requests.parquet",
        "decisions.parquet",
    ):
        shutil.copy2(source / name, target / name)
    for name in ("requests.csv", "decisions.csv"):
        # Stable gzip headers; original CSV bytes survive decompression exactly.
        (target / (name + ".gz")).write_bytes(gzip.compress((source / name).read_bytes(), mtime=0))
    for t, path in ((0, "temperature-zero"), (1, "temperature-one")):
        write(target / path / "episodes.json", [e for e in episodes if e["temperature"] == t])
    shutil.copy2(campaign / "schedule-48.json", target / "schedule.json")
    for name in ("selection.json", "prices.json", "source-index.json"):
        shutil.copy2(campaign / name, target / name)
    shutil.copy2(recovery / "source-index.json", target / "recovery-source-index.json")
    amendment = read(recovery / "amendment.json")
    # The signed amendment is private because it contains an absolute local path.
    # Publish its unmodified digest and all scientific/transport fields, explicitly
    # labelled as a redacted projection rather than pretending it hashes itself.
    private_path = amendment.pop("parentDirectory")
    assert private_path == str(campaign.resolve())
    write(target / "recovery-amendment.json", {"redactedProjection": True, **amendment})
    supplement = read(recovery / ("analysis-" + evidence_head[:12] + ".json"))
    supplement.pop("export")
    write(target / "recovery-analysis.json", supplement)
    ds = diagnostics(episodes, summary["specSha256"])
    requests = list(csv.DictReader((source / "requests.csv").open()))
    ds["requestDiagnostics"] = []
    for t in (0, 1):
        for arm in ("nano-direct", "nano-draft", "super-direct", "super-draft"):
            calls = [r for r in requests if int(r["temperature"]) == t and r["arm"] == arm]
            successes = [r for r in calls if r["estimatedUsd"]]
            drafts = [r for r in successes if r["phase"] == "draft"]
            ds["requestDiagnostics"].append(
                {
                    "temperature": t,
                    "arm": arm,
                    "transmitted": len(calls),
                    "successful": len(successes),
                    "uncertainBillingAttempts": len(calls) - len(successes),
                    "successfulDrafts": len(drafts),
                    "cappedDrafts": sum(r["draftCapped"] == "True" for r in drafts),
                    "reportedModels": dict(Counter(r["reportedModel"] for r in successes)),
                    "systemFingerprints": dict(
                        Counter(r["systemFingerprint"] or "not supplied" for r in successes)
                    ),
                }
            )
    ds["autonomousPooled"] = [
        {
            "temperature": t,
            "episodes": 480,
            "rounds": sum(r["rounds"] for r in summary["cooperation"] if r["temperature"] == t),
            "CC": sum(r["CC"] for r in summary["cooperation"] if r["temperature"] == t),
            "episodeWeightedCC": mean(
                e["mutualCooperation"]["count"] / e["rounds"]
                for e in episodes
                if e["temperature"] == t and e["track"] == "B"
            ),
        }
        for t in (0, 1)
    ]
    write(target / "diagnostics.json", ds)
    # Inspect only non-secret metadata and accounting; never publish request bodies.
    pending, sent, ended, before = {}, set(), [], set()
    started = read(campaign / "final/clock.json")["startedUnix"]
    finish = None
    for line in (campaign / "final/events.jsonl").open():
        event = json.loads(line)
        kind = event["event"]
        if kind == "joint-reservation":
            pending.update(event["entries"])
        elif kind in ("settled", "released-unsent"):
            pending.pop(event["key"], None)
        elif kind == "request-sent":
            sent.add(event["key"])
        elif kind == "episode-ended":
            ended.append(event["episodeId"])
        elif kind == "recovery-amendment":
            before = set(ended)
        elif kind == "run-ended" and event["halted"] is None:
            finish = event["atUnix"]
    assert len(ended) == 7104 and len(before) == 3406 and finish
    assert all(k in sent for k in pending)
    assert str(sum(map(Decimal, pending.values()))) == summary["reservedUsd"]
    final_usd = Decimal(summary["spentUsd"])
    eng_events = [json.loads(s) for s in (campaign / "engineering/events.jsonl").open()]
    engineering_usd = Decimal(eng_events[-1]["spentUsd"])
    write(
        private_records / "accounting.json",
        {
            "currency": "USD",
            "basis": "Usage at recorded input/output token rates; estimates, not invoices",
            "finalUsageEstimate": str(final_usd),
            "engineeringUsageEstimate": str(engineering_usd),
            "unresolvedMaximumExposure": summary["reservedUsd"],
            "unresolvedTransmittedAttempts": len(pending),
            "campaignUsageEstimate": str(final_usd + engineering_usd),
            "campaignInferenceMaximumExposure": str(
                final_usd + engineering_usd + Decimal(summary["reservedUsd"])
            ),
            "additionalCampaignCap": "40",
            "nonInferenceReservedAllocation": "4",
            "settledLedgerAltered": False,
            "billingReconciled": False,
            "unresolvedMeaning": "Retained exposure; neither confirmed billed nor confirmed free. No reservation was cleared for publication.",
        },
    )
    # Pre/post comparisons are composition-sensitive, explicitly exploratory.
    ds["transportSegments"] = []
    for t in (0, 1):
        for arm in ("nano-direct", "nano-draft", "super-direct", "super-draft"):
            row = {"temperature": t, "arm": arm}
            for name, predicate in (
                ("original", lambda e: e["id"] in before),
                ("recovery", lambda e: e["id"] not in before),
            ):
                es = [
                    e
                    for e in episodes
                    if e["track"] == "A"
                    and e["temperature"] == t
                    and e["players"][e["subjectSeat"]] == arm
                    and predicate(e)
                ]
                row[name] = {
                    "episodes": len(es),
                    "meanLoss": mean(e["normalisedOracleLoss"] for e in es),
                }
            ds["transportSegments"].append(row)
    write(target / "diagnostics.json", ds)
    write(
        target / "provenance.json",
        {
            "study": "Joint-temperature final evaluation, 24-25 October 2026",
            "specSha256": summary["specSha256"],
            "evidenceHead": evidence_head,
            "parentSourceSha256": summary["sourceSha256"],
            "amendmentSourceSha256": supplement["amendmentSourceSha256"],
            "amendmentSha256": supplement["amendmentSha256"],
            "finalStartedUTC": datetime.fromtimestamp(started, timezone.utc).isoformat(),
            "finalCompletedUTC": datetime.fromtimestamp(finish, timezone.utc).isoformat(),
            "finalElapsedHours": (finish - started) / 3600,
            "preservedEpisodesAtAmendment": len(before),
            "nativeScoredEpisodeCoverage": 7104,
            "nativeCoverageBasis": "Private evidence review by frozen evaluation_recovery release-check; logs and raw responses retained privately",
            "mlflowFinalEvidenceHead": read(campaign / "tracking-final.json")["evidenceHead"],
            "publicReproducibility": "Saved actions, exact scoring, paired schedule, deterministic block bootstrap and numeric telemetry. Public hashes do not independently authenticate private provider evidence.",
            "historicalDevelopmentEpisodesPooled": 0,
        },
    )
    print(f"Prepared private release candidate: {target}")


if __name__ == "__main__":
    if sys.argv[1] == "--manifest":
        target = Path(sys.argv[2])
        private_records = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / "output/release-polish/private"
        check_local_records(target, private_records)
        assert not (target / "accounting.json").exists()
        assert not (target / "publication-review.json").exists()
        write(
            target / "manifest.json",
            {
                "schemaVersion": 2,
                "scope": "Completed joint-temperature evaluation: saved actions, scientific source, exact scoring and numerical telemetry. Private provider evidence and release authority are retained locally and checked separately.",
                "files": manifest_files(target),
            },
        )
        print("Updated complete final-publication manifest.")
    else:
        prepare(*(Path(s) for s in sys.argv[1:5]))
