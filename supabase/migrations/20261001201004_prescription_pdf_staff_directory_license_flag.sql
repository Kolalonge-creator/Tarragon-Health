-- Prescription PDF (patient-side), phase 1: the issuing rule needs to know whether the prescriber's
-- licence is currently verified, and the patient session cannot read clinical_staff (narrowed in
-- 20260925015430). The safe-column view clinical_staff_directory is the one place every patient-facing
-- clinical_staff read goes through, so it gains ONE derived boolean (never the dates or the verifier).
-- Additive: create or replace appends a column at the end; every existing selector is unaffected.
-- Live state when written: 2 clinical_staff rows, both with license_verified_at set, one carrying a
-- placeholder credential number (that is checked separately, in the application builder).

create or replace view public.clinical_staff_directory
with (security_invoker = false)
as
select
  cs.id,
  cs.organisation_id,
  cs.profile_id,
  cs.full_name,
  cs.photo_url,
  cs.credential_type,
  cs.credential_number,
  cs.specialty,
  cs.bio,
  cs.active,
  cs.doctor_tier,
  cs.employment_type,
  cs.offers_therapy_sessions,
  (cs.license_verified_at is not null
    and (cs.license_expires_at is null or cs.license_expires_at > now())) as license_verified
from public.clinical_staff cs
where cs.organisation_id = private.current_org_id()
   or private.is_org_staff(cs.organisation_id)
   or (cs.profile_id is not null and private.can_support_view(cs.profile_id))
   or coalesce(current_setting('role', true), '') = 'service_role'
   or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';

revoke all on public.clinical_staff_directory from anon;
grant select on public.clinical_staff_directory to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.clinical_staff_directory', 'SELECT') then
    raise exception 'anon can read clinical_staff_directory';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'clinical_staff_directory'
                   and column_name = 'license_verified') then
    raise exception 'license_verified column missing';
  end if;
  if (select reloptions from pg_class where oid = 'public.clinical_staff_directory'::regclass)
       is distinct from array['security_invoker=false'] then
    raise exception 'view options changed';
  end if;
end $$;
