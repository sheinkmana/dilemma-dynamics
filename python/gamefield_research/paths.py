"""Find reviewable source in a checkout, container or self-contained wheel."""

from pathlib import Path


def source_root():
    checkout = Path(__file__).resolve().parents[2]
    if (checkout / "pyproject.toml").is_file():
        return checkout
    bundled = Path(__file__).parent / "_bundle"
    if not (bundled / "uv.lock").is_file():
        raise ValueError("Install the complete research wheel or run from its source checkout")
    return bundled
