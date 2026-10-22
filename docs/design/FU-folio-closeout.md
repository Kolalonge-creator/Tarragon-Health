# FU folio base-table lock: closeout (CMO OQ-358 and OQ-358b)

Two stacked PRs. PR 1 (`fu/folio-base-table-lock`) is code only. PR 2 (`fu/folio-base-table-lock-2`) is the schema step.
**PR 2 must merge only after PR 1 is deployed READY on production**: merging auto-applies migrations, and the application deployed before PR 1 does `select *` on `clinical_staff` and reads `credential_number`, which fails as a whole once the column grant is removed.

## Decisions implemented
1. OQ-358: the base table `public.clinical_staff` exposes the MDCN folio (`credential_number`) only to the clinician themself, the CMO and credentialing staff (`private.can_credential_review()`: admin or CMO). Colleagues, patients and other staff cannot read it.
2. OQ-358b: the folio prints on letters and prescriptions only (referral letters, prescriptions). It no longer prints on lab result PDFs or verified-document PDFs. A patient sees "Licence verified on <date>" from a stored verification record, never the number.

## PR 1 (code, no schema)
- `lib/clinical/staff-folio.ts`: `fetchStaffFolios` / `withStaffFolios` read the folio through `public.clinical_staff_folio()`. **Deploy-window fallback**: while that function does not exist (PGRST202 / 42883) it reads the column directly, as the old app did; any other failure (including a refusal) yields no folio, never a crash and never an invented number.
- `lib/clinical/staff-columns.ts`: the explicit non-folio column list (drift-tested against the generated row type). Every `select("*")` on `clinical_staff` is gone (admin manager list, org clinicians, admin dashboard counts).
- Moved to the folio helper (entitled screens): admin clinical-staff manager, protocol versions (signer line), admin search hint, own account page. Admin search no longer searches by folio.
- Folio dropped (colleague screens): care-team doctor picker, case cockpit "confirmed by" line (shows the credential type only), annual-review embed (never rendered), view-as page, `getCurrentClinicalStaff()` in `packages/auth`.
- Patient-facing licence copy: booking card and `ClinicianLicenceLine` now say "Licence verified on <date>" (`book.card.licence_verified`, `licence.line`); `toConsultSlots` no longer carries `mdcn_number`.
- PDFs: lab result (single and combined) and verified-document (web and mobile) generators take `licenceVerifiedOn` from the stored record (`clinician_licence_verified_on`, via `fetchLicenceVerifiedOn`) and print no folio or credential type. Referral letter and prescription unchanged (still print it through `clinician_folio_for_document`).
- Review fixes (code-review at high): fallback fires only when `clinical_staff_folio` itself is missing and logs a warning; every other failure logs an error code; the lookups are no longer silent; the scan test also catches `select()`, a leading `*`, write-then-`.select()` and nested embeds, across web, mobile, console, packages and edge functions; the care-team picker selects only seven columns; screens that need only names (`provider-restrictions`) never fetch folios. Known and left: PDFs still call the document folio function for the doctor's name (the number is null after PR 2), and "Licence verified on" is the clinician's latest stored check, not the check at issue time.
- Tests: `staff-folio.test.ts`, `staff-columns.test.ts`, `folio-base-table-reads.test.ts` (scan: no select names the folio or `*` on the table; lab and verified-document generators carry no folio; letters and prescriptions still do), updated `slots.test.ts` and the booking a11y test. Whole web suite 6210 tests green, `tsc` clean for web and auth, i18n suite green.

## PR 2 (schema): `20261022114116_clinical_staff_folio_lock.sql`
- `public.clinical_staff_folio(uuid[])`: own row, or `can_credential_review()` in the same organisation, or the real service role; zero rows otherwise; anon cannot execute.
- Base table: table-level SELECT revoked from `authenticated` (a column REVOKE is a no-op under a table grant), explicit column grant of every column except `credential_number`; `service_role`/`postgres` keep everything; INSERT/UPDATE/DELETE grants and all RLS policies untouched.
- Folio leaks found by scanning every function body (`pg_get_functiondef`): `clinician_licence_public` (returned any clinician's folio to any signed-in user) now returns type and date; `list_bookable_consult_slots` no longer returns `mdcn_number`; `clinician_folio_for_document` returns a null folio for `lab_result_interpretation` and `verified_document`.
- `public.record_corrections`: the audit trigger on `clinical_staff` copied old and new folio values into a table whose policy admits every member of the organisation (found by the second code review; 2 live rows). The policy now hides any correction that changed `credential_number` from everyone except `can_credential_review()` callers (not even the colleague who made the change). Rows are append-only and not rewritten.
- `packages/shared/src/database.types.ts`: spliced by hand (new function, `clinician_licence_public` return shape).
- Proof `packages/db/tests/clinical_staff_folio_base_table_lock.sql` (registered in `ci.manifest`) with five sabotage rows that print `PASS (caught)` (table grant, entitlement check, organisation clause, licence function shape, audit policy), plus a foreign-organisation CMO, pharmacist and care coordinator getting nothing; `clinician_folio_for_document.sql`, `folio_not_exposed.sql` and `s64_consultation_gaps.sql` updated for the new contract. The full `scripts/run-db-proofs.sh` suite was replayed against a local stack with the migration applied (see the result in the PR).

## Apply order
1. Merge PR 1; wait until Vercel shows it READY as the production deployment (check `get_deployment` on the live hostname, not `latest`). Mobile needs no release (no mobile read changed).
2. Merge PR 2 (auto-applies the migration). Afterwards confirm live: `has_column_privilege('authenticated','public.clinical_staff','credential_number','SELECT')` is false, and the admin clinical-staff screen still lists the folio.
3. Roll back if needed: re-grant `select on public.clinical_staff to authenticated`.

## Open questions (proposed OQ text, for the lead)
- Health passport: `health_passport_by_serial` (readable without sign-in) and `mint_health_passport` carry the attesting doctor's folio. A passport is neither a letter nor a prescription. Keep or drop?
- Lab request PDFs (to the laboratory) and vaccination certificates still print the folio, because OQ-358b names only lab result and verified-document PDFs. Confirm they stay.
- Admin search by folio is removed (the column is not searchable by a screen). If credentialing needs it, add a function that searches by folio for `can_credential_review()` callers.
- `health_passport_issuances.attesting_credential_number` is a table column readable by the patient and org staff (policy `health_passport_issuances_select`), beside the two passport functions. Same decision as the passport above.
- `clinician_folio_for_document` hands the issuing clinician's folio to anyone entitled to read the letter, prescription, lab request or vaccination record, as data and not only on the PDF (colleagues with a clinical tie, caregivers, emergency readers). Accepted as "printed on the document"? Confirm.
- The column grant is a snapshot: a column added to `clinical_staff` later is unreadable by `authenticated` until granted. CI catches it (proof check 5 fails on a missing grant), so a migration that adds a column must also `grant select (col) on public.clinical_staff to authenticated`.
- Other open branches that add `select("*")` or `clinical_staff(*)` would break after the lock; re-run `folio-base-table-reads.test.ts` (it scans web, mobile, console, packages and edge functions) on each before merging PR 2.
- `licence_checked_on` in the slot list is unchanged in meaning (the stored credential check, MDCN credentials only, as the old gate already required).
- Any org staff can still UPDATE another clinician's folio through the table's write policy (`is_org_staff`), only reading is closed here.

## Not proven
No live production run: the migration is not applied; the proof ran on a local isolated stack. PostgREST embedded-join behaviour is proved at the SQL level (join, security_invoker view, count) and not through a real PostgREST request. Mobile and the console app read no folio.

## Re-do on main-dev (2026-10-22)
PR #1167 merged into the step-1 branch, not main-dev, so the lock never applied. This PR carries the same step-2 diff on `origin/main-dev`, migration re-timestamped `20261022114116`. Step 1 is already in production. Re-audit of current main-dev found no new direct reader of `clinical_staff.credential_number` and no `select *` or embed on the table in apps/web, apps/mobile, apps/console, packages or edge functions; the live SQL scan found one new folio reader, `public.sign_health_report` (SECURITY DEFINER, snapshots the signer's own folio into `health_reports.signer_registration`; unaffected by the lock). `folio-base-table-reads.test.ts` now also fails on ANY non-reviewed source file that names the folio.

Further open questions from the second review: `provider_credential_monitor()` returns folios of every organisation to any admin or CMO (not org-scoped); `health_reports.signer_registration`, `verify_prescription_public` (anon, by token) and `desk_verify_prescription` carry copies of the folio; `clinical_staff_live_folio_unique` lets a colleague who cannot read folios probe for an existing number via a 23505 on a blind write; a sibling credentials table would make the lock structural.
