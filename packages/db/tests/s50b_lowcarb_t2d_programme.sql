-- S50b proof: the low-carbohydrate type 2 diabetes programme (migration *_s50b_lowcarb_t2d_programme.sql).
--   a. eligibility: 26 shared cases (ids L01..L26 are the same ids as packages/clinical/src/lowcarb-programme.test.ts; lowcarb-parity.test.ts pins them),
--      and no signed rules is "unavailable", never eligible (L23).
--   b. config: unsigned is never live, an invalid config is refused, only the CMO signs.
--   c. enrolment: a patient cannot self-enrol, an untied or non-prescribing staff member cannot offer, the admission confirmation and the supervision
--      note are required, the patient (and nobody else) answers, a real patient is refused while the guard is off, the patient door is one answer.
--   d. safety: a low glucose, a high ketone reading and a red triage event each PAUSE; a resume re-runs the screen; the third pause in 30 days STOPS;
--      the patient can always stop; sugars falling raises a medicine review task; the sweep pauses on pregnancy and stops on lapsed check-ins.
--   e. medicines (INV-02): the draft step table can be approved by nobody, drives an engine proposal for a test patient only, and a proposal is an unsigned
--      draft row that changes no medicine.
--   f. go-live: the guard is born off, its conditions read as expected, the two attestable conditions can be recorded, nothing is switched on.
--   g. privacy: the patient and a care coordinator read no enrolment or event row; anon has no grants; events are append-only; a stopped enrolment
--      cannot be reopened.
-- One rolled-back transaction. is_test data only. SABOTAGE section at the end: the reading trigger, the eligibility function and the transition guard are each
-- broken once; the matching checks must flip (otherwise the test is vacuous).
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
  exception when others then r := 'ERR:' || sqlstate || ':' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.err(p_text text) returns text language sql as $$ select case when p_text like 'ERR:%' then substr(p_text, 1, 9) else 'ok' end $$;
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
create function pg_temp.lagos_today() returns date language sql as $$ select (now() at time zone 'Africa/Lagos')::date $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's50b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  -- registration is adult-only: every profile is created as an adult, and a minor is made by a later UPDATE
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S50b ' || p_label || ' Person', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (pg_temp.lagos_today() - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = true, is_active = true, phone = excluded.phone,
    date_of_birth = excluded.date_of_birth;
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
create function pg_temp.tie(p_org uuid, p_patient uuid, p_doc uuid) returns void language sql as
$$ insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (p_org, p_patient, p_doc, now()) $$;

-- triage_events is append-only for every client; the proof's owner session removes a patient's events to reset the 72-hour window
create function pg_temp.clear_triage(p_patient uuid) returns void language plpgsql as $f$
begin
  alter table public.triage_events disable trigger user;
  delete from public.triage_events where patient_id = p_patient;
  alter table public.triage_events enable trigger user;
end $f$;
-- a fresh patient from a spec; returns the patient id. Keys: age, confirmed ('none' = unrecorded), reported, preg (yes | postnatal6 | postnatal13), ed,
-- conds [{name, icd10, status}], meds [names], glucose [{mmol, days}], triage [{grade, hours}]
create function pg_temp.mkcase(spec jsonb) returns uuid language plpgsql as $f$
declare v uuid; v_org uuid := pg_temp.f('org'); c jsonb; e jsonb; g jsonb; m text; v_conf text := coalesce(spec ->> 'confirmed', 'type_2');
begin
  v := pg_temp.mkuser(v_org, 'case', 'patient');
  if (spec ->> 'age') = 'null' then
    update public.profiles set date_of_birth = null where id = v;
  elsif spec ? 'age' and (spec ->> 'age')::int < 18 then
    null; -- made a minor at the very end: a dependant under 18 cannot hold a diabetes profile row
  elsif spec ? 'age' then
    update public.profiles set date_of_birth = (pg_temp.lagos_today() - make_interval(years => (spec ->> 'age')::int, days => 30))::date where id = v;
  end if;
  if v_conf <> 'none' or spec ? 'reported' then
    insert into public.patient_diabetes_profile (patient_id, organisation_id, confirmed_type, patient_reported_type)
    values (v, v_org, case when v_conf = 'none' then null else v_conf::public.diabetes_type end,
            case when spec ? 'reported' then (spec ->> 'reported')::public.diabetes_type else null end);
  end if;
  case spec ->> 'preg'
    when 'yes' then insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, v, true);
    when 'postnatal6' then insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date) values (v_org, v, pg_temp.lagos_today() - 180);
    when 'postnatal13' then insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date) values (v_org, v, pg_temp.lagos_today() - 400);
    else null;
  end case;
  if coalesce((spec ->> 'ed')::boolean, false) then
    -- a trigger derives `positive` from two or more SCOFF answers; a bare positive = true would be reset
    insert into public.obesity_ed_screens (organisation_id, patient_id, scoff_sick, scoff_control) values (v_org, v, true, true);
  end if;
  for c in select * from jsonb_array_elements(coalesce(spec -> 'conds', '[]'::jsonb)) loop
    insert into public.patient_conditions (organisation_id, patient_id, condition_name, icd10_code, status)
    values (v_org, v, c ->> 'name', c ->> 'icd10', coalesce(c ->> 'status', 'active')::public.condition_clinical_status);
  end loop;
  for m in select jsonb_array_elements_text(coalesce(spec -> 'meds', '[]'::jsonb)) loop
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
    values (v_org, v, m, '1', 'daily', true, 'clinician');
  end loop;
  for g in select * from jsonb_array_elements(coalesce(spec -> 'glucose', '[]'::jsonb)) loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, taken_at, glucose_mmol_l)
    values (v_org, v, 'glucose', 'device', now() - ((g ->> 'days')::numeric * interval '1 day'), (g ->> 'mmol')::numeric);
  end loop;
  -- the readings above may have started the ordinary glucose pipeline: this case is about the screen, so only the events the spec names remain
  perform pg_temp.clear_triage(v);
  for e in select * from jsonb_array_elements(coalesce(spec -> 'triage', '[]'::jsonb)) loop
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow, actions, created_at, is_test)
    values (v_org, v, 'observation', gen_random_uuid(), e ->> 'grade', null, 'live_symptom_gate', 1, 'draft', true,
            case when e ->> 'grade' = 'red' then '[{"kind":"page_on_call"}]'::jsonb else '[]'::jsonb end,
            now() - ((e ->> 'hours')::numeric * interval '1 hour'), true);
  end loop;
  if spec ? 'age' and (spec ->> 'age') <> 'null' and (spec ->> 'age')::int < 18 then
    -- a minor is made in ONE update: dependent flag, kind and date of birth together
    update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child',
           date_of_birth = (pg_temp.lagos_today() - make_interval(years => (spec ->> 'age')::int, days => 30))::date where id = v;
  end if;
  return v;
end $f$;
create function pg_temp.run_case(spec jsonb, p_supervision boolean default false, p_admission boolean default true) returns text language plpgsql as $f$
declare v uuid := pg_temp.mkcase(spec); g jsonb;
begin
  g := private.lowcarb_eligibility_for(v, p_supervision, p_admission, now());
  return (g ->> 'decision') || '|' || coalesce((select string_agg(x, ',' order by x) from jsonb_array_elements_text(g -> 'reasons') x), '');
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then insert into public.organisations (name) values ('S50b proof org') returning id into v_org; end if;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  -- only the proof's own staff exist for the duration (the CMO count and task routing must not depend on real people)
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'senior', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('doc2', pg_temp.mkdoc(v_org, 'senior2', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('coord', pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', v_admin));
exception when others then
  raise exception 'fixture failed: %', sqlerrm;
end $$;

-- a. before anything is signed: no rules, no answer ---------------------------------------------------------------------------------
select pg_temp.ck('L23 no signed rules: unavailable, never eligible', 'unavailable|rules_unavailable', pg_temp.run_case('{}'));
select pg_temp.ck('b the seeded config is born unsigned and inactive', '0|1', (select count(*) filter (where is_active or approved_by is not null)::text || '|' || count(*)::text from public.lowcarb_protocol_config));
select pg_temp.ck('b the seeded config is valid', 'true', (select private.lowcarb_config_valid(config)::text from public.lowcarb_protocol_config where version = 1));
select pg_temp.ck('b an unsigned row cannot be made live by a bare update', 'refused', (
  select case when pg_temp.q_as(pg_temp.f('admin'), 'update public.lowcarb_protocol_config set is_active = true') like 'ERR:%' then 'refused' else 'accepted' end));
do $$
declare v_err text;
begin
  begin update public.lowcarb_protocol_config set is_active = true where version = 1; v_err := 'accepted'; exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('b even the owner cannot make an unsigned row live', 'refused', v_err);
  begin
    insert into public.lowcarb_protocol_config (version, config) select 98, jsonb_set(config, '{eligibility,min_age_years}', '16') from public.lowcarb_protocol_config where version = 1;
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('b a config that admits under-18s is refused', 'refused', v_err);
  begin
    insert into public.lowcarb_protocol_config (version, config) select 99, config #- '{safety,pause_glucose_below_mmol}' from public.lowcarb_protocol_config where version = 1;
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('b a config with no pause line is refused', 'refused', v_err);
  begin
    insert into public.lowcarb_protocol_config (version, config) select 97, jsonb_set(config, '{eligibility,medicine_groups,insulin,handling}', '"ignore"') from public.lowcarb_protocol_config where version = 1;
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('b an unknown medicine handling is refused', 'refused', v_err);
  begin
    insert into public.lowcarb_protocol_config (version, config) select 96, jsonb_set(config, '{medicine_review,min_readings}', '5.5') from public.lowcarb_protocol_config where version = 1;
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('b a fractional count that a trigger would cast to an integer is refused', 'refused', v_err);
end $$;
select pg_temp.ck('b a senior doctor cannot sign', 'ERR:P0001', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.sign_lowcarb_protocol_config(%L)', (select id from public.lowcarb_protocol_config where version = 1)))));
select pg_temp.ck('b the CMO signs', 'ok', pg_temp.err(pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_lowcarb_protocol_config(%L)', (select id from public.lowcarb_protocol_config where version = 1)))));
select pg_temp.ck('b it is now live and signed', 'true', (select (is_active and approved_by is not null)::text from public.lowcarb_protocol_config where version = 1));

-- a. the shared eligibility cases ---------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('L01 a plain adult with confirmed type 2', 'eligible|none', pg_temp.run_case('{}'));
  perform pg_temp.ck('L02 age 17', 'not_eligible|under_age', pg_temp.run_case('{"age":17}'));
  perform pg_temp.ck('L03 no date of birth', 'not_eligible|age_unknown', pg_temp.run_case('{"age":"null"}'));
  perform pg_temp.ck('L04 confirmed type 1', 'not_eligible|not_type_2', pg_temp.run_case('{"confirmed":"type_1"}'));
  perform pg_temp.ck('L05 type 2 reported but not confirmed', 'not_eligible|type_unconfirmed', pg_temp.run_case('{"confirmed":"none","reported":"type_2"}'));
  perform pg_temp.ck('L06 pregnant', 'not_eligible|pregnancy_or_postnatal', pg_temp.run_case('{"preg":"yes"}'));
  perform pg_temp.ck('L07 positive eating disorder screen', 'not_eligible|eating_disorder_screen', pg_temp.run_case('{"ed":true}'));
  perform pg_temp.ck('L08 kidney disease by name', 'not_eligible|condition_kidney_disease', pg_temp.run_case('{"conds":[{"name":"Chronic kidney disease stage 3"}]}'));
  perform pg_temp.ck('L09 resolved kidney disease', 'eligible|none', pg_temp.run_case('{"conds":[{"name":"Chronic kidney disease","status":"resolved"}]}'));
  perform pg_temp.ck('L10 kidney disease by ICD-10 code only', 'not_eligible|condition_kidney_disease', pg_temp.run_case('{"conds":[{"name":"Reduced function","icd10":"N18.3"}]}'));
  perform pg_temp.ck('L11 an SGLT2 inhibitor', 'not_eligible|medicine_sglt2_inhibitor', pg_temp.run_case('{"meds":["Jardiance 10mg"]}'));
  perform pg_temp.ck('L12 insulin, supervision not accepted', 'needs_supervision|supervision_insulin', pg_temp.run_case('{"meds":["Insulin glargine"]}'));
  perform pg_temp.ck('L13 insulin, supervision accepted', 'eligible|none', pg_temp.run_case('{"meds":["Insulin glargine"]}', true));
  perform pg_temp.ck('L14 a sulfonylurea, supervision not accepted', 'needs_supervision|supervision_sulfonylurea', pg_temp.run_case('{"meds":["Gliclazide 80mg"]}'));
  perform pg_temp.ck('L15 a severe low 10 days ago', 'not_eligible|recent_severe_low_sugar', pg_temp.run_case('{"glucose":[{"mmol":2.5,"days":10}]}'));
  perform pg_temp.ck('L16 a severe low 100 days ago', 'eligible|none', pg_temp.run_case('{"glucose":[{"mmol":2.5,"days":100}]}'));
  perform pg_temp.ck('L17 a 3.5 reading is not severe', 'eligible|none', pg_temp.run_case('{"glucose":[{"mmol":3.5,"days":10}]}'));
  perform pg_temp.ck('L18 admission not ruled out', 'not_eligible|admission_not_ruled_out', pg_temp.run_case('{}', false, false));
  perform pg_temp.ck('L19 a red event 24 hours ago', 'not_now|recent_triage_event', pg_temp.run_case('{"triage":[{"grade":"red","hours":24}]}'));
  perform pg_temp.ck('L20 an amber event 100 hours ago', 'eligible|none', pg_temp.run_case('{"triage":[{"grade":"amber","hours":100}]}'));
  perform pg_temp.ck('L21 type 1 and pregnant, both reasons', 'not_eligible|not_type_2,pregnancy_or_postnatal', pg_temp.run_case('{"confirmed":"type_1","preg":"yes"}'));
  perform pg_temp.ck('L22 pregnant on insulin: the hard reason wins', 'not_eligible|pregnancy_or_postnatal', pg_temp.run_case('{"preg":"yes","meds":["Insulin glargine"]}'));
  perform pg_temp.ck('L24 a green event is not a reason', 'eligible|none', pg_temp.run_case('{"triage":[{"grade":"green","hours":2}]}'));
  perform pg_temp.ck('L25 postnatal 6 months ago', 'not_eligible|pregnancy_or_postnatal', pg_temp.run_case('{"preg":"postnatal6"}'));
  perform pg_temp.ck('L26 postnatal 13 months ago', 'eligible|none', pg_temp.run_case('{"preg":"postnatal13"}'));
end $$;

-- c. enrolment ---------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); p uuid; q uuid; r uuid; t uuid; u uuid; real_p uuid; v_id text;
begin
  p := pg_temp.mkcase('{}'); perform pg_temp.setf('p', p);
  q := pg_temp.mkcase('{}'); perform pg_temp.setf('q', q);
  r := pg_temp.mkcase('{}'); perform pg_temp.setf('r', r);
  t := pg_temp.mkcase('{"meds":["Gliclazide 80mg"]}'); perform pg_temp.setf('t', t);
  u := pg_temp.mkcase('{"preg":"yes"}'); perform pg_temp.setf('u', u);
  real_p := pg_temp.mkcase('{}'); perform pg_temp.setf('real', real_p);
  update public.profiles set is_test = false where id = real_p;
  perform pg_temp.tie(v_org, p, pg_temp.f('doc'));
  perform pg_temp.tie(v_org, r, pg_temp.f('doc'));
  perform pg_temp.tie(v_org, t, pg_temp.f('doc'));
  perform pg_temp.tie(v_org, u, pg_temp.f('doc'));
  perform pg_temp.tie(v_org, real_p, pg_temp.f('doc'));
  perform pg_temp.tie(v_org, q, pg_temp.f('coord'));

  perform pg_temp.ck('c1 before an offer the patient door says unavailable', '{"state": "unavailable"}', pg_temp.q_as(p, 'select public.my_lowcarb_gate()::text'));
  perform pg_temp.ck('c2 a patient cannot self-enrol', 'ERR:42501', pg_temp.err(pg_temp.q_as(p, format('select public.offer_lowcarb_programme(%L, true)', p))));
  perform pg_temp.ck('c3 an untied doctor cannot offer', 'ERR:42501', pg_temp.err(pg_temp.q_as(pg_temp.f('doc2'), format('select public.offer_lowcarb_programme(%L, true)', p))));
  perform pg_temp.ck('c4 a care coordinator cannot offer', 'ERR:42501', pg_temp.err(pg_temp.q_as(pg_temp.f('coord'), format('select public.offer_lowcarb_programme(%L, true)', q))));
  perform pg_temp.ck('c5 a care coordinator cannot even check eligibility', 'ERR:42501', pg_temp.err(pg_temp.q_as(pg_temp.f('coord'), format('select public.lowcarb_eligibility(%L, true)', q)::text)));
  perform pg_temp.ck('c6 the admission confirmation is required', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, false)', p))));
  perform pg_temp.ck('c7 a real patient is refused while the guard is off', 'ERR:55000', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true)', real_p))));
  declare real_doc uuid := pg_temp.mkdoc(v_org, 'realdoc', 'senior_medical_officer', pg_temp.f('admin')); pair_p uuid := pg_temp.mkcase('{}');
  begin
    update public.profiles set is_test = false where id = real_doc;
    perform pg_temp.tie(v_org, pair_p, real_doc);
    perform pg_temp.ck('c7b a real clinician cannot offer to a test patient while the guard is off (the pair rule)', 'ERR:55000', pg_temp.err(pg_temp.q_as(real_doc, format('select public.offer_lowcarb_programme(%L, true)', pair_p))));
  end;
  perform pg_temp.ck('c8 a person on a sulfonylurea needs supervision first', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true)', t))));
  perform pg_temp.ck('c9 accepting supervision needs a note', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true, true, %L)', t, 'ok'))));
  perform pg_temp.ck('c10 a pregnant patient cannot be offered it', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true)', u))));
  perform pg_temp.ck('c11 the clinician sees a pregnancy reason only because the tie entitles them to it', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format('select public.lowcarb_eligibility(%L, true) -> ''reasons'' ? ''pregnancy_or_postnatal''', u))));

  v_id := pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true)', p));
  perform pg_temp.ck('c12 a tied prescriber can offer', 'true', (v_id !~ '^ERR')::text);
  perform pg_temp.setf('ep', v_id::uuid);
  perform pg_temp.ck('c13 the offer is not yet a programme', 'offered', (select status from public.lowcarb_enrolments where id = pg_temp.f('ep')));
  perform pg_temp.ck('c14 an offer is a neutral in-app notice', '1', (select count(*)::text from public.notifications where recipient_id = p and template = 'lowcarb_programme_update'));
  perform pg_temp.ck('c15 a second open offer is refused', 'ERR:23505', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true)', p))));
  perform pg_temp.ck('c16 another patient cannot answer it', 'ERR:22023', pg_temp.err(pg_temp.q_as(q, format('select public.respond_lowcarb_offer(%L, true)', pg_temp.f('ep')))));
  perform pg_temp.ck('c17 the clinician cannot accept for the patient', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.respond_lowcarb_offer(%L, true)', pg_temp.f('ep')))));
  perform pg_temp.ck('c18 the patient door shows the offer and the numbers needed', 'offered|3.9|14',
    (select (g ->> 'status') || '|' || (g ->> 'low_glucose_below_mmol') || '|' || (g #>> '{check_ins,glucose,per_week}') from (select pg_temp.q_as(p, 'select public.my_lowcarb_gate()::text')::jsonb g) x));
  perform pg_temp.ck('c19 the door for someone else is the same unavailable answer', '{"state": "unavailable"}', pg_temp.q_as(q, 'select public.my_lowcarb_gate()::text'));
  perform pg_temp.ck('c20 a real patient gets the identical unavailable answer', '{"state": "unavailable"}', pg_temp.q_as(real_p, 'select public.my_lowcarb_gate()::text'));
  perform pg_temp.ck('c21 anon cannot call the door', 'ERR:42501', pg_temp.q_anon('select public.my_lowcarb_gate()::text'));
  perform pg_temp.ck('c22 the patient accepts', 'active', pg_temp.q_as(p, format('select public.respond_lowcarb_offer(%L, true)', pg_temp.f('ep'))));
  perform pg_temp.ck('c23 now it is active and stamped', 'active|true', (select status || '|' || (accepted_at is not null)::text from public.lowcarb_enrolments where id = pg_temp.f('ep')));
  perform pg_temp.ck('c24 the supervision flag is recorded with the offer', 'false', (select supervision_accepted::text from public.lowcarb_enrolments where id = pg_temp.f('ep')));
  -- a declined offer
  v_id := pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true)', r));
  perform pg_temp.setf('er', v_id::uuid);
  perform pg_temp.ck('c25 the patient can decline', 'declined', pg_temp.q_as(r, format('select public.respond_lowcarb_offer(%L, false)', pg_temp.f('er'))));
  -- an offer to someone on a sulfonylurea works once a doctor accepts supervision with a note
  v_id := pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true, true, %L)', t, 'Weekly glucose review by me, stop at first low'));
  perform pg_temp.ck('c26 supervision accepted with a note: offered', 'true', (v_id !~ '^ERR')::text);
  perform pg_temp.setf('et', v_id::uuid);
  perform pg_temp.ck('c27 the supervision is on the record', 'true', (select supervision_accepted::text from public.lowcarb_enrolments where id = pg_temp.f('et')));
  -- an offer goes stale: pregnancy appears between the offer and the answer
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, t, true);
  perform pg_temp.ck('c28 accepting after pregnancy appeared is refused as unavailable', 'unavailable', pg_temp.q_as(t, format('select public.respond_lowcarb_offer(%L, true)', pg_temp.f('et'))));
  perform pg_temp.ck('c29 ...and that offer expired', 'expired', (select status from public.lowcarb_enrolments where id = pg_temp.f('et')));
end $$;

-- d. safety ------------------------------------------------------------------------------------------------------------------------
create function pg_temp.status_of(p_id uuid) returns text language sql as $$ select status || coalesce('/' || pause_code, '') || coalesce('/' || stop_code, '') from public.lowcarb_enrolments where id = p_id $$;
create function pg_temp.reading(p_patient uuid, p_type text, p_val numeric, p_days numeric default 0) returns void language plpgsql as $f$
begin
  if p_type = 'glucose' then
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, taken_at, glucose_mmol_l)
    values (pg_temp.f('org'), p_patient, 'glucose', 'device', now() - p_days * interval '1 day', p_val);
  else
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, taken_at, ketones_mmol_l)
    values (pg_temp.f('org'), p_patient, 'ketones', 'device', now() - p_days * interval '1 day', p_val);
  end if;
end $f$;
do $$
declare p uuid := pg_temp.f('p'); ep uuid := pg_temp.f('ep'); v_tasks integer;
begin
  -- a normal glucose reading moves nothing
  perform pg_temp.reading(p, 'glucose', 8.2);
  perform pg_temp.ck('d1 a normal reading leaves the programme running', 'active', pg_temp.status_of(ep));

  -- first pause: a low glucose
  perform pg_temp.reading(p, 'glucose', 3.5);
  perform pg_temp.ck('d2 a low glucose pauses it', 'paused', split_part(pg_temp.status_of(ep), '/', 1));
  perform pg_temp.ck('d3 a pause opens one medicine review task', '1', (select count(*)::text from public.clinical_tasks where patient_id = p and type = 'lowcarb_medicine_review' and state not in ('completed', 'cancelled')));
  perform pg_temp.ck('d4 the patient gets a neutral notice', 'true', ((select count(*) from public.notifications where recipient_id = p and template = 'lowcarb_programme_update') >= 2)::text);
  perform pg_temp.ck('d5 the pause is on the programme history', 'true', (exists (select 1 from public.lowcarb_programme_events where enrolment_id = ep and kind = 'paused'))::text);
  perform pg_temp.ck('d6 the patient door still answers (so what-to-do-if-low stays on screen) and says nothing of why', 'paused|false',
    (select (g ->> 'status') || '|' || (g ? 'pause_code')::text from (select pg_temp.q_as(p, 'select public.my_lowcarb_gate()::text')::jsonb g) x));

  -- resume is a clinician's decision and re-runs the screen
  perform pg_temp.ck('d7 the patient cannot resume it', 'ERR:42501', pg_temp.err(pg_temp.q_as(p, format('select public.resume_lowcarb_programme(%L)', ep))));
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow, actions, is_test)
  values (pg_temp.f('org'), p, 'observation', gen_random_uuid(), 'red', null, 'live_symptom_gate', 1, 'draft', true, '[{"kind":"page_on_call"}]'::jsonb, true);
  perform pg_temp.ck('d8 a new red result blocks a resume', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.resume_lowcarb_programme(%L)', ep))));
  perform pg_temp.clear_triage(p);
  perform pg_temp.ck('d9 an untied doctor cannot resume', 'ERR:42501', pg_temp.err(pg_temp.q_as(pg_temp.f('doc2'), format('select public.resume_lowcarb_programme(%L)', ep))));
  perform pg_temp.ck('d9b after a low sugar pause a resume needs a medicine review since the pause', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.resume_lowcarb_programme(%L)', ep))));
  perform pg_temp.ck('d9c the doctor records the review (the words are kept)', 'ok', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.complete_lowcarb_medicine_review(%L, %L)', ep, 'Looked at the gliclazide dose today'))));
  perform pg_temp.ck('d9d ...on the programme history', 'Looked at the gliclazide dose today', (select note from public.lowcarb_programme_events where enrolment_id = ep and kind = 'review_completed' order by id desc limit 1));
  perform pg_temp.ck('d10 the tied doctor resumes', 'ok', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.resume_lowcarb_programme(%L)', ep))));
  perform pg_temp.ck('d11 running again with the pause cleared', 'active', pg_temp.status_of(ep));

  -- second pause: high ketones
  perform pg_temp.reading(p, 'ketones', 1.2);
  perform pg_temp.ck('d12 ordinary ketones leave it running', 'active', pg_temp.status_of(ep));
  perform pg_temp.reading(p, 'ketones', 3.4);
  perform pg_temp.ck('d13 high ketones pause it', 'paused/high_ketones', pg_temp.status_of(ep));
  perform pg_temp.clear_triage(p);
  perform pg_temp.ck('d13b a high ketone pause also needs a review first', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.resume_lowcarb_programme(%L)', ep))));
  perform pg_temp.q_as(pg_temp.f('doc'), format('select public.complete_lowcarb_medicine_review(%L, %L)', ep, 'Ketones were high, medicines checked'));
  perform pg_temp.q_as(pg_temp.f('doc'), format('select public.resume_lowcarb_programme(%L)', ep));

  -- third pause: a red triage event, which is also the third pause in 30 days: it STOPS
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow, actions, is_test)
  values (pg_temp.f('org'), p, 'observation', gen_random_uuid(), 'red', null, 'live_symptom_gate', 1, 'draft', true, '[{"kind":"page_on_call"}]'::jsonb, true);
  perform pg_temp.ck('d14 the third pause in 30 days stops the programme', 'stopped/triage_event/repeated_pauses', pg_temp.status_of(ep));
  perform pg_temp.ck('d15 a stop opens a review (or joins the open one), never none', 'true',
    (exists (select 1 from public.clinical_tasks where patient_id = p and type = 'lowcarb_medicine_review' and state not in ('completed', 'cancelled')))::text);
  perform pg_temp.ck('d16 the task did not multiply', '1', (select count(*)::text from public.clinical_tasks where patient_id = p and type = 'lowcarb_medicine_review'));
  perform pg_temp.ck('d17 a stopped programme cannot be resumed', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.resume_lowcarb_programme(%L)', ep))));
  perform pg_temp.ck('d18 after a stop the patient door goes back to unavailable', '{"state": "unavailable"}', pg_temp.q_as(p, 'select public.my_lowcarb_gate()::text'));
  perform pg_temp.ck('d19 a doctor records the medicine review', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.complete_lowcarb_medicine_review(%L, %L)', ep, 'Reviewed'))));
end $$;

do $$
declare
  v_org uuid := pg_temp.f('org'); w uuid; ew uuid; x uuid; ex uuid; v_n integer;
begin
  -- the patient can always stop; sugars falling raises a review without pausing
  w := pg_temp.mkcase('{}'); perform pg_temp.setf('w', w); perform pg_temp.tie(v_org, w, pg_temp.f('doc'));
  ew := pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true)', w))::uuid; perform pg_temp.setf('ew', ew);
  perform pg_temp.q_as(w, format('select public.respond_lowcarb_offer(%L, true)', ew));
  perform pg_temp.reading(w, 'glucose', 6.0, 1); perform pg_temp.reading(w, 'glucose', 6.2, 2); perform pg_temp.reading(w, 'glucose', 5.9, 3);
  perform pg_temp.reading(w, 'glucose', 6.1, 4); perform pg_temp.reading(w, 'glucose', 6.3, 5);
  perform pg_temp.ck('d20 falling sugars do not pause it', 'active', pg_temp.status_of(ew));
  perform pg_temp.ck('d21 five readings averaging below the line raise a medicine review', 'true',
    (exists (select 1 from public.lowcarb_programme_events where enrolment_id = ew and kind = 'review_raised' and code = 'average_glucose_low'))::text);
  perform pg_temp.ck('d22 ...as one task', '1', (select count(*)::text from public.clinical_tasks where patient_id = w and type = 'lowcarb_medicine_review'));
  perform pg_temp.reading(w, 'glucose', 4.1);
  perform pg_temp.ck('d23 a reading of 4.1 (below the review line, above the pause line) does not pause', 'active', pg_temp.status_of(ew));
  perform pg_temp.ck('d24 a doctor records the medicine review', 'ok', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format('select public.complete_lowcarb_medicine_review(%L, %L)', ew, 'Reviewed medicines, no change today'))));
  perform pg_temp.ck('d25 an untied doctor cannot', 'ERR:42501', pg_temp.err(pg_temp.q_as(pg_temp.f('doc2'), format('select public.complete_lowcarb_medicine_review(%L, %L)', ew, 'Reviewed medicines, no change today'))));
  perform pg_temp.ck('d26 another patient cannot stop it', 'ERR:42501', pg_temp.err(pg_temp.q_as(pg_temp.f('q'), format('select public.stop_lowcarb_programme(%L)', ew))));
  perform pg_temp.q_as(w, format('select public.stop_lowcarb_programme(%L)', ew));
  perform pg_temp.ck('d27 the patient can always stop', 'stopped/patient_choice', pg_temp.status_of(ew));
end $$;


do $$
declare
  v_org uuid := pg_temp.f('org'); y uuid; ey uuid; z uuid; ez uuid;
begin
  -- the sweep: pregnancy appearing after enrolment pauses it; lapsed check-ins stop it
  y := pg_temp.mkcase('{}'); perform pg_temp.setf('y', y); perform pg_temp.tie(v_org, y, pg_temp.f('doc'));
  ey := pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true)', y))::uuid; perform pg_temp.setf('ey', ey);
  perform pg_temp.q_as(y, format('select public.respond_lowcarb_offer(%L, true)', ey));
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, y, true);
  perform private.lowcarb_sweep();
  perform pg_temp.ck('d28 the sweep pauses someone who has become pregnant', 'paused/no_longer_eligible', pg_temp.status_of(ey));

  z := pg_temp.mkcase('{}'); perform pg_temp.setf('z', z); perform pg_temp.tie(v_org, z, pg_temp.f('doc'));
  ez := pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true)', z))::uuid; perform pg_temp.setf('ez', ez);
  perform pg_temp.q_as(z, format('select public.respond_lowcarb_offer(%L, true)', ez));
  perform private.lowcarb_sweep();
  perform pg_temp.ck('d29 the sweep leaves a new enrolment alone', 'active', pg_temp.status_of(ez));
  update public.lowcarb_enrolments set accepted_at = now() - interval '20 days' where id = ez;
  perform private.lowcarb_sweep();
  perform pg_temp.ck('d30 ...and stops one with no check-ins for 14 days', 'stopped/check_ins_lapsed', pg_temp.status_of(ez));

  -- an excluded condition entered after enrolment pauses it at the next sweep
  declare k uuid; ek uuid;
  begin
    k := pg_temp.mkcase('{}'); perform pg_temp.tie(v_org, k, pg_temp.f('doc'));
    ek := pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true)', k))::uuid;
    perform pg_temp.q_as(k, format('select public.respond_lowcarb_offer(%L, true)', ek));
    insert into public.patient_conditions (organisation_id, patient_id, condition_name, status) values (v_org, k, 'Chronic kidney disease stage 3', 'active');
    perform private.lowcarb_sweep();
    perform pg_temp.ck('d31 the sweep pauses someone with a newly recorded excluded condition', 'paused/no_longer_eligible', pg_temp.status_of(ek));
  end;
end $$;

-- e. medicines (INV-02) ------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); m uuid; v_proto uuid; v_real uuid := pg_temp.f('real'); v_pat uuid := pg_temp.f('p'); v_prop text; v_before integer;
begin
  select id into v_proto from public.protocols where code = 't2d_lowcarb_deprescribing' and version = 1;
  perform pg_temp.ck('e1 the step table exists as a draft', 'draft', (select status from public.protocols where id = v_proto));
  perform pg_temp.ck('e2 nobody can approve the placeholder table', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('cmo'), format('select public.approve_protocol(%L)', v_proto))));
  perform pg_temp.ck('e3 the table is not approved, so the go-live condition is unmet', 'false', (select (c ->> 'met') from jsonb_array_elements(private.go_live_conditions('low_carb_t2d_programme', null)) c where c ->> 'code' = 'step_table_signed'));
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source) values (v_org, v_pat, 'Gliclazide', '80mg', 'daily', true, 'clinician') returning id into m;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source) values (v_org, v_real, 'Gliclazide', '80mg', 'daily', true, 'clinician');
  select count(*) into v_before from public.medications where patient_id = v_pat and is_active;
  v_prop := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.propose_care_plan_change(%L, 'medication', %L::jsonb, 'Sugars have fallen on the programme, proposing a stop for the doctor to decide', null, 'engine', %L, '{"now":"x"}'::jsonb)$q$,
    v_pat, jsonb_build_object('action', 'stop', 'medication_id', m)::text, v_proto));
  perform pg_temp.ck('e4 a draft table can drive a proposal for a TEST patient', 'true', (v_prop !~ '^ERR')::text);
  perform pg_temp.ck('e5 the proposal is an unsigned draft row', 'proposed|true', (select state || '|' || (signed_by is null)::text from public.care_plan_changes where id = v_prop::uuid));
  perform pg_temp.ck('e6 proposing changed no medicine', v_before::text, (select count(*)::text from public.medications where patient_id = v_pat and is_active));
  perform pg_temp.ck('e7 the medicine is still active and unstopped', 'true', (select (is_active and stopped_at is null)::text from public.medications where id = m));
  perform pg_temp.ck('e8 a draft table cannot drive a proposal for a REAL patient', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'), format($q$select public.propose_care_plan_change(%L, 'medication', %L::jsonb, 'Sugars have fallen on the programme, proposing a stop for the doctor to decide', null, 'engine', %L, '{"now":"x"}'::jsonb)$q$,
    v_real, jsonb_build_object('action', 'stop', 'medication_id', (select id from public.medications where patient_id = v_real limit 1))::text, v_proto))));
  perform pg_temp.ck('e9 the patient cannot read the draft proposal at all', 'ERR:42501', pg_temp.err(pg_temp.q_as(v_pat, 'select count(*)::text from public.care_plan_changes')));
end $$;

-- f. go-live -----------------------------------------------------------------------------------------------------------------------
do $$
declare v_conds jsonb;
begin
  perform pg_temp.ck('f1 the guard is born off', 'false', (select is_on::text from public.go_live_guards where key = 'low_carb_t2d_programme'));
  perform pg_temp.ck('f2 the guard names the CMO as the switch holder', 'cmo', (select switch_role from public.go_live_guards where key = 'low_carb_t2d_programme'));
  v_conds := private.go_live_conditions('low_carb_t2d_programme', null);
  perform pg_temp.ck('f3 six conditions: config signed (met here), step table, rota, ketone cost, sweep scheduled (all unmet), CMO switch', 'true|false|false|false|false|true',
    (select string_agg(c ->> 'met', '|' order by o) from jsonb_array_elements(v_conds) with ordinality t(c, o)));
  perform pg_temp.ck('f4 an admin can record the rota attestation', 'ok', pg_temp.err(pg_temp.q_as(pg_temp.f('admin'),
    $q$select public.attest_go_live_condition('low_carb_t2d_programme', 'doctor_dietitian_rota_recorded', true, 'Proof: rota recorded by the test, rolled back')::text$q$)));
  perform pg_temp.ck('f5 ...and the condition then reads as met', 'true', (select c ->> 'met' from jsonb_array_elements(private.go_live_conditions('low_carb_t2d_programme', null)) c where c ->> 'code' = 'doctor_dietitian_rota_recorded'));
  perform pg_temp.ck('f6 the ketone cost decision is attestable too', 'ok', pg_temp.err(pg_temp.q_as(pg_temp.f('admin'),
    $q$select public.attest_go_live_condition('low_carb_t2d_programme', 'ketone_testing_cost_decided', true, 'Proof: decision recorded by the test, rolled back')::text$q$)));
  perform pg_temp.ck('f6b the sweep being scheduled is attestable too', 'ok', pg_temp.err(pg_temp.q_as(pg_temp.f('admin'),
    $q$select public.attest_go_live_condition('low_carb_t2d_programme', 'check_in_sweep_scheduled', true, 'Proof: scheduled by the test, rolled back')::text$q$)));
  perform pg_temp.ck('f7 a condition read from the data cannot be attested', 'ERR:22023', pg_temp.err(pg_temp.q_as(pg_temp.f('admin'),
    $q$select public.attest_go_live_condition('low_carb_t2d_programme', 'step_table_signed', true, 'Proof: trying to attest a data condition')::text$q$)));
  perform pg_temp.ck('f8 the proof switched nothing on', 'false', (select is_on::text from public.go_live_guards where key = 'low_carb_t2d_programme'));
end $$;

-- g. privacy and structure ---------------------------------------------------------------------------------------------------------
do $$
declare v_err text;
begin
  perform pg_temp.ck('g1 a patient reads no enrolment row', '0', pg_temp.q_as(pg_temp.f('p'), 'select count(*)::text from public.lowcarb_enrolments'));
  perform pg_temp.ck('g2 a patient reads no event row', '0', pg_temp.q_as(pg_temp.f('p'), 'select count(*)::text from public.lowcarb_programme_events'));
  perform pg_temp.ck('g3 a care coordinator reads no enrolment row', '0', pg_temp.q_as(pg_temp.f('coord'), 'select count(*)::text from public.lowcarb_enrolments'));
  perform pg_temp.ck('g4 the tied doctor reads the enrolment', '1', pg_temp.q_as(pg_temp.f('doc'), format('select count(*)::text from public.lowcarb_enrolments where patient_id = %L', pg_temp.f('p'))));
  perform pg_temp.ck('g5 an untied doctor reads none of it', '0', pg_temp.q_as(pg_temp.f('doc2'), format('select count(*)::text from public.lowcarb_enrolments where patient_id = %L', pg_temp.f('p'))));
  perform pg_temp.ck('g6 the console read is refused to an untied doctor', 'ERR:42501', pg_temp.err(pg_temp.q_as(pg_temp.f('doc2'), format('select public.lowcarb_programme_for_patient(%L)::text', pg_temp.f('p')))));
  perform pg_temp.ck('g7 ...and to the patient', 'ERR:42501', pg_temp.err(pg_temp.q_as(pg_temp.f('p'), format('select public.lowcarb_programme_for_patient(%L)::text', pg_temp.f('p')))));
  perform pg_temp.ck('g8 the tied doctor gets the record', 'true',
    pg_temp.q_as(pg_temp.f('doc'), format('select ((public.lowcarb_programme_for_patient(%L) -> ''enrolment'' ->> ''status'') is not null)::text', pg_temp.f('p'))));
  perform pg_temp.ck('g8b ...and the read is audited', 'true', (exists (select 1 from public.audit_log where action = 'lowcarb.programme_viewed' and actor_id = pg_temp.f('doc')))::text);
  -- switching the guard off hides an unanswered OFFER, never the card or the Stop button of someone already on the programme (real patients: the guard is off)
  insert into public.lowcarb_enrolments (organisation_id, patient_id, status, no_recent_admission, config_version, accepted_at)
  values (pg_temp.f('org'), pg_temp.f('real'), 'active', true, 1, now());
  perform pg_temp.ck('g8c a real patient already on the programme still gets the card with the guard off', 'ok|active',
    (select (g ->> 'state') || '|' || (g ->> 'status') from (select pg_temp.q_as(pg_temp.f('real'), 'select public.my_lowcarb_gate()::text')::jsonb g) x));
  perform pg_temp.ck('g9 anon has no table or function grants', 'false|false|false', (has_table_privilege('anon', 'public.lowcarb_enrolments', 'SELECT')::text) || '|' ||
    (has_table_privilege('anon', 'public.lowcarb_programme_events', 'SELECT')::text) || '|' || (has_function_privilege('anon', 'public.offer_lowcarb_programme(uuid,boolean,boolean,text)', 'EXECUTE')::text));
  perform pg_temp.ck('g10 a signed-in client cannot write the tables directly', 'ERR:42501', pg_temp.err(pg_temp.q_as(pg_temp.f('doc'),
    format('insert into public.lowcarb_enrolments (organisation_id, patient_id, no_recent_admission, config_version) values (%L, %L, true, 1)', pg_temp.f('org'), pg_temp.f('q')))));
  begin update public.lowcarb_enrolments set status = 'active' where id = pg_temp.f('ep'); v_err := 'accepted'; exception when others then v_err := 'refused'; end;
  perform pg_temp.ck('g11 a stopped enrolment cannot be reopened, even by the owner', 'refused', v_err);
  begin update public.lowcarb_programme_events set code = 'x' where enrolment_id = pg_temp.f('ep'); v_err := 'accepted'; exception when others then v_err := 'refused'; end;
  perform pg_temp.ck('g12 history is append-only', 'refused', v_err);
  begin delete from public.lowcarb_enrolments where id = pg_temp.f('ep'); v_err := 'accepted'; exception when others then v_err := 'refused'; end;
  perform pg_temp.ck('g13 an enrolment is never deleted', 'refused', v_err);
  begin update public.lowcarb_enrolments set patient_id = pg_temp.f('q') where id = pg_temp.f('ez'); v_err := 'accepted'; exception when others then v_err := 'refused'; end;
  perform pg_temp.ck('g14 an enrolment cannot be moved to another patient', 'refused', v_err);
  perform pg_temp.ck('g15 both tables are registered for tied staff reads and in the data registry', '2|2',
    (select count(*)::text from public.staff_read_scope where table_name in ('lowcarb_enrolments', 'lowcarb_programme_events') and mode = 'tied') || '|' ||
    (select count(*)::text from public.data_registry where table_name in ('lowcarb_enrolments', 'lowcarb_programme_events')));
  perform pg_temp.ck('g16 notices name no reading, condition or medicine', '0',
    (select count(*)::text from public.notification_template_locales where template_key = 'lowcarb_programme_update' and body ~* '(diabet|glucose|sugar|ketone|insulin|mmol|pregnan|medicine)'));
  perform pg_temp.ck('g17 the review task type exists, creatable, not waiting on confirmation', 'true', (select (creatable and is_active and not needs_confirmation)::text from public.task_types where code = 'lowcarb_medicine_review'));
end $$;

-- h. SABOTAGE: break each safeguard once; the matching checks must flip -----------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); s uuid; es uuid; v uuid;
begin
  -- (1) the reading trigger removed: a low glucose no longer pauses an active enrolment
  s := pg_temp.mkcase('{}'); perform pg_temp.tie(v_org, s, pg_temp.f('doc'));
  es := pg_temp.q_as(pg_temp.f('doc'), format('select public.offer_lowcarb_programme(%L, true)', s))::uuid;
  perform pg_temp.q_as(s, format('select public.respond_lowcarb_offer(%L, true)', es));
  drop trigger lowcarb_programme_reading on public.vitals_readings;
  perform pg_temp.reading(s, 'glucose', 3.2);
  insert into results values ('sabotaged', 'SABOTAGE: without the reading trigger a low glucose pauses the programme', 'paused', split_part(pg_temp.status_of(es), '/', 1));
end $$;

do $$
declare v uuid;
begin
  -- (2) an eligibility function that always says eligible: a pregnant patient passes
  v := pg_temp.mkcase('{"preg":"yes"}');
  create or replace function private.lowcarb_eligibility_for(p_patient uuid, p_supervision_accepted boolean default false, p_no_admission boolean default false, p_now timestamptz default now())
  returns jsonb language sql stable as $g$ select '{"decision":"eligible","reasons":["none"],"supervision_for":[]}'::jsonb $g$;
  insert into results values ('sabotaged', 'SABOTAGE: an always-eligible function lets a pregnant patient through', 'not_eligible', private.lowcarb_eligibility_for(v) ->> 'decision');
end $$;

do $$
declare v_err text;
begin
  -- (3) the transition guard removed: a stopped enrolment can be reopened
  drop trigger lowcarb_enrolments_guard on public.lowcarb_enrolments;
  begin update public.lowcarb_enrolments set status = 'active' where id = pg_temp.f('ep'); v_err := 'accepted'; exception when others then v_err := 'refused'; end;
  insert into results values ('sabotaged', 'SABOTAGE: without the guard a stopped enrolment can be reopened', 'refused', v_err);
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
