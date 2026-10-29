# Service-role inventory (W-36)

The service-role key bypasses row security. Any code holding it can read or write every row of every table, so the list of places that hold it must be short, known and reviewed.

## What is enforced

- `docs/security/service-role-allowlist.json` lists every non-test file that calls `createServiceRoleClient` or mentions `SERVICE_ROLE_KEY`. It was generated on 2026-10-27 and holds 205 files.
- `apps/web/src/lib/security/service-role-scan.test.ts` scans `apps/web/src`, `apps/mobile/src`, `apps/console/src`, `packages`, `supabase/functions`, `scripts`, `tools`, `services` and `.github/workflows` (skipping `node_modules`, `.next`, `.expo`, `dist`, `build`, `.turbo`, `coverage`, `.vercel`) and fails when:
  - a file outside the list starts using the key (add it with a category and write the reason in the PR);
  - a file imports one of the helper wrappers below and is neither on the list nor in `wrapper_callers`;
  - a listed file is gone or no longer uses the key (prune the entry; the list must not rot).

## Categories in the baseline

| Category | Files | Why the key is needed |
| --- | --- | --- |
| edge function | 18 | Runs on a timer or a webhook with no signed-in user. |
| cron or webhook route | 26 | Same, but in the web app (`/api/cron`, `/api/webhooks`). |
| factory | 1 | `packages/auth/src/supabase/service-role.ts` creates the client. |
| CI workflow | 1 | `.github/workflows/ci.yml` passes the key to the local test stack. |
| app server code | 159 | Baselined as found. The owner of each area still owes a one-line reason (see below). |

## Transitive callers: helper wrappers

Some modules call the key for their callers, so importing them is a service-role use even without the key in the importing file. Callers of these modules must be reviewed. Their current importers are in `wrapper_callers` (14 files that are not already on the list); the scan flags any new importer.

- `apps/web/src/lib/supabase/service-role.ts` (re-exports `createServiceRoleClient`; importers are all on the main list)
- `apps/web/src/lib/supabase/sign-storage-paths.ts`
- `apps/web/src/lib/care-messages/attachments.ts`
- `apps/web/src/lib/imaging-reports/documents.ts`
- `apps/web/src/lib/referrals/outcome-documents.ts`
- `apps/web/src/lib/prescriptions/signature.ts`
- `apps/web/src/lib/auth/signup-gate.ts`
- `apps/web/src/lib/protocol-api/check-quota.ts`
- `apps/web/src/lib/protocol-api/log-usage.ts`
- `apps/web/src/lib/notifications/queue-risk-signal-attention.ts`

Not covered: a wrapper that is itself imported by another wrapper (two hops), wrappers outside `apps/web/src`, and any module that gets the key through a dependency-injected client. The import check resolves `@/` and relative paths only.

## Known gaps

- The 159 "app server code" entries are baselined, not justified. They are the working list for a later reduction pass: for each, either move the work to a `SECURITY DEFINER` function that checks the caller, or write the reason here.
- Edge functions read the key as `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`, which the scan catches by the key name only.

## Other gates in the same family

- Release Integrity job "Anon reads zero rows" (`scripts/release-integrity/check-anon-zero-rows.mjs`): switches to the anon role and counts readable rows in every table and view. It fails on a readable row outside the six public-by-design tables, on a table with row security off that anon can open, on any error other than permission denied, and on a failed positive control (`public.consent_versions` must return a row as anon). Known Supabase-managed exposures are reported, not failed: `net._http_response` and `net.http_request_queue` (row security off), `extensions.pg_stat_statements` and its info view, `realtime.subscription`, `realtime.messages`. Public storage buckets are listed. The same scan runs report-only against the PR replay database (`--local`).
- Release Integrity job "Policy baseline" (`scripts/release-integrity/check-policy-baseline.mjs`): nightly snapshot of `pg_policies` compared with `docs/security/pg-policies-baseline.json`. Report only until that file exists and carries `"enforce": true`.
- `packages/db/tests/rls_shape_gate.sql`, run in the replay job through `ci.manifest`: every table with a `patient_id` column has row security on, no open permissive policy (true, 1=1, `(select true)`, `true or ...`, `auth.uid() is not null`) for read or write, a read policy that calls a reviewed helper or compares `patient_id` with `auth.uid()`, and a `staff_read_scope` row when staff can read it. 33 tables are baselined (OQ-280 organisation-wide reads and tables whose own policy limits staff), plus `care_circle_alert_acks` (supporter-owned rows).
