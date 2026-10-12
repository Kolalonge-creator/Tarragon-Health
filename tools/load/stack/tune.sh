#!/usr/bin/env bash
# SR4: make the local database resemble the live project's small tier, so the numbers are less flattering.
# Live (read-only look on 2026-10-10): max_connections 60, shared_buffers about 224 MB. The container is limited to 2 CPUs and 2 GB.
# These are matched settings, NOT the same hardware: Supabase's compute is shared-core ARM in the cloud, this is an M-series laptop.
# Usage: tools/load/stack/tune.sh [name] [cpus] [mem]
set -uo pipefail
NAME="${1:-sr4}"; CPUS="${2:-2}"; MEM="${3:-2g}"
docker exec "$NAME-db" psql -U supabase_admin -d postgres -Atc "alter system set max_connections = 60" >/dev/null
docker exec "$NAME-db" psql -U supabase_admin -d postgres -Atc "alter system set shared_buffers = '224MB'" >/dev/null
docker exec "$NAME-db" psql -U supabase_admin -d postgres -Atc "alter system set track_io_timing = on" >/dev/null
docker update --cpus "$CPUS" --memory "$MEM" --memory-swap "$MEM" "$NAME-db" >/dev/null
docker restart "$NAME-db" >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME-db" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 3
docker exec "$NAME-db" psql -U postgres -Atc "show max_connections; show shared_buffers"
echo "container IP (the socat proxy must point here):"
docker inspect "$NAME-db" | grep '"IPAddress"' | tail -1
