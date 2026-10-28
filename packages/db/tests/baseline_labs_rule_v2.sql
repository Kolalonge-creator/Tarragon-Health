-- Proof: baseline labs rule VERSION 2 (migration *_baseline_labs_rule_v2_cmo_answers.sql), the CMO's answers of 2026-10-27. Raises on any failed check. One rolled-back transaction.
--   1. v2 is born unsigned and inactive, v1 is untouched; only the CMO can sign v2 (an admin cannot).
--   2. Signed v2: a calcium channel blocker and a beta blocker need no labs. ACE inhibitor / ARB need creatinine, potassium and sodium within 12 months (13 months is too old).
--      A thiazide also needs fasting glucose or HbA1c. Metformin needs creatinine and glucose or HbA1c; a sulfonylurea needs creatinine, HbA1c and glucose.
--   3. Metformin with an eGFR under 30 is refused with NO override (a recorded override does not help); eGFR above the limit is allowed.
--   4. HbA1c unreliable: only a prescriber tied to the patient can mark it; a glucose result then stands in for HbA1c, and a combined glucose-or-HbA1c test stops accepting HbA1c alone.
--   5. Pregnancy: a woman who could be pregnant (or with sex not on record) starting an ACE inhibitor, ARB or statin needs a negative pregnancy test within 30 days; a man or a woman past 50 is not asked.
--   6. A documented override lets a start through once, and the missing-labs follow-up falls due in 7 days.
--   SABOTAGE: the kidney rule removed from the trigger; the low-eGFR metformin start must then be accepted.
begin;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_sex text default 'male', p_age integer default 50) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'blv2-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test, language)
  values (v, p_org, p_role::public.user_role, 'BLv2 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => p_age) - interval '40 days')::date, p_sex::public.sex, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, sex = excluded.sex, date_of_birth = excluded.date_of_birth, organisation_id = excluded.organisation_id;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician', null, 45);
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'BLv2 ' || p_label, 'MDCN', 'BLv2-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true);
  return v;
end $f$;
create function pg_temp.lab(p_pat uuid, p_code text, p_value numeric, p_unit text, p_days_ago integer) returns void language sql as
$$ insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
   values ((select organisation_id from public.profiles where id = p_pat), p_pat, p_code, p_value, p_unit, now() - make_interval(days => p_days_ago)) $$;
create function pg_temp.negtest(p_pat uuid, p_days_ago integer) returns void language sql as
$$ insert into public.lab_analyte_readings (organisation_id, patient_id, code, value_text, taken_at)
   values ((select organisation_id from public.profiles where id = p_pat), p_pat, 'pregnancy_test', 'negative', now() - make_interval(days => p_days_ago)) $$;
-- start a medicine as the doctor; 'ok' or sqlstate | hint | message
create function pg_temp.start(p_uid uuid, p_pat uuid, p_drug text, p_dose text default '10 mg') returns text language plpgsql as $f$
declare r text; h text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  begin
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active)
    values ((select organisation_id from public.profiles where id = p_pat), p_pat, p_drug, p_dose, 'once daily', 'clinician', true);
    r := 'ok';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    r := sqlstate || '|' || coalesce(h, '') || '|' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $f$;
create function pg_temp.as_(p_uid uuid, p_sql text) returns text language plpgsql as $f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate || ':' || sqlerrm; end;
  execute 'reset role'; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.ck(p_what text, p_ok boolean, p_got text default null) returns void language plpgsql as $f$
begin if not coalesce(p_ok, false) then raise exception 'FAIL %: got %', p_what, p_got; end if; end $f$;

create temp table fx(k text primary key, v text) on commit drop;
grant all on fx to public;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v::uuid from fx where k = p_k $$;

do $$
declare v_org uuid; ad uuid; cmo uuid; smo uuid; untied uuid; r text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  ad := pg_temp.mkuser(v_org, 'admin', 'admin', null, 40);
  cmo := pg_temp.mkdoc(v_org, ad, 'cmo', 'chief_medical_officer');
  smo := pg_temp.mkdoc(v_org, ad, 'smo', 'senior_medical_officer');
  untied := pg_temp.mkdoc(v_org, ad, 'untied', 'senior_medical_officer');
  insert into fx values ('org', v_org::text), ('ad', ad::text), ('cmo', cmo::text), ('smo', smo::text), ('untied', untied::text);

  -- 1. born unsigned and inactive; v1 untouched; only the CMO signs
  perform pg_temp.ck('1a v2 exists unsigned and inactive', exists (select 1 from public.baseline_labs_rule_config where version = 2 and not is_active and approved_at is null), null);
  perform pg_temp.ck('1b v1 is untouched', exists (select 1 from public.baseline_labs_rule_config where version = 1 and not is_active and approved_at is null), null);
  r := pg_temp.as_(ad, $q$select public.sign_baseline_labs_rule_config(2)::text$q$);
  perform pg_temp.ck('1c an admin cannot sign', r like 'ERR:42501%', r);
  r := pg_temp.as_(cmo, $q$select public.sign_baseline_labs_rule_config(2)::text$q$);
  perform pg_temp.ck('1d the CMO signs v2', r not like 'ERR:%' and exists (select 1 from public.baseline_labs_rule_config where version = 2 and is_active and approved_at is not null), r);
end $$;

-- 2. class tests, window, scope
do $$
declare org uuid := pg_temp.f('org'); smo uuid := pg_temp.f('smo'); p uuid := pg_temp.mkuser(pg_temp.f('org'), 'htn', 'patient', 'male', 55); r text;
begin
  r := pg_temp.start(smo, p, 'Amlodipine 5');
  perform pg_temp.ck('2a a calcium channel blocker needs no labs', r = 'ok', r);
  r := pg_temp.start(smo, p, 'Atenolol 50');
  perform pg_temp.ck('2b a beta blocker needs no labs', r = 'ok', r);
  r := pg_temp.start(smo, p, 'Losartan 50');
  perform pg_temp.ck('2c an ARB with no labs is refused naming the tests', r like '23514|baseline_labs_rule|%Kidney%Potassium%Sodium%', r);
  perform pg_temp.lab(p, 'creatinine', 80, 'umol/L', 400); perform pg_temp.lab(p, 'potassium', 4.1, 'mmol/L', 400); perform pg_temp.lab(p, 'sodium', 139, 'mmol/L', 400);
  r := pg_temp.start(smo, p, 'Telmisartan 40');
  perform pg_temp.ck('2d results older than 12 months are missing', r like '23514%', r);
  perform pg_temp.lab(p, 'creatinine', 80, 'umol/L', 300); perform pg_temp.lab(p, 'potassium', 4.1, 'mmol/L', 300); perform pg_temp.lab(p, 'sodium', 139, 'mmol/L', 300);
  r := pg_temp.start(smo, p, 'Valsartan 80');
  perform pg_temp.ck('2e results inside 12 months pass (a 300-day-old set; v1 would refuse at 90 days)', r = 'ok', r);
  r := pg_temp.start(smo, p, 'Indapamide 1.5');
  perform pg_temp.ck('2f a thiazide also needs fasting glucose or HbA1c', r like '23514%Fasting glucose or HbA1c%', r);
  perform pg_temp.lab(p, 'hba1c', 5.9, '%', 20);
  r := pg_temp.start(smo, p, 'Indapamide 1.5');
  perform pg_temp.ck('2g an HbA1c satisfies the combined test', r = 'ok', r);
  r := pg_temp.start(smo, p, 'Gliclazide 30');
  perform pg_temp.ck('2h a sulfonylurea also needs a glucose result', r like '23514%Glucose%', r);
  perform pg_temp.lab(p, 'fasting_glucose', 5.2, 'mmol/L', 10);
  r := pg_temp.start(smo, p, 'Gliclazide 30');
  perform pg_temp.ck('2i with creatinine, HbA1c and glucose it passes', r = 'ok', r);
end $$;

-- 3. metformin and the kidney
do $$
declare smo uuid := pg_temp.f('smo'); ok uuid := pg_temp.mkuser(pg_temp.f('org'), 'met-ok', 'patient', 'male', 50); lo uuid := pg_temp.mkuser(pg_temp.f('org'), 'met-lo', 'patient', 'male', 50); r text; v_ov text;
begin
  perform pg_temp.lab(ok, 'creatinine', 80, 'umol/L', 10); perform pg_temp.lab(ok, 'hba1c', 6.4, '%', 10);
  perform pg_temp.lab(lo, 'creatinine', 300, 'umol/L', 10); perform pg_temp.lab(lo, 'hba1c', 6.4, '%', 10);
  r := pg_temp.start(smo, ok, 'Metformin 500');
  perform pg_temp.ck('3a normal kidney function passes', r = 'ok', r);
  r := pg_temp.start(smo, lo, 'Metformin 500');
  perform pg_temp.ck('3b eGFR under 30 is refused with the kidney hint', r like '23514|baseline_labs_egfr|%under 30%', r);
  v_ov := pg_temp.as_(smo, format($q$select public.record_baseline_labs_override(%L, 'Metformin', 'emergency_treatment', 'Emergency start, waiting would put the patient at risk')::text$q$, lo));
  perform pg_temp.ck('3c the override can be recorded', v_ov not like 'ERR:%', v_ov);
  r := pg_temp.start(smo, lo, 'Metformin 500');
  perform pg_temp.ck('3d a recorded override does NOT get past the kidney rule', r like '23514|baseline_labs_egfr|%', r);
end $$;

-- 4. HbA1c unreliable
do $$
declare smo uuid := pg_temp.f('smo'); untied uuid := pg_temp.f('untied'); p uuid := pg_temp.mkuser(pg_temp.f('org'), 'sickle', 'patient', 'male', 40); r text;
begin
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (pg_temp.f('org'), p, smo, now())
  on conflict (patient_id) do update set clinician_id = smo;
  perform pg_temp.lab(p, 'creatinine', 80, 'umol/L', 10); perform pg_temp.lab(p, 'fasting_glucose', 6.1, 'mmol/L', 10);
  r := pg_temp.start(smo, p, 'Glimepiride 1');
  perform pg_temp.ck('4a without HbA1c a sulfonylurea start is refused', r like '23514%HbA1c%', r);
  r := pg_temp.as_(p, format($q$select public.mark_hba1c_unreliable(%L, 'sickle cell disease, HbA1c unreliable')::text$q$, p));
  perform pg_temp.ck('4b a patient cannot mark themselves', r like 'ERR:%', r);
  r := pg_temp.as_(untied, format($q$select public.mark_hba1c_unreliable(%L, 'sickle cell disease, HbA1c unreliable')::text$q$, p));
  perform pg_temp.ck('4c an untied doctor cannot mark', r like 'ERR:42501%', r);
  r := pg_temp.as_(smo, format($q$select public.mark_hba1c_unreliable(%L, 'sickle cell disease, HbA1c unreliable')::text$q$, p));
  perform pg_temp.ck('4d the tied prescriber marks', r not like 'ERR:%' and exists (select 1 from public.hba1c_exceptions where patient_id = p), r);
  r := pg_temp.start(smo, p, 'Glimepiride 1');
  perform pg_temp.ck('4e a glucose result now stands in for HbA1c', r = 'ok', r);
  -- a combined test no longer accepts an HbA1c alone
  declare q uuid := pg_temp.mkuser(pg_temp.f('org'), 'sickle2', 'patient', 'male', 40);
  begin
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (pg_temp.f('org'), q, smo, now()) on conflict (patient_id) do update set clinician_id = smo;
    perform pg_temp.lab(q, 'creatinine', 80, 'umol/L', 10); perform pg_temp.lab(q, 'potassium', 4, 'mmol/L', 10); perform pg_temp.lab(q, 'sodium', 139, 'mmol/L', 10); perform pg_temp.lab(q, 'hba1c', 5.5, '%', 10);
    perform pg_temp.as_(smo, format($q$select public.mark_hba1c_unreliable(%L, 'recent transfusion, HbA1c unreliable')::text$q$, q));
    r := pg_temp.start(smo, q, 'Hydrochlorothiazide 25');
    perform pg_temp.ck('4f HbA1c alone no longer satisfies a thiazide for an exception patient', r like '23514%', r);
  end;
end $$;

-- 5. pregnancy
do $$
declare smo uuid := pg_temp.f('smo'); org uuid := pg_temp.f('org'); w uuid := pg_temp.mkuser(pg_temp.f('org'), 'woman', 'patient', 'female', 34); m uuid := pg_temp.mkuser(pg_temp.f('org'), 'man', 'patient', 'male', 34);
        old uuid := pg_temp.mkuser(pg_temp.f('org'), 'older', 'patient', 'female', 62); nosex uuid := pg_temp.mkuser(pg_temp.f('org'), 'nosex', 'patient', null, 34); r text; x uuid;
begin
  foreach x in array array[w, m, old, nosex] loop
    perform pg_temp.lab(x, 'creatinine', 70, 'umol/L', 10); perform pg_temp.lab(x, 'potassium', 4, 'mmol/L', 10); perform pg_temp.lab(x, 'sodium', 139, 'mmol/L', 10);
  end loop;
  r := pg_temp.start(smo, w, 'Atorvastatin 20');
  perform pg_temp.ck('5a a woman who could be pregnant needs a negative test for a statin', r like '23514%Pregnancy excluded%', r);
  r := pg_temp.start(smo, w, 'Lisinopril 10');
  perform pg_temp.ck('5b and for an ACE inhibitor', r like '23514%Pregnancy excluded%', r);
  r := pg_temp.start(smo, nosex, 'Lisinopril 10');
  perform pg_temp.ck('5c an unrecorded sex cannot rule pregnancy out', r like '23514%Pregnancy excluded%', r);
  perform pg_temp.negtest(w, 60);
  r := pg_temp.start(smo, w, 'Lisinopril 10');
  perform pg_temp.ck('5d a negative test older than 30 days does not count', r like '23514%', r);
  perform pg_temp.negtest(w, 3);
  r := pg_temp.start(smo, w, 'Lisinopril 10');
  perform pg_temp.ck('5e a recent negative test clears it', r = 'ok', r);
  r := pg_temp.start(smo, m, 'Atorvastatin 20');
  perform pg_temp.ck('5f a man is not asked', r = 'ok', r);
  r := pg_temp.start(smo, old, 'Atorvastatin 20');
  perform pg_temp.ck('5g a woman past 50 is not asked', r = 'ok', r);
end $$;

-- 6. documented override and the 7-day follow-up
do $$
declare smo uuid := pg_temp.f('smo'); p uuid := pg_temp.mkuser(pg_temp.f('org'), 'ovr', 'patient', 'male', 60); r text; v_due date;
begin
  r := pg_temp.start(smo, p, 'Ramipril 5');
  perform pg_temp.ck('6a no labs: refused', r like '23514%', r);
  r := pg_temp.as_(smo, format($q$select public.record_baseline_labs_override(%L, 'Ramipril', 'labs_ordered_results_pending', 'Labs ordered today, results pending, pressure very high')::text$q$, p));
  perform pg_temp.ck('6b the override is recorded', r not like 'ERR:%', r);
  r := pg_temp.start(smo, p, 'Ramipril 5');
  perform pg_temp.ck('6c the start goes through once', r = 'ok', r);
  select m.due_date into v_due from public.medication_lab_monitoring m join public.medications md on md.id = m.medication_id
   where md.patient_id = p and m.monitoring_label = 'Baseline labs after a documented override';
  perform pg_temp.ck('6d the follow-up falls due in 7 days', v_due = (now() + interval '7 days')::date, v_due::text);
end $$;

-- SABOTAGE: the kidney rule removed from the trigger; the low-eGFR metformin start must then be accepted (proving 3b can fail)
do $$
declare d text; lo uuid := pg_temp.mkuser(pg_temp.f('org'), 'sab', 'patient', 'male', 50); r text;
begin
  perform pg_temp.lab(lo, 'creatinine', 300, 'umol/L', 10); perform pg_temp.lab(lo, 'hba1c', 6.4, '%', 10);
  d := pg_get_functiondef('private.enforce_baseline_labs_rule()'::regprocedure);
  execute replace(d, 'if v_egfr is not null and v_egfr <', 'if false and v_egfr <');
  r := pg_temp.start(pg_temp.f('smo'), lo, 'Metformin 500');
  if r <> 'ok' then raise exception 'FAIL SABOTAGE: removing the kidney rule did not flip the result: %', r; end if;
end $$;

select 'PASS baseline_labs_rule_v2' as result;
rollback;
