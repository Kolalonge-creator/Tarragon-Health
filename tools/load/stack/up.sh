#!/usr/bin/env bash
# SR4: bring up an isolated, disposable Postgres for load tests and replay every migration into it.
#
# Why not `supabase start`? On the author's machine (2026-10-12) the CLI failed with ECONNRESET against a fresh
# project and ~25 other stacks were already running, so this uses the same plain-container approach the S41-S46
# integration used: the supabase/postgres image, a socat proxy (direct port publishing resets connections with this
# image), a small bootstrap for the auth/storage pieces GoTrue and storage-api would create, then a psql replay.
# It is NOT the CI "Supabase migration replay" job. It is the same migration files, applied in filename order, each
# in its own transaction; failures are listed, not hidden.
#
# Usage: tools/load/stack/up.sh [name] [port] [cpus] [mem]      defaults: sr4 54397 4 4g
# The database is local and disposable: postgresql://postgres:postgres@127.0.0.1:<port>/postgres
set -uo pipefail
NAME="${1:-sr4}"; PORT="${2:-54397}"; CPUS="${3:-4}"; MEM="${4:-4g}"
IMAGE="public.ecr.aws/supabase/postgres:17.6.1.167"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export PGPASSWORD=postgres PGSSLMODE=disable

if [ "${SKIP_CONTAINER:-}" != 1 ]; then
docker rm -f "$NAME-db" "$NAME-px" >/dev/null 2>&1
docker run -d --name "$NAME-db" -e POSTGRES_PASSWORD=postgres --cpus "$CPUS" --memory "$MEM" "$IMAGE" >/dev/null || exit 1
for _ in $(seq 1 60); do docker exec "$NAME-db" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 5
docker exec "$NAME-db" psql -U supabase_admin -d postgres -Atc "alter role postgres password 'postgres'; alter role supabase_admin password 'postgres'" >/dev/null
IP="$(docker inspect "$NAME-db" | grep '"IPAddress"' | tail -1 | sed 's/[^0-9.]//g')"
docker run -d --name "$NAME-px" -p "$PORT:5432" alpine/socat TCP-LISTEN:5432,fork,reuseaddr "TCP:$IP:5432" >/dev/null || exit 1
sleep 3
fi
U="postgresql://postgres@127.0.0.1:$PORT/postgres"
docker exec -i "$NAME-db" psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 < "$ROOT/tools/load/stack/bootstrap.sql" || exit 1

fail=0; n=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  n=$((n + 1))
  out="$(psql "$U" -X -q -1 -v ON_ERROR_STOP=1 -f "$f" 2>&1)" || { fail=$((fail + 1)); echo "REPLAY FAIL $(basename "$f") :: $(echo "$out" | grep -m1 -i error)"; }
done
echo "replay: $n files, $fail failed"
if [ -f "$ROOT/supabase/seed/seed.sql" ]; then psql "$U" -X -q -f "$ROOT/supabase/seed/seed.sql" >/dev/null 2>&1 && echo "seed applied" || echo "seed had errors (continuing)"; fi
echo "ready: $U"
