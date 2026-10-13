# P1 design: chain canary, chain health, measurement, parity (S11 to S15 end to end)

Reconciled first with: `private.handle_bp_reading_red_flag`, `handle_emergency_event`, `record_triage_result`, `create_tasks_from_triage_event`, `create_red_page`, `sweep_pages`, `private.page_notify`, `acknowledge_page`, `close_page`, `private.apply_task_transition`, `ops_alert_incident`, `event_bus_lag_sweep`, S38 `analytics` schema and `bp_control_report`, S12b `triage_shadow_divergence` (live definitions via `pg_get_functiondef`, 2026-10-13). Extended, nothing rebuilt; no existing function body is changed.

## 1. The canary
Cron `chain-canary` at minutes 11 and 41 (not a round minute, one statement) calls `private.chain_canary_tick()`: evaluate any run old enough (`minEvalAgeSeconds`, default 660), raise `chain_canary:stale` if nothing finished for `staleAfterMinutes`, start the next run unless one is waiting. Evaluating a finished run later (next tick) is exact because every stage is judged from row timestamps against budgets, not from when the check looked.

A run (`private.chain_canary_start`) inserts, for each enabled row of `chain_canary_fixtures`, the red-flag symptom (red fixture) and a manual BP reading for the synthetic patient through the normal tables, so every real trigger fires: the bus event, the legacy alert, the S12 handler (in the deployed `process-events`), S16 tasks, S19 paging. Fixtures are data: `bp_red_chest_pain` (190/125 with chest pain: red, page), `bp_amber_low` (85/55: amber, `amber_bp_review` task, no page), `glucose_red_severe_hypo` (disabled hook for P2: enable the row once the glucose rule set grades through the same bus; the start function already inserts glucose readings).

`private.chain_canary_evaluate` checks per fixture: `graded` (a non-shadow triage event, right grade, in budget), `event_delivered` (the queue and paging deliveries are `done`), `task` (amber), `page` (red: root page to the synthetic clinician, in budget), `notification` and `notification_not_neutral` (critical non-clinical rows exist; payload only `page_id`; `private.notification_text_violations` empty, INV-07), `ack`, `unexpected_page`. A failure writes an append-only `result` row, opens an incident through `ops_alert_incident` (reference `chain_canary:<stage>`, sev1 if a page fixture failed), then clean-up cancels the run's tasks, closes its pages, resolves its legacy alerts and emergencies (errors recorded, never hidden).

## 2. Isolation (why it cannot page a real clinician)
- Own organisation (`organisations.metadata.canary`), synthetic patient (a Member, restored if a sweep ends it), synthetic clinician (`clinical_staff.is_test`, employed SMO) and admin, all `is_test`, none able to log in (`@example.invalid`, no password).
- `notifications_chain_canary_record_only` (BEFORE INSERT): anything pending for a canary profile becomes `suppressed`, so nothing is sent and the critical-escalation sweep skips it.
- Synthetic on-call rota (`is_test`) so a test patient's page routes to the synthetic clinician; auto-acknowledged at commit by a deferred constraint trigger that calls the real `acknowledge_page`, so `sweep_pages` never raises a real `page_unanswered` incident.
- `event_bus_lag_sweep`, `unacknowledged_page`, `rota_gap_12h` already skip test rows, so none of them fires for the canary.

## 3. Chain health and measures
`public.chain_health()` (admin and active CMO; no patient id) returns status ok, attention or down with reasons, last canary runs, per-subscriber backlog and dead letters on the three chain subscribers (real events only), 7-day timings (percentiles only from `minSample`), canary timings, and 30-day parity. Thresholds are `chain_canary_config.rules.health`, mirrored in the registry key `chain.canary_and_health` with a drift test. `public.chain_reliability_report(days)` adds task to claim, act rate, page acknowledgement, push open rate by phone make (cells under the S38 minimum withheld) and credential expiry coverage. `analytics.v_chain_timings` (service role, no identifier, no test row) puts the timings in the S38 analytics schema; facts are read from existing tables (`private.chain_timing_rows`), no new fact table.

## 4. Parity (D1)
`triage_shadow_divergence` reads shadow rows only by design (its S12b proof asserts approved events are not counted), so with v3 approved it is empty; left untouched. `triage_engine_parity` and `triage_engine_parity_cases` compare each graded real BP reading with what the legacy pipeline actually did (an `emergency_events` row, a Priority 1 or review `clinician_alerts` row), shown on the chain health page in five plain groups. Asymptomatic severe BP is expected to show as "old urgent, new not red" (CMO decision Q2). No legacy trigger is retired.

## 5. Screens
`/admin/ops/chain-health` (admin) and `/clinician/chain-health` (active CMO or admin), one shared panel, English only (staff pages), nav entries and search entries for both, a "Run the check now" button (`chain_canary_run_now`, once per 15 minutes). Nothing needs CMO signing (the thresholds are PROPOSED configuration confirmed by publishing registry v2), so no hub line.

## 6. Safety rules honoured
INV-01 no model; INV-07 the canary asserts the page notice is neutral; INV-08 no SMS; INV-12 staff reads unchanged (aggregates only, ids never); INV-13 test rows excluded from every analytics path; nothing here is required for a patient feature to work.
