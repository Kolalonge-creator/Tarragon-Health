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
- Tests: `staff-folio.test.ts`, `staff-columns.test.ts`, `folio-base-table-reads.test.ts` (scan: no select names the folio or `*` on the table; lab and verified-document generators carry no folio; letters and prescriptions still do), updated `slots.test.ts` and the booking a11y test. Whole web suite 6210 tests green, `tsc` clean for web and auth, i18n suite green.

## PR 2 (schema): `20261015231612_clinical_staff_folio_lock.sql`
- `public.clinical_staff_folio(uuid[])`: own row, or `can_credential_review()` in the same organisation, or the real service role; zero rows otherwise; anon cannot execute.
- Base table: table-level SELECT revoked from `authenticated` (a column REVOKE is a no-op under a table grant), explicit column grant of every column except `credential_number`; `service_role`/`postgres` keep everything; INSERT/UPDATE/DELETE grants and all RLS policies untouched.
- Folio leaks found by scanning every function body (`pg_get_functiondef`): `clinician_licence_public` (returned any clinician's folio to any signed-in user) now returns type and date; `list_bookable_consult_slots` no longer returns `mdcn_number`; `clinician_folio_for_document` returns a null folio for `lab_result_interpretation` and `verified_document`.
- Proof `packages/db/tests/clinical_staff_folio_base_table_lock.sql` (registered in `ci.manifest`) with two sabotage rows that print `PASS (caught)`; `clinician_folio_for_document.sql` and `folio_not_exposed.sql` updated for the new contract.

## Apply order
1. Merge PR 1; wait until Vercel shows it READY as the production deployment (check `get_deployment` on the live hostname, not `latest`). Mobile needs no release (no mobile read changed).
2. Merge PR 2 (auto-applies the migration). Afterwards confirm live: `has_column_privilege('authenticated','public.clinical_staff','credential_number','SELECT')` is false, and the admin clinical-staff screen still lists the folio.
3. Roll back if needed: re-grant `select on public.clinical_staff to authenticated`.

## Open questions (proposed OQ text, for the lead)
- Health passport: `health_passport_by_serial` (readable without sign-in) and `mint_health_passport` carry the attesting doctor's folio. A passport is neither a letter nor a prescription. Keep or drop?
- Lab request PDFs (to the laboratory) and vaccination certificates still print the folio, because OQ-358b names only lab result and verified-document PDFs. Confirm they stay.
- Admin search by folio is removed (the column is not searchable by a screen). If credentialing needs it, add a function that searches by folio for `can_credential_review()` callers.
- Any org staff can still UPDATE another clinician's folio through the table's write policy (`is_org_staff`), only reading is closed here.

## Not proven
No live production run: the migration is not applied; the proof ran on a local isolated stack. PostgREST embedded-join behaviour is proved at the SQL level (join, security_invoker view, count) and not through a real PostgREST request. Mobile and the console app read no folio.
