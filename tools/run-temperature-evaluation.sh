#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 1 ]; then
  echo 'Usage: run-temperature-evaluation.sh ABSOLUTE_PREPARATION_DIRECTORY' >&2
  exit 2
fi
cd "$(dirname "$0")/.."
exec .venv/bin/python -m gamefield_research.cli launch-temperature "$1"
