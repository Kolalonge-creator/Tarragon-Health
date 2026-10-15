# Folio exposure fix (CMO Q17, OQ-358)

Problem: `public.clinical_staff_directory` returned `credential_number` (the MDCN folio) to every signed-in user in the organisation, patients included. Live definition read 2026-10-15: owner-run view (`security_invoker=false`), no dependent views or policies. `authenticated` also held INSERT/UPDATE/DELETE on it (auto-updatable view); revoked in the same migration.

## What changed
- Split in two: branch 1 (this) adds only the function; branch 2 `fix/folio-hide-view-column` rebuilds the view without the folio after branch 1 is deployed (code first, schema second: merging auto-applies migrations, so hiding the column in the same merge would break the old app). `public.clinician_folio_for_document(kind, uuid[])` is SECURITY DEFINER, execute for `authenticated` and `service_role` only. The clinician is derived from the document row, never supplied by the caller. Entitlement mirrors each document's own read rule: owning patient, tied staff (`private.staff_may_read`, never plain `is_org_staff`), caregiver permission and emergency access where the document policy admits them, plus service role. Zero rows when not entitled; nothing is logged.
- Kinds and consumers (all keep printing the same folio text): `referral_letter` (referral letter), `lab_result_interpretation` (single + combined lab PDF), `verified_document` (web + mobile verified-document PDF), `prescription` (prescription PDF, single/bundle/clinician), `lab_request` (lab request PDF incl. internal notification route), `vaccination_certificate`. Shared helper `apps/web/src/lib/clinical/document-folio.ts`; a lookup error throws instead of printing an unnumbered document.
- Dropped, not moved: lab-order orderer lookup (`credential_number` was carried but never rendered) and the health passport protocol-supervisor line (patient page and PDF footer). **Output change to flag for the CMO:** the passport now says "Protocols supervised by Dr. X" with no credential type or folio.
- Staff-only screens (admin clinical-staff manager, protocol versions, case cockpit signer, care-team form, own account) read the base table `clinical_staff` and are unchanged. No patient or clinician-profile component renders the folio.

## Proofs
Branch 1: `packages/db/tests/clinician_folio_for_document.sql`. Branch 2: `folio_not_exposed.sql` plus the two existing proofs updated for the removed column. Jest: `document-folio.test.ts`, `folio-not-in-directory-reads.test.ts` (scan), prescription loader test now mocks the function.

## Open follow-up (not done, needs a decision)
A clinician colleague can still read a folio from the base table `clinical_staff` because its SELECT policy admits all org staff, and about 60 staff screens read that table (some with `select *`). Narrowing it needs a column-level grant plus a staff-folio function and a per-screen pass (admin manager, protocol versions, case cockpit, care-team form, `getCurrentClinicalStaff`). Proposed OQ: "Should colleagues, as opposed to admins and the clinician themself, be able to read a folio at all?"

A lookup that returns no row (caller not entitled, clinician deactivated) leaves the folio blank; the prescription loader then refuses as "prescriber not confirmed" and returns a structured error if the call itself fails. Other generators print the name and number only when a row comes back, as before.
