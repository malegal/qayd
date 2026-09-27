#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${QAYD_CDP_PORT:-9223}"
LOG_FILE="${TMPDIR:-/tmp}/qayd-electron-smoke-${PORT}.log"
USER_DATA_DIR="${TMPDIR:-/tmp}/qayd-electron-smoke-profile-${PORT}"
rm -f "$LOG_FILE"
xvfb-run -a -s '-screen 0 1440x1000x24' node_modules/.bin/electron . --user-data-dir="$USER_DATA_DIR" --remote-debugging-port="$PORT" --remote-allow-origins=* --disable-gpu >"$LOG_FILE" 2>&1 &
ELECTRON_PID=$!
cleanup() { kill "$ELECTRON_PID" 2>/dev/null || true; wait "$ELECTRON_PID" 2>/dev/null || true; }
trap cleanup EXIT
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/json" >/dev/null 2>&1; then break; fi
  sleep .2
done
if ! curl -fsS "http://127.0.0.1:${PORT}/json" >/dev/null 2>&1; then
  cat "$LOG_FILE"
  exit 1
fi
QAYD_CDP_PORT="$PORT" python3 test/electron-smoke.py
