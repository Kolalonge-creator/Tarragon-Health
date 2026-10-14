# P6 coverage: design note (S11-S15 build, plan item R3)

## Reconciled first
- Live (2026-10-13): bp_care_triage v3 approved, v4 draft; 0 triage_events and 0 tasks; the only pathway state in the two-tier schema
  is `patient_memberships` (`private.patient_is_member_at`). There is no care pack or pathway_enrolments table, so OQ-89's
  `care_pack_active` maps to "active Member". `private.weekly_adherence` (S08x) already gives the percentage. Task type
  `adherence_follow_up` already answers `adherence_review` and `silence_check`, deduplicated per patient while open.
- Reused unchanged: the engine and rule sets (no new BP version), S10 bus and `silence.detected` (already registered), S12
  `triage_events`/`triage.graded`, S16 `create_tasks_from_triage_event` (shadow and Free guards), S35 `s35_audit_read`, the task page.

## Data
- `triage_events.context jsonb`: the facts the engine was given (reading, symptoms, cuff type, or the silence/adherence trigger).
  `rule_set_id` is nullable only for the shadow-only symptom bridge (check: no rule set means shadow and code `live_symptom_gate`).
- `triage_coverage_config` (versioned, born `enabled=false`; mirrored as `triage.coverage` with a drift test).
- New event type `adherence.below_line`; subscribers `triage.grade_silence` and `triage.grade_adherence` run handler `triage.grade_coverage`.

## Flow (silence and adherence)
cron `triage-coverage-daily` 06:52 UTC -> `private.sweep_triage_coverage` (off until enabled) -> for active Members with a BP interest
(active hypertension plan, or a reading in 90 days) emits one event per patient per Lagos day, skipping a cause that already has a
triage event (same task key) -> `process-events` runs the SAME pure engine (`makeCoverageHandler`) with `triage_context_for_coverage`
-> `record_coverage_triage_result` (idempotent, shadow if the rule set is not approved, emits `triage.graded`) -> S16 makes one task.
Free patients never reach a context (found=false) and S16 also refuses a Free red/amber. The silence line and adherence line are read
from the rule set (7 days, 80 percent), not hard-coded.

## Symptom-only reports
The engine grades readings; a symptom alone has no rule. Until the CMO signs a rule that grades it, `handle_symptom_red_flag` (not
touched) stays the only thing that pages. An AFTER INSERT trigger on `symptoms` records what that gate decided as a permanently
shadow `triage_events` row (+ shadow `triage.graded`), so the same table and divergence tooling see it. A symptom within 10 minutes
after a BP reading is left to the S12 regrade.

## Screens
Clinician task page: `TriageExplainer` (rule, version, facts, wrist hint) from `clinician_task_triage_explainer` (holder or tied,
one audit row, same answer for "no task" and "not yours"). Summary: triage rows carry rule/version/reading, reading rows carry cuff.
Patient BP/glucose history: folded "What happened with this reading" with the grade in plain words and approved guidance, from
non-shadow results only. All wording through i18n, no condition names, in-app only.

## Safety rules held
INV-01 no model; INV-07 no content in events (ids and a day only); INV-12/10 tied and audited; Free gets no clinician task; no flag
or guard turned on; rewrites made from the LIVE definition with an asserted single replace (record_triage_result, observations view,
clinician_patient_summary), never an old copy.
