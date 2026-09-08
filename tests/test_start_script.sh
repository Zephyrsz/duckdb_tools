#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
START_SCRIPT="$ROOT_DIR/start.sh"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/AIBase-start-test.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT

output=$(DUCKDB_TOOLS_RUN_DIR="$TEST_DIR/run" DUCKDB_TOOLS_LOG_DIR="$TEST_DIR/logs" "$START_SCRIPT" status 2>&1)
status=$?

if [[ $status -ne 1 ]]; then
  printf 'expected status on a stopped workspace to exit 1, got %s\n%s\n' "$status" "$output" >&2
  exit 1
fi
[[ "$output" == *"后端：未运行"* ]] || { printf 'missing backend status\n%s\n' "$output" >&2; exit 1; }
[[ "$output" == *"前端：未运行"* ]] || { printf 'missing frontend status\n%s\n' "$output" >&2; exit 1; }

help_output=$(DUCKDB_TOOLS_RUN_DIR="$TEST_DIR/run" DUCKDB_TOOLS_LOG_DIR="$TEST_DIR/logs" "$START_SCRIPT" help 2>&1)
[[ "$help_output" == *"start|stop|restart|status"* ]] || { printf 'missing command help\n%s\n' "$help_output" >&2; exit 1; }
