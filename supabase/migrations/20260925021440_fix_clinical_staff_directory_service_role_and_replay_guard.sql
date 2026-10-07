-- Follow-up to 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql,
-- found by /code-review high before merge: two real regressions the original
-- migration introduced, plus one replay-safety gap.
--
-- 1) Service-role callers got zero rows from clinical_staff_directory. The
--    view's WHERE clause resolves entirely through auth.uid()-dependent
--    helpers (current_org_id()/is_org_staff()/can_support_view()); a
--    service-role caller (cron jobs, internal notification routes) has no
--    JWT `sub` claim at all, so auth.uid() is null and every disjunct
--    evaluates false. BYPASSRLS — why service_role could always see every
--    column of the base table — does NOT help here, because this is a plain
--    view predicate baked into the view body, not an RLS policy. Confirmed
--    live: apps/web/src/lib/health-passport/get-health-passport-data.ts
--    (reached from the quarterly-report cron via a service-role client) and
--    apps/web/src/lib/lab-results/generate-lab-request-pdf.ts (reached from
--    the internal lab-order-request-pdf notification route the same way)
--    both silently lost their doctor-attribution line. Fixed by adding the
--    same service-role detection idiom already used elsewhere in this repo
--    (20260904235834_doctor_time_features_grantable_by_the_purchasable_
--    programme.sql's own hard-won comment: current_user is rewritten to the
--    view/function owner and can't be used; current_setting('role')/
--    auth.jwt()->>'role' are what actually survive).
--
-- 2) The view's own grant was missing the paired `revoke all ... from
--    public` this codebase's two prior "directory" views both carry
--    (public.specialist_directory / public.therapy_directory, both in
--    20260910172703_specialist_providers_commercial_columns_off_the_patient_
--    surface.sql) — added here for parity.
--
-- 3) `drop policy clinical_staff_select` (in the original migration) had no
--    `if exists` guard, unlike every other migration that has touched this
--    same policy (most recently 20260922175144_support_view_as.sql) — a
--    replay-safety gap, not a behaviour bug. Not fixed retroactively in the
--    original file: that would create file-vs-schema_migrations.statements
--    drift for an already-applied version — see this repo's own standing
--    migration-drift lesson. The next statement that touches this policy
--    (this one) restores the guard going forward.

drop policy if exists clinical_staff_select on public.clinical_staff;

create policy clinical_staff_select on public.clinical_staff
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or ((profile_id is not null) and private.can_support_view(profile_id))
  );

create or replace view public.clinical_staff_directory
  with (security_invoker = false)
  as
  select
    id,
    organisation_id,
    profile_id,
    full_name,
    photo_url,
    credential_type,
    credential_number,
    specialty,
    bio,
    active,
    doctor_tier,
    employment_type,
    offers_therapy_sessions
  from public.clinical_staff
  where organisation_id = private.current_org_id()
     or private.is_org_staff(organisation_id)
     or ((profile_id is not null) and private.can_support_view(profile_id))
     or coalesce(current_setting('role', true), '') = 'service_role'
     or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';

comment on view public.clinical_staff_directory is
  'Safe-column subset of clinical_staff for patient/family-facing trust display (docs/CLINICAL_TRUST_MODEL_SPEC.md), plus internal service-role callers (cron/notification routes) that have no auth.uid() at all. Deliberately owner-run, not security_invoker: embeds its own org/staff/service-role predicate rather than inheriting the base table''s RLS, which no longer admits a patient. Never add indemnity_*/staff_number/verified_by/credential_verified_by/*_verified_at columns here.';

revoke all on public.clinical_staff_directory from public;
grant select on public.clinical_staff_directory to authenticated;

do $$
declare
  v_service_role_visible boolean;
begin
  perform set_config('role', 'service_role', true);
  select exists (select 1 from public.clinical_staff_directory limit 1) into v_service_role_visible;
  perform set_config('role', 'postgres', true);
  if not v_service_role_visible and exists (select 1 from public.clinical_staff) then
    raise exception 'clinical_staff_directory: a service_role caller still sees zero rows despite existing clinical_staff data';
  end if;
end $$;
