#!/usr/bin/env bash
set -euo pipefail

# Local loopback bridge for Harness settings. The remote service remains bound
# to 127.0.0.1; only this user's local browser can reach the tunnel.
REMOTE_USER="${HARNESS_SSH_USER:-ubuntu}"
REMOTE_HOST="${HARNESS_SSH_HOST:-54.70.213.240}"
REMOTE_PORT="${HARNESS_REMOTE_PORT:-3090}"
LOCAL_PORT="${HARNESS_LOCAL_PORT:-3091}"
SSH_KEY="${HARNESS_SSH_KEY:-$HOME/pj/pj_agent/aws_oregon_server/rgwei-aws.pem}"
PID_FILE="${HARNESS_TUNNEL_PID_FILE:-${TMPDIR:-/tmp}/rds-harness-tunnel-${LOCAL_PORT}.pid}"
LOG_FILE="${HARNESS_TUNNEL_LOG_FILE:-${TMPDIR:-/tmp}/rds-harness-tunnel-${LOCAL_PORT}.log}"

ssh_args=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes)
remote_target="${REMOTE_USER}@${REMOTE_HOST}"

pid_alive() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(tr -cd '0-9' < "$PID_FILE")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

fetch_token() {
  local remote_url
  remote_url="$(ssh "${ssh_args[@]}" "$remote_target" \
    "grep -Eo 'http://127\\.0\\.0\\.1:${REMOTE_PORT}/\\?token=[^[:space:]]+' /app/rds_agent/logs/remote/harness.log | tail -1" \
    2>/dev/null || true)"
  [[ -n "$remote_url" ]] || return 0
  printf '%s\n' "${remote_url/http:\/\/127.0.0.1:${REMOTE_PORT}/http://127.0.0.1:${LOCAL_PORT}}"
}

start() {
  if pid_alive; then
    echo "Harness tunnel already running (PID $(cat "$PID_FILE"))"
    echo "Open: http://127.0.0.1:${LOCAL_PORT}/"
    return 0
  fi
  [[ -r "$SSH_KEY" ]] || { echo "SSH key is not readable: $SSH_KEY" >&2; exit 1; }
  rm -f "$PID_FILE"
  ssh "${ssh_args[@]}" -N -T \
    -L "${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
    "$remote_target" >"$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"
  for _ in {1..20}; do
    pid_alive || { cat "$LOG_FILE" >&2 || true; rm -f "$PID_FILE"; exit 1; }
    if ssh "${ssh_args[@]}" -O check "$remote_target" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
  echo "Harness tunnel: http://127.0.0.1:${LOCAL_PORT}/"
  local token_url
  token_url="$(fetch_token)"
  if [[ -n "$token_url" ]]; then
    echo "Settings URL:   $token_url"
  else
    echo "Settings URL:   token not found; inspect $LOG_FILE or restart Harness"
  fi
}

stop() {
  if ! pid_alive; then
    rm -f "$PID_FILE"
    echo "Harness tunnel is not running"
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true
  for _ in {1..20}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  rm -f "$PID_FILE"
  echo "Harness tunnel stopped"
}

status() {
  if pid_alive; then
    echo "Harness tunnel: running PID $(cat "$PID_FILE")"
    echo "URL: http://127.0.0.1:${LOCAL_PORT}/"
  else
    echo "Harness tunnel: stopped"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  *) echo "usage: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
