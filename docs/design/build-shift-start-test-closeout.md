# Closeout: shift-start test page (2026-10-16)

Branch `build/shift-start-test-page`. Nothing was applied to production, deployed, signed or switched on.

## Built
- Migration `20261016190204_shift_start_test_page.sql`: `shift_start_test_config` (PROPOSED values, v1 active), `shift_start_tests` (per shift and role: send time, deadline, channel, device, shown and acknowledged latency, escalation), `page_tests.kind` allows `shift_start`, guard `shift_start_test` (born OFF) with its go-live conditions, `private.shift_start_sweep`, `shift_start_gap_kind`, `shift_start_promoted`, reads `my_shift_start_tests` and `shift_start_tests_overview`. Patches from the CURRENT definition (anchor-checked, stop if gone): `private.rota_gaps`, `private.page_recipient`, `private.ops_check_rota_gap_12h` (calls the sweep first), `private.go_live_conditions`.
- App: "Shift-start test page" card and a reviewer table on `/clinician/on-call` (existing search entry extended), `acknowledgeShiftStartTest`, pure `describeShiftTest` (undelivered instructions), schemas and queries, `shift_start_test` in `GUARD_KEYS`.
- Registry `shift_start.test_rules` with a drift test against the migration seed.
- Existing proofs s37 and s36b: guard-count exclusion lists now include the new guard.

## Reused (nothing rebuilt)
page_tests, delivered receipts, `acknowledge_test_page`, `page_notify_ref` and the `on_call_test_page` template (no edge function change), S18 rota and the single `rota_gap:<org>` incident from FU-db (no new alert), the one-minute ops tick (no new cron), go-live guards.

## Tests
- Jest: `apps/web/src/lib/paging` 17 new tests in `shift-start.test.ts` (paging, go-live suites 62 passing); `packages/shared` proposed-config 315 passing (2 new). tsc and ESLint clean for apps/web and packages/shared.
- DB proof `packages/db/tests/shift_start_test_page.sql` registered in `ci.manifest`, with four sabotage rows reading `PASS (caught)`. Run result: see PR description.

## Apply order
1. Merge after required CI is green (merge auto-applies the migration). Check `list_migrations` for anything newer first.
2. No function deploys. No signature needed. Nothing changes until the CMO switches the `shift_start_test` guard on from the go-live page (conditions: values in force, a test page acknowledged recently, CMO switch). Before switching on, have both live clinicians send themselves a test page so the route condition is met.

## Proposed open questions
- OQ: lead 10 minutes, grace 15 minutes, undelivered after 5 minutes: confirm or change (versioned config, new version).
- OQ: should an unconfirmed primary also be removed from the rota automatically after N misses? Not built (reviewers decide).
- OQ: a late-night shift start (22:00 Lagos) sends a test page at 21:50. Acceptable, or exempt overnight starts?

## Unproven
- No real phone, no Critical Alerts entitlement, no pg_cron run: the sweep and ops check were called directly.
- The promoted backup is paged first, but the 5 minute ladder step also targets the backup (same person); the lead alert follows as today.
- The `page_recipient` and `rota_gaps` patches depend on anchors in the live definitions; the migration stops with a clear error if either moved.
