# Closeout: caregiver red-care answer and assisted entry (2026-10-16)

Branch `build/assisted-entry-and-caregiver-red-care`. Design: `docs/design/build-assisted-entry.md`. Research: `docs/research/build-assisted-entry.md`.

## Built
- `record_red_care_response_for` (caregiver answers for the person; the 42501 reproduced first against the old function, proof R0).
- `log_readings` capability, guard trigger and append-only ledger on `vitals_readings`, versioned limits, `assisted_entry_attribution`,
  pharmacy seam closed behind `assisted_entry_pharmacy_enabled` (OQ-ASSIST-1).
- Web: permission label, "Entered for you by <name>" in recent readings, chart caption, refusal wording; red-care action uses the open
  acting-for subject. Phone: red-care outbox sends the for-person function when the subject is not the signed-in user; the screen resolves
  the acting subject. Three mobile API routes map refusals to 403/422/429/503.
- Registry key `assisted_entry.limits` and a mirror test against the migration seed.

## Deviation from the brief
`source` stays `manual` (or `device`), not `assisted`. A new `vital_source` value would skip glucose triage (`r2_glucose_triage_wiring`
fires only for manual/device), escape the manual no-backdating stamp and the source lock, and fall out of the S46/S47 source counts.

## Tests
- Jest, all passing: `packages/shared` assisted-entry (5) and registry mirror (2), `apps/web` red-care action (10), assisted-refusal (2),
  red-patient-answer (6), the patient section and mobile API suites, `apps/mobile` red-care outbox (14). tsc (web, mobile, shared) and eslint clean.
- DB proof `packages/db/tests/assisted_entry_and_caregiver_red_care.sql` is written and registered in `ci.manifest` with three sabotage steps
  ("PASS (caught)") but has NOT been run to completion by its author (see Unproven).

## Unproven (read this first)
- **The DB proof and both migrations were never executed successfully.** The shared live project (koiplnmbgnqnbywhpjlf) was saturated for the whole
  session: the Management API returned "Connection terminated due to connection timeout", "Failed to create login role" and 524s, and a
  rolled-back dry run needs one uninterrupted request. The first attempt also found another session's vitals proof holding locks on
  `vitals_readings`. CI replay (`supabase db reset` plus `run-db-proofs`) is therefore the first real execution. Expect to fix small things.
  Dry runs were also to be done with the stand-in label `receive_alerts` for `log_readings` (ADD VALUE cannot be used in its own transaction).
- Read-only facts that WERE checked live: `vital_source` values, the 28 triggers on `vitals_readings`, 0 manage grants (0 narrowed), the
  anchors in the live `latest_red_patient_response` and `record_red_care_response` text.
- Things most likely to need a fix in CI: other triggers or functions that enumerate `vitals_readings` columns (new column `assisted_entry`),
  the data-registry and minor-dependant policy rows for `assisted_entry_log`, and `received_at` being present on every row.
- No component test for the new label in `VitalsHistory`; the words are unit tested in `packages/shared`.
- The clinician monitoring roster does not flag a helper-entered latest value (chart and history do).
- Nothing was exercised on a device or with a real helper account.

## Apply order
1. Merge after required CI is green (merge auto-applies migrations per the two-tier hand-off, check that rule at merge time).
2. Migration `*_assisted_entry_permission_value.sql` first (ADD VALUE, own transaction), then `*_assisted_entry_and_caregiver_red_care.sql`.
3. Deploy web (the old web works against the new schema; the new web calls `record_red_care_response_for`, so schema before web for the
   caregiver path). Ship phone by OTA (JS only).
4. Live counts before apply: 0 manage grants, 0 narrowed grants, so no helper loses access.
