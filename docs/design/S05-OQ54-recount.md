# OQ-54 recount: staff reads on the ten health-record tables (2026-10-13)

Method: `pg_policies` on live project `koiplnmbgnqnbywhpjlf` (read only), plus the S05b to S05f entries in `docs/BUILD-PROGRESS.md`, plus a repo scan of staff screens.

| Table | Live SELECT policies | Admits staff? |
|---|---|---|
| vitals_readings | patient; `can_read_clinical(..., category)` (caregiver grant only); own-entry (acting supporter) | No |
| medications | patient; `can_read_clinical` x2 (caregiver category / permission) | No |
| medication_logs | patient or caregiver category; own-entry (supporter) | No |
| symptoms | patient; own-entry (supporter) | No |
| patient_conditions | patient only | No |
| patient_allergies | patient only | No |
| clinical_encounter_notes | none (RLS on, zero policies; only definer functions read it) | No |
| specialist_referrals | patient only | No |
| patient_documents | patient only | No |
| family_history | patient only | No |

`private.can_read_clinical` (all three overloads) reads only `profile_access` and `emergency_access_grants`, never `is_org_staff`, so it is a caregiver and break-glass path, not a staff door. All write policies are patient-only or supporter-only (S05f follow-ups).

Result: OQ-54 is already closed in the database. Nothing is left to migrate. S39b/S39c (tied reads, audited openings) sit on top for the 128 other tables.

Repo scan: no file under the staff screens (`apps/web/src/app/(dashboard)/{clinician,admin,doctor,pharmacist,lab-liaison,lab-partner,credentialing,rota,finance,analytics,payer,provider-org}` and all of `apps/console/src`) has a direct `.from()` read or select embed of these tables. The remaining `.from()` users are patient, mobile, service-role or shared server code (e.g. corporate activation funnel runs on the service-role client).

Added: `apps/web/src/lib/security/staff-closed-tables-scan.test.ts`, which fails if that changes. Sabotage checked: adding a staff file with a direct read and an embed made two of the four tests fail.

Known blind spots (also in the test header): shared libs, variable table names, constant-built selects. Not verified: the two paths outside the scan (shared libs under `apps/web/src/lib` called from staff pages with a user session) were not traced call by call; S05f's own review re-scanned `.from()` readers on 2026-10-01 and found none.
