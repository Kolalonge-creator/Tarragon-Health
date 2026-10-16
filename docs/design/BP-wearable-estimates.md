# Design note: wearable and cuffless blood pressure is an estimate, never a diagnostic number

Written 2026-10-16 on `pr1/bp-wearable-estimate-exclusion`, off `origin/main-dev`. Invariants touched: INV-01 (no model), INV-05 (red events still page), INV-14 (the paging change is a go-live guard born OFF), INV-16 (rules versioned, none invented here).

## The rule (one sentence)
A `vitals_readings` blood pressure whose `source = 'wearable'` (a watch, ring or phone sensor, including a HealthKit or Health Connect sample, which cannot be told apart from a cuff-synced one) is an **estimate**: it is kept, shown and labelled "Wearable estimate", but it is not counted in any home average, outcome or risk number, is not graded by the triage engine, and (once the CMO agrees) does not page the care team at the red or amber level.

Everything else is unchanged. A **wrist cuff** (`cuff_type = 'wrist'`, source manual or device) is not an estimate: the CMO decision pack Q4 says grade every cuff reading and never downgrade a red because of cuff type. Pulse is not touched (below).

Basis: S06-S10 CMO pack C1 ("a wrist or finger device, or a watch or ring, is not used for care decisions"); AHA/ACC-2025 (cuffless devices not recommended for clinical assessment); ESH-2023 (validated devices).

## What the audit found (live, 2026-10-16, read from `pg_proc`/`pg_get_viewdef`, not from files)
- 0 live rows have `source = 'wearable'` (no provider credentials; HealthKit and Health Connect never run on a device). So nothing below changes a number that exists today.
- Nothing excluded a wearable BP anywhere. `source` is read by display code only (`SourceBadge`, visit report counts, health passport provenance) and by the SpO2 trigger (S70a module `device_wrist_spo2_informational`, the precedent followed here).
- A wearable BP reaches: the legacy red-flag trigger `vitals_readings_bp_red_flag` (clinician alert and page, or the emergency record), the S12 `observation.recorded` event (triage engine, shadow today, a pager once approved), and about 25 SQL readers through `private.vitals_readings_current`.

## Decisions
1. **One chokepoint, not 25 edits.** New view `private.vitals_readings_diagnostic` = `vitals_readings_current` minus wearable BP. A migration points an explicit list of diagnostic readers at it by rewriting their **live** definitions (`pg_get_functiondef`), failing loudly if a listed function no longer reads the old view. Display and integrity readers keep the full view: the audited record read, audit case file, share view, circle blocks, merge counts, engagement counts, device data-quality.
   Readers moved: BP window stats, home average (`hbpm_average`, `home_bp_assess`), outcome snapshots (S38), risk compute, patient monitoring, the whole triage context family, symptom regrade, quality metrics rows, analytics outcomes/funnel, board measure, clinical summary draft, consultation prep, monitoring gaps, overdue-vitals and reminders, vitals adherence, monthly reports, pathway baseline, health report BP lines. The same migration test (`bp_cuffless_estimates_never_diagnostic.sql`) asserts each one so a later migration that re-creates a reader from old text fails CI instead of silently reverting this.
2. **Triage engine: always off for estimates.** `emit_bp_observation_recorded` returns before emitting for an estimate. The engine was specified for cuff readings (INV-01 deterministic rules on measurements).
3. **Legacy pager: behind a go-live guard born OFF** (`platform_modules.device_cuffless_bp_informational`, S70a pattern, INV-14). Off = byte-for-byte today. On = a red or amber estimate gives the patient the **existing** recheck guidance (same text, same in-app notice `free_tier_reading_self_care_suggestion`), raises no clinician alert and no page, and writes an audit row `bp_red_flag.estimate_patient_only`.
4. **Emergency range is deliberately not suppressed.** The live pipeline downgrades a 200/130-range reading with no emergency symptom to red (S11g, CMO 2026-10-05), so that case is covered by (3). With a red-flag symptom (or pregnancy or postpartum) the emergency record still opens for an estimate. Reason: the emergency record is the patient safety net (acknowledge-gated guidance, emergency contact, follow-up); making it depend on the reading's source could make a patient less safe. Whether it should also stay silent for an estimate is OQ-BPW-1 for the CMO.
5. **Pulse is not changed.** A dangerously low or high single heart-rate value from any source is triaged by founder decision (2026-08-29, pulse red-flag engine); wrist optical heart rate is far better validated than cuffless BP, and a wearable BP cannot reach the pulse trigger (`vital_type = 'pulse'` only). Recorded as OQ-BPW-2 so it is a decision, not an oversight.
6. **App mirror.** `isDiagnosticBpSource` (packages/shared) is the TypeScript twin of `private.bp_reading_is_estimate`. Used where the apps compute a BP number themselves: mobile 7-day average and trend, the clinical-rules window count, the web outcome and monthly summary queries that read rows, AI-coach and case-brief BP context, titration and BP-control inputs. Display keeps the row with its label.

## The safety trade-off (for the CMO, OQ-BPW-1)
With the guard ON, a real hypertensive reading that happens to arrive only as a wearable estimate does not page a clinician at red or amber; the person is told to rest and recheck with a cuff. The risk is a missed true red. The alternative (guard OFF) lets an unreliable estimate page a clinician, which at scale is alert noise and trains clinicians to distrust the queue. The migration ships the mechanism OFF; the CMO chooses. Nothing is switched on by this PR, and today there is no wearable BP data, so the choice is not urgent.

## Not run / limits
- No device ran HealthKit or Health Connect; the "cannot tell a cuff-synced HealthKit BP from a watch estimate" limit is real and is why those samples are treated as estimates until a device-level discriminator exists (OQ-BPW-3).
- Diagnostic readers inside Postgres are rewritten programmatically; if a future migration copies an old definition of one of them, the proof fails in CI.
