# Design: shift-start test page (2026-10-16)

Branch `build/shift-start-test-page`. Research: `docs/research/build-shift-start-test.md`. Migration `20261016190204_shift_start_test_page.sql`. Proof `packages/db/tests/shift_start_test_page.sql`.

## 1. What and why
A rota shift counts as covered only when the on-call primary and backup have shown, shortly before the shift, that a page really reaches them. Today a clinician is put on the rota after a self-attested checklist and (optionally) an acknowledged test page in the last N days (S19b, S19c P9). That proves the phone worked last week, not at the start of this shift.

## 2. Flow
1. A guard `shift_start_test` (go-live guards, born OFF) gates everything. While off nothing is sent and `rota_gaps` and `page_recipient` behave exactly as before.
2. The existing one-minute ops tick (`ops_check_rota_gap_12h`, FU-db) now calls `private.shift_start_sweep()` first. No new cron job, no new per-minute load beyond one guard lookup when off.
3. Send: for every uncancelled `on_call_rota` row that starts within `lead_minutes` (or started less than `late_send_minutes` ago) the sweep creates, per person (primary, backup), a `page_tests` row of kind `shift_start` and a `shift_start_tests` record, and sends the existing `on_call_test_page` notice through `page_notify_ref` (push including critical priority, in-app, email; SMS and voice are impossible, trigger `no_sms_for_pages`). Wording is the existing fixed template "This is a test page. Nothing is wrong." with the page id only (INV-07). Deadline is `max(start, now) + grace_minutes`.
4. Acknowledge: on `/clinician/on-call` a "Shift-start test page" card shows each pending test with "I received the test page". It is the existing `acknowledge_test_page`: the page must first have been shown on a device, via the service worker, or on this screen (`TestPageReceipt` records an in-app receipt). A trigger copies the first receipt's channel and device, the shown latency and the acknowledgement latency into `shift_start_tests`.
5. Not covered: after the deadline, an unacknowledged test makes `private.rota_gaps` return a gap for the whole shift (`primary_unconfirmed`, `backup_unconfirmed` or `start_test_failed`). That feeds the single S18 incident `rota_gap:<org>` (FU-db), the intake gate and the `on_call_cover_ok` guard, with no new alert. The sweep escalates each missed row once: the reviewers (admins and the Chief Medical Officer) get one in-app notice (email copy through the credential notice), and if the primary missed while the backup confirmed, the backup is told it is first on call. The incident is refreshed at once.
6. Promotion: `page_recipient` returns the backup first when the primary missed and the backup confirmed. The inserted clause is placed before the old logic, so nothing changes otherwise. If nobody is confirmed, the old order (primary, then backup) stands: a red event is never made worse (INV-05).
7. Recovery: a late acknowledgement flips the shift to covered immediately and the incident resolves in the same transaction.
8. Failure visible: `my_shift_start_tests` returns `undelivered` when no receipt exists `undelivered_after_minutes` after sending. The card then shows plain instructions (notifications, battery saving, data, check email, still try the button if the page shows on this screen, phone the clinical lead).

## 3. Data
- `shift_start_test_config` (version, rules; PROPOSED, owner CMO; mirrored in `packages/shared` as `shift_start.test_rules`, drift test). Values: lead 10, grace 15, undelivered 5, late send 3, max per run 20, proof lookback 30 days.
- `shift_start_tests` (one per shift and role; unique (rota_id, role)); written only under the paging write switch; clinician reads own rows, reviewers read the organisation.
- `page_tests.kind` gains `shift_start`.
- Reads: `my_shift_start_tests()`, `shift_start_tests_overview()` (reviewers).

## 4. Safety and invariants
INV-05 red path never held back; INV-06 nothing turns paging off; INV-07 fixed template, no patient data; INV-08 push, in-app, email only; INV-13 `is_test` carried; INV-14 guard born off, CMO switches it; the notice to the clinical lead is in-app (plus email copy); no notification is required for the feature to work (the screen itself records a receipt and can acknowledge).
Disruption control: switching the guard on does not affect a running shift (no test for a shift that started more than `late_send_minutes` ago) and the two live clinicians are unaffected while it is off.

## 5. CMO and console
No signature is needed: the CMO switches the guard on the existing go-live page (conditions: values in force, a recent acknowledged test page proves the route, CMO switch). Values are PROPOSED. The page is the existing `/clinician/on-call`, which already has a search entry; keywords were extended.

## 6. Reuse
page_tests, page_delivered_acks, acknowledge_test_page, page_notify_ref, S18 rota and `rota_gap_alert`, FU-db single incident, S19 `page_recipient`, S19c receipts and `TestPageReceipt`, go-live guards, ops tick. Drills (S20) are untouched: they use kind `drill`.

## 7. Known limits
Not exercised by pg_cron, a real phone or Critical Alerts entitlement (push priority is `critical` as for every page). `page_recipient` promotion pages the backup first; the later 5 minute ladder step also targets the backup (same person), after which the lead is alerted as today.
