# Runbook: patient tables that escape the under-18 dependant guard

A dependant under 18 may hold immunisation and preventive tracking rows only (founder decision 2026-10-13). The database enforces it
with a `00_minor_dependant_scope` trigger on every table keyed by `patient_id`, except tables listed as `allowed` or `exempt` in
`public.minor_dependant_table_policy`.

## How a gap appears
Migrations are applied to production separately from CI, and a table added by a later migration is not guarded unless that migration
says so. CI proves the guard on a fresh replay (`minor_dependant_table_policy_complete`), which can pass while production is behind.

## The check
- `select * from private.minor_guard_gaps();` (run as the database owner; not callable by API roles). Empty means complete.
- `scripts/release-integrity/check-minor-guard-gaps.mjs` runs it against production in the release-integrity workflow and fails the job
  with the table names.

## The fix
1. Decide: clinical or personal data (guard it), immunisation or preventive tracking (`allowed`), or a system, data-rights or safety
   table that must stay writable for a child (`exempt`, with a reason).
2. In a NEW migration (never edit an applied one) call `select private.guard_minor_dependant_table('<table>');`, or insert the
   `allowed` / `exempt` row into `minor_dependant_table_policy`.
3. Add the same call to the migration that creates any new `patient_id` table, so CI and production agree from the start.
4. Re-run the check; the release-integrity job should go green.
