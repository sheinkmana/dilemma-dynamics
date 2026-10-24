"""Restore one byte-preserved runtime input; never overwrite or launch anything."""

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = "d39a12c0ff737067e4727a2cfa8106c73240c9fd0a86195b362f3851f5a5e566"


def restore(root=ROOT):
    root = Path(root)
    source = root / "evaluation_v2/frozen/protocol-2026-10-24.snapshot"
    target = root / "docs/FINAL_EVALUATION_V2.md"
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != EXPECTED:
        raise ValueError("Frozen protocol snapshot changed; preserve and reconcile it")
    if target.exists():
        if target.read_bytes() != data:
            raise ValueError("Existing protocol differs; refusing to overwrite it")
        return "Frozen protocol already matches; no files changed."
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as stream:
        stream.write(data)
    return "Restored the exact frozen protocol. No inference, credentials or clock."


if __name__ == "__main__":
    print(restore())
