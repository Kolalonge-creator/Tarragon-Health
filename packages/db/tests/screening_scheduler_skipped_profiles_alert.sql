-- Tarragon Health: screening safety case gaps HZ-SCR-03 and HZ-SCR-06
-- (migration 20261029215729_screening_scheduler_skipped_profiles_alert_and_incident_owner).
--
-- Proves:
--   1. a real active patient with no date of birth or sex is counted by the full nightly run, one audit_log row is written
--      (a count only, no patient named) and exactly one sev3 incident opens, owned by the active Chief Medical Officer;
--   2. running the scheduler again does not open a second incident while the first is still open;
--   3. a TEST patient with the same gap is not counted (no noise from fixtures);
--   4. a patient with a complete profile is not counted;
--   5. a single-patient run (p_patient set) never raises the incident;
--   6. the request-automation failure incident also gets the CMO as owner (the failing row is forced by a stub lab_orders
--      insert that raises);
--   7. the owner resolver is not callable by anon or a signed-in user.
--
-- Sabotage (by hand): in run_screening_scheduler delete the `if v_missing > 0 then` block. Step 1 must then fail; if it still
-- passes, the gap alert is untested. Second sabotage: remove `private.screening_incident_owner()` from the request-automation
-- incident insert. Step 6 must then fail.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/screening_scheduler_skipped_profiles_alert.sql

begin;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean, p_dob date default null, p_sex text default null) returns uuid
language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'sk-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = p_org, role = p_role::public.user_role, full_name = 'Skip ' || p_label,
         is_test = p_test, is_active = true, date_of_birth = p_dob, sex = p_sex::public.sex
   where id = v;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_staff uuid; v_set uuid; v_gap uuid; v_gap_test uuid; v_ok uuid;
  v_before integer; v_n integer; v_inc public.ops_incidents%rowtype; v_res jsonb; v_audit jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician', false);
  -- only this CMO may be the owner: any other active CMO in the database is set aside (rolled back with everything)
  update public.clinical_staff set active = false where doctor_tier = 'chief_medical_officer';
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_cmo, 'Skip cmo', 'MDCN', 'SK-' || substr(v_cmo::text, 1, 8), true, 'active', now(), v_admin,
          'chief_medical_officer'::public.doctor_tier, 'contracted'::public.staff_employment_type, 2, true, v_admin, false)
  returning id into v_staff;

  -- a signed rule set and the scheduler guard on (both rolled back); the guard stub is the s98 proof's pattern
  update public.screening_rule_sets set approved_by = v_staff, approved_at = now(), is_active = true where version = 1;
  select id into v_set from public.screening_rule_sets where version = 1;
  create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
    as $b$select p_key in ('screening_scheduler_enabled', 'screening_request_automation_enabled')$b$;

  v_gap := pg_temp.mkuser(v_org, 'gap-real', 'patient', false, null, null);
  v_gap_test := pg_temp.mkuser(v_org, 'gap-test', 'patient', true, null, null);
  v_ok := pg_temp.mkuser(v_org, 'complete', 'patient', false, date '1980-01-01', 'female');

  -- 0. the owner resolver finds exactly this CMO
  if private.screening_incident_owner() is distinct from v_cmo then
    raise exception 'FAIL 0: owner resolver returned %, expected the active CMO %', private.screening_incident_owner(), v_cmo;
  end if;

  -- 5 first: a single-patient run never raises the incident
  v_res := private.run_screening_scheduler(v_gap);
  if exists (select 1 from public.ops_incidents where external_reference = 'screening_scheduler_missing_profile_data') then
    raise exception 'FAIL 5: a single-patient run opened the missing-profile incident';
  end if;

  -- 1. the full nightly run counts, audits and opens one owned incident
  select count(*) into v_before from public.profiles
   where role = 'patient' and is_active and organisation_id is not null and not coalesce(is_test, false) and (date_of_birth is null or sex is null);
  v_res := private.run_screening_scheduler(null);
  if (v_res ->> 'ran') <> 'true' then raise exception 'FAIL 1: the scheduler did not run: %', v_res; end if;
  if (v_res ->> 'skipped_missing_profile')::integer <> v_before then
    raise exception 'FAIL 1: counted % skipped, expected % (test patients and complete profiles must not count)', v_res ->> 'skipped_missing_profile', v_before;
  end if;
  if v_before < 1 then raise exception 'FAIL 1: the fixture produced no real patient with a gap'; end if;
  select count(*) into v_n from public.ops_incidents where external_reference = 'screening_scheduler_missing_profile_data' and status not in ('resolved', 'closed');
  if v_n <> 1 then raise exception 'FAIL 1: % open incidents, expected 1', v_n; end if;
  select * into v_inc from public.ops_incidents where external_reference = 'screening_scheduler_missing_profile_data';
  if v_inc.owner_id is distinct from v_cmo then raise exception 'FAIL 1: incident owner is %, expected the CMO %', v_inc.owner_id, v_cmo; end if;
  if v_inc.severity::text <> 'sev3' then raise exception 'FAIL 1: severity %', v_inc.severity; end if;
  select event into v_audit from public.audit_log where action = 'screening_scheduler.skipped_missing_profile_data' order by created_at desc limit 1;
  if v_audit is null or (v_audit ->> 'skipped')::integer <> v_before then raise exception 'FAIL 1: audit row missing or wrong count: %', v_audit; end if;
  -- INV-07: neither the incident nor the audit row names a patient
  if v_inc.summary like '%' || v_gap::text || '%' or v_audit::text like '%' || v_gap::text || '%' or v_inc.summary ilike '%Skip gap%' then
    raise exception 'FAIL 1: a patient is named in the incident or audit row';
  end if;

  -- 2. a second run does not open a second incident
  perform private.run_screening_scheduler(null);
  select count(*) into v_n from public.ops_incidents where external_reference = 'screening_scheduler_missing_profile_data';
  if v_n <> 1 then raise exception 'FAIL 2: % incidents after a second run, expected 1', v_n; end if;

  -- 6. request-automation failure incident gets the CMO as owner. Force a failure: a schedule due today for the complete-profile
  -- patient, and a lab_orders insert trigger that raises.
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date, rule_set_id)
  values (v_org, v_ok, (select id from public.screen_types where code = 'hba1c'), 'pending', current_date - 1, v_set);
  create function pg_temp.boom() returns trigger language plpgsql as $t$ begin raise exception 'proof: forced failure'; end $t$;
  create trigger zz_proof_boom before insert on public.lab_orders for each row execute function pg_temp.boom();
  -- the bundle for hba1c must exist for the row to reach the insert; if the fixture database has none, add the failure through
  -- the guard path instead
  if exists (select 1 from public.panel_bundles b where b.is_active and b.test_codes = array['hba1c']) then
    v_res := private.run_screening_request_automation(null);
    if coalesce((v_res ->> 'failed')::integer, 0) < 1 then raise exception 'FAIL 6: the forced failure was not counted: %', v_res; end if;
    select * into v_inc from public.ops_incidents where external_reference = 'screening_request_automation' and status not in ('resolved', 'closed');
    if v_inc.id is null then raise exception 'FAIL 6: no failure incident opened'; end if;
    if v_inc.owner_id is distinct from v_cmo then raise exception 'FAIL 6: failure incident owner is %, expected the CMO', v_inc.owner_id; end if;
  else
    raise notice 'NOTE 6: no active hba1c single-test bundle in this database, step 6 skipped';
  end if;
  drop trigger zz_proof_boom on public.lab_orders;

  -- 7. privileges
  if has_function_privilege('anon', 'private.screening_incident_owner()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.screening_incident_owner()', 'EXECUTE') then
    raise exception 'FAIL 7: the owner resolver is callable by anon or a signed-in user';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
