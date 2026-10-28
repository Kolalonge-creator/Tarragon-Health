# Load tooling (W-40)

Two tools, two layers. Neither has been run by the author of this folder (no Docker, no k6 on that machine).

| Tool | Layer | Covers | Does not cover |
| --- | --- | --- | --- |
| `tools/load` (`node tools/load/run.mjs --stage A\|B\|C\|D`) | database, direct SQL | builds the 500 / 5,000 / 25,000 / 100,000 Member populations; red-event paging, reading saves, queue, chart reads; its own safety assertions | HTTP, PostgREST, the app |
| `scripts/load/k6/queue-next.js` | HTTP, PostgREST | `public.queue_next` only: N doctors asking for their next task | red events, pages, reading saves, charts, any Member traffic |

So the k6 stages (A, B, C) are queue-only: they set how many doctors ask at once. The Member count comes from the population `tools/load` generated.

After a run, `scripts/load/verify-safety.sql` checks the database. Its first check is a sanity check only, because the unique index `task_claims_one_live` already forbids two live claims on one task. The real contention measures are the k6 counters `queue_contention_409`, `queue_server_errors`, `second_live_claim` and `teardown_double_claims`. Red-event checks print `NOT EXERCISED` when the run created no red test events, and fail with `-v require_red=1`.

## Where it may point

An allowlist, not a denylist. Accepted: `localhost`, `127.0.0.1`, `host.docker.internal`, or a hosted Supabase project whose ref is listed in `LOAD_TEST_PROJECT_REFS` (comma separated). Refused always: the live Tarragon Health project and `tarragonhealth.ng`. Use a disposable target: the local stack, a branch, or a scratch project.

## Doctor sessions (tokens)

k6 needs one access token per `is_test` doctor, in a JSON file: `[{"jwt": "<access token>"}, ...]`.

- Mint them against the disposable target only. For a local stack, sign in each seeded test doctor with the Auth API (`POST /auth/v1/token?grant_type=password`) and keep the `access_token`. Never use real staff accounts and never a service-role token (the runner refuses `service_role`).
- Lifetime: access tokens last one hour by default. A stage A run is about 8 minutes, stage B about 16 minutes, stage C about 26 minutes plus ramp-down and teardown, so mint fresh tokens for each run. A token that expires mid-run shows up as 401s and fails `http_req_failed`.
- Keep the file outside the repository. If it must live inside, name it `sessions*.json` or `*.jwt` (git-ignored). `scripts/load/run-queue-next.mjs` refuses to start when the file is tracked, or inside the work tree and not ignored.

## Running

```
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_ANON_KEY=...            # the local anon key
node scripts/load/run-queue-next.mjs --sessions /absolute/path/sessions.json --stage A
psql "$LOAD_DB_URL" -v ON_ERROR_STOP=1 -f scripts/load/verify-safety.sql
```

Tests for the guards: `node --test scripts/load/run-queue-next.test.mjs scripts/load/k6/stages.test.mjs`.
