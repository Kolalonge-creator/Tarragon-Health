# P6 coverage: closeout (2026-10-13)

## Built
- Silence (BP-A5, 7 days under approved v3) and adherence (BP-A4, 80 percent) wired end to end for active Members with a BP interest:
  daily cron `triage-coverage-daily` (06:52 UTC, born OFF via `triage_coverage_config`), S10 events `silence.detected` and new
  `adherence.below_line`, handler `triage.grade_coverage` (same pure engine), `triage_context_for_coverage`,
  `record_coverage_triage_result`. One task per patient while open (S16 dedupe); Free gets none.
- Symptom-only reports: permanent-shadow `triage_events` row + shadow `triage.graded` via an AFTER INSERT trigger on `symptoms`.
  `handle_symptom_red_flag` NOT touched (its proofs re-run clean).
- cuff_type in `observations.context`, the stored triage context and the summary reading rows.
- Clinician explainer on the task page (`clinician_task_triage_explainer`, tied, one audit row) and rule/version/reading on summary
  triage rows. Patient "What happened with this reading" in web BP/glucose history (non-shadow results only).
- Fix found by review: `ageYears` was dropped by `jsonb_strip_nulls`, so a patient with no date of birth was rejected as
  `invalid_input` by BOTH the new and the existing S12 observation path (a red reading would get no grade). `withKnownAge` in both handlers.

## Reused
Engine and rule sets (no new BP version), S10 bus, S12/S16/S19/S35 functions, `patient_is_member_at`, `weekly_adherence`, task type
`adherence_follow_up`, i18n clinical wording by explanation code.

## Tests
- DB proof `p6_triage_coverage.sql`: 58 real checks pass, 2 sabotages flip (registered in ci.manifest). Re-run with the migration in a
  rolled-back live transaction and clean: s12b, s35, s16, s11e, symptom_red_flag_handler. `s12_triage_wiring` fails on two live-data
  assumptions (v1 is retired and v3 approved live) with or without this migration; it passes on a fresh replay.
- Jest: clinical 417 (new 11 + 1 observation), shared proposed-config 130 (mirror test), i18n 81, web 51 in the touched suites. tsc and eslint clean.
- Live checked after every run: no table, cron job, user, incident or event left behind.

## Not proven
No deploy (process-events not redeployed, so the handler never ran inside Deno); no real phone; mobile history not changed (phone
keeps its own offline grade badge); the symptom bridge and the daily job were never run on real Member data (live has 0 Members with BP).

## Order
1. Apply `20261013223020_p6_triage_coverage.sql` (CI does not push migrations; pin version to the filename). 2. Redeploy
`process-events` (new handler key). 3. Later, a human sets `triage_coverage_config.rules.enabled` true (new version row; nothing else turns it on).

## Proposed open questions
- OQ-P6-1: turn the daily sweep on? It creates `adherence_follow_up` tasks for Members (CMO/founder). Born off.
- OQ-P6-2: existing `medicine-adherence-signals-daily` already raises a clinical-rule alert for low adherence; BP-A4 adds a task for the
  same Member (alert plus task). Keep both or let BP-A4 replace the alert for Members with a BP interest?
- OQ-P6-3: a symptom alone has no engine rule; the CMO must sign a rule (new rule set version, not made here) before the bridge can page.
- OQ-P6-4: adherence window comes from `medicine_config.adherence_window_days`, the engine field is named `percent7d`; confirm they stay 7.
- OQ-P6-5: the stored context is re-read when the result is written, not the exact engine input (a symptom landing in that second could differ); acceptable?

## Follow-ups
Mobile history entry; glucose results appear in patient history automatically once P2's rules write non-shadow events; splice
`database.types.ts` (screens use Zod); stale explanation of weekly_adherence config if the window changes.
