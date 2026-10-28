-- S50b proof: religious-fasting safety gate and fasting plans (6.13), glucose series for the glucose-response insight (6.11)
-- (migration *_s50b_fasting_safety_and_glucose_response.sql).
--   a. the gate: the shared cases (ids FS01..FS31, FS35..FS37 are the same ids as packages/clinical/src/fasting-safety.test.ts; fasting-safety-parity.test.ts
--      pins them), the acceptance case (an insulin user cannot start a fasting plan without a clinician-signed medicine timing plan), no signed config = unavailable.
--   b. the public door: guard off, and every sensitive reason, return the SAME {"state":"unavailable"}.
--   c. fasting plans: refused for an uncovered insulin user (through the function AND a direct insert by a privileged session), allowed once a confirmed signed
--      S24 timing plan covers the medicine, one active plan at a time, a client cannot write the table, ending a plan.
--   d. config: signed by the CMO only; an invalid config, or one that softens a red event, cannot be stored.
--   e. glucose series: guard off, withheld (pregnancy) and normal; fingerstick and cgm are labelled.
-- One rolled-back transaction. is_test data only. SABOTAGE section at the end: the plan trigger, the gate and the series' withheld check are each broken
-- once; the matching checks must flip (otherwise the test is vacuous).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin
    if p_sql ~* '^\s*select' then execute p_sql into r; else execute p_sql; r := null; end if;
  exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  return r;
end $f$;
-- Registration is adult-only: a minor is created as an adult and then updated to a minor_child dependant in ONE update. Dates come from the Lagos date.
create function pg_temp.lagos_today() returns date language sql as $$ select (now() at time zone 'Africa/Lagos')::date $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date default null) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_adult date := (pg_temp.lagos_today() - interval '45 years')::date;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's50b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S50b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), v_adult, true)
  on conflict (id) do update set role = excluded.role, date_of_birth = excluded.date_of_birth, is_test = true, is_active = true;
  -- Registration is adult-only and compares against the UTC date, so any chosen date of birth (a minor, or an adult at the Lagos boundary) is set by UPDATE.
  if p_dob is not null and p_dob > (pg_temp.lagos_today() - interval '18 years')::date then
    update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child', date_of_birth = p_dob where id = v;
  elsif p_dob is not null then
    update public.profiles set date_of_birth = p_dob where id = v;
  end if;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S50b ' || p_label, 'MDCN', 'S50B-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true);
  return v;
end $f$;

-- The guard table has its own guard trigger (a guard changes only through set_go_live_guard); disabled for this rolled-back transaction only.
create function pg_temp.setguard(p_key text, p_on boolean) returns void language plpgsql as $f$
begin
  alter table public.go_live_guards disable trigger go_live_guards_guard;
  update public.go_live_guards set is_on = p_on, changed_at = now(), changed_by = pg_temp.f('doc'), change_note = 'S50b proof: rolled back' where key = p_key;
  alter table public.go_live_guards enable trigger go_live_guards_guard;
end $f$;

-- A confirmed, clinician-signed S24 medicine change tagged for a fast, applied to prescription p_rx. Written with triggers and foreign keys off (replica mode),
-- exactly as the S24 engine leaves a confirmed row; every CHECK constraint still applies.
create function pg_temp.mkplan(p_org uuid, p_patient uuid, p_signer uuid, p_rx uuid, p_fast text, p_from date, p_to date) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.care_plan_changes (id, organisation_id, patient_id, kind, proposed_by, proposed_by_user, proposal, rationale, patient_summary, state,
                                        signed_by, signed_at, patient_confirmed_at, applied_at, applied_prescription_id, is_test)
  values (v, p_org, p_patient, 'medication', 'clinician', p_signer,
          jsonb_build_object('action', 'change', 'fasting', jsonb_build_object('fast', p_fast, 'valid_from', p_from, 'valid_to', p_to)),
          'proof: fasting timing plan', 'Take your morning tablet at sunrise and your evening tablet after you break your fast.', 'confirmed',
          p_signer, now(), now(), now(), p_rx, true);
  set local session_replication_role = origin;
  return v;
end $f$;

-- one case: a fresh patient; returns "decision|reason|blocks|covered"
-- p_conds [{name, icd10, status}], p_meds [{name, rx: bool (a covering plan exists), prescribed: bool}], p_events [{grade, hours}]
create function pg_temp.run_case(p_events jsonb, p_conds jsonb, p_meds jsonb, p_preg boolean default false, p_ed boolean default false,
                                 p_dob_years integer default 45, p_dob_days integer default 0, p_no_dob boolean default false,
                                 p_fast text default 'ramadan', p_starts date default null, p_ends date default null, p_plan_from date default null, p_plan_to date default null,
                                 p_plan_fast text default null, p_other_rx boolean default false, p_hold boolean default false) returns text
language plpgsql as $f$
declare v uuid; e jsonb; c jsonb; m jsonb; g jsonb; v_org uuid := pg_temp.f('org'); v_rx uuid; v_dob date;
begin
  v_dob := (pg_temp.lagos_today() - make_interval(years => p_dob_years))::date - p_dob_days;
  v := pg_temp.mkuser(v_org, 'case', 'patient', v_dob);
  if p_no_dob then update public.profiles set date_of_birth = null where id = v; end if;
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow, actions, created_at, is_test)
    values (v_org, v, 'observation', gen_random_uuid(), e ->> 'grade', null, 'live_symptom_gate', 1, 'draft', true,
            case when e ->> 'grade' = 'red' then '[{"kind":"page_on_call"}]'::jsonb else '[]'::jsonb end,
            now() - ((e ->> 'hours')::numeric * interval '1 hour'), true);
  end loop;
  for c in select * from jsonb_array_elements(coalesce(p_conds, '[]'::jsonb)) loop
    insert into public.patient_conditions (organisation_id, patient_id, condition_name, icd10_code, status)
    values (v_org, v, c ->> 'name', c ->> 'icd10', coalesce(c ->> 'status', 'active')::public.condition_clinical_status);
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_meds, '[]'::jsonb)) loop
    v_rx := gen_random_uuid();
    set local session_replication_role = replica;
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source, prescription_id)
    values (v_org, v, m ->> 'name', '1 unit', 'daily', true, case when (m ->> 'prescribed')::boolean then 'clinician' else 'patient' end::public.medication_source,
            case when (m ->> 'prescribed')::boolean then v_rx end);
    set local session_replication_role = origin;
    if coalesce((m ->> 'rx')::boolean, false) then
      perform pg_temp.mkplan(v_org, v, pg_temp.f('cmo'), case when p_other_rx then gen_random_uuid() else v_rx end, coalesce(p_plan_fast, p_fast),
                             coalesce(p_plan_from, pg_temp.lagos_today() - 10), coalesce(p_plan_to, pg_temp.lagos_today() + 90));
    end if;
  end loop;
  if p_preg then insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant, high_risk) values (v_org, v, true, false); end if;
  -- a trigger derives `positive` from the SCOFF answers (two or more); a bare positive = true is reset to false
  if p_ed then insert into public.obesity_ed_screens (organisation_id, patient_id, scoff_sick, scoff_control) values (v_org, v, true, true); end if;
  if p_hold then insert into public.nutrition_target_holds (organisation_id, patient_id, reason, set_by) values (v_org, v, 'eating_disorder_concern', pg_temp.f('doc')); end if;
  perform pg_temp.setf('last', v);
  g := private.fasting_gate_for(v, p_fast, p_starts, p_ends, now());
  return (g ->> 'decision') || '|' || (g ->> 'reason') || '|' ||
    coalesce((select string_agg(x, ',' order by ord) from jsonb_array_elements_text(g -> 'blocks') with ordinality as t(x, ord)), '') || '|' ||
    coalesce((select string_agg(x, ',' order by ord) from jsonb_array_elements_text(g -> 'covered') with ordinality as t(x, ord)), '');
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('p', pg_temp.mkuser(v_org, 'patient', 'patient'));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'senior', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
exception when others then
  raise exception 'fixture failed: %', sqlerrm;
end $$;

-- 0. born inactive: no signed rules means the gate cannot answer ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('born inactive and unsigned', 'false|false', (select is_active::text || '|' || (approved_by is not null)::text from public.fasting_safety_config where version = 1));
  perform pg_temp.ck('with no signed rules the gate is rules_unavailable', 'not_advised|rules_unavailable|rules_unavailable|', pg_temp.run_case(null, null, null));
end $$;

-- Activate the seeded rules as the CMO would (signing records review; the proof does it directly, as postgres, and rolls back).
do $$
begin
  update public.fasting_safety_config
     set approved_by = (select id from public.clinical_staff where profile_id = pg_temp.f('cmo')), approved_at = now(), is_active = true where version = 1;
end $$;

-- a. the shared gate cases ---------------------------------------------------------------------------------------------------------------
do $$
declare
  v_ok text := 'may_fast_with_guidance|none||';
  v_ins jsonb := '[{"name":"Insulin glargine","prescribed":true}]';
  v_ins_rx jsonb := '[{"name":"Insulin glargine","prescribed":true,"rx":true}]';
  v_met jsonb := '[{"name":"Metformin","prescribed":true}]';
  v_today date := pg_temp.lagos_today();
begin
  perform pg_temp.ck('FS01 nothing recorded: may fast with guidance', v_ok, pg_temp.run_case(null, null, null));
  perform pg_temp.ck('FS02 red event 10h ago: not advised', 'not_advised|recent_red_event|recent_red_event|', pg_temp.run_case('[{"grade":"red","hours":10}]', null, null));
  perform pg_temp.ck('FS03 red event 80h ago: allowed', v_ok, pg_temp.run_case('[{"grade":"red","hours":80}]', null, null));
  perform pg_temp.ck('FS04 amber 10h ago: needs a clinician', 'needs_clinician_plan|recent_amber_event|recent_amber_event|', pg_temp.run_case('[{"grade":"amber","hours":10}]', null, null));
  perform pg_temp.ck('FS05 pregnancy: not advised', 'not_advised|pregnancy|pregnancy|', pg_temp.run_case(null, null, null, true));
  perform pg_temp.ck('FS06 aged 14: not advised', 'not_advised|under_age|under_age|', pg_temp.run_case(null, null, null, false, false, 14));
  perform pg_temp.ck('FS07 the 18th birthday today (Lagos): adult', v_ok, pg_temp.run_case(null, null, null, false, false, 18, 0));
  perform pg_temp.ck('FS08 the day before the 18th birthday: under age', 'not_advised|under_age|under_age|', pg_temp.run_case(null, null, null, false, false, 18, -1));
  perform pg_temp.ck('FS09 no date of birth: fails closed', 'not_advised|under_age|under_age|', pg_temp.run_case(null, null, null, false, false, 45, 0, true));
  perform pg_temp.ck('FS10 type 1 diabetes by name: not advised', 'not_advised|type1_diabetes|type1_diabetes|', pg_temp.run_case(null, '[{"name":"Type 1 diabetes mellitus"}]', v_met));
  perform pg_temp.ck('FS11 type 1 diabetes by ICD-10', 'not_advised|type1_diabetes|type1_diabetes|', pg_temp.run_case(null, '[{"name":"Diabetes","icd10":"E10.9"}]', v_met));
  perform pg_temp.ck('FS12 kidney disease by name', 'not_advised|kidney_disease|kidney_disease|', pg_temp.run_case(null, '[{"name":"Chronic Kidney Disease"}]', null));
  perform pg_temp.ck('FS13 kidney disease by ICD-10', 'not_advised|kidney_disease|kidney_disease|', pg_temp.run_case(null, '[{"name":"Unspecified","icd10":"N18.3"}]', null));
  perform pg_temp.ck('FS14 a positive eating-disorder screen (two SCOFF answers)', 'not_advised|eating_disorder|eating_disorder|', pg_temp.run_case(null, null, null, false, true));
  perform pg_temp.ck('FS15 a recorded eating disorder', 'not_advised|eating_disorder|eating_disorder|', pg_temp.run_case(null, '[{"name":"Bulimia nervosa"}]', null));
  perform pg_temp.ck('FS16 ACCEPTANCE: insulin without a signed timing plan needs a clinician', 'needs_clinician_plan|insulin|insulin|', pg_temp.run_case(null, null, v_ins));
  perform pg_temp.ck('FS17 sulfonylurea without a plan', 'needs_clinician_plan|sulfonylurea|sulfonylurea|', pg_temp.run_case(null, null, '[{"name":"Gliclazide 80mg","prescribed":true}]'));
  perform pg_temp.ck('FS18 insulin with a confirmed signed timing plan covering the fast', 'may_fast_with_guidance|none||insulin', pg_temp.run_case(null, null, v_ins_rx));
  perform pg_temp.ck('FS19 a plan for the other fast does not count', 'needs_clinician_plan|insulin|insulin|', pg_temp.run_case(null, null, v_ins_rx, false, false, 45, 0, false, 'ramadan', null, null, null, null, 'lent'));
  perform pg_temp.ck('FS20 a plan that ends before the fast does not cover it', 'needs_clinician_plan|insulin|insulin|',
    pg_temp.run_case(null, null, v_ins_rx, false, false, 45, 0, false, 'ramadan', v_today + 20, v_today + 120));
  perform pg_temp.ck('FS21 a plan that starts after the fast starts does not cover it', 'needs_clinician_plan|insulin|insulin|',
    pg_temp.run_case(null, null, v_ins_rx, false, false, 45, 0, false, 'ramadan', v_today - 30, v_today + 5, v_today - 10, v_today + 90));
  perform pg_temp.ck('FS22 a plan that has already ended does not count', 'needs_clinician_plan|insulin|insulin|',
    pg_temp.run_case(null, null, v_ins_rx, false, false, 45, 0, false, 'ramadan', v_today - 40, v_today - 39, v_today - 50, v_today - 30));
  perform pg_temp.ck('FS23 a plan applied to a different prescription does not count', 'needs_clinician_plan|insulin|insulin|',
    pg_temp.run_case(null, null, v_ins_rx, false, false, 45, 0, false, 'ramadan', null, null, null, null, null, true));
  perform pg_temp.ck('FS24 insulin the person typed in themselves (no prescription) is never covered', 'needs_clinician_plan|insulin|insulin|',
    pg_temp.run_case(null, null, '[{"name":"Insulin glargine","prescribed":false,"rx":true}]'));
  perform pg_temp.ck('FS25 insulin covered, sulfonylurea not', 'needs_clinician_plan|sulfonylurea|sulfonylurea|insulin',
    pg_temp.run_case(null, null, '[{"name":"Insulin glargine","prescribed":true,"rx":true},{"name":"Glimepiride","prescribed":true}]'));
  perform pg_temp.ck('FS26 diabetes with no medicine recorded at all needs a clinician', 'needs_clinician_plan|diabetes_medicines_unconfirmed|diabetes_medicines_unconfirmed|',
    pg_temp.run_case(null, '[{"name":"Type 2 diabetes"}]', null));
  perform pg_temp.ck('FS27 diabetes on metformin only: allowed', v_ok, pg_temp.run_case(null, '[{"name":"Type 2 diabetes"}]', v_met));
  perform pg_temp.ck('FS28 resolved diabetes, no medicines: allowed', v_ok, pg_temp.run_case(null, '[{"name":"Type 2 diabetes","status":"resolved"}]', null));
  perform pg_temp.ck('FS29 pregnancy and insulin: both blocks, pregnancy first', 'not_advised|pregnancy|pregnancy,insulin|', pg_temp.run_case(null, null, v_ins, true));
  perform pg_temp.ck('FS30 red and amber together: red first', 'not_advised|recent_red_event|recent_red_event,recent_amber_event|',
    pg_temp.run_case('[{"grade":"red","hours":5},{"grade":"amber","hours":5}]', null, null));
  perform pg_temp.ck('FS31 two insulin rows, one covered: still blocked', 'needs_clinician_plan|insulin|insulin|',
    pg_temp.run_case(null, null, '[{"name":"Insulin glargine","prescribed":true,"rx":true},{"name":"Insulin aspart","prescribed":true}]'));
  perform pg_temp.ck('FS38 diabetes with only an unrelated medicine (amlodipine) recorded needs a clinician', 'needs_clinician_plan|diabetes_medicines_unconfirmed|diabetes_medicines_unconfirmed|',
    pg_temp.run_case(null, '[{"name":"Type 2 diabetes"}]', '[{"name":"Amlodipine","prescribed":true}]'));
  perform pg_temp.ck('FS39 a clinician nutrition hold is treated as an eating-disorder concern', 'not_advised|eating_disorder|eating_disorder|',
    pg_temp.run_case(null, null, null, false, false, 45, 0, false, 'ramadan', null, null, null, null, null, false, true));
  perform pg_temp.ck('FS40 a brand of insulin the first list missed (Actrapid) is caught', 'needs_clinician_plan|insulin|insulin|',
    pg_temp.run_case(null, null, '[{"name":"Actrapid 100IU/ml","prescribed":true}]'));
  perform pg_temp.ck('FS35 a red event dated in the future is ignored', v_ok, pg_temp.run_case('[{"grade":"red","hours":-2}]', null, null));
  perform pg_temp.ck('FS36 red exactly 72h ago is still not advised (the window is inclusive)', 'not_advised|recent_red_event|recent_red_event|', pg_temp.run_case('[{"grade":"red","hours":72}]', null, null));
  perform pg_temp.ck('FS37 a green event changes nothing', v_ok, pg_temp.run_case('[{"grade":"green","hours":1}]', null, null));
end $$;

-- b. the public door ------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_doc uuid := pg_temp.f('doc');
  v_ins uuid; v_preg uuid; v_minor uuid; v_t1 uuid; v_ed uuid; v_ok uuid; v_post uuid;
  v_un text := '{"state": "unavailable"}';
begin
  v_ins := pg_temp.mkuser(v_org, 'ins', 'patient');
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source) values (v_org, v_ins, 'Insulin glargine', '10u', 'daily', true, 'patient');
  v_preg := pg_temp.mkuser(v_org, 'preg', 'patient');
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant, high_risk) values (v_org, v_preg, true, false);
  v_minor := pg_temp.mkuser(v_org, 'minor', 'patient', (pg_temp.lagos_today() - interval '14 years')::date);
  v_t1 := pg_temp.mkuser(v_org, 't1', 'patient');
  insert into public.patient_conditions (organisation_id, patient_id, condition_name) values (v_org, v_t1, 'Type 1 diabetes');
  v_ed := pg_temp.mkuser(v_org, 'ed', 'patient');
  insert into public.obesity_ed_screens (organisation_id, patient_id, scoff_sick, scoff_control) values (v_org, v_ed, true, true);
  v_ok := pg_temp.mkuser(v_org, 'ok', 'patient');
  v_post := pg_temp.mkuser(v_org, 'post', 'patient');
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date) values (v_org, v_post, pg_temp.lagos_today() - 100);
  perform pg_temp.setf('ins', v_ins); perform pg_temp.setf('preg', v_preg); perform pg_temp.setf('minor', v_minor); perform pg_temp.setf('ok', v_ok);

  perform pg_temp.ck('door: with the guard OFF every patient gets unavailable', v_un, pg_temp.q_as(v_ok, 'select public.my_fasting_gate(''ramadan'')::text'));
  perform pg_temp.setguard('fasting_safety', true);
  perform pg_temp.ck('door: guard ON, a healthy adult may fast with guidance', 'ok|may_fast_with_guidance|none', (
    select (j ->> 'state') || '|' || (j ->> 'decision') || '|' || (j ->> 'reason') from (select pg_temp.q_as(v_ok, 'select public.my_fasting_gate(''ramadan'')::text')::jsonb j) s));
  perform pg_temp.ck('door: an insulin user is told a medicine timing plan is needed', 'needs_clinician_plan|medicine_timing_plan_needed', (
    select (j ->> 'decision') || '|' || (j ->> 'reason') from (select pg_temp.q_as(v_ins, 'select public.my_fasting_gate(''ramadan'')::text')::jsonb j) s));
  perform pg_temp.ck('door: pregnancy is the same single unavailable answer', v_un, pg_temp.q_as(v_preg, 'select public.my_fasting_gate(''ramadan'')::text'));
  perform pg_temp.ck('door: a postpartum year is the same answer', v_un, pg_temp.q_as(v_post, 'select public.my_fasting_gate(''ramadan'')::text'));
  perform pg_temp.ck('door: under 18 is the same answer', v_un, pg_temp.q_as(v_minor, 'select public.my_fasting_gate(''ramadan'')::text'));
  perform pg_temp.ck('door: type 1 diabetes is the same answer', v_un, pg_temp.q_as(v_t1, 'select public.my_fasting_gate(''ramadan'')::text'));
  perform pg_temp.ck('door: a positive eating-disorder screen is the same answer', v_un, pg_temp.q_as(v_ed, 'select public.my_fasting_gate(''ramadan'')::text'));
  perform pg_temp.ck('door: an unknown fast is the same answer', v_un, pg_temp.q_as(v_ok, 'select public.my_fasting_gate(''diwali'')::text'));
  perform pg_temp.ck('door: the payload never names a pregnancy, an age, a screen or a condition', 'false', (
    (pg_temp.q_as(v_preg, 'select public.my_fasting_gate(''ramadan'')::text') || pg_temp.q_as(v_ins, 'select public.my_fasting_gate(''ramadan'')::text')) ~* 'pregnan|postpartum|under_age|eating|kidney|type1|scoff')::text);
  perform pg_temp.ck('door: anon cannot call it', '42501', replace(pg_temp.q_anon('select public.my_fasting_gate(''ramadan'')::text'), 'ERR:', ''));
  perform pg_temp.ck('door: a client cannot call the unscoped gate', 'true', (pg_temp.q_as(v_ok, format('select private.fasting_gate_for(%L, ''ramadan'')::text', v_preg)) like 'ERR:%')::text);
  perform pg_temp.ck('door: the expected calendar window is offered as a hint (or "unknown" once every seeded window has passed)',
    (select case when exists (select 1 from public.fasting_safety_config c, jsonb_array_elements(c.config -> 'calendar' -> 'ramadan') e
                               where c.version = 1 and (e ->> 'end')::date >= pg_temp.lagos_today()) then 'expected' else 'unknown' end),
    (pg_temp.q_as(v_ok, 'select public.my_fasting_gate(''ramadan'')::text')::jsonb #>> '{calendar,status}'));
  perform pg_temp.ck('door: the guard has real conditions and the CMO holds the switch', 'true', (
    private.go_live_conditions('fasting_safety', null)::text like '%config_signed%' and private.go_live_conditions('fasting_safety', null)::text like '%timing_plan_rota%'
    and (select switch_role from public.go_live_guards where key = 'fasting_safety') = 'cmo')::text);
end $$;

-- c. fasting plans ------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_ins uuid := pg_temp.f('ins'); v_ok uuid := pg_temp.f('ok'); v_cmo uuid := pg_temp.f('cmo');
  v_today date := pg_temp.lagos_today(); v_rx uuid := gen_random_uuid(); v_chg uuid; v_err text; v_id uuid; v_ws date; v_we date; v_ps date; v_pe date; v_txt text;
begin
  perform pg_temp.ck('plan: ACCEPTANCE, an insulin user cannot start a fasting plan without a signed timing plan', 'true',
    (pg_temp.q_as(v_ins, format('select public.start_fasting_plan(''ramadan'', %L, %L)::text', v_today, v_today + 29)) like 'ERR:%')::text);
  perform pg_temp.ck('plan: ...and nothing was recorded', '0', (select count(*)::text from public.fasting_plans where patient_id = v_ins));
  -- even a privileged session inserting straight into the table is stopped by the trigger
  begin
    insert into public.fasting_plans (organisation_id, patient_id, fast, starts_on, ends_on, config_version, gate_snapshot) values (v_org, v_ins, 'ramadan', v_today, v_today + 29, 0, '{}');
    v_err := 'accepted';
  exception when insufficient_privilege then v_err := 'refused'; end;
  perform pg_temp.ck('plan: a direct insert for an uncovered insulin user is refused by the trigger', 'refused', v_err);
  -- the refusal never says why
  perform pg_temp.ck('plan: the refusal names no reason', 'false', (coalesce(pg_temp.q_as(v_ins, format('select public.start_fasting_plan(''ramadan'', %L, %L)::text', v_today, v_today + 29)), '') ~* 'insulin|pregnan|age|screen|condition')::text);

  -- a confirmed, clinician-signed timing plan applied to the medicine she takes now
  set local session_replication_role = replica;
  update public.medications set prescription_id = v_rx, source = 'clinician' where patient_id = v_ins and drug_name = 'Insulin glargine';
  set local session_replication_role = origin;
  -- The door asks about the WHOLE expected fast when no dates are given, so the plan must cover it: window from the seeded calendar (or, once every seeded
  -- window has passed, a plan around today).
  select (e ->> 'start')::date, (e ->> 'end')::date into v_ws, v_we from public.fasting_safety_config c, jsonb_array_elements(c.config -> 'calendar' -> 'ramadan') e
   where c.version = 1 and (e ->> 'end')::date >= v_today order by (e ->> 'start')::date limit 1;
  v_ps := greatest(coalesce(v_ws, v_today), v_today);
  v_pe := coalesce(v_we, v_today + 29);
  v_chg := pg_temp.mkplan(v_org, v_ins, v_cmo, v_rx, 'ramadan', v_ps - 7, v_pe + 3);
  perform pg_temp.setf('chg', v_chg);
  -- a second insulin user whose signed plan covers only a short stretch, not the whole expected fast
  declare v_x uuid := pg_temp.mkuser(v_org, 'ins2x', 'patient'); v_xrx uuid := gen_random_uuid(); begin
    set local session_replication_role = replica;
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source, prescription_id) values (v_org, v_x, 'Insulin glargine', '10u', 'daily', true, 'clinician', v_xrx);
    set local session_replication_role = origin;
    perform pg_temp.mkplan(v_org, v_x, v_cmo, v_xrx, 'ramadan', v_ps - 30, v_ps + 2);
    perform pg_temp.setf('ins2x', v_x);
  end;
  perform pg_temp.ck('plan: with the timing plan the insulin user may fast', 'may_fast_with_guidance', pg_temp.q_as(v_ins, 'select public.my_fasting_gate(''ramadan'', null, null)::jsonb ->> ''decision'''));
  perform pg_temp.ck('plan: a plan that covers only part of the expected fast is not reported as covering it', 'needs_clinician_plan', pg_temp.q_as(pg_temp.f('ins2x'), 'select public.my_fasting_gate(''ramadan'')::jsonb ->> ''decision'''));
  perform pg_temp.ck('plan: the door shows the plan the clinician wrote and who signed it', 'true', (
    (pg_temp.q_as(v_ins, 'select public.my_fasting_gate(''ramadan'')::jsonb -> ''timing_plans'' -> 0 ->> ''summary''')) like 'Take your morning tablet%')::text);
  v_txt := pg_temp.q_as(v_ins, format('select public.start_fasting_plan(''ramadan'', %L, %L)::text', v_ps, v_pe));
  if v_txt ~ '^ERR' then
    raise exception 'DIAG start refused: % | private gate: % | gate for the same dates: % | today % ps % pe %', v_txt, private.fasting_gate_for(v_ins, 'ramadan', v_ps, v_pe, now())::text, pg_temp.q_as(v_ins, format('select public.my_fasting_gate(''ramadan'', %L, %L)::text', v_ps, v_pe)), v_today, v_ps, v_pe;
  end if;
  v_id := v_txt::uuid;
  perform pg_temp.ck('plan: a plan covering only part of the fast does not let her start for the whole of it', 'true',
    (pg_temp.q_as(pg_temp.f('ins2x'), format('select public.start_fasting_plan(''ramadan'', %L, %L)::text', v_ps - 30, v_pe)) like 'ERR:%')::text);
  perform pg_temp.ck('plan: the covered insulin user can start', '1', (select count(*)::text from public.fasting_plans where id = v_id));
  perform pg_temp.ck('plan: the plan records which signed change covered it', v_chg::text, (select timing_change_ids[1]::text from public.fasting_plans where id = v_id));
  perform pg_temp.ck('plan: a second active plan is refused', 'true', (pg_temp.q_as(v_ins, format('select public.start_fasting_plan(''ramadan'', %L, %L)::text', v_ps, v_pe)) like 'ERR:%')::text);
  perform pg_temp.ck('plan: a plan longer than 60 days is refused', 'true', (pg_temp.q_as(v_ok, format('select public.start_fasting_plan(''ramadan'', %L, %L)::text', v_today, v_today + 90)) like 'ERR:%')::text);
  perform pg_temp.ck('plan: a client cannot insert directly', 'true',
    (pg_temp.q_as(v_ok, format('insert into public.fasting_plans (organisation_id, patient_id, fast, starts_on, ends_on, config_version, gate_snapshot) values (%L, %L, ''lent'', %L, %L, 1, ''{}'')', v_org, v_ok, v_today, v_today + 5)) like 'ERR:%')::text);
  perform pg_temp.ck('plan: a client cannot update', 'true', (pg_temp.q_as(v_ins, 'update public.fasting_plans set ends_on = ends_on + 1') like 'ERR:%')::text);
  perform pg_temp.ck('plan: the owner sees only their own plan', '1', pg_temp.q_as(v_ins, 'select count(*)::text from public.fasting_plans'));
  perform pg_temp.ck('plan: another patient sees none', '0', pg_temp.q_as(v_ok, 'select count(*)::text from public.fasting_plans'));
  perform pg_temp.ck('plan: an untied doctor sees none', '0', pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.fasting_plans'));
  perform pg_temp.ck('plan: my_fasting_plan shows the active plan whichever fast is on screen', 'true', (pg_temp.q_as(v_ins, 'select public.my_fasting_plan()::jsonb ->> ''id''') = v_id::text)::text);
  perform pg_temp.ck('plan: ...and the gate answer itself carries no plan', 'false', (pg_temp.q_as(v_ins, 'select public.my_fasting_gate(''lent'')::text') ~* '"plan')::text);
  perform pg_temp.ck('plan: another patient has no plan', 'null', coalesce(pg_temp.q_as(v_ok, 'select public.my_fasting_plan()::text'), 'null'));
  perform pg_temp.ck('plan: anon cannot read a plan', '42501', replace(pg_temp.q_anon('select public.my_fasting_plan()::text'), 'ERR:', ''));
  perform pg_temp.ck('plan: a plan cannot be re-dated', 'true', (pg_temp.q_as(pg_temp.f('p'), 'update public.fasting_plans set ends_on = ends_on + 1') like 'ERR:%')::text);
  begin
    update public.fasting_plans set ends_on = ends_on + 1 where id = v_id;
    v_err := 'accepted';
  exception when insufficient_privilege then v_err := 'refused'; end;
  perform pg_temp.ck('plan: a privileged session cannot re-date a plan either (the trigger, not just the missing grant)', 'refused', v_err);
  -- a red event pauses the plan guidance
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow, actions, created_at, is_test)
  values (v_org, v_ins, 'observation', gen_random_uuid(), 'red', null, 'live_symptom_gate', 1, 'draft', true, '[{"kind":"page_on_call"}]', now() - interval '2 hours', true);
  perform pg_temp.ck('plan: a red event pauses the plan guidance (decision not advised)', 'not_advised', pg_temp.q_as(v_ins, 'select public.my_fasting_gate(''ramadan'')::jsonb ->> ''decision'''));
  perform pg_temp.ck('plan: ...and the plan is still visible so it can be ended', 'true', (pg_temp.q_as(v_ins, 'select public.my_fasting_plan()::jsonb ->> ''id''') = v_id::text)::text);
  perform pg_temp.q_as(v_ins, 'select public.end_fasting_plan(''stopped_by_person'')::text');
  perform pg_temp.ck('plan: ending it records the reason', 'ended|stopped_by_person', (select status || '|' || ended_reason from public.fasting_plans where id = v_id));
  begin
    update public.fasting_plans set status = 'active', ended_at = null, ended_reason = null where id = v_id;
    v_err := 'accepted';
  exception when insufficient_privilege then v_err := 'refused'; end;
  perform pg_temp.ck('plan: an ended plan cannot be reopened', 'refused', v_err);
  perform pg_temp.ck('plan: a plan that has already ended cannot be started', 'true',
    (pg_temp.q_as(v_ok, format('select public.start_fasting_plan(''ramadan'', %L, %L)::text', v_today - 20, v_today - 5)) like 'ERR:%')::text);
  perform pg_temp.ck('plan: a plan starting more than a year away cannot be started', 'true',
    (pg_temp.q_as(v_ok, format('select public.start_fasting_plan(''ramadan'', %L, %L)::text', v_today + 500, v_today + 520)) like 'ERR:%')::text);
  -- a plan whose last day has passed ends by itself, so it neither blocks the next fast nor shows the care team a person still fasting
  declare v_stale uuid := pg_temp.mkuser(v_org, 'stale', 'patient'); v_cnt integer; begin
    set local session_replication_role = replica;
    insert into public.fasting_plans (organisation_id, patient_id, fast, starts_on, ends_on, config_version, gate_snapshot) values (v_org, v_stale, 'ramadan', v_today - 40, v_today - 10, 1, '{}');
    set local session_replication_role = origin;
    perform pg_temp.ck('plan: a plan past its last day is no longer shown as the active plan', 'null', coalesce(pg_temp.q_as(v_stale, 'select public.my_fasting_plan()::text'), 'null'));
    perform pg_temp.ck('plan: starting a new fast ends the stale one first (the one-active-plan index does not block it)', 'true',
      (pg_temp.q_as(v_stale, format('select public.start_fasting_plan(''lent'', %L, %L)::text', v_today, v_today + 20)) !~ '^ERR')::text);
    perform pg_temp.ck('plan: ...and the stale one is recorded as finished', 'finished', (select ended_reason from public.fasting_plans where patient_id = v_stale and ends_on < v_today));
    set local session_replication_role = replica;
    insert into public.fasting_plans (organisation_id, patient_id, fast, starts_on, ends_on, config_version, gate_snapshot) values (v_org, pg_temp.f('p'), 'lent', v_today - 40, v_today - 10, 1, '{}');
    set local session_replication_role = origin;
    v_cnt := private.sweep_fasting_plans();
    perform pg_temp.ck('plan: the daily sweep ends every plan past its last day', 'true', (v_cnt >= 1 and not exists (select 1 from public.fasting_plans where status = 'active' and ends_on < v_today))::text);
  end;
  perform pg_temp.ck('plan: anon cannot start', '42501', replace(pg_temp.q_anon(format('select public.start_fasting_plan(''ramadan'', %L, %L)::text', v_today, v_today + 5)), 'ERR:', ''));
  perform pg_temp.ck('plan: the healthy adult can start a plan', 'true', (pg_temp.q_as(v_ok, format('select public.start_fasting_plan(''lent'', %L, %L)::text', v_today, v_today + 20)) !~ '^ERR')::text);
  perform pg_temp.setguard('fasting_safety', false);
  perform pg_temp.ck('plan: with the guard OFF nobody can start one', 'true',
    (pg_temp.q_as(pg_temp.f('p'), format('select public.start_fasting_plan(''ramadan'', %L, %L)::text', v_today, v_today + 5)) like 'ERR:%')::text);
  perform pg_temp.setguard('fasting_safety', true);
end $$;

-- d. config -----------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_cfg uuid; v_err text; v_json jsonb;
begin
  select id, config into v_cfg, v_json from public.fasting_safety_config where version = 1;
  perform pg_temp.ck('cfg: a senior doctor cannot sign', 'true', (pg_temp.q_as(pg_temp.f('doc'), format('select public.sign_fasting_safety_config(%L)::text', v_cfg)) like '%only the active Chief Medical Officer%')::text);
  perform pg_temp.ck('cfg: a patient cannot sign', 'true', (pg_temp.q_as(pg_temp.f('p'), format('select public.sign_fasting_safety_config(%L)::text', v_cfg)) like 'ERR:%')::text);
  perform pg_temp.ck('cfg: anon cannot sign', '42501', replace(pg_temp.q_anon(format('select public.sign_fasting_safety_config(%L)::text', v_cfg)), 'ERR:', ''));
  perform pg_temp.ck('cfg: the CMO can sign', v_cfg::text, pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_fasting_safety_config(%L)::text', v_cfg)));
  perform pg_temp.ck('cfg: a patient cannot read the rules', '0', pg_temp.q_as(pg_temp.f('p'), 'select count(*)::text from public.fasting_safety_config'));
  begin
    insert into public.fasting_safety_config (version, config) values (98, jsonb_set(v_json, '{safety,outcomes,recent_red_event}', '"needs_clinician_plan"'));
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('cfg: a red event can never be softened', 'refused', v_err);
  begin
    insert into public.fasting_safety_config (version, config) values (99, v_json #- '{safety,medicine_classes,insulin}');
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('cfg: insulin cannot be dropped from the medicine classes', 'refused', v_err);
  begin
    insert into public.fasting_safety_config (version, config) values (100, jsonb_set(v_json, '{calendar,ramadan}', '[{"year":2027,"start":"2027-03-09","end":"2027-02-08"}]'));
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('cfg: a calendar window cannot end before it starts', 'refused', v_err);
  begin
    insert into public.fasting_safety_config (version, config, is_active) values (101, v_json, true);
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('cfg: a config cannot be active without a signature', 'refused', v_err);
  perform pg_temp.ck('cfg: an empty condition match (which would switch a hard stop off) is not valid', 'false',
    private.fasting_config_valid(jsonb_set(v_json, '{safety,matches,type1_diabetes}', '{"name_patterns":[],"icd10_prefixes":[]}'))::text);
  perform pg_temp.ck('cfg: a fractional minimum age is not valid', 'false', private.fasting_config_valid(jsonb_set(v_json, '{safety,min_age_years}', '18.5'))::text);
  -- the tag on an S24 medicine change: only a CHANGE, for one of the two fasts, inside 120 days
  begin
    insert into public.care_plan_changes (organisation_id, patient_id, kind, proposed_by, proposal, rationale, is_test)
    values (pg_temp.f('org'), pg_temp.f('ok'), 'medication', 'clinician', '{"action":"stop","medication_id":"00000000-0000-0000-0000-000000000000","fasting":{"fast":"ramadan","valid_from":"2027-02-01","valid_to":"2027-03-01"}}', 'proof: tag on a stop', true);
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('cfg: a stop cannot carry the fasting tag', 'refused', v_err);
  begin
    insert into public.care_plan_changes (organisation_id, patient_id, kind, proposed_by, proposal, rationale, is_test)
    values (pg_temp.f('org'), pg_temp.f('ok'), 'medication', 'clinician', '{"action":"start","item":{"drug_name":"x","quantity":"30","duration_days":40},"fasting":{"fast":"ramadan","valid_from":"2027-02-01","valid_to":"2027-03-01"}}', 'proof: tag on a start', true);
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('cfg: a start CAN carry the fasting tag (the replacement for a self-entered medicine)', 'accepted', v_err);
  begin
    insert into public.care_plan_changes (organisation_id, patient_id, kind, proposed_by, proposal, rationale, is_test)
    values (pg_temp.f('org'), pg_temp.f('ok'), 'medication', 'clinician', '{"action":"change","medication_id":"00000000-0000-0000-0000-000000000000","item":{"drug_name":"x"},"fasting":{"fast":"diwali","valid_from":"2027-02-01","valid_to":"2027-03-01"}}', 'proof: unknown fast', true);
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('cfg: an unknown fast cannot be tagged', 'refused', v_err);
  perform pg_temp.ck('cfg: the seeded config is valid', 'true', private.fasting_config_valid(v_json)::text);
  perform pg_temp.ck('cfg: both guards ship OFF (the proof turned one on and off; the other is untouched)', 'false', (select is_on::text from public.go_live_guards where key = 'glucose_response_insights'));
end $$;

-- e. glucose series ------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_ok uuid := pg_temp.f('ok'); v_preg uuid := pg_temp.f('preg'); v_doc uuid := pg_temp.f('doc');
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, taken_at, source) values
    (v_org, v_ok, 'glucose', 5.2, 'pre_meal', now() - interval '3 hours', 'device'),
    (v_org, v_ok, 'glucose', 7.9, 'post_meal', now() - interval '1 hour', 'device'),
    (v_org, v_ok, 'glucose', 6.1, null, now() - interval '30 minutes', 'cgm'),
    (v_org, v_preg, 'glucose', 5.5, 'pre_meal', now() - interval '3 hours', 'device');
  perform pg_temp.ck('series: guard OFF is unavailable', '{"state": "unavailable"}', pg_temp.q_as(v_ok, 'select public.my_glucose_series(90)::text'));
  perform pg_temp.setguard('glucose_response_insights', true);
  perform pg_temp.ck('series: guard ON returns the readings, labelled by source', 'fingerstick,fingerstick,cgm', (
    select string_agg(r ->> 'source', ',' order by r ->> 'at') from jsonb_array_elements(pg_temp.q_as(v_ok, 'select public.my_glucose_series(90)::text')::jsonb -> 'readings') r));
  perform pg_temp.ck('series: a pregnant person gets the same unavailable answer', '{"state": "unavailable"}', pg_temp.q_as(v_preg, 'select public.my_glucose_series(90)::text'));
  update public.profiles set date_of_birth = null where id = v_ok;
  perform pg_temp.ck('series: an unknown date of birth is withheld too (fails closed, like the fasting gate)', '{"state": "unavailable"}', pg_temp.q_as(v_ok, 'select public.my_glucose_series(90)::text'));
  update public.profiles set date_of_birth = (pg_temp.lagos_today() - interval '45 years')::date where id = v_ok;
  perform pg_temp.ck('series: only your own readings', '3', pg_temp.q_as(v_ok, 'select jsonb_array_length(public.my_glucose_series(90) -> ''readings'')::text'));
  perform pg_temp.ck('series: anon cannot call it', '42501', replace(pg_temp.q_anon('select public.my_glucose_series(90)::text'), 'ERR:', ''));
  perform pg_temp.ck('series: a day count beyond 180 is clamped, not an error', 'true', (pg_temp.q_as(v_ok, 'select public.my_glucose_series(100000)::text') !~ '^ERR')::text);
end $$;

-- f. SABOTAGE: break each safeguard once; the matching checks must flip --------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_ins uuid := pg_temp.f('ins'); v_ok uuid := pg_temp.f('ok'); v_today date := pg_temp.lagos_today(); v_err text; v_ins2 uuid;
begin
  -- an insulin user with NO timing plan
  v_ins2 := pg_temp.mkuser(v_org, 'ins2', 'patient');
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source) values (v_org, v_ins2, 'Insulin glargine', '10u', 'daily', true, 'patient');
  perform pg_temp.setf('ins2', v_ins2);
  -- (1) the plan trigger removed: an uncovered insulin user can be recorded as fasting
  drop trigger fasting_plans_gate on public.fasting_plans;
  insert into results values ('sabotaged', 'SABOTAGE: without the trigger an uncovered insulin user gets a plan', 'refused',
    case when pg_temp.q_as(v_ins2, format('select public.start_fasting_plan(''ramadan'', %L, %L)::text', v_today, v_today + 5)) like 'ERR:%' then 'refused' else 'accepted' end);
end $$;

do $$
begin
  -- (2) a gate that always says yes lets the insulin user through the public door
  create or replace function private.fasting_gate_for(p_patient uuid, p_fast text, p_starts_on date default null, p_ends_on date default null, p_now timestamptz default now())
  returns jsonb language sql stable as $g$ select '{"decision":"may_fast_with_guidance","reason":"none","blocks":[],"covered":[],"config_version":1,"timing_change_ids":[]}'::jsonb $g$;
  insert into results values ('sabotaged', 'SABOTAGE: a gate that always allows would let the insulin user fast', 'needs_clinician_plan',
    pg_temp.q_as(pg_temp.f('ins2'), 'select public.my_fasting_gate(''ramadan'')::jsonb ->> ''decision'''));
end $$;

do $$
begin
  -- (3) a series with no withheld check shows a pregnant person their numbers
  create or replace function public.my_glucose_series(p_days integer default 90) returns jsonb
  language sql stable security definer set search_path = '' as $g$
    select jsonb_build_object('state', 'ok', 'readings', coalesce(jsonb_agg(jsonb_build_object('at', v.taken_at)), '[]'::jsonb))
      from private.vitals_readings_current v where v.patient_id = (select auth.uid()) and v.vital_type = 'glucose' $g$;
  insert into results values ('sabotaged', 'SABOTAGE: without the withheld check a pregnant person gets a series', 'unavailable',
    coalesce(pg_temp.q_as(pg_temp.f('preg'), 'select public.my_glucose_series(90)::jsonb ->> ''state'''), 'null'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S50b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
