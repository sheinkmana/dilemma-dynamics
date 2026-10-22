"""Offline local rehearsal. Every response is synthetic; no campaign claims are consumed."""

import argparse
import asyncio
import json
from pathlib import Path

from gamefield_research.artifacts import export_run, hash_file, verify_export
from gamefield_research.design import write_json
from gamefield_research.engineering import check_provider
from gamefield_research.local import read, verify_preparation
from gamefield_research.paths import source_root
from gamefield_research.runner import run


async def mock(body):
    draft = body["chat_template_kwargs"]["enable_thinking"]
    return {
        "model": body["model"],
        "choices": [
            {
                "finish_reason": "length" if draft else "stop",
                "message": {
                    "content": "" if draft else '{"action":"X"}',
                    "reasoning_content": "synthetic private draft" if draft else "",
                },
            }
        ],
        "usage": {"prompt_tokens": 100, "completion_tokens": body["max_tokens"] if draft else 7},
    }


async def rehearse(preparation, output):
    root = source_root()
    preparation = verify_preparation(preparation.resolve(), root)
    output.mkdir(exist_ok=False)
    prices = read(preparation / "prices.json")["prices"]
    engineering = await check_provider(
        read(preparation / "engineering-plan.json"),
        read(root / "fixtures/engineering-bank.json"),
        output / "engineering",
        prices,
        root,
        transport=mock,
    )
    if not engineering["passed"] or engineering["execution"] != "synthetic":
        raise ValueError("Synthetic bank rehearsal failed")
    await run(
        read(preparation / "candidate-4.json"),
        output / "final",
        prices,
        transport=mock,
        source_root=root,
    )
    export_run(output / "final", output / "export")
    report = verify_export(output / "export")
    if report["completed"] != 296 or report["scientificObservations"] != 0:
        raise ValueError("Synthetic derived-plan rehearsal failed")
    result = {
        "passed": True,
        "execution": "synthetic",
        "scientificObservations": 0,
        "engineeringDecisions": engineering["bankCompleted"],
        "engineeringEpisodes": 26,
        "derivedFinalEpisodes": report["completed"],
        "sourceSha256": report["sourceSha256"],
        "driverSha256": hash_file(__file__),
        "liveReadinessEstablished": False,
        "campaignClaimsConsumed": False,
    }
    write_json(output / "rehearsal.json", result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("preparation", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    asyncio.run(rehearse(args.preparation, args.output))
