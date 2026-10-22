"""Short user-run Linux filesystem check; never accesses cloud APIs."""

import fcntl
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from .design import write_json
from .gateway import fsync_directory


def probe(mount, filesystem_id, output):
    mount = Path(mount)
    if sys.platform != "linux" or not os.path.ismount(mount):
        raise ValueError("Probe requires the actual Linux shared-filesystem mount")
    with tempfile.TemporaryDirectory(prefix=".gamefield-probe-", dir=mount) as name:
        directory = Path(name)
        file = directory / "exclusive"
        with file.open("x") as stream:
            stream.write("durability-probe\n")
            stream.flush()
            os.fsync(stream.fileno())
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            code = (
                "import fcntl,sys; f=open(sys.argv[1]);\n"
                "try: fcntl.flock(f, fcntl.LOCK_EX|fcntl.LOCK_NB)\n"
                "except BlockingIOError: sys.exit(0)\n"
                "sys.exit(1)\n"
            )
            subprocess.run([sys.executable, "-c", code, str(file)], check=True, timeout=10)
        try:
            file.open("x").close()
        except FileExistsError:
            pass
        else:
            raise ValueError("Exclusive creation not enforced")
        file.rename(directory / "renamed")
        fsync_directory(directory)
        assert (directory / "renamed").read_text() == "durability-probe\n"
    report = {
        "schemaVersion": 1,
        "filesystemId": filesystem_id,
        "passed": True,
        "platform": sys.platform,
        "mount": str(mount),
        "checks": ["fsync", "exclusive-create", "cross-process-lock", "rename-readback"],
        "limitation": "Functional probe; does not certify provider durability under power loss",
    }
    write_json(output, report)
    print(json.dumps(report))
