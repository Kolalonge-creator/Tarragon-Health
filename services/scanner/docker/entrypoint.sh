#!/usr/bin/env bash
# Starts the three processes of the upload scanner and exits as soon as any one of them stops, so Railway's restart policy
# brings the whole container back rather than leaving an API in front of a dead clamd.
#   1. a one-off signature update (non-fatal: the image carries a baked signature set)
#   2. clamd (foreground, loopback only)
#   3. freshclam as a daemon (re-checks every 2 hours, tells clamd to reload)
#   4. the FastAPI front (uvicorn) on $PORT
set -uo pipefail

echo "scanner: updating signatures"
if ! freshclam --config-file=/etc/clamav/freshclam.conf --stdout; then
  echo "scanner: signature update failed; starting with the signatures already on disk"
fi

if ! ls /var/lib/clamav/*.c[lv]d >/dev/null 2>&1; then
  echo "scanner: no signature database on disk; cannot start clamd" >&2
  exit 1
fi

clamd --config-file=/etc/clamav/clamd.conf &
CLAMD_PID=$!

freshclam --config-file=/etc/clamav/freshclam.conf --daemon --stdout &
FRESHCLAM_PID=$!

uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-server-header &
API_PID=$!

trap 'kill -TERM "$API_PID" "$FRESHCLAM_PID" "$CLAMD_PID" 2>/dev/null' TERM INT

wait -n "$CLAMD_PID" "$FRESHCLAM_PID" "$API_PID"
STATUS=$?
echo "scanner: a process exited (status $STATUS); stopping the container" >&2
kill -TERM "$API_PID" "$FRESHCLAM_PID" "$CLAMD_PID" 2>/dev/null
exit "${STATUS:-1}"
