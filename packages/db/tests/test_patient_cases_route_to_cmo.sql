-- ===========================================================================
-- Proof: 20261103023419_test_patient_cases_route_to_cmo.sql
-- PROVES, in a fresh organisation with two senior doctors (created first, zero load) and one Chief Medical Officer:
--   1. A test patient's alert is owned by the CMO with no backup, although the least-loaded senior doctor would have
--      been the picker's choice.
--   2. CONTROL: a real patient's alert of the same type goes to the first senior doctor (owner tier) with the second as
--      backup, so the missing backup in check 1 is a choice, not a shortage.
--   3. The sweep gives a test patient's unowned alert to the CMO.
--   4. A test patient's escalation is assigned to the CMO's profile; a real patient's (CONTROL) to the senior doctor.
--   5. An organisation with no CMO falls through: the test patient's alert still gets an owner (the senior doctor).
--   6. SABOTAGE: with private.test_patient_cover returning null, a fresh test-patient alert goes to the senior doctor,
--      so check 1 discriminates.
-- Wrapped in BEGIN/ROLLBACK; mints its own organisations, people and rows.
-- ===========================================================================
begin;
create temp table r (check_name text, observed text, expected text, verdict text);
create function pg_temp.chk(p_name text, p_expected text, p_observed text) returns void language plpgsql as $$
begin
  insert into r values (p_name, p_observed, p_expected, case when p_observed is not distinct from p_expected then 'PASS' else 'FAIL' end);
end $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'tpc-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'TPC ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test,
          is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_label text, p_tier text, p_verifier uuid) returns uuid
language plpgsql as $f$
declare v_profile uuid := pg_temp.mkuser(p_org, p_label, 'clinician', true); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v_profile, 'TPC ' || p_label, 'MDCN', 'TPC-' || substr(v_profile::text, 1, 8), true, 'active', now(), p_verifier,
      p_tier::public.doctor_tier, (case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end)::public.staff_employment_type,
      2, p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_verifier end, true)
  returning id into v_staff;
  return v_staff;
end $f$;
create function pg_temp.mkalert(p_org uuid, p_patient uuid) returns uuid language plpgsql as $f$
declare v uuid;
begin
  -- abnormal_result: owner, backup and senior tier are all senior_medical_officer in the governed rule set.
  insert into public.clinician_alerts (organisation_id, patient_id, level, title, type_code, status)
  values (p_org, p_patient, 'clinician_review', 'TPC alert', 'abnormal_result', 'open') returning id into v;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_org_nocmo uuid; v_admin uuid; v_smo uuid; v_smo_b uuid; v_cmo uuid; v_smo2 uuid;
  v_test uuid; v_real uuid; v_test2 uuid;
  v_a uuid; v_e uuid; v_n integer; v_src text;
begin
  insert into public.organisations (name, type) values ('TPC org', 'direct_consumer') returning id into v_org;
  insert into public.organisations (name, type) values ('TPC org without CMO', 'direct_consumer') returning id into v_org_nocmo;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  v_smo := pg_temp.mkstaff(v_org, 'smo', 'senior_medical_officer', v_admin);
  perform pg_sleep(0.01);
  v_smo_b := pg_temp.mkstaff(v_org, 'smo-b', 'senior_medical_officer', v_admin);
  perform pg_sleep(0.01);
  v_cmo := pg_temp.mkstaff(v_org, 'cmo', 'chief_medical_officer', v_admin);
  v_smo2 := pg_temp.mkstaff(v_org_nocmo, 'smo-nocmo', 'senior_medical_officer', v_admin);
  v_test := pg_temp.mkuser(v_org, 'test patient', 'patient', true);
  v_real := pg_temp.mkuser(v_org, 'real patient', 'patient', false);
  v_test2 := pg_temp.mkuser(v_org_nocmo, 'test patient no cmo', 'patient', true);

  perform pg_temp.chk('0 cover of the org is the CMO', v_cmo::text, private.test_patient_cover(v_org)::text);

  -- 1. test patient's alert -> CMO, no backup
  v_a := pg_temp.mkalert(v_org, v_test);
  perform pg_temp.chk('1a test patient alert owned by the CMO', v_cmo::text, (select responsible_clinician_id::text from public.clinician_alerts where id = v_a));
  perform pg_temp.chk('1b test patient alert has no backup', 'true', (select (backup_clinician_id is null)::text from public.clinician_alerts where id = v_a));
  perform pg_temp.chk('1c test patient alert carries assigned_at', 'true', (select (assigned_at is not null)::text from public.clinician_alerts where id = v_a));

  -- 2. CONTROL: real patient's alert -> first senior doctor (owner tier), second senior doctor as backup
  v_a := pg_temp.mkalert(v_org, v_real);
  perform pg_temp.chk('2a CONTROL real patient alert owned by the senior doctor', v_smo::text, (select responsible_clinician_id::text from public.clinician_alerts where id = v_a));
  perform pg_temp.chk('2b CONTROL real patient alert backed up by the second senior doctor', v_smo_b::text, (select backup_clinician_id::text from public.clinician_alerts where id = v_a));

  -- 3. sweep: an unowned test-patient alert -> CMO
  v_a := pg_temp.mkalert(v_org, v_test);
  update public.clinician_alerts set responsible_clinician_id = null, assigned_at = null, duplicate_of = null, suppressed = false where id = v_a;
  v_n := private.assign_unowned_clinician_alerts();
  perform pg_temp.chk('3 sweep gives the unowned test patient alert to the CMO', v_cmo::text, (select responsible_clinician_id::text from public.clinician_alerts where id = v_a));

  -- 4. escalations
  insert into public.escalations (organisation_id, patient_id, status, reason) values (v_org, v_test, 'open', 'TPC test') returning id into v_e;
  perform pg_temp.chk('4a test patient escalation assigned to the CMO profile', (select profile_id::text from public.clinical_staff where id = v_cmo), (select assigned_doctor_id::text from public.escalations where id = v_e));
  insert into public.escalations (organisation_id, patient_id, status, reason) values (v_org, v_real, 'open', 'TPC real') returning id into v_e;
  perform pg_temp.chk('4b CONTROL real patient escalation assigned to the senior doctor profile', (select profile_id::text from public.clinical_staff where id = v_smo), (select assigned_doctor_id::text from public.escalations where id = v_e));

  -- 5. no CMO: falls through to the picker
  perform pg_temp.chk('5a org without a CMO has no cover', null, private.test_patient_cover(v_org_nocmo)::text);
  v_a := pg_temp.mkalert(v_org_nocmo, v_test2);
  perform pg_temp.chk('5b test patient alert still owned (senior doctor) where there is no CMO', v_smo2::text, (select responsible_clinician_id::text from public.clinician_alerts where id = v_a));

  -- 6. SABOTAGE: cover returns null -> the picker's choice (senior doctor) wins, so check 1 discriminates
  v_src := pg_get_functiondef('private.test_patient_cover(uuid)'::regprocedure);
  create or replace function private.test_patient_cover(p_org uuid) returns uuid language sql stable security definer set search_path to '' as 'select null::uuid';
  v_a := pg_temp.mkalert(v_org, v_test);
  perform pg_temp.chk('6 SABOTAGE without the cover the test patient alert goes to the senior doctor', v_smo::text, (select responsible_clinician_id::text from public.clinician_alerts where id = v_a));
  execute v_src;
  perform pg_temp.chk('6b cover restored', v_cmo::text, private.test_patient_cover(v_org)::text);
end $$;

select * from r order by check_name;
do $$
declare v_fail integer;
begin
  select count(*) into v_fail from r where verdict = 'FAIL';
  if v_fail > 0 then raise exception 'test_patient_cases_route_to_cmo proof: % check(s) FAILED', v_fail; end if;
end $$;
rollback;
