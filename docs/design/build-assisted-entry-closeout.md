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
- Jest: `packages/shared` assisted-entry and registry mirror, `apps/web` red-care action (7 to 10 tests), assisted-refusal, patient section and
  mobile API suites, `apps/mobile` red-care outbox (14). tsc (web) and eslint clean.
- DB proof `packages/db/tests/assisted_entry_and_caregiver_red_care.sql` in `ci.manifest`, three sabotage steps ("PASS (caught)").
- Dry run note: the live project is shared and busy; see "Unproven" for the state of the dry run.

## Unproven
- Dry run against the live project was done with the stand-in label `receive_alerts` for `log_readings`, because ADD VALUE cannot be used in
  the transaction that adds it. The real label is exercised by CI replay (two migration files).
- No component test for the new label in `VitalsHistory`; the words are unit tested in `packages/shared`.
- The clinician monitoring roster does not flag a helper-entered latest value (chart and history do).
- Nothing was exercised on a device or against a real helper account.

## Apply order
1. Merge after required CI is green (merge auto-applies migrations per the two-tier hand-off, check that rule at merge time).
2. Migration `*_assisted_entry_permission_value.sql` first (ADD VALUE, own transaction), then `*_assisted_entry_and_caregiver_red_care.sql`.
3. Deploy web (the old web works against the new schema; the new web calls `record_red_care_response_for`, so schema before web for the
   caregiver path). Ship phone by OTA (JS only).
4. Live counts before apply: 0 manage grants, 0 narrowed grants, so no helper loses access.
