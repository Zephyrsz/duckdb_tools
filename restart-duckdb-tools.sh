#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION="${1:-restart}"
REMOTE_CONFIG="${RDS_STACK_CONFIG:-/app/rds_agent/config/remote-stack.env}"

case "$ACTION" in
  start|stop|restart|status)
    ;;
  help|-h|--help)
    cat <<'EOF'
用法: ./restart-duckdb-tools.sh [start|stop|restart|status]

默认执行 restart，只管理 DuckDB Tools 的 FastAPI 后端和前端。
不会启动、停止或重启 rds_agent、DeepSeek Harness 或 Nginx。
EOF
    exit 0
    ;;
  *)
    echo "错误：不支持的操作：$ACTION" >&2
    echo "用法: ./restart-duckdb-tools.sh [start|stop|restart|status]" >&2
    exit 2
    ;;
esac

# The remote deployment has its own ports, runtime environment, and PID files.
# Fall back to start.sh for local development where the remote stack config is absent.
if [[ -x "$ROOT_DIR/remote-service.sh" && -f "$REMOTE_CONFIG" ]]; then
  exec "$ROOT_DIR/remote-service.sh" "$ACTION"
fi

exec "$ROOT_DIR/start.sh" "$ACTION"
