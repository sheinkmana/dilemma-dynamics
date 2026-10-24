"""Prepare and verify an additive receipt without inference or a new clock."""

import fcntl
import hashlib
import tarfile
from copy import deepcopy
from decimal import Decimal
from pathlib import Path

from gamefield_research.artifacts import hash_file
from gamefield_research.design import digest
from gamefield_research.gateway import read_events
from gamefield_research.recovery import OVERLOAD_POLICY

from evaluation_v2.design import ROOT, indexed_source, read
from evaluation_v2.design import verify as verify_parent
from evaluation_v2.runner import choose_schedule, engineering_report, exclusive_json

APPROVED_PARENT_SPEC = "047b9a5ab172ffb907781aa4601bce01138c434409d97ca362e98fa4944be4bc"
APPROVED_PARENT_HEAD = "d6cf489f818dd314d856fa475adfdaeba9080a5edee522713d94ccb9166e2753"

POLICY = {
    **deepcopy(OVERLOAD_POLICY),
    "version": "approved-bounded-recovery/2026-10-24",
    "maximumAttempts": 6,
    "decisionSeconds": 1800,
    "overloadCooldownSeconds": 300,
    "sampleWorkers": 2,
    "concurrentRequests": 4,
    "attemptTimeoutSeconds": 600,
}


def source_index():
    return {
        str(p.relative_to(ROOT)): hash_file(p)
        for folder in ("evaluation_recovery", "recovery_tests")
        for p in sorted((ROOT / folder).glob("*.py"))
    }


def prefix_hash(path, size):
    sha = hashlib.sha256()
    with Path(path).open("rb") as stream:
        left = size
        while left:
            part = stream.read(min(left, 1024 * 1024))
            if not part:
                raise ValueError("Original evidence prefix was shortened")
            sha.update(part)
            left -= len(part)
    return sha.hexdigest()


def validate_extension(events, receipt):
    """The old chain is a fixed prefix; only one explicit amendment may follow."""
    count = receipt["parentEventCount"]
    if len(events) < count or events[count - 1]["sha256"] != receipt["parentEvidenceHead"]:
        raise ValueError("The preserved parent evidence head changed")
    markers = [r for r in events[count:] if r["event"] == "recovery-amendment"]
    if len(events) == count:
        return False
    if (
        len(markers) != 1
        or events[count] != markers[0]
        or markers[0].get("amendmentSha256") != receipt["sha256"]
        or markers[0].get("policy") != POLICY
    ):
        raise ValueError("Unreviewed continuation or a different recovery amendment")
    return True


def accounting(events):
    pending = {}
    spent = retry = Decimal(0)
    for row in events:
        if row["event"] == "joint-reservation":
            for key, amount in row["entries"].items():
                pending[key] = Decimal(amount)
                if row["attempts"][key]["number"] > 1:
                    retry += Decimal(amount)
        elif row["event"] == "settled":
            spent += Decimal(row["costUsd"])
            pending.pop(row["key"])
        elif row["event"] == "released-unsent":
            for key in row["entries"]:
                pending.pop(key)
        elif row["event"] == "accounting-overrun":
            raise ValueError("Recorded accounting overrun prevents recovery")
    reserved = sum(pending.values(), Decimal(0))
    if spent + reserved > Decimal("34") or retry > Decimal("0.50"):
        raise ValueError("Original final or retry allocation exhausted")
    return {"spentUsd": str(spent), "reservedUsd": str(reserved), "retryExposureUsd": str(retry)}


def verify(directory, *, check_runtime=True, include_events=False):
    directory = Path(directory).resolve()
    packet = read(directory / "preparation.json")
    for name, sha in packet["files"].items():
        if Path(name).name != name or hash_file(directory / name) != sha:
            raise ValueError("Recovery preparation changed: " + name)
    receipt = read(directory / "amendment.json")
    body = {k: v for k, v in receipt.items() if k != "sha256"}
    if (
        digest(body) != receipt["sha256"]
        or receipt["policy"] != POLICY
        or receipt["parentSpecSha256"] != APPROVED_PARENT_SPEC
        or receipt["parentEvidenceHead"] != APPROVED_PARENT_HEAD
    ):
        raise ValueError("Recovery authority or approved policy changed")
    own_files = read(directory / "source-index.json")
    if own_files != source_index() or digest(own_files) != receipt["amendmentSourceSha256"]:
        raise ValueError("Recovery source changed; preserve this receipt")
    with tarfile.open(directory / "source.tar.gz") as archive:
        recovered = {
            m.name: hashlib.file_digest(archive.extractfile(m), "sha256").hexdigest()
            for m in archive
            if m.isfile()
        }
    if recovered != own_files:
        raise ValueError("Recovery source archive differs from its index")
    parent = Path(receipt["parentDirectory"])
    verify_parent(parent, check_runtime=check_runtime)
    if (
        read(parent / "spec.json")["sha256"] != receipt["parentSpecSha256"]
        or digest(indexed_source()) != receipt["parentSourceSha256"]
        or read(parent / "clock.json") != receipt["campaignClock"]
        or read(parent / "final/clock.json") != receipt["finalClock"]
        or digest(read(parent / "selection.json")) != receipt["selectionSha256"]
        or hash_file(parent / "prices.json") != receipt["pricesSha256"]
    ):
        raise ValueError("Parent identity, schedule, prices or original clock changed")
    ledger = parent / "final/events.jsonl"
    if prefix_hash(ledger, receipt["parentLedgerBytes"]) != receipt["parentLedgerSha256"]:
        raise ValueError("Original canonical evidence bytes changed")
    events = read_events(ledger)
    activated = validate_extension(events, receipt)
    result = {
        "verified": True,
        "amendmentSha256": receipt["sha256"],
        "parentDirectory": str(parent),
        "activated": activated,
        "originalFinalDeadlineUnix": receipt["finalClock"]["deadlineUnix"],
        "additionalBudgetUsd": "0",
        "verificationProviderCalls": 0,
        "accounting": accounting(events),
    }
    if include_events:
        return result, receipt, events
    return result


def prepare(parent, directory):
    parent, directory = Path(parent).resolve(), Path(directory).resolve()
    if directory.exists():
        raise FileExistsError("Recovery preparation exists; never overwrite or renew it")
    verify_parent(parent)
    with (parent / "execution.lock").open("r") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        events = read_events(parent / "final/events.jsonl")
        spec, selection = read(parent / "spec.json"), read(parent / "selection.json")
        if spec["sha256"] != APPROVED_PARENT_SPEC or events[-1]["sha256"] != APPROVED_PARENT_HEAD:
            raise ValueError("This approval belongs to one preserved parent run and stop")
        accounting(events)
        if spec["recoveryPolicy"] != OVERLOAD_POLICY or spec["additionalBudgetUsd"] != "40":
            raise ValueError("This approval is bound to the recorded $40 parent policy")
        if not engineering_report(parent)["passed"] or selection != choose_schedule(
            parent, selection["selectionUnix"]
        ):
            raise ValueError("Original engineering/selection no longer verifies")
        if events[0]["execution"] != "tokenfactory":
            raise ValueError("Hosted authority cannot be attached to synthetic evidence")
        if events[-1]["event"] != "run-ended" or events[-1]["halted"] is None:
            raise ValueError("Require a stopped, incomplete original run")
        if any(r["event"] == "episode-ended" and r["status"] != "completed" for r in events):
            raise ValueError("Cannot regenerate a permanently invalid successful episode")
        if any(r["event"] == "recovery-amendment" for r in events):
            raise ValueError("A recovery identity already owns this parent")
        first = events[0]
        samples = [
            {"id": e["id"], "kind": "episode", "temperature": e["temperature"], "episode": e}
            for e in read(parent / f"schedule-{selection['selectedBlocks']}.json")
        ]
        if (
            first["specSha256"] != spec["sha256"]
            or first["scheduleSha256"] != digest(samples)
            or first["selectionSha256"] != digest(selection)
            or first["capUsd"] != "34"
        ):
            raise ValueError("Parent final identity is not the approved scientific schedule")
        directory.mkdir(parents=True, exist_ok=False)
        files = source_index()
        with tarfile.open(directory / "source.tar.gz", "x:gz") as archive:
            for name in files:
                archive.add(ROOT / name, arcname=name, recursive=False)
        exclusive_json(directory / "source-index.json", files)
        ledger = parent / "final/events.jsonl"
        body = {
            "version": "dilemma-final-recovery/1",
            "authorization": "User approved bounded recovery in chat on 24 October 2026",
            "policy": POLICY,
            "parentDirectory": str(parent),
            "parentSpecSha256": spec["sha256"],
            "parentSourceSha256": read(parent / "preparation.json")["sourceSha256"],
            "amendmentSourceSha256": digest(files),
            "parentEvidenceHead": events[-1]["sha256"],
            "parentEventCount": len(events),
            "parentLedgerBytes": ledger.stat().st_size,
            "parentLedgerSha256": hash_file(ledger),
            "campaignClock": read(parent / "clock.json"),
            "finalClock": read(parent / "final/clock.json"),
            "selectionSha256": digest(selection),
            "pricesSha256": hash_file(parent / "prices.json"),
            "additionalBudgetUsd": "0",
            "campaignCeilingUsd": "40",
            "finalAllocationUsd": "34",
            "retryExposureCeilingUsd": "0.50",
            "preservedCompletedEpisodes": sum(
                r["event"] == "episode-ended" and r["status"] == "completed" for r in events
            ),
            "inheritedSpentUsd": events[-1]["spentUsd"],
            "inheritedReservedUsd": events[-1]["reservedUsd"],
            "inheritedRetryExposureUsd": events[-1]["retryExposureUsd"],
            "publicationGate": "Unchanged: unresolved reservations require explicit reconciliation",
            "scientificChange": "None: same models, prompts, phases, tokens, seed, paired schedule and scoring",
        }
        exclusive_json(directory / "amendment.json", {**body, "sha256": digest(body)})
        exclusive_json(
            directory / "preparation.json",
            {
                "files": {p.name: hash_file(p) for p in sorted(directory.iterdir()) if p.is_file()},
                "inferenceRequests": 0,
                "newClockStarted": False,
            },
        )
    return verify(directory)
