#!/usr/bin/env bash
set -euo pipefail
CONFIG_FILE="${RDS_STACK_CONFIG:-/app/rds_agent/config/remote-stack.env}"
[[ -f "$CONFIG_FILE" ]] || { echo "missing config: $CONFIG_FILE" >&2; exit 1; }
set -a; source "$CONFIG_FILE"; set +a
RUN_DIR="$DUCKDB_TOOLS_ROOT/.run/remote"; LOG_DIR="$DUCKDB_TOOLS_ROOT/logs/remote"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"; FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.log"; FRONTEND_LOG="$LOG_DIR/frontend.log"
FRONTEND_BIN="$DUCKDB_TOOLS_ROOT/frontend/node_modules/.bin/vite"
mkdir -p "$RUN_DIR" "$LOG_DIR" "$DUCKDB_TOOLS_DATA"
pid_alive(){ local f="$1" p; [[ -f "$f" ]] || return 1; p="$(tr -cd '0-9' < "$f")"; [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; }
port_free(){ ! ss -ltn | awk '{print $4}' | grep -qE ":${1}$"; }
wait_url(){ local u="$1" p="$2"; for _ in {1..80}; do kill -0 "$p" 2>/dev/null || return 1; curl -fsS --max-time 1 "$u" >/dev/null 2>&1 && return 0; sleep 0.25; done; return 1; }
setup(){ "$RDS_AGENT_PYTHON" -m pip install -r "$DUCKDB_TOOLS_ROOT/backend/requirements.txt"; npm ci --prefix "$DUCKDB_TOOLS_ROOT/frontend"; }
initialize_storage(){ cd "$DUCKDB_TOOLS_ROOT"; "$RDS_AGENT_PYTHON" - <<'PY_INIT'
from backend.app.main import connect_db

connection = connect_db()
connection.close()
PY_INIT
}
start_backend(){ if pid_alive "$BACKEND_PID_FILE"; then echo "backend already running (PID $(cat "$BACKEND_PID_FILE"))"; return; fi; port_free "$DUCKDB_TOOLS_BACKEND_PORT" || { echo "backend port busy" >&2; exit 1; }; cd "$DUCKDB_TOOLS_ROOT"; nohup setsid "$RDS_AGENT_PYTHON" -m uvicorn backend.app.main:app --host "$DUCKDB_TOOLS_HOST" --port "$DUCKDB_TOOLS_BACKEND_PORT" >"$BACKEND_LOG" 2>&1 </dev/null & echo "$!" > "$BACKEND_PID_FILE"; wait_url "http://127.0.0.1:$DUCKDB_TOOLS_BACKEND_PORT/api/health" "$!" || { tail -n 40 "$BACKEND_LOG" >&2 || true; exit 1; }; echo "backend started on $DUCKDB_TOOLS_BACKEND_PORT"; }
start_frontend(){ if pid_alive "$FRONTEND_PID_FILE"; then echo "frontend already running (PID $(cat "$FRONTEND_PID_FILE"))"; return; fi; [[ -x "$FRONTEND_BIN" ]] || { echo "frontend dependencies missing; run $0 setup" >&2; exit 1; }; port_free "$DUCKDB_TOOLS_FRONTEND_PORT" || { echo "frontend port busy" >&2; exit 1; }; cd "$DUCKDB_TOOLS_ROOT/frontend"; nohup setsid "$FRONTEND_BIN" --host "$DUCKDB_TOOLS_HOST" --port "$DUCKDB_TOOLS_FRONTEND_PORT" --strictPort >"$FRONTEND_LOG" 2>&1 </dev/null & echo "$!" > "$FRONTEND_PID_FILE"; wait_url "http://127.0.0.1:$DUCKDB_TOOLS_FRONTEND_PORT/" "$!" || { tail -n 40 "$FRONTEND_LOG" >&2 || true; exit 1; }; echo "frontend started on $DUCKDB_TOOLS_FRONTEND_PORT"; }
stop_one(){ local n="$1" f="$2" p; if ! pid_alive "$f"; then rm -f "$f"; echo "$n is not running"; return; fi; p="$(cat "$f")"; kill -- "-$p" 2>/dev/null || kill "$p" 2>/dev/null || true; for _ in {1..40}; do kill -0 "$p" 2>/dev/null || break; sleep 0.25; done; rm -f "$f"; echo "$n stopped"; }
status(){ if pid_alive "$BACKEND_PID_FILE"; then echo "backend: running PID $(cat "$BACKEND_PID_FILE") port $DUCKDB_TOOLS_BACKEND_PORT"; else echo "backend: stopped"; fi; if pid_alive "$FRONTEND_PID_FILE"; then echo "frontend: running PID $(cat "$FRONTEND_PID_FILE") port $DUCKDB_TOOLS_FRONTEND_PORT"; else echo "frontend: stopped"; fi; echo "duckdb: $DUCKDB_TOOLS_DATABASE"; echo "metadata: $RDS_AGENT_METADATA_DB"; }
case "${1:-}" in setup) setup;; start) initialize_storage; start_backend; start_frontend; status;; stop) stop_one frontend "$FRONTEND_PID_FILE"; stop_one backend "$BACKEND_PID_FILE";; restart) "$0" stop; "$0" start;; status) status;; logs) tail -n 80 "$BACKEND_LOG" "$FRONTEND_LOG";; *) echo "usage: $0 {setup|start|stop|restart|status|logs}" >&2; exit 2;; esac
