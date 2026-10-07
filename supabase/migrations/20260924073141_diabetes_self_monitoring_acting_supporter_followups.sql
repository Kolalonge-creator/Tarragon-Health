-- Two gaps in 20260924071557_diabetes_self_monitoring_acting_supporter.sql,
-- found by /code-review ultra on that same diff before it shipped:
--
-- 1. insulin_logs/foot_self_checks/sick_day_logs got an
--    *_insert_acting_supporter policy but no matching *_select_own_entry
--    one -- exactly the trap 20260801121000_supporter_can_read_back_what_
--    they_wrote.sql already documented and fixed for vitals_readings/
--    symptoms/emergency_events/patient_hospital_admissions/
--    risk_assessment_responses: `insert(...).select(...)` is checked against
--    the SELECT policy too (Postgres raises the same 42501 "new row violates
--    row-level security policy" whether the INSERT or the SELECT policy is
--    the one that actually failed), so a supporter's write silently breaks
--    the moment any caller adds `.select()`, or the supporter/dependent ever
--    needs to read the entry back. Dormant today only because
--    logInsulin/logFootSelfCheck/logSickDay (apps/web/.../actions.ts) happen
--    not to chain .select() yet -- closing it now rather than leaving the
--    same latent trap this codebase has already been bitten by once.
--
-- 2. setPatientReportedDiabetesType (same page, same acting-for gap) calls
--    public.set_patient_reported_diabetes_type(p_type), which is entirely
--    keyed on auth.uid() with no patient parameter at all
--    (20260810032736_diabetes_type_profile.sql) -- so even though
--    currentPatientOrg() now correctly resolves the acting-for subject, this
--    one action has nowhere to pass it, and a parent selecting a diabetes
--    type for their child silently overwrites the PARENT's own
--    patient_diabetes_profile row instead. Fixed by adding an optional
--    p_patient_id (defaulting to auth.uid(), so every existing call site is
--    unaffected), authorised the same way every other acting-for write on
--    this platform is: self, or private.can_act_for(p_patient_id).

drop policy if exists insulin_logs_select_own_entry on public.insulin_logs;
create policy insulin_logs_select_own_entry on public.insulin_logs
  for select to authenticated
  using (logged_by_profile_id = (select auth.uid()));

drop policy if exists foot_self_checks_select_own_entry on public.foot_self_checks;
create policy foot_self_checks_select_own_entry on public.foot_self_checks
  for select to authenticated
  using (logged_by_profile_id = (select auth.uid()));

drop policy if exists sick_day_logs_select_own_entry on public.sick_day_logs;
create policy sick_day_logs_select_own_entry on public.sick_day_logs
  for select to authenticated
  using (logged_by_profile_id = (select auth.uid()));

drop function if exists public.set_patient_reported_diabetes_type(diabetes_type);

create or replace function public.set_patient_reported_diabetes_type(
  p_type diabetes_type,
  p_patient_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := coalesce(p_patient_id, (select auth.uid()));
  v_org uuid;
begin
  if v_patient is distinct from (select auth.uid())
     and not private.can_act_for(v_patient) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select organisation_id into v_org from public.profiles where id = v_patient;
  if v_org is null then
    raise exception 'No organisation on file for this account';
  end if;

  insert into public.patient_diabetes_profile (patient_id, organisation_id, patient_reported_type)
  values (v_patient, v_org, p_type)
  on conflict (patient_id) do update
    set patient_reported_type = excluded.patient_reported_type;
end;
$$;

revoke all on function public.set_patient_reported_diabetes_type(diabetes_type, uuid) from public;
revoke all on function public.set_patient_reported_diabetes_type(diabetes_type, uuid) from anon;
grant execute on function public.set_patient_reported_diabetes_type(diabetes_type, uuid) to authenticated;

do $$
declare
  v_missing text;
begin
  select string_agg(t.tbl, ', ')
    into v_missing
  from (values ('insulin_logs'), ('foot_self_checks'), ('sick_day_logs')) as t(tbl)
  where not exists (
    select 1 from pg_policies p
     where p.schemaname = 'public' and p.tablename = t.tbl and p.cmd = 'SELECT'
       and p.qual::text like '%logged_by_profile_id%'
  );
  if v_missing is not null then
    raise exception 'these tables let a supporter write but not read back: %', v_missing;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_patient_reported_diabetes_type'
       and pg_get_function_identity_arguments(p.oid) = 'p_type diabetes_type, p_patient_id uuid'
  ) then
    raise exception 'set_patient_reported_diabetes_type did not pick up the p_patient_id parameter';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_patient_reported_diabetes_type'
       and pg_get_function_identity_arguments(p.oid) = 'p_type diabetes_type'
  ) then
    raise exception 'the old 1-arg set_patient_reported_diabetes_type overload was not dropped';
  end if;
  if has_function_privilege('anon', 'public.set_patient_reported_diabetes_type(diabetes_type, uuid)', 'EXECUTE') then
    raise exception 'anon must never be able to set a patient-reported diabetes type';
  end if;
end $$;
