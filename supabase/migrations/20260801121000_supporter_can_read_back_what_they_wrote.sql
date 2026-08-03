-- A supporter must be able to read back the thing they just recorded.
--
-- THE TRAP, worth reading before writing another acting-for policy:
-- `insert ... returning` is checked against the SELECT policy as well as the
-- INSERT one, and when the SELECT policy rejects the new row Postgres raises
--
--     42501: new row violates row-level security policy
--
-- which is the *same message* as a WITH CHECK failure. So an INSERT policy
-- that is perfectly correct still fails, and the error points at the wrong
-- half. supabase-js `.insert(...).select("id")` compiles to exactly that, so
-- every write path in the app hits it while a plain `insert` in a test does
-- not — which is how the previous migration's own test passed while the real
-- danger-symptom button failed with RLS in the browser.
--
-- The fix is narrow on purpose: a supporter may read a row BECAUSE THEY WROTE
-- IT, matched on logged_by_profile_id. This adds no visibility over anything
-- the patient recorded themselves, and nothing over the rest of the record —
-- reading the patient's own data stays gated on their explicit clinical
-- consent, exactly as before.

drop policy if exists emergency_events_select_own_report on public.emergency_events;
create policy emergency_events_select_own_report on public.emergency_events
  for select to authenticated
  using (logged_by_profile_id = (select auth.uid()));

drop policy if exists patient_hospital_admissions_select_own_report
  on public.patient_hospital_admissions;
create policy patient_hospital_admissions_select_own_report
  on public.patient_hospital_admissions
  for select to authenticated
  using (logged_by_profile_id = (select auth.uid()));

drop policy if exists risk_assessment_responses_select_own_entry
  on public.risk_assessment_responses;
create policy risk_assessment_responses_select_own_entry
  on public.risk_assessment_responses
  for select to authenticated
  using (logged_by_profile_id = (select auth.uid()));

-- vitals_readings and symptoms are covered today only because the supporter
-- also holds clinical-read consent. Someone with 'manage' but no clinical
-- consent would hit the identical trap the moment they logged a reading, so
-- close it the same way rather than leaving a latent one.
drop policy if exists vitals_readings_select_own_entry on public.vitals_readings;
create policy vitals_readings_select_own_entry on public.vitals_readings
  for select to authenticated
  using (logged_by_profile_id = (select auth.uid()));

drop policy if exists symptoms_select_own_entry on public.symptoms;
create policy symptoms_select_own_entry on public.symptoms
  for select to authenticated
  using (logged_by_profile_id = (select auth.uid()));

do $$
declare
  v_missing text;
begin
  -- Every table a supporter can INSERT into must have a matching
  -- read-back-what-you-wrote SELECT policy, or `.select()` after the insert
  -- fails with a message that points at the wrong policy.
  select string_agg(t.tbl, ', ')
    into v_missing
  from (values ('emergency_events'), ('patient_hospital_admissions'),
               ('risk_assessment_responses'), ('vitals_readings'), ('symptoms')) as t(tbl)
  where not exists (
    select 1 from pg_policies p
     where p.schemaname = 'public' and p.tablename = t.tbl and p.cmd = 'SELECT'
       and p.qual::text like '%logged_by_profile_id%'
  );

  if v_missing is not null then
    raise exception 'these tables let a supporter write but not read back: %', v_missing;
  end if;
end $$;
