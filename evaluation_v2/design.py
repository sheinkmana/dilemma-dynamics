"""Offline, immutable preparation for a joint two-temperature evaluation."""

import hashlib
import importlib.metadata
import json
import secrets
import sys
import tarfile
from copy import deepcopy
from pathlib import Path

from gamefield_research.artifacts import hash_file, source_index
from gamefield_research.design import ARMS, digest, make_plan, write_json
from gamefield_research.engineering import check_manifest
from gamefield_research.local import runtime_record
from gamefield_research.recovery import OVERLOAD_POLICY

ROOT = Path(__file__).resolve().parents[1]
VERSION = "dilemma-final/3"
CANDIDATES = (24, 32, 48)
ALLOCATION = {"engineering": "2", "final": "34", "otherReserve": "2", "contingency": "2"}


def read(path):
    return json.loads(Path(path).read_text())


def indexed_source():
    files = source_index(ROOT)
    for folder in ("evaluation_v2",):
        for p in sorted((ROOT / folder).glob("*.py")):
            files[str(p.relative_to(ROOT))] = hash_file(p)
    files["docs/FINAL_EVALUATION_V2.md"] = hash_file(ROOT / "docs/FINAL_EVALUATION_V2.md")
    return dict(sorted(files.items()))


def joint_episodes(seed, blocks):
    """Adjacent matched temperature pairs, order randomised once before outcomes."""
    base = make_plan(seed, blocks)
    result = []
    for e in base["episodes"]:
        temperatures = (
            (0, 1) if int(digest([seed, e["id"], "temperature-order"])[0], 16) % 2 else (1, 0)
        )
        for temperature in temperatures:
            row = deepcopy(e)
            row.update(
                matchedId=e["id"],
                temperature=temperature,
                id=digest([VERSION, e["id"], temperature])[:24],
            )
            result.append(row)
    return result


def engineering_samples(seed):
    bank = read(ROOT / "fixtures/engineering-bank.json")
    base = make_plan(seed + "/engineering", 4, "engineering")
    episodes = check_manifest(base, bank)["interactiveEpisodes"]
    samples = []
    for task in bank["tasks"]:
        for temperature in (0, 1):
            samples.append(
                {
                    "id": f"bank-{temperature}-{task['id']}",
                    "kind": "bank",
                    "temperature": temperature,
                    "task": task,
                }
            )
    for e in episodes:
        for temperature in (0, 1):
            row = {
                **e,
                "id": f"engineering-{temperature}-{e['id']}",
                "matchedId": e["id"],
                "temperature": temperature,
            }
            samples.append(
                {"id": row["id"], "kind": "episode", "episode": row, "temperature": temperature}
            )
    return samples


def make_spec(seed):
    body = {
        "version": VERSION,
        "seed": seed,
        "additionalBudgetUsd": "40",
        "allocationUsd": ALLOCATION,
        "candidateBlocksPerTemperature": list(CANDIDATES),
        "temperatures": [0, 1],
        "arms": ARMS,
        "procedure": {"draftTokens": 1024, "actionTokens": 128, "topP": 1},
        "recoveryPolicy": OVERLOAD_POLICY,
        "clock": {
            "campaignSeconds": 36 * 3600,
            "engineeringSeconds": 2 * 3600,
            "shutdownMarginSeconds": 900,
        },
        "concurrency": {"samples": 4, "requests": 8},
        "analysis": {
            "bootstrapDraws": 50000,
            "primaryFamilySize": 4,
            "primaryMarginalCoverage": 0.9875,
            "secondaryCoverage": 0.95,
            "unit": "whole matched block, stratified by mapping and seat",
            "conditionWeights": "1/16",
            "stratumWeights": "1/4",
            "selection": "largest frozen candidate with engineering cost/time forecast fitting caps; never outcomes",
            "costMargin": 1.5,
            "timeMargin": 1.5,
        },
        "claimScope": "Prospective replication informed by historical exploratory results; approximate uncertainty; hosted API setting effects only.",
        "publicRelease": "Only this complete verified campaign becomes the primary report/app dataset; historical evidence retained and disclosed as development history.",
    }
    return {**body, "sha256": digest(body)}


def prepare(directory, seed=None):
    directory = Path(directory).resolve()
    if directory.exists():
        raise FileExistsError("Preparation exists; preserve its seeds and evidence")
    for package in ("inspect-ai", "mlflow-skinny", "sqlalchemy", "alembic"):
        importlib.metadata.version(package)
    if sys.version_info[:2] != (3, 12):
        raise ValueError("Use the existing Python 3.12 project environment")
    directory.mkdir(parents=True)
    spec = make_spec(seed or "dilemma-final-2026-10-24-" + secrets.token_hex(16))
    write_json(directory / "spec.json", spec)
    write_json(directory / "engineering.json", engineering_samples(spec["seed"]))
    for blocks in CANDIDATES:
        write_json(directory / f"schedule-{blocks}.json", joint_episodes(spec["seed"], blocks))
    # Retain the dated reviewed rate book; live launch refreshes public rates and
    # requires an exact match before starting the campaign clock or paid traffic.
    write_json(directory / "prices.json", read(ROOT / "fixtures/prices-2026-10-20.json"))
    write_json(directory / "runtime.json", runtime_record())
    files = indexed_source()
    with tarfile.open(directory / "source.tar.gz", "x:gz") as archive:
        for name in files:
            archive.add(ROOT / name, arcname=name, recursive=False)
    write_json(directory / "source-index.json", files)
    names = [p for p in directory.iterdir() if p.is_file()]
    write_json(
        directory / "preparation.json",
        {
            "version": VERSION,
            "sourceSha256": digest(files),
            "specSha256": spec["sha256"],
            "files": {p.name: hash_file(p) for p in sorted(names)},
            "inferenceRequests": 0,
            "clockStarted": False,
        },
    )
    return verify(directory)


def verify(directory, check_runtime=True):
    directory = Path(directory).resolve()
    packet = read(directory / "preparation.json")
    for name, sha in packet["files"].items():
        if Path(name).name != name or hash_file(directory / name) != sha:
            raise ValueError("Preparation bytes changed: " + name)
    files = read(directory / "source-index.json")
    if files != indexed_source() or digest(files) != packet["sourceSha256"]:
        raise ValueError("Prepared source changed; preserve this packet and prepare a new identity")
    with tarfile.open(directory / "source.tar.gz") as archive:
        recovered = {
            m.name: hashlib.file_digest(archive.extractfile(m), "sha256").hexdigest()
            for m in archive
            if m.isfile()
        }
    if recovered != files:
        raise ValueError("Source archive does not match its index")
    spec = read(directory / "spec.json")
    if spec != make_spec(spec["seed"]) or spec["sha256"] != packet["specSha256"]:
        raise ValueError("Specification differs from the prospective design")
    if check_runtime and runtime_record() != read(directory / "runtime.json"):
        raise ValueError("Recorded runtime changed; do not sync or uninstall into this environment")
    if read(directory / "engineering.json") != engineering_samples(spec["seed"]):
        raise ValueError("Engineering schedule changed")
    for blocks in CANDIDATES:
        if read(directory / f"schedule-{blocks}.json") != joint_episodes(spec["seed"], blocks):
            raise ValueError("Scientific schedule changed")
    return {
        "verified": True,
        "directory": str(directory),
        "specSha256": spec["sha256"],
        "candidateEpisodes": {str(b): b * 148 for b in CANDIDATES},
        "additionalBudgetUsd": "40",
        "inferenceRequests": 0,
    }
