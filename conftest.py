"""Host compatibility for byte-frozen research tests; never used by the runner."""

import pytest


@pytest.fixture(autouse=True)
def frozen_macos_utility_test(monkeypatch, request):
    """Emulate the utility only in the frozen test that already mocks execve.

    That test simulates macOS on every host, so Linux must also simulate the
    macOS-only file. Keep all research/test source bytes and runtime guards intact
    during the active campaign. Every other file lookup retains its real result.
    """
    if request.node.nodeid != (
        "python_tests/test_overload.py::test_mac_launch_is_wrapped_for_utility_lifetime"
    ):
        return

    from gamefield_research import cli

    original = cli.Path.is_file
    monkeypatch.setattr(
        cli.Path,
        "is_file",
        lambda path: str(path) == "/usr/bin/caffeinate" or original(path),
    )
