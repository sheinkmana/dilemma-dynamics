"""Short network-free CPU image rehearsal; all responses are synthetic."""

import asyncio
import json
import tempfile
from pathlib import Path

from gamefield_research.artifacts import export_run, verify_export
from gamefield_research.design import make_plan
from gamefield_research.engineering import check_provider
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


async def main():
    root = Path("/app")
    prices = json.loads((root / "fixtures/prices-2026-10-20.json").read_text())["prices"]
    bank = json.loads((root / "fixtures/engineering-bank.json").read_text())
    plan = make_plan("linux-synthetic-engineering-2026-10-20", 4, "engineering")
    with tempfile.TemporaryDirectory() as directory:
        work = Path(directory)
        check = await check_provider(plan, bank, work / "bank", prices, root, mock)
        assert check["passed"], check
        await run(plan, work / "episodes", prices, mock)
        report = export_run(work / "episodes", work / "export")
        assert verify_export(work / "export") == report
        assert report["completed"] == 296 and report["scientificObservations"] == 0
        print(
            json.dumps(
                {
                    "linuxRehearsalPassed": True,
                    "bankDecisions": check["bankCompleted"],
                    "episodes": report["completed"],
                    "network": "disabled",
                    "scientificObservations": 0,
                    "sourceSha256": report["sourceSha256"],
                }
            )
        )


if __name__ == "__main__":
    asyncio.run(main())
