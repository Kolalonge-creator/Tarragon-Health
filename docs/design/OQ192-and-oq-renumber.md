# OQ-192 re-check and OQ renumbering (2026-10-16)

## OQ-192 (profile_access grantees): NOT changed in this PR
- Re-checked against the repo first: S71 (`20261007223107_s71_checkout_core.sql`, applied) already fixed paying (live `create_order` calls
  `private.order_beneficiary_check`, which needs a Care Circle `pay_for_care` or `can_act_for(..., 'manage_payments')`), and tightened
  `booking_requests_select`, `vaccination_adverse_events_select`, `vaccination_card_extractions_select` and `profiles_select`.
  I read the live `create_order` body 2026-10-16 and it matches S71.
- Left open: the profile row stays readable to any unexpired grantee with a permission (OQ-404, a standing founder decision, not a bug), and the
  vaccination record and schedule UPDATE policies, which S71 did not touch (`vaccination_records_update`, `vaccination_schedules_update`).
- Why no migration: the live database stopped answering (`Connection terminated due to connection timeout`, even `select 1`, and `get_advisors`) for the
  rest of the session, so the live policy text, the `profile_access` row count and any function-body references could not be read. CLAUDE.md
  requires reading live definitions before changing a policy, and the count belongs in the migration header. A blind policy rewrite on a security surface was not shipped.
- Next step: with the database reachable, list `pg_policies` where `qual`/`with_check` mention `profile_access`, and `pg_proc` bodies that do,
  confirm each against `can_read_clinical(uuid, <enum>)` / `can_act_for`, count affected `profile_access` rows, then ship one migration with a
  simulated-JWT proof, a Care Circle and `manage_pharmacy` control, and a sabotage step.

## OQ renumbering
- 225 repeated `### OQ-N` headings (125 numbers; up to six topics per number) plus `OQ-S55-14` and `OQ-S60-12`. First heading in the file keeps its number; each later
  one got a new number from 453 up (677 is the highest). Old to new map at the bottom of `docs/OPEN-QUESTIONS.md`.
- Citations inside a renumbered entry were updated. Citations elsewhere were not rewritten: a bare "OQ-310" cannot be assigned to one of five topics, and applied migration SQL is never edited.
- `packages/shared/src/open-questions-unique.test.ts` fails on any repeated heading id (runs in the TypeScript CI job).
