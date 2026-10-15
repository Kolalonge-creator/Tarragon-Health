# S75 track D: outcome measures (HbA1c, weight, PHQ-9, GAD-7) on S38's snapshots

CMO decision S-5 (`docs/plans/S75-S80-cmo-decisions.md`). Extends S38 (`docs/design/S38.md`); BP logic (S-1, 140/90 on home averages) is not touched.

## What exists, found by reading code
- **HbA1c** lives in `lab_analyte_readings` (`code = 'hba1c'`, always stored as percent by `screening-result-actions.ts`; the `unit` column says so). The care-plan target is `patient_glucose_targets.hba1c_target_percent` (doctor-set, nullable).
- **Weight** lives in `vitals_readings.weight_kg` (`vital_type = 'weight'`), with `validation_status`; a reading waiting for validation is not used.
- **PHQ-9 and GAD-7** live in `mental_health_screens` (`instrument` `phq9`/`gad7`, `total_score`, `created_at`). The table also holds `item_responses` and `crisis_flagged`; the new code never names either (item 9 follows the red pathway).
- S38's `outcome_snapshots` is BP only (`pathway_code in ('bp')`), `bp_control_report` is day 90 only, and sponsors reach only `private.v_bp_cohort_90d` through `sponsor_report_aggregate` and the S38f snapshots. `analytics.v_outcome_facts` does not exist on this base (only in the plan), so there is no spine view to extend; HbA1c and weight get `analytics.v_outcome_measure_snapshots` (service role, pseudonymised, no test rows) and mental health gets no analytics object.

## Decisions
1. **Config as data.** `outcome_config` v3 = v2 plus a `measures` block and `bp_report_days`. It is inserted PROPOSED, unsigned and INACTIVE; v2 stays active. The daily job and the reports return or refuse until the CMO activates v3. Mirrored as registry key `outcomes.measure_rules` (v1); a test checks v3 = v2 + that block. `outcomes.snapshot_rules` v2 stays the version in force in the registry.
2. **Sparse measures: nearest result in a window.** Baseline: HbA1c from 90 days before to 14 days after joining; weight 14 before to 7 after; PHQ-9 and GAD-7 14 and 14. Later days: nearest result within a tolerance (HbA1c 30, weight 14, scores 21). No result is `insufficient_data`, stored, never "not improved". Later days reuse the day-0 row's baseline so history is consistent.
3. **Who is in a measure.** A person with an HbA1c result or a glucose target; an adult with any weight; a person with a screen of that instrument. A snapshot is due when the window plus the grace days has closed.
4. **Goals (S-5).** HbA1c: reached when under 7.0 percent OR at or under the patient's own care-plan target. Weight: reached when weight is 5 percent or more below baseline (exactly 5.00 counts). PHQ-9 and GAD-7: response is a fall of 50 percent or more (exactly 50 counts); remission is a total under 5; both only when the baseline total is 5 or more (otherwise `not_applicable`).
5. **Mental health is a separate table** (`outcome_mh_snapshots`), patient-only at row level, no staff or sponsor policy, no analytics view. A treating clinician reads one patient through `clinician_mental_health_outcomes(patient, reason)`: an active clinician, a real tie (care team, routed case or active lead; not break-glass or support view), a reason of 10+ characters, audited whether allowed or denied. Admin, analyst and the CMO get only suppressed aggregates (`mental_health_outcome_report`). No UI for these aggregates on `/admin/outcomes`.
6. **Reports** (`outcome_measures_report`, `bp_control_report_day`, `mental_health_outcome_report`): whole calendar months of joining, the S38 min-cell rule from the active config (20; withheld together with any small neighbouring category), the missing share beside every rate, `comparison_group: none`, `not_a_causal_claim: true`, audited.

## Open for the CMO (not decided by this build)
- Reading of "below 7.0 percent or the care-plan target" as an OR (either counts). A tight target of 6.5 does not stop 6.8 counting.
- Lowest baseline for response and remission (PROPOSED 5, the remission line); usual practice counts remission among people starting at 10 or more for PHQ-9.
- Pregnancy: weight and the 5 percent goal are not meaningful in pregnancy; reproductive tables are not read here, so pregnant adults are not excluded. Needs a CMO decision and a safe way to ask.
- Windows and tolerances above are PROPOSED.
