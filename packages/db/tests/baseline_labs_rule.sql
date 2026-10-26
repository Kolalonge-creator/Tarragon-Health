-- Proof: the CMO-owned baseline-labs prescribing rule (migration *_baseline_labs_prescribing_rule.sql).
--
--   a. A non-CMO (admin, senior doctor, patient, anon) cannot sign (42501) and nothing becomes active.
--   b. The CMO signs: version active and signed, an audit row is written, a second signing is refused.
--   c. With NO active rule, starting and raising the dose of a BP or glucose-lowering medicine is untouched (complete no-op).
--   d. With the rule active: a start or a dose increase is refused (23514) when labs are missing, allowed when all are present and recent,
--      refused when the labs are older than the window; a dose decrease and a same-dose amendment are allowed; an unrelated drug is allowed.
--   e. A patient recording their own medicine (source patient) and an import (fhir_import) are never blocked.
--   f. HbA1c is required only when diabetes is on the problem list.
--   g. SABOTAGE: the trigger function emptied; the refusal check must flip (a test that cannot fail is not a test).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'bllabs-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'BLLabs ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'BLLabs ' || p_label, 'MDCN', 'BLLabs-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true)
  returning id into v_staff;
  return v;
end $f$;
create function pg_temp.lab(p_org uuid, p_pat uuid, p_code text, p_unit text, p_days_ago integer) returns void language sql as
$$ insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
   values (p_org, p_pat, p_code, 5, p_unit, now() - make_interval(days => p_days_ago)) $$;
create function pg_temp.upd(p_uid uuid, p_id uuid, p_dose text) returns text language plpgsql as
$f$ declare r text; n integer;
begin
  -- the prescriber's identity without the row-level filter: the thing under test is the trigger, and the signed-prescription trigger only guards API sessions
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  begin
    update public.medications set dose = p_dose where id = p_id;
    get diagnostics n = row_count;
    r := case when n = 1 then 'ok' else 'norows:' || n end;
  exception when others then r := sqlstate || ':' || sqlerrm;
  end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.updf(p_uid uuid, p_id uuid, p_freq text) returns text language plpgsql as
$f$ declare r text; n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  begin
    update public.medications set frequency = p_freq where id = p_id;
    get diagnostics n = row_count;
    r := case when n = 1 then 'ok' else 'norows:' || n end;
  exception when others then r := sqlstate || ':' || sqlerrm;
  end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.med(p_org uuid, p_pat uuid, p_drug text, p_dose text, p_source text, p_prev uuid default null) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, previous_version_id)
  values (p_org, p_pat, p_drug, p_dose, 'once daily', p_source::public.medication_source, true, p_prev) returning id into v;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_smo uuid; v_pat uuid; v_dm uuid; v_ver integer;
  v_m uuid; v_old uuid; v_fut uuid; v_nl uuid; v_stop uuid; v_ren uuid; v_fq uuid; v_fm uuid; v_fm2 uuid; v_txt text; v_n integer; v_missing text[];
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_smo := pg_temp.mkdoc(v_org, v_admin, 'smo', 'senior_medical_officer');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_dm := pg_temp.mkuser(v_org, 'diabetic', 'patient');
  v_fq := pg_temp.mkuser(v_org, 'freq', 'patient');
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, icd10_code, status)
  values (v_org, v_dm, 'Type 2 diabetes', 'E11', 'active');

  select version into v_ver from public.baseline_labs_rule_config order by version desc limit 1;

  -- the draft is born unsigned and inactive
  perform pg_temp.rec('the seeded draft is unsigned and inactive', 'false/null', (select is_active::text || '/' || coalesce(approved_at::text, 'null') from public.baseline_labs_rule_config where version = v_ver));

  -- c. NO active rule: complete no-op (start and uptitrate, BP and glucose, no labs on file)
  perform pg_temp.rec('c1 no rule: a doctor starts metformin with no labs', 'ok', pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_pat, 'Metformin', '500 mg', 'specialist')));
  v_m := (select id from public.medications where patient_id = v_pat and drug_name = 'Metformin');
  perform pg_temp.rec('c2 no rule: a prescriber raises the dose with no labs', 'ok', pg_temp.upd(v_cmo, v_m, '1000 mg'));
  perform pg_temp.rec('c3 no rule: a doctor starts amlodipine with no labs', 'ok', pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_pat, 'Amlodipine', '5 mg', 'clinician')));
  perform pg_temp.rec('c4 no rule: baseline_labs_missing is empty', '0', cardinality(private.baseline_labs_missing(v_pat, 'Metformin'))::text);

  -- a. not the CMO
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('a1 an admin cannot sign', '42501', left(pg_temp.msg(format('select public.sign_baseline_labs_rule_config(%s)', v_ver)), 5));
  perform pg_temp.back();
  perform pg_temp.act(v_smo);
  perform pg_temp.rec('a2 a senior doctor who is not the CMO cannot sign', '42501', left(pg_temp.msg(format('select public.sign_baseline_labs_rule_config(%s)', v_ver)), 5));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a3 a patient cannot sign', '42501', left(pg_temp.msg(format('select public.sign_baseline_labs_rule_config(%s)', v_ver)), 5));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('a4 anon cannot sign', '42501', left(pg_temp.msg(format('select public.sign_baseline_labs_rule_config(%s)', v_ver)), 5));
  perform pg_temp.back();
  perform pg_temp.rec('a5 nothing became active', '0', (select count(*)::text from public.baseline_labs_rule_config where is_active or approved_at is not null));

  -- b. the CMO signs
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('b1 the CMO signs', 'ok', pg_temp.msg(format('select public.sign_baseline_labs_rule_config(%s)', v_ver)));
  perform pg_temp.back();
  perform pg_temp.rec('b2 the version is active and signed by the CMO', 'true/true', (select (is_active)::text || '/' || (approved_by = v_cmo)::text from public.baseline_labs_rule_config where version = v_ver));
  perform pg_temp.rec('b3 an audit row was written', '1', (select count(*)::text from public.audit_log where action = 'baseline_labs_rule_config.signed' and actor_id = v_cmo));
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('b4 signing again is refused', '23514', left(pg_temp.msg(format('select public.sign_baseline_labs_rule_config(%s)', v_ver)), 5));
  perform pg_temp.back();

  -- d. rule active, no labs
  perform pg_temp.rec('d1 start metformin with no labs is refused', '23514', left(pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_pat, 'Metformin', '500 mg', 'clinician')), 5));
  v_txt := pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_pat, 'Lisinopril', '10 mg', 'clinician'));
  perform pg_temp.rec('d2 the refusal names the missing labs', 'true', (v_txt like '%Kidney function%' and v_txt like '%Potassium%' and v_txt like '%Glucose%' and v_txt like '%90 days%')::text);
  perform pg_temp.rec('d2b a non-diabetic is not asked for HbA1c', 'false', (v_txt like '%HbA1c%')::text);
  perform pg_temp.rec('d3 raising the dose with no labs is refused', '23514', left(pg_temp.upd(v_cmo, v_m, '2000 mg'), 5));
  perform pg_temp.rec('d3b raising the dose with a different unit is refused (cannot show it did not go up)', '23514', left(pg_temp.upd(v_cmo, v_m, '2 g'), 5));
  perform pg_temp.rec('d4 lowering the dose with no labs is allowed', 'ok', pg_temp.upd(v_cmo, v_m, '250 mg'));
  perform pg_temp.rec('d5 an unrelated medicine is allowed with no labs', 'ok', pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_pat, 'Paracetamol', '500 mg', 'clinician')));
  perform pg_temp.rec('d6 an amendment that raises the dose is refused', '23514', left(pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L,%L)', v_org, v_pat, 'Metformin', '2000 mg', 'clinician', v_m)), 5));
  perform pg_temp.rec('d7 an amendment that keeps the dose is allowed', 'ok', pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L,%L)', v_org, v_pat, 'Metformin', '250 mg', 'clinician', v_m)));

  -- e. patient self-report and import never blocked
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('e1 a patient records their own metformin', 'ok', pg_temp.msg(format('insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active) values (%L,%L,%L,%L,%L,%L,true)', v_org, v_pat, 'Metformin', '850 mg', 'twice daily', 'patient')));
  perform pg_temp.back();
  perform pg_temp.rec('e2 an imported record is not blocked', 'ok', pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_pat, 'Insulin glargine', '20 units', 'fhir_import')));

  -- d. labs present and recent: start allowed
  perform pg_temp.lab(v_org, v_pat, 'creatinine', 'umol/L', 10);
  perform pg_temp.lab(v_org, v_pat, 'potassium', 'mmol/L', 10);
  perform pg_temp.rec('d8 two of three labs: still refused, and only the glucose is named', 'true', (pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_pat, 'Losartan', '50 mg', 'clinician')) like '%Glucose%'
     and pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_pat, 'Losartan', '50 mg', 'clinician')) not like '%Potassium%')::text);
  perform pg_temp.lab(v_org, v_pat, 'fasting_glucose', 'mmol/L', 10);
  perform pg_temp.rec('d9 all three recent: a start is allowed', 'ok', pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_pat, 'Losartan', '50 mg', 'clinician')));
  perform pg_temp.rec('d10 all three recent: a dose increase is allowed', 'ok', pg_temp.upd(v_cmo, v_m, '1000 mg'));
  perform pg_temp.rec('d11 baseline_labs_missing is empty with labs on file', '0', cardinality(private.baseline_labs_missing(v_pat, 'Losartan'))::text);

  -- d. labs older than the window
  v_old := pg_temp.mkuser(v_org, 'stale', 'patient');
  perform pg_temp.lab(v_org, v_old, 'creatinine', 'umol/L', 10);
  perform pg_temp.lab(v_org, v_old, 'fasting_glucose', 'mmol/L', 10);
  perform pg_temp.lab(v_org, v_old, 'potassium', 'mmol/L', 120);
  perform pg_temp.rec('d12 a potassium older than 90 days: a start is refused', '23514', left(pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_old, 'Ramipril', '5 mg', 'clinician')), 5));
  perform pg_temp.rec('d13 and only the potassium is named', '{Potassium}', private.baseline_labs_missing(v_old, 'Ramipril')::text);

  -- d (review fixes). a lab dated in the future does not count; a restart, a rename and a frequency increase are checked; a lower frequency is not
  v_fut := pg_temp.mkuser(v_org, 'future', 'patient');
  perform pg_temp.lab(v_org, v_fut, 'creatinine', 'umol/L', 10);
  perform pg_temp.lab(v_org, v_fut, 'fasting_glucose', 'mmol/L', 10);
  perform pg_temp.lab(v_org, v_fut, 'potassium', 'mmol/L', -10);
  perform pg_temp.rec('d14 a potassium dated in the future does not count', '{Potassium}', private.baseline_labs_missing(v_fut, 'Ramipril')::text);

  v_nl := pg_temp.mkuser(v_org, 'nolabs', 'patient');
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active)
    values (v_org, v_nl, 'Losartan', '50 mg', 'once daily', 'clinician', false) returning id into v_stop;
  perform pg_temp.rec('d15 restarting a stopped medicine with no labs is refused', '23514',
    left(pg_temp.msg(format('update public.medications set is_active = true where id = %L', v_stop)), 5));
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active)
    values (v_org, v_nl, 'Paracetamol', '500 mg', 'once daily', 'clinician', true) returning id into v_ren;
  perform pg_temp.rec('d16 renaming an unrelated drug into a checked one with no labs is refused', '23514',
    left(pg_temp.msg(format('update public.medications set drug_name = %L where id = %L', 'Ramipril', v_ren)), 5));

  -- seed an existing clinician prescription for a patient with no labs (the trigger is paused only to plant the row)
  alter table public.medications disable trigger medications_c_baseline_labs_rule;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active)
    values (v_org, v_fq, 'Losartan', '50 mg', 'once daily', 'clinician', true) returning id into v_fm;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active)
    values (v_org, v_fq, 'Amlodipine', '5 mg', 'twice daily', 'clinician', true) returning id into v_fm2;
  alter table public.medications enable trigger medications_c_baseline_labs_rule;
  perform pg_temp.rec('d17 a higher frequency at the same strength is checked, and refused with no labs', '23514',
    left(pg_temp.updf(v_cmo, v_fm, 'three times daily'), 5));
  perform pg_temp.rec('d18 the same frequency written differently is not an increase', 'ok',
    pg_temp.updf(v_cmo, v_fm, 'once daily '));
  perform pg_temp.rec('d19 a lower frequency is not an increase', 'ok',
    pg_temp.updf(v_cmo, v_fm2, 'once daily'));

  -- f. HbA1c only for diabetes
  perform pg_temp.lab(v_org, v_dm, 'creatinine', 'umol/L', 5);
  perform pg_temp.lab(v_org, v_dm, 'potassium', 'mmol/L', 5);
  perform pg_temp.lab(v_org, v_dm, 'random_glucose', 'mmol/L', 5);
  perform pg_temp.rec('f1 a diabetic with no HbA1c is refused and HbA1c named', 'true', (pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_dm, 'Metformin', '500 mg', 'clinician')) like '23514:%HbA1c%')::text);
  perform pg_temp.lab(v_org, v_dm, 'hba1c', 'percent', 5);
  perform pg_temp.rec('f2 a diabetic with an HbA1c is allowed', 'ok', pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_dm, 'Metformin', '500 mg', 'clinician')));

  -- g. SABOTAGE: the trigger function emptied; the refusal must disappear
  create or replace function private.enforce_baseline_labs_rule() returns trigger language plpgsql security definer set search_path = '' as $s$ begin return new; end $s$;
  v_txt := pg_temp.msg(format('select pg_temp.med(%L,%L,%L,%L,%L)', v_org, v_old, 'Ramipril', '5 mg', 'clinician'));
  insert into results values ('sabotaged', 'a start with a stale potassium is refused', '23514', left(v_txt, 5));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Baseline labs rule proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage step did not change the refusal check'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
