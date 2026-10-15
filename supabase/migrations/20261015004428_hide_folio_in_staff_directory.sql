-- CMO decision Q17 / OQ-358, step 2 of 2 (schema second): hide the MDCN folio in public.clinical_staff_directory.
-- Apply only after the app using public.clinician_folio_for_document() (step 1) is deployed; the old app read
-- credential_number from this view. Live facts read 2026-10-15: owner-run view, no dependent views or policies,
-- and `authenticated` held INSERT/UPDATE/DELETE on it although it is auto-updatable; those are removed here.
-- Not changed: clinical_staff (base table) stays readable by org staff; see docs/design/folio-exposure-fix.md.

drop view public.clinical_staff_directory;

create view public.clinical_staff_directory
  with (security_invoker = false)
  as
  select
    id,
    organisation_id,
    profile_id,
    full_name,
    photo_url,
    credential_type,
    specialty,
    bio,
    active,
    doctor_tier,
    employment_type,
    offers_therapy_sessions,
    license_verified_at is not null
      and (license_expires_at is null or license_expires_at > now()) as license_verified
  from public.clinical_staff cs
  where organisation_id = private.current_org_id()
     or private.is_org_staff(organisation_id)
     or ((profile_id is not null) and private.can_support_view(profile_id))
     -- the REAL database role only: request.jwt.claims is an ordinary GUC any session can set, so a JWT-claim
     -- test here would let a forged claim read every organisation's staff
     or coalesce(current_setting('role', true), '') = 'service_role';

comment on view public.clinical_staff_directory is
  'Safe-column subset of clinical_staff for patient/family-facing trust display (docs/CLINICAL_TRUST_MODEL_SPEC.md), plus internal service-role callers. Owner-run, not security_invoker: embeds its own org/staff/service-role predicate. NEVER add credential_number (the MDCN folio, CMO Q17), indemnity_*/staff_number/verified_by/credential_verified_by/*_verified_at columns here; documents that must print the folio use public.clinician_folio_for_document().';

revoke all on public.clinical_staff_directory from public;
revoke all on public.clinical_staff_directory from anon;
revoke all on public.clinical_staff_directory from authenticated;
revoke all on public.clinical_staff_directory from service_role;
-- Live ACL before this migration (read 2026-10-15): postgres=arwdDxtm, authenticated=arwd, service_role=arwdDxtm.
-- DROP VIEW discards it, so re-grant explicitly: authenticated read-only (the write grants were the defect);
-- service_role exactly what it had (every consumer only SELECTs); anon nothing.
grant select on public.clinical_staff_directory to authenticated;
grant all on public.clinical_staff_directory to service_role;


do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'clinical_staff_directory'
               and column_name = 'credential_number') then
    raise exception 'directory view still exposes credential_number';
  end if;
  if not has_table_privilege('service_role', 'public.clinical_staff_directory', 'SELECT') then
    raise exception 'service_role lost SELECT on the directory view';
  end if;
  if not has_table_privilege('authenticated', 'public.clinical_staff_directory', 'SELECT') then
    raise exception 'authenticated lost SELECT on the directory view';
  end if;
  if has_table_privilege('anon', 'public.clinical_staff_directory', 'SELECT') then
    raise exception 'anon can read the directory view';
  end if;
  if has_table_privilege('authenticated', 'public.clinical_staff_directory', 'UPDATE')
     or has_table_privilege('authenticated', 'public.clinical_staff_directory', 'INSERT')
     or has_table_privilege('authenticated', 'public.clinical_staff_directory', 'DELETE') then
    raise exception 'authenticated still has write grants on the directory view';
  end if;
end $$;
