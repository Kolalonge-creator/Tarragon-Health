# Fix: rota_gap_12h alert re-raised on every evaluation

**Bug.** `private.ops_check_rota_gap_12h` built its `dedup_key` from the gap start time. A gap that starts at `now()` moves every run, so `private.ops_evaluate_alerts` never matched the open alert and raised a new sev1 alert, a new `ops_incident` ("Nobody is on call for part of the next 12 hours") and on-call notifications each time (cron `ops-evaluate-alerts`). Live on 2026-10-15: 225 open duplicate incidents since 2026-10-13 21:44 UTC, still growing. The gap itself is real (no on-call rota); only the duplication is the bug.

**Fix** (`supabase/migrations/20261014234345_fix_rota_gap_alert_dedup_key.sql`).
1. The check returns one row per organisation with the stable key `<org_id>:rota_gap`; detail aggregates the gaps (`gap_start` first, `gap_end` last, total `hours`, `gap_count`). Same eligibility filter, signature and ACL (service role only; the migration asserts anon and authenticated cannot execute).
2. Quiet clean-up in the same migration: open `rota_gap_12h` alerts set to `resolved`, open incidents of that title (and `ops_alert:rota_gap_12h:%` reference) set to `resolved` with root cause, corrective and preventive action. `ops_alert_notify` is not called, so no "clear" notices go out. Counts are taken first and asserted in a closing DO block. Other incident titles are untouched.

**After apply.** The next evaluation raises exactly one alert and one incident while the gap persists, then reminds per `renotify_minutes` (60) as designed. Apply promptly: until then each 5-minute run adds one more duplicate (the clean-up count is dynamic, so a late apply is fine).

**Proof.** `packages/db/tests/ops_rota_gap_alert_dedup.sql` (registered in `ci.manifest`): one row with a stable timestamp-free key for a fixture org; two forced evaluations (`ops_evaluate_alerts(true, true)`, include test data and force) leave one open alert and one incident; the clean-up resolves seeded old-style duplicates with no notification and leaves other titles alone; sabotage reinstalls the old timestamped key and the assertion flips.

**Not changed.** The evaluator itself is correct; its dedup relies on a key that is stable per condition. Other checks use stable keys already.
