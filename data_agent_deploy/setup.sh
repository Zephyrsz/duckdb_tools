#!/bin/bash
set -euo pipefail
DEPLOY_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEPLOY_ROOT"
python3 scripts/configure.py
if [ ! -x .venv/bin/python ]; then uv venv .venv --python python3; fi
uv pip install --python .venv/bin/python -r requirements.lock.txt
cd openmuse
corepack pnpm install --frozen-lockfile
