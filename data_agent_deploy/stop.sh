#!/bin/bash
set -euo pipefail
DEPLOY_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEPLOY_ROOT"
exec .venv/bin/python scripts/manage.py stop "${1:-all}"
