# End to end journeys (S85, spec D.7)

Four journeys from `docs/BUILD-SPEC-v5.md` D.7.3, a conformance check for the D.7.2 event map, and the shared harness they run on. Design note: `docs/design/S85.md`.

**Read this first.** A journey here is never reported as passing while any of its steps is pending or skipped. Most journeys have pending steps today because the modules behind them are not built (Health Points S58, symptom checker S59/S60, consultation directory S64, institution console S79, PHQ-9 S56, wearables S70, pregnancy S67). A pending step names its owner session and is counted in the report. Nothing in this directory says that a stage or a gate is complete.

## What is where
| Piece | Path | Runs on |
|---|---|---|
| Step model (passed, failed, pending(owner), skipped) | `packages/shared/src/journeys/steps.ts` | Jest, pure |
| The four journeys as typed step lists, with the known pending steps | `packages/shared/src/journeys/journeys.ts` | Jest, pure |
| D.7.2 event map and the expected-gap registry | `packages/shared/src/journeys/event-map.ts` | Jest, reads migrations and `process-events/handlers.ts` |
| Event map against the real bus tables | `packages/db/tests/s85_event_map_conformance.sql` (in `ci.manifest`) | local database, `scripts/run-db-proofs.sh` |
| Journey 3, typed skeleton, every step pending | `packages/shared/src/journeys/journeys.test.ts` | Jest |
| Journey 1 spine, journey 2 full depth, journey 4 privacy | `e2e-browser/journeys/*.spec.ts` | Playwright against the local Supabase stack |
| Harness | `e2e-browser/journeys/harness/` | the same |

## Harness
- `env.ts` refuses a non-local API URL or database URL. Never point a journey at a real project.
- `sql.ts` seeds and observes through `psql` (the CI proof runner's tool). It is a seeding and looking channel only.
- `sessions.ts` creates users with real passwords and signs in with the anon key. **Every access assertion goes through a real signed-in session** (patient, clinician, institution administrator, supporter). Seeding through the service role bypasses row security and proves nothing about access.
- `drain.ts` runs the event bus synchronously, with the dispatcher and handler registry imported from `supabase/functions`, instead of waiting for the 15 second cron. A Jest parity test keeps its RPC calls identical to `process-events/index.ts`. A fetch spy records every host contacted (INV-01).
- `capture.ts` is the notification capture: it reads `public.notifications`, the outbox. The send function is never run and nothing is sent. It also checks INV-07 neutrality over what was actually written.
- `clock.ts` is a deterministic clock for harness waiting. Server time is not faked: where a rule depends on elapsed minutes the journey moves the row's own timestamp through the guarded flag the DB proofs use. The browser clock is left real, because a faked page clock makes the session tokens look expired.
- `oncall.ts` builds a chief medical officer, a primary and a backup on-call clinician and a rota, like the S19 proof.
- `ruleset.ts` reads the triage rule set the database holds and holds the test only approval fixture (below).
- `report.ts` writes `test-results/journeys/<id>.json` and `.txt`, and prints the report.
- Every row is `is_test`. Organisations carry `metadata.s85_test`.

## The rule set: never hard-coded, never signed
`bp_care_triage` on a fresh stack is a draft (approval is the Chief Medical Officer's signature). The journeys read whatever the database holds and compute the expected grade with the engine on the facts the server used.
- Default: the grade is made by the draft and is **shadow** (OQ-88). The queue, page and Care Circle steps are `pending(CMO)` and the journey asserts the shadow behaviour instead (nothing paged, no task).
- `S85_FIXTURE_APPROVE_RULESET=1` lets a **test** chief medical officer approve the newest draft inside the disposable local database through the same RPC a real approval uses, so the downstream pipeline is exercised. It refuses a non-local database and a non test approver. The step `d1-rule-approved` stays `pending(CMO)` in this mode, and the report says "FIXTURE approved".
- A parallel branch drafts a 180/120 trigger version. When that version is approved by the real CMO, `d1-rule-approved` passes by itself and nothing in these files changes.

## Running locally
```bash
# from the repo root; use your own project_id and ports if another stack is running (see docs/LOCAL-DEVELOPMENT.md)
npx supabase start
npx supabase db reset                       # replays migrations and supabase/seed/seed.sql
eval "$(npx supabase status -o env --override-name api.url=NEXT_PUBLIC_SUPABASE_URL --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY)"
export E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres   # your stack's db port
cd apps/web
S85_FIXTURE_APPROVE_RULESET=1 pnpm exec playwright test e2e-browser/journeys
```
Static checks (no stack needed): `pnpm --filter @tarragon/shared test` and `./scripts/run-db-proofs.sh` for the SQL proof.

## Expected-gap registry
`packages/shared/src/journeys/event-map.ts` lists, per D.7.2 event, what is missing today and the owner session. It may only shrink. The day an owner session adds an emitter, a subscriber or an effect, the test fails and says which entry to shrink or delete. The SQL proof carries two matching lists and the Jest test compares them.

## Paystack
Checkout through Paystack test mode is `skipped` with a stated reason unless a test key and a served `order-checkout` function exist. Never put a live key anywhere here.

## Maestro (mobile)
See `apps/mobile/.maestro/README.md`. Maestro flows are not run in CI (they need a macOS runner and a native build); CI lints their YAML. The honest record of what has been run on a simulator is in `docs/BUILD-PROGRESS.md`.
