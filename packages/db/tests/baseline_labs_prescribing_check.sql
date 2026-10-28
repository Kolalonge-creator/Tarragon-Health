-- Proof: the baseline labs prescribing check (migration *_baseline_labs_prescribing_check.sql). Raises on any failed check. One rolled-back transaction.
--   1. Unsigned rule = check OFF. Only the CMO can sign; an admin, a doctor and a patient cannot; signing twice is refused.
--   2. Signed: a blood pressure / glucose medicine without the required filed results needs the doctor's reason (SAFETY_FINDINGS); with the reason it is
--      signed and records the date the tests are due. With fresh filed results it passes with no reason. Stale, withdrawn and non-numeric results count as MISSING.
--   3. A calcium channel blocker alone needs nothing. Metformin: eGFR under 30 is BLOCKED even with a reason; 30 to 44 needs a reason; above passes.
--   4. HbA1c unreliable: a prescriber can mark a patient (a patient and an untied doctor cannot); fasting glucose then stands in for HbA1c.
--   5. A woman who could be pregnant on an ACE inhibitor / ARB / statin needs a recent negative test or the doctor's reason; a man does not.
--   6. An amendment is checked only when the dose or the medicine changes.
--   SABOTAGE: the line that adds the baseline findings removed from the safety check; the missing-labs case must then flip to accepted.
begin;

insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note) select 'prescribing_enabled', 'switched_on', id, 'cmo', 'proof setup' from public.profiles limit 1;
update public.go_live_guards set is_on = true, changed_at = now(), changed_by = (select id from public.profiles limit 1), change_note = 'proof setup' where key = 'prescribing_enabled';

create temp table fx(k text primary key, v text) on commit drop;
grant all on fx to public;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v::uuid from fx where k = p_k $$;

create function pg_temp.mkpat(p_label text, p_sex text, p_age integer) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'bl-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, (select id from public.organisations order by created_at limit 1), 'patient', 'BL ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => p_age) - interval '30 days')::date, p_sex::public.sex, true)
  on conflict (id) do update set sex = excluded.sex, date_of_birth = excluded.date_of_birth;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values ((select id from public.organisations order by created_at limit 1), v, pg_temp.f('smo'), now()) on conflict (patient_id) do update set clinician_id = pg_temp.f('smo');
  return v;
end $f$;

create function pg_temp.lab(p_pat uuid, p_analyte text, p_value numeric, p_unit text, p_days_ago integer default 5, p_withdrawn boolean default false, p_text text default null) returns void language plpgsql as $f$
declare v_res uuid := gen_random_uuid(); v_org uuid := (select organisation_id from public.profiles where id = p_pat);
begin
  insert into public.lab_results (id, organisation_id, patient_id, source, submitted_by_kind, release_state, received_at, is_test, withdrawn_at, withdrawn_by, withdrawn_reason)
  values (v_res, v_org, p_pat, 'api', 'partner', 'awaiting_review', now() - make_interval(days => p_days_ago), true,
          case when p_withdrawn then now() end, case when p_withdrawn then pg_temp.f('smo') end, case when p_withdrawn then 'proof withdrawn' end);
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit, flag, sensitive_positive, is_test)
  values (v_res, v_org, p_pat, p_analyte, p_value, p_text, coalesce(p_unit, ''), 'normal', false, true);
end $f$;

-- prescribe as a doctor; returns OK, or DETAIL:HINT of the refusal
create function pg_temp.rx(p_user uuid, p_pat uuid, p_drug text, p_override text default null) returns text language plpgsql as $f$
declare r text; d text; h text; v_id uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
  begin
    v_id := public.prescribe_medication(p_pat, p_drug, p_dose => '10 mg', p_frequency => 'daily', p_duration_days => 30, p_quantity => '30 tablets',
                                        p_allergies_confirmed => true, p_safety_override_reason => p_override);
    r := 'OK';
  exception when others then
    get stacked diagnostics d = pg_exception_detail, h = pg_exception_hint;
    r := coalesce(nullif(d, ''), 'ERR') || ':' || coalesce(nullif(h, ''), '') || ' | ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate || ':' || sqlerrm; end;
  execute 'reset role'; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $f$;
create function pg_temp.ck(p_what text, p_ok boolean, p_got text default null) returns void language plpgsql as $f$
begin if not coalesce(p_ok, false) then raise exception 'FAIL %: got %', p_what, p_got; end if; end $f$;

do $$
declare v_org uuid; smo uuid := gen_random_uuid(); cmo uuid := gen_random_uuid(); untied uuid := gen_random_uuid(); ad uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'bl-staff-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[smo, cmo, untied, ad]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone, is_test) values
    (smo, v_org, 'clinician', 'BL SMO', '+2348058870001', true), (cmo, v_org, 'clinician', 'BL CMO', '+2348058870002', true),
    (untied, v_org, 'clinician', 'BL Untied', '+2348058870003', true), (ad, v_org, 'admin', 'BL Admin', '+2348058870004', true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org, smo, 'BL SMO', true, now(), 'senior_medical_officer', 'MDCN', 'BL-1', 'Probe', 'BL-P1', now() + interval '1 year'),
    (v_org, cmo, 'BL CMO', true, now(), 'chief_medical_officer', 'MDCN', 'BL-2', 'Probe', 'BL-P2', now() + interval '1 year'),
    (v_org, untied, 'BL Untied', true, now(), 'senior_medical_officer', 'MDCN', 'BL-3', 'Probe', 'BL-P3', now() + interval '1 year');
  insert into fx values ('smo', smo::text), ('cmo', cmo::text), ('untied', untied::text), ('ad', ad::text);
end $$;

-- 1. unsigned = off; only the CMO signs
do $$
declare p uuid := pg_temp.mkpat('unsigned', 'male', 55); r text;
begin
  if exists (select 1 from public.baseline_labs_config where is_active or approved_at is not null) then raise exception 'FAIL 1a: the rule must be born unsigned'; end if;
  r := pg_temp.rx(pg_temp.f('smo'), p, 'Losartan 50');
  perform pg_temp.ck('1b unsigned rule adds nothing', r = 'OK', r);
  r := pg_temp.q_as(pg_temp.f('ad'), $q$select public.sign_baseline_labs_config(1)::text$q$);
  perform pg_temp.ck('1c an admin cannot sign', r like 'ERR:42501%', r);
  r := pg_temp.q_as(pg_temp.f('smo'), $q$select public.sign_baseline_labs_config(1)::text$q$);
  perform pg_temp.ck('1d a doctor who is not the CMO cannot sign', r like 'ERR:42501%', r);
  r := pg_temp.q_as(pg_temp.mkpat('signer', 'male', 30), $q$select public.sign_baseline_labs_config(1)::text$q$);
  perform pg_temp.ck('1e a patient cannot sign', r like 'ERR:42501%', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select public.sign_baseline_labs_config(1)::text$q$);
  perform pg_temp.ck('1f the CMO signs', r not like 'ERR:%' and exists (select 1 from public.baseline_labs_config where version = 1 and is_active and approved_at is not null), r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select public.sign_baseline_labs_config(1)::text$q$);
  perform pg_temp.ck('1g signing again is refused', r like 'ERR:23514%', r);
end $$;

-- 2. missing results need the doctor's reason; fresh filed results pass; stale / withdrawn / non-numeric count as missing
do $$
declare p uuid := pg_temp.mkpat('htn', 'male', 55); r text; v_checks jsonb;
begin
  r := pg_temp.rx(pg_temp.f('smo'), p, 'Losartan 50');
  perform pg_temp.ck('2a no labs: findings with the three tests', r like 'SAFETY_FINDINGS:%baseline_labs_missing%creatinine%potassium%sodium%', r);
  r := pg_temp.rx(pg_temp.f('smo'), p, 'Losartan 50', 'Severely raised pressure; tests ordered today');
  perform pg_temp.ck('2b with the reason it is signed', r = 'OK', r);
  v_checks := private.check_prescription_safety(p, 'Candesartan 8', null, true, 'reason');
  perform pg_temp.ck('2c the due date is recorded', (v_checks ->> 'baseline_labs_due_by') = to_char(now() + interval '7 days', 'YYYY-MM-DD'), v_checks::text);
  -- stale (13 months), withdrawn, and a qualitative-only item (no number; a picture is never an item at all) do not count
  perform pg_temp.lab(p, 'creatinine', 80, 'umol/L', 400);
  perform pg_temp.lab(p, 'potassium', 4.1, 'mmol/L', 5, true);
  perform pg_temp.lab(p, 'sodium', null, null, 5, false, 'negative');
  r := pg_temp.rx(pg_temp.f('smo'), p, 'Telmisartan 40');
  perform pg_temp.ck('2d stale, withdrawn and unreadable results are missing', r like 'SAFETY_FINDINGS:%creatinine%potassium%sodium%', r);
  perform pg_temp.lab(p, 'creatinine', 80, 'umol/L', 20); perform pg_temp.lab(p, 'potassium', 4.1, 'mmol/L', 20); perform pg_temp.lab(p, 'sodium', 139, 'mmol/L', 20);
  r := pg_temp.rx(pg_temp.f('smo'), p, 'Valsartan 80');
  perform pg_temp.ck('2e fresh filed results pass with no reason', r = 'OK', r);
  -- 3a. calcium channel blocker alone
  r := pg_temp.rx(pg_temp.f('smo'), pg_temp.mkpat('ccb', 'male', 60), 'Amlodipine 5');
  perform pg_temp.ck('3a a calcium channel blocker needs no blood test', r = 'OK', r);
end $$;

-- 3. metformin and eGFR
do $$
declare ok uuid := pg_temp.mkpat('met-ok', 'male', 50); mid uuid := pg_temp.mkpat('met-mid', 'male', 50); lo uuid := pg_temp.mkpat('met-lo', 'male', 50); r text;
begin
  perform pg_temp.lab(ok, 'creatinine', 80, 'umol/L'); perform pg_temp.lab(ok, 'hba1c', 6.4, '%');
  perform pg_temp.lab(mid, 'creatinine', 170, 'umol/L'); perform pg_temp.lab(mid, 'hba1c', 6.4, '%');
  perform pg_temp.lab(lo, 'creatinine', 300, 'umol/L'); perform pg_temp.lab(lo, 'hba1c', 6.4, '%');
  r := pg_temp.rx(pg_temp.f('smo'), ok, 'Metformin 500');
  perform pg_temp.ck('3b normal kidney function passes', r = 'OK', r);
  r := pg_temp.rx(pg_temp.f('smo'), mid, 'Metformin 500');
  perform pg_temp.ck('3c eGFR 30 to 44 needs a reason to review the dose', r like 'SAFETY_FINDINGS:%metformin_egfr_review_dose%', r);
  r := pg_temp.rx(pg_temp.f('smo'), lo, 'Metformin 500', 'I want to start anyway');
  perform pg_temp.ck('3d eGFR under 30 is BLOCKED even with a reason', r like 'SAFETY_BLOCKED:%metformin_egfr_below_30%', r);
  perform pg_temp.ck('3e the blocked message is not the controlled-medicine one',
    (select count(*) from public.medications m where m.patient_id = lo) = 0, 'a medication was written');
end $$;

-- 4. HbA1c unreliable
do $$
declare p uuid := pg_temp.mkpat('sickle', 'male', 40); r text;
begin
  perform pg_temp.lab(p, 'creatinine', 80, 'umol/L'); perform pg_temp.lab(p, 'fasting_glucose', 6.1, 'mmol/L');
  r := pg_temp.rx(pg_temp.f('smo'), p, 'Gliclazide 80');
  perform pg_temp.ck('4a without HbA1c a sulfonylurea start needs a reason', r like 'SAFETY_FINDINGS:%hba1c%', r);
  r := pg_temp.q_as(p, format($q$select public.mark_hba1c_unreliable(%L, 'sickle cell disease, HbA1c unreliable')::text$q$, p));
  perform pg_temp.ck('4b a patient cannot mark themselves', r like 'ERR:%', r);
  r := pg_temp.q_as(pg_temp.f('untied'), format($q$select public.mark_hba1c_unreliable(%L, 'sickle cell disease, HbA1c unreliable')::text$q$, p));
  perform pg_temp.ck('4c an untied doctor cannot mark', r like 'ERR:42501%', r);
  r := pg_temp.q_as(pg_temp.f('smo'), format($q$select public.mark_hba1c_unreliable(%L, 'sickle cell disease, HbA1c unreliable')::text$q$, p));
  perform pg_temp.ck('4d the tied prescriber marks', r not like 'ERR:%' and exists (select 1 from public.hba1c_exceptions where patient_id = p), r);
  r := pg_temp.rx(pg_temp.f('smo'), p, 'Gliclazide 80');
  perform pg_temp.ck('4e fasting glucose now stands in for HbA1c', r = 'OK', r);
end $$;

-- 5. pregnancy
do $$
declare w uuid := pg_temp.mkpat('woman', 'female', 34); m uuid := pg_temp.mkpat('man', 'male', 34); old uuid := pg_temp.mkpat('older', 'female', 62); r text;
begin
  r := pg_temp.rx(pg_temp.f('smo'), w, 'Atorvastatin 20');
  perform pg_temp.ck('5a a woman who could be pregnant needs the answer recorded', r like 'SAFETY_FINDINGS:%pregnancy_not_excluded%', r);
  perform pg_temp.lab(w, 'pregnancy_test', null, null, 3, false, 'negative');
  r := pg_temp.rx(pg_temp.f('smo'), w, 'Atorvastatin 20');
  perform pg_temp.ck('5b a recent negative test clears it', r = 'OK', r);
  r := pg_temp.rx(pg_temp.f('smo'), m, 'Atorvastatin 20');
  perform pg_temp.ck('5c a man is not asked', r = 'OK', r);
  r := pg_temp.rx(pg_temp.f('smo'), old, 'Atorvastatin 20');
  perform pg_temp.ck('5d a woman past the age range is not asked', r = 'OK', r);
  r := pg_temp.rx(pg_temp.f('smo'), pg_temp.mkpat('nosex', null, 34), 'Atorvastatin 20');
  perform pg_temp.ck('5e an unrecorded sex cannot rule pregnancy out, so it is asked', r like 'SAFETY_FINDINGS:%pregnancy_not_excluded%', r);
end $$;

-- 6. amendments
do $$
declare p uuid := pg_temp.mkpat('amend', 'male', 58); v_med uuid; r text;
begin
  r := pg_temp.rx(pg_temp.f('smo'), p, 'Lisinopril 10', 'Emergency start, tests ordered');
  perform pg_temp.ck('6a started with a reason', r = 'OK', r);
  select id into v_med from public.medications where patient_id = p and is_active order by created_at desc limit 1;
  r := pg_temp.q_as(pg_temp.f('smo'), format($q$select public.amend_medication(p_medication_id => %L, p_amendment_reason => 'Change the supply note only', p_instructions => 'Take in the morning', p_allergies_confirmed => true)::text$q$, v_med));
  perform pg_temp.ck('6b an amendment with the same dose and medicine is not asked for tests', r not like 'ERR:%', r);
  select id into v_med from public.medications where patient_id = p and is_active and superseded_at is null order by created_at desc limit 1;
  r := pg_temp.q_as(pg_temp.f('smo'), format($q$select public.amend_medication(p_medication_id => %L, p_amendment_reason => 'Raise the dose', p_dose => '20 mg', p_allergies_confirmed => true)::text$q$, v_med));
  perform pg_temp.ck('6c raising the dose asks for the tests again', r like 'ERR:P0001%', r);
  perform pg_temp.ck('6d the dose flag does not outlive the amendment', coalesce(current_setting('tarragon.rx_dose_changed', true), '') = '', current_setting('tarragon.rx_dose_changed', true));
end $$;

-- SABOTAGE: the line that adds the baseline findings removed; the missing-labs start must then be accepted (proving 2a can fail)
do $$
declare d text; p uuid := pg_temp.mkpat('sab', 'male', 55); r text;
begin
  d := pg_get_functiondef('private.prescription_safety_findings(uuid,text,uuid)'::regprocedure);
  execute replace(d, 'v_f := v_f || private.baseline_labs_findings(p_patient, p_drug, p_replacing);', '');
  r := pg_temp.rx(pg_temp.f('smo'), p, 'Losartan 50');
  if r <> 'OK' then raise exception 'FAIL SABOTAGE: removing the baseline line did not flip the result: %', r; end if;
end $$;

select 'PASS baseline_labs_prescribing_check' as result;
rollback;
