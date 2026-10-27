# Service-role inventory (W-36)

The service-role key bypasses row security. Any code holding it can read or write every row of every table, so the list of places that hold it must be short, known and reviewed.

## What is enforced

- `docs/security/service-role-allowlist.json` lists every non-test file that calls `createServiceRoleClient` or reads `SUPABASE_SERVICE_ROLE_KEY`. It was generated on 2026-10-27 and holds 204 files.
- `apps/web/src/lib/security/service-role-scan.test.ts` fails when a file outside that list starts using the key. Fix: add the file to the list with a category, and write the reason in the PR.
- Removing a file from use never fails the test. Prune the list when you delete code.

## Categories in the baseline

| Category | Files | Why the key is needed |
| --- | --- | --- |
| edge function | 18 | Runs on a timer or a webhook with no signed-in user. |
| cron or webhook route | 26 | Same, but in the web app (`/api/cron`, `/api/webhooks`). |
| factory | 1 | `packages/auth/src/supabase/service-role.ts` creates the client. |
| app server code | 159 | Baselined as found. The owner of each area still owes a one-line reason (see below). |

## Known gap

The 159 "app server code" entries are baselined, not justified. They are the working list for a later reduction pass: for each, either move the work to a `SECURITY DEFINER` function that checks the caller, or write the reason here. Nothing about live behaviour changes in this item.

## Other gates in the same family

- Release Integrity job "Anon reads zero rows" (`scripts/release-integrity/check-anon-zero-rows.mjs`): connects as the anon role and fails if any table returns a row, except the six public-by-design tables listed in the script.
- Release Integrity job "Policy baseline" (`scripts/release-integrity/check-policy-baseline.mjs`): nightly snapshot of `pg_policies` compared with `docs/security/pg-policies-baseline.json`.
- `packages/db/tests/rls_shape_gate.sql`: every table with a `patient_id` column has row security on, no open read policy, an approved helper in each read policy, and a `staff_read_scope` row when staff can read it. 33 known unregistered tables are baselined in the script (the organisation-wide reads recorded in OQ-280 and tables whose own policy limits staff).
