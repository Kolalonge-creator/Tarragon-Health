-- S05b-a (1 of 3): genotype and blood group carry a verification flag, self_reported or lab_verified.
--
-- Founder decision 2026-10-13. Live check before writing (project koiplnmbgnqnbywhpjlf, read only):
--   * Genotype and blood group live in ONE table, public.patient_blood_profile (no columns on profiles).
--   * 0 rows today, so there is nothing to convert. Every future row is self_reported unless a lab report backs it.
--   * The database already refuses an unsourced row (provenance 'lab_document' needs a report that belongs to this patient;
--     'patient_attested' needs an attestation stamp) and the trigger private.enforce_blood_profile_provenance forces any
--     non-staff caller to 'patient_attested'. So the "patient may not set lab_verified" rule exists; what was missing was the
--     founder's vocabulary and one derived field every screen and query can read.
--
-- Design: a GENERATED column, not a second writable column. A second writable field could drift from provenance and would need its
-- own guard; a generated one cannot be written by anyone (the server refuses with 428C9), and it is lab_verified exactly when the row
-- is backed by a report that the provenance constraint has already checked. The self-update guard is the existing trigger.

alter table public.patient_blood_profile
  add column if not exists verification text
  generated always as (
    case when provenance = 'lab_document' then 'lab_verified' else 'self_reported' end
  ) stored;

comment on column public.patient_blood_profile.verification is
  'S05b: self_reported (the patient attested it) or lab_verified (a clinician recorded it against a lab report that belongs to this patient). Generated from provenance, so it cannot be written; non-staff callers are forced to patient_attested by private.enforce_blood_profile_provenance.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'patient_blood_profile'
       and column_name = 'verification' and is_generated = 'ALWAYS'
  ) then
    raise exception 'patient_blood_profile.verification is missing or not generated';
  end if;
end $$;
