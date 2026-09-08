#!/usr/bin/env bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${DUCKDB_TOOLS_CONFIG:-$ROOT_DIR/config/workbench.env}"
_cfg_host="${DUCKDB_TOOLS_HOST-}"
_cfg_backend_port="${DUCKDB_TOOLS_BACKEND_PORT-}"
_cfg_frontend_port="${DUCKDB_TOOLS_FRONTEND_PORT-}"
_cfg_data="${DUCKDB_TOOLS_DATA-}"
_cfg_rds_root="${RDS_AGENT_ROOT-}"
_cfg_metadata="${RDS_AGENT_METADATA_DB-}"
if [[ -f "$CONFIG_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
fi
[[ -n "$_cfg_host" ]] && DUCKDB_TOOLS_HOST="$_cfg_host"
[[ -n "$_cfg_backend_port" ]] && DUCKDB_TOOLS_BACKEND_PORT="$_cfg_backend_port"
[[ -n "$_cfg_frontend_port" ]] && DUCKDB_TOOLS_FRONTEND_PORT="$_cfg_frontend_port"
[[ -n "$_cfg_data" ]] && DUCKDB_TOOLS_DATA="$_cfg_data"
[[ -n "$_cfg_rds_root" ]] && RDS_AGENT_ROOT="$_cfg_rds_root"
[[ -n "$_cfg_metadata" ]] && RDS_AGENT_METADATA_DB="$_cfg_metadata"
unset _cfg_host _cfg_backend_port _cfg_frontend_port _cfg_data _cfg_rds_root _cfg_metadata
RUN_DIR="${DUCKDB_TOOLS_RUN_DIR:-$ROOT_DIR/.run}"
LOG_DIR="${DUCKDB_TOOLS_LOG_DIR:-$ROOT_DIR/logs}"
HOST="${DUCKDB_TOOLS_HOST:-0.0.0.0}"
BACKEND_PORT="${DUCKDB_TOOLS_BACKEND_PORT:-8000}"
FRONTEND_PORT="${DUCKDB_TOOLS_FRONTEND_PORT:-5173}"

BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG_FILE="$LOG_DIR/backend.log"
FRONTEND_LOG_FILE="$LOG_DIR/frontend.log"

usage() {
  cat <<'EOF'
用法: ./start.sh {start|stop|restart|status}

命令:
  start    启动 FastAPI 后端和 Vite 前端
  stop     停止由本脚本启动的前后端服务
  restart  重启前后端服务
  status   显示服务状态和日志位置

可选环境变量:
  DUCKDB_TOOLS_HOST           监听地址，默认 0.0.0.0
  DUCKDB_TOOLS_BACKEND_PORT   后端端口，默认 8000
  DUCKDB_TOOLS_FRONTEND_PORT  前端端口，默认 5173
  DUCKDB_TOOLS_RUN_DIR        PID 文件目录，默认 .run
  DUCKDB_TOOLS_LOG_DIR        日志目录，默认 logs
  DUCKDB_TOOLS_CONFIG         统一配置文件，默认 config/workbench.env
EOF
}

ensure_dirs() {
  mkdir -p "$RUN_DIR" "$LOG_DIR"
}

read_pid() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(tr -cd '0-9' < "$pid_file")"
  [[ -n "$pid" ]] || return 1
  printf '%s' "$pid"
}

process_matches() {
  local pid="$1"
  local expected="$2"
  kill -0 "$pid" 2>/dev/null || return 1
  local command
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"$expected"* ]]
}

service_pid() {
  local pid_file="$1"
  local expected="$2"
  local pid
  pid="$(read_pid "$pid_file")" || return 1
  process_matches "$pid" "$expected" || return 1
  printf '%s' "$pid"
}

port_owner() {
  local port="$1"
  command -v lsof >/dev/null 2>&1 || return 1
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1
}

port_ready() {
  local port="$1"
  local owner
  owner="$(port_owner "$port")"
  if [[ -n "$owner" ]]; then
    return 0
  fi
  command -v curl >/dev/null 2>&1 || return 1
  curl -fsS --max-time 1 "http://127.0.0.1:$port/" >/dev/null 2>&1
}

assert_port_free() {
  local name="$1"
  local port="$2"
  local owner
  owner="$(port_owner "$port")"
  if [[ -n "$owner" ]]; then
    printf '错误：%s端口 %s 已被进程 %s 占用。\n' "$name" "$port" "$owner" >&2
    return 1
  fi
}

wait_for_service() {
  local name="$1"
  local pid="$2"
  local port="$3"
  local log_file="$4"
  local attempt
  for attempt in {1..50}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      printf '错误：%s启动失败，最近日志：\n' "$name" >&2
      tail -n 12 "$log_file" 2>/dev/null >&2 || true
      return 1
    fi
    if port_ready "$port"; then
      return 0
    fi
    sleep 0.1
  done
  printf '错误：%s未在端口 %s 上就绪，请查看 %s。\n' "$name" "$port" "$log_file" >&2
  return 1
}

start_service() {
  local name="$1"
  local pid_file="$2"
  local expected="$3"
  local port="$4"
  local log_file="$5"
  local work_dir="$6"
  shift 6

  local current_pid
  if current_pid="$(service_pid "$pid_file" "$expected")"; then
    printf '%s已运行（PID %s，端口 %s）。\n' "$name" "$current_pid" "$port"
    return 0
  fi

  rm -f "$pid_file"
  assert_port_free "$name" "$port" || return 1
  printf '[%s] 启动 %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$name" >> "$log_file"
  (
    cd "$work_dir" || exit 1
    nohup "$@" >> "$log_file" 2>&1 </dev/null &
    printf '%s' "$!" > "$pid_file"
  )

  local pid
  pid="$(read_pid "$pid_file")" || return 1
  if ! wait_for_service "$name" "$pid" "$port" "$log_file"; then
    rm -f "$pid_file"
    return 1
  fi
  printf '%s已启动（PID %s，端口 %s）。\n' "$name" "$pid" "$port"
}

start_all() {
  ensure_dirs

  local uvicorn_bin="$ROOT_DIR/.venv/bin/uvicorn"
  local vite_bin="$ROOT_DIR/frontend/node_modules/.bin/vite"
  if [[ ! -x "$uvicorn_bin" ]]; then
    printf '错误：未找到 %s。请先运行 python3 -m venv .venv && .venv/bin/python -m pip install -r backend/requirements.txt\n' "$uvicorn_bin" >&2
    return 1
  fi
  if [[ ! -x "$vite_bin" ]]; then
    printf '错误：未找到前端依赖。请先运行 cd frontend && npm install\n' >&2
    return 1
  fi

  start_service "后端" "$BACKEND_PID_FILE" "uvicorn backend.app.main:app" "$BACKEND_PORT" "$BACKEND_LOG_FILE" "$ROOT_DIR" \
    "$uvicorn_bin" backend.app.main:app --host "$HOST" --port "$BACKEND_PORT" || return 1

  if ! start_service "前端" "$FRONTEND_PID_FILE" "vite --host" "$FRONTEND_PORT" "$FRONTEND_LOG_FILE" "$ROOT_DIR/frontend" \
    "$vite_bin" --host "$HOST" --port "$FRONTEND_PORT"; then
    stop_service "后端" "$BACKEND_PID_FILE" "uvicorn backend.app.main:app"
    return 1
  fi

  printf '\nAIBase 已启动：\n'
  printf '  前端: http://localhost:%s\n' "$FRONTEND_PORT"
  printf '  API:  http://localhost:%s/api/health\n' "$BACKEND_PORT"
  printf '  日志: %s\n' "$LOG_DIR"
}

stop_service() {
  local name="$1"
  local pid_file="$2"
  local expected="$3"
  local pid

  if ! pid="$(service_pid "$pid_file" "$expected")"; then
    rm -f "$pid_file"
    printf '%s未运行。\n' "$name"
    return 0
  fi

  kill "$pid" 2>/dev/null || true
  local attempt
  for attempt in {1..50}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$pid_file"
      printf '%s已停止。\n' "$name"
      return 0
    fi
    sleep 0.1
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$pid_file"
  printf '%s已强制停止。\n' "$name"
}

stop_all() {
  ensure_dirs
  stop_service "前端" "$FRONTEND_PID_FILE" "vite --host"
  stop_service "后端" "$BACKEND_PID_FILE" "uvicorn backend.app.main:app"
}

status_all() {
  ensure_dirs
  local healthy=0
  local pid

  if pid="$(service_pid "$BACKEND_PID_FILE" "uvicorn backend.app.main:app")"; then
    printf '后端：运行中（PID %s，http://localhost:%s）\n' "$pid" "$BACKEND_PORT"
  else
    rm -f "$BACKEND_PID_FILE"
    printf '后端：未运行\n'
    healthy=1
  fi

  if pid="$(service_pid "$FRONTEND_PID_FILE" "vite --host")"; then
    printf '前端：运行中（PID %s，http://localhost:%s）\n' "$pid" "$FRONTEND_PORT"
  else
    rm -f "$FRONTEND_PID_FILE"
    printf '前端：未运行\n'
    healthy=1
  fi

  printf '日志：%s\n' "$LOG_DIR"
  return "$healthy"
}

case "${1:-}" in
  start)
    start_all
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    start_all
    ;;
  status)
    status_all
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
