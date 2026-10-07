-- S45 proof: risk assessments, screening calendar, packages (migrations *_s45a_* and *_s45_risk_screening_packages.sql). One rolled-back transaction.
-- Proves:
--   1. The WHO 2019 instrument starts unsigned with no coefficients, cannot be signed without them, and only the CMO could sign it.
--   2. risk_assessments: every row names its instrument version (INV-16); a scored row is refused for a real person while the guard is off (INV-14);
--      the database resolves band limits and tier from the version config; non-lab at or above 10 percent flags further assessment;
--      a refusal is stored with its reason and no band; rows are append only; only the service role writes; a patient reads only their own;
--      staff read only through the audited, tie-checked function (INV-10, INV-12); the event carries ids only (INV-07).
--   3. Reassessment reasons: yearly, new chronic condition, high BP.
--   4. Calendar: a 45-year-old woman is scheduled for cervical screening by the configured rule (a 24-year-old is not); the scheduler does nothing with the
--      guard off or no signed rules; not_applicable and declined carry stored reasons, are never re-created, and can be reopened by the patient only.
--   5. Packages: price and rate card before checkout, HPV DNA hidden behind its guard, ineligible reasons.
--   6. Home collection: a bundle holding HIV, hepatitis or STI tests is refused for home collection until the guard is on; a test pair passes.
--   7. INV-04: a sensitive positive on an order from a package never auto-releases and the patient cannot read it.
--   8. SABOTAGE: the decline trigger, the scoring guard, the rule config and the home-kit trigger each undone; the matching checks must flip.
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
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.sqlstate_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_sex text default 'female', p_age integer default 45) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's45-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'S45 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => p_age, days => 30))::date, p_sex::public.sex, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone,
     date_of_birth = excluded.date_of_birth, sex = excluded.sex;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician', 'male', 40);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S45 ' || p_label, 'MDCN', 'S45-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (p_org, s, 'result_review', p_admin, true);
  return v;
end $f$;
create function pg_temp.go_real(p_uid uuid) returns void language sql as $$ update public.profiles set is_test = false where id = p_uid $$;
create function pg_temp.cervical_rows(p_pat uuid) returns integer language sql as
$$ select count(*)::integer from public.screening_schedules ss join public.screen_types st on st.id = ss.screen_type_id
    where ss.patient_id = p_pat and st.code = 'cervical_smear' $$;
create function pg_temp.items(p_creatinine numeric, p_extra text default '') returns text language sql as
$$ select '[{"analyte_code":"fasting_glucose","value_numeric":88},{"analyte_code":"hba1c","value_numeric":5.2},{"analyte_code":"creatinine","value_numeric":'
  || p_creatinine || '},{"analyte_code":"potassium","value_numeric":4.1},{"analyte_code":"sodium","value_numeric":140},{"analyte_code":"total_cholesterol","value_numeric":170},{"analyte_code":"ldl_cholesterol","value_numeric":100},{"analyte_code":"hdl_cholesterol","value_numeric":55},{"analyte_code":"triglycerides","value_numeric":110},{"analyte_code":"alt","value_numeric":24}'
  || p_extra || ']' $$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_lab uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', 'male', 40);
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'medical_officer', v_admin));
  perform pg_temp.setf('stranger', pg_temp.mkdoc(v_org, 'stranger', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('fpat', pg_temp.mkuser(v_org, 'fpat', 'patient', 'female', 45));
  perform pg_temp.setf('young', pg_temp.mkuser(v_org, 'young', 'patient', 'female', 24));
  perform pg_temp.setf('mpat', pg_temp.mkuser(v_org, 'mpat', 'patient', 'male', 45));
  perform pg_temp.setf('real', pg_temp.mkuser(v_org, 'real', 'patient', 'female', 45));
  perform pg_temp.go_real(pg_temp.f('real'));
  perform pg_temp.setf('real2', pg_temp.mkuser(v_org, 'real2', 'patient', 'female', 45));
  perform pg_temp.go_real(pg_temp.f('real2'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id)
  values (v_org, pg_temp.f('fpat'), pg_temp.f('doc'), pg_temp.f('doc'));
  insert into public.lab_providers (name, is_active) values ('S45 Lab', false) returning id into v_lab;
  perform pg_temp.setf('lab', pg_temp.mkuser(v_org, 'lab', 'lab_partner', 'male', 40));
  update public.profiles set lab_provider_id = v_lab where id = pg_temp.f('lab');
  perform pg_temp.setf('lab_provider', v_lab);
end $$;

-- 1. The instrument -------------------------------------------------------------------------------------------------------------
do $$
declare v_ver uuid;
begin
  select id into v_ver from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 1;
  perform pg_temp.setf('ver', v_ver);
  perform pg_temp.ck('the instrument starts unsigned', 'false', private.risk_instrument_signed('who_cvd_2019_wssa')::text);
  perform pg_temp.ck('...with no coefficients loaded', 'true',
    (select (config #> '{models,lab,male}') = 'null'::jsonb and (config #> '{models,non_lab,female}') = 'null'::jsonb from public.risk_instrument_versions where id = v_ver)::text);
  perform pg_temp.ck('the CMO cannot sign a version with no coefficients', 'true',
    (pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_risk_instrument(%L)::text', v_ver)) like 'ERR:coefficients_not_verified%')::text);
  perform pg_temp.ck('an ordinary doctor cannot sign', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format('select public.sign_risk_instrument(%L)::text', v_ver)) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('a patient cannot sign', 'true',
    (pg_temp.q_as(pg_temp.f('fpat'), format('select public.sign_risk_instrument(%L)::text', v_ver)) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('anon cannot sign', '42501', pg_temp.try_anon(format('select public.sign_risk_instrument(%L)', v_ver)));
  perform pg_temp.ck('instrument_version_id is NOT NULL on risk_assessments (INV-16)', 'NO',
    (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'risk_assessments' and column_name = 'instrument_version_id'));
  perform pg_temp.ck('the four new guards are all off', '0',
    (select count(*)::text from public.go_live_guards where key in ('risk_instrument_who2019_enabled', 'screening_scheduler_enabled', 'hpv_dna_enabled', 'home_kit_sensitive_enabled') and is_on));
end $$;

-- 2. Recording assessments -------------------------------------------------------------------------------------------------------
do $$
declare v_ver uuid := pg_temp.f('ver'); v_real uuid := pg_temp.f('real'); v_f uuid := pg_temp.f('fpat'); r text; v_id uuid;
begin
  perform pg_temp.ck('a patient cannot write an assessment (service role only)', 'true',
    (pg_temp.q_as(v_real, format('select public.record_risk_assessment(%L, %L, ''not_scored_instrument_off'', null, ''{}''::jsonb, null, ''manual'', ''{}'', null)::text', v_real, v_ver)) like 'ERR:permission denied%')::text);
  perform pg_temp.ck('a clinician cannot write an assessment either', 'true',
    (pg_temp.q_as(pg_temp.f('cmo'), format('select public.record_risk_assessment(%L, %L, ''not_scored_instrument_off'', null, ''{}''::jsonb, null, ''manual'', ''{}'', null)::text', v_real, v_ver)) like 'ERR:permission denied%')::text);
  perform pg_temp.ck('anon cannot', '42501', pg_temp.try_anon(format('select public.record_risk_assessment(%L, %L, ''not_scored_instrument_off'', null, ''{}''::jsonb, null, ''manual'', ''{}'', null)', v_real, v_ver)));

  r := pg_temp.as_service(format('select public.record_risk_assessment(%L, %L, ''scored'', ''lab'', ''{}''::jsonb, ''lt5'', ''initial'', ''{}'', null)::text', v_real, v_ver));
  perform pg_temp.ck('INV-14: a scored band is refused for a real person while the guard is off', 'true', (r like 'ERR:not_live%')::text);
  perform pg_temp.ck('...and nothing was written', '0', (select count(*)::text from public.risk_assessments where patient_id = v_real));

  r := pg_temp.as_service(format('select public.record_risk_assessment(%L, %L, ''not_scored_instrument_off'', null, ''{"age":45}''::jsonb, null, ''initial'', ''{}'', null)::text', v_real, v_ver));
  perform pg_temp.ck('a refusal is stored with its reason', '1', (select count(*)::text from public.risk_assessments where patient_id = v_real and status = 'not_scored_instrument_off' and instrument_version_id = v_ver and band_code is null and tier is null));

  r := pg_temp.as_service(format('select public.record_risk_assessment(%L, %L, ''scored'', ''lab'', ''{"age":45}''::jsonb, ''10to20'', ''initial'', ''{}'', null)::text', v_f, v_ver));
  v_id := r::uuid;
  perform pg_temp.setf('ra_lab', v_id);
  perform pg_temp.ck('a test patient can be scored (test pair rule); limits and tier come from the config', '10|20|moderate|lab|false',
    (select band_low_pct || '|' || band_high_pct || '|' || tier || '|' || model || '|' || further_assessment from public.risk_assessments where id = v_id));
  r := pg_temp.as_service(format('select public.record_risk_assessment(%L, %L, ''scored'', ''non_lab'', ''{}''::jsonb, ''10to20'', ''manual'', ''{}'', null)::text', v_f, v_ver));
  perform pg_temp.ck('non-lab at 10 percent or above flags further assessment', 'true', (select further_assessment::text from public.risk_assessments where id = r::uuid));
  r := pg_temp.as_service(format('select public.record_risk_assessment(%L, %L, ''scored'', ''non_lab'', ''{}''::jsonb, ''lt5'', ''manual'', ''{}'', null)::text', v_f, v_ver));
  perform pg_temp.ck('non-lab below 10 percent does not', 'false', (select further_assessment::text from public.risk_assessments where id = r::uuid));
  r := pg_temp.as_service(format('select public.record_risk_assessment(%L, %L, ''scored'', ''lab'', ''{}''::jsonb, ''ge30'', ''manual'', ''{}'', null)::text', v_f, v_ver));
  perform pg_temp.ck('the open top band has no upper limit', 'null', (select coalesce(band_high_pct::text, 'null') from public.risk_assessments where id = r::uuid));
  r := pg_temp.as_service(format('select public.record_risk_assessment(%L, %L, ''scored'', ''lab'', ''{}''::jsonb, ''made_up'', ''manual'', ''{}'', null)::text', v_f, v_ver));
  perform pg_temp.ck('an unknown band is refused', 'true', (r like 'ERR:unknown_band%')::text);
  perform pg_temp.ck('a refusal row cannot carry a band (check constraint)', '23514',
    pg_temp.try_sql(format('insert into public.risk_assessments (organisation_id, patient_id, instrument_code, instrument_version_id, status, band_code, tier, model) values (%L, %L, ''x'', %L, ''not_scored_known_diabetes'', ''lt5'', ''low'', ''lab'')', pg_temp.f('org'), v_f, v_ver)));
  perform pg_temp.ck('rows are append only: update refused', '55000', pg_temp.try_sql(format('update public.risk_assessments set tier = ''low'' where id = %L', v_id)));
  perform pg_temp.ck('rows are append only: delete refused', '55000', pg_temp.try_sql(format('delete from public.risk_assessments where id = %L', v_id)));
  perform pg_temp.ck('the event carries ids only (INV-07)', 'risk_assessment_id',
    (select string_agg(k, ',') from (select jsonb_object_keys(payload) k from public.domain_events where event_type = 'risk.assessed' and (payload ->> 'risk_assessment_id')::uuid = v_id) x));
  perform pg_temp.ck('every row written has an event', 'true',
    ((select count(*) from public.risk_assessments where patient_id in (v_real, v_f)) = (select count(*) from public.domain_events where event_type = 'risk.assessed' and patient_id in (v_real, v_f)))::text);
end $$;

-- RLS and audited reads
do $$
declare v_f uuid := pg_temp.f('fpat'); v_id uuid := pg_temp.f('ra_lab');
begin
  perform pg_temp.ck('a patient reads their own assessments', '4',
    pg_temp.q_as(v_f, 'select count(*)::text from public.risk_assessments'));
  perform pg_temp.ck('another patient reads none of them', '1', pg_temp.q_as(pg_temp.f('real'), 'select count(*)::text from public.risk_assessments'));
  perform pg_temp.ck('anon is refused the table', '42501', pg_temp.try_anon('select 1 from public.risk_assessments'));
  perform pg_temp.ck('a clinician cannot read the table directly (no staff policy)', '0', pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.risk_assessments'));
  perform pg_temp.ck('a clinician with no tie is refused the audited read', 'true',
    (pg_temp.q_as(pg_temp.f('stranger'), format('select count(*)::text from public.clinician_read_risk_assessments(%L)', v_f)) like 'ERR:not_authorised%')::text);
  perform pg_temp.ck('a clinician with a tie reads them', '4',
    pg_temp.q_as(pg_temp.f('doc'), format('select count(*)::text from public.clinician_read_risk_assessments(%L)', v_f)));
  perform pg_temp.ck('...and the read is in the audit log', '1',
    (select count(*)::text from public.audit_log where action = 'risk_assessments.read' and entity_id = v_f));
  perform pg_temp.ck('anon cannot call the audited read', '42501', pg_temp.try_anon(format('select * from public.clinician_read_risk_assessments(%L)', v_f)));
end $$;

-- 3. Reassessment reasons ---------------------------------------------------------------------------------------------------------
do $$
declare v_f uuid := pg_temp.f('fpat'); v_real uuid := pg_temp.f('real'); v_org uuid := pg_temp.f('org');
begin
  perform pg_temp.ck('no reason straight after an assessment', '0', cardinality(private.risk_reassessment_reasons(v_f))::text);
  perform pg_temp.ck('a patient with no assessment has no reasons (nothing to reassess)', '0', cardinality(private.risk_reassessment_reasons(pg_temp.f('mpat')))::text);
  insert into public.care_plans (organisation_id, patient_id, condition, status, created_at) values (v_org, v_f, 'hypertension', 'active', now() + interval '1 minute');
  perform pg_temp.ck('a new chronic condition is a reason', 'true', ('new_chronic_condition' = any (private.risk_reassessment_reasons(v_f)))::text);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_f, 'blood_pressure', 165, 95, now() + interval '1 minute', 'manual');
  perform pg_temp.ck('a reading at or above 160/100 is a reason', 'true', ('bp_at_or_above_160_100' = any (private.risk_reassessment_reasons(v_f)))::text);
  alter table public.risk_assessments disable trigger risk_assessments_no_change;
  update public.risk_assessments set assessed_at = now() - interval '400 days' where patient_id = v_real;
  alter table public.risk_assessments enable trigger risk_assessments_no_change;
  perform pg_temp.ck('older than a year is a reason', 'true', ('yearly' = any (private.risk_reassessment_reasons(v_real)))::text);
  perform pg_temp.ck('a patient can ask for their own reasons', 'yearly', pg_temp.q_as(v_real, 'select (public.my_risk_reassessment_due())[1]'));
end $$;

-- 4. Calendar -----------------------------------------------------------------------------------------------------------------------
do $$
declare v_f uuid := pg_temp.f('fpat'); v_y uuid := pg_temp.f('young'); v_m uuid := pg_temp.f('mpat'); v_real uuid := pg_temp.f('real'); r jsonb;
begin
  perform pg_temp.ck('screening rule v1 starts unsigned', 'false', private.screening_rules_signed()::text);
  perform pg_temp.ck('v1 mirrors the catalogue: cervical 25 to 65 every 36 months', '25|65|36',
    (select (x ->> 'ageFrom') || '|' || (x ->> 'ageTo') || '|' || (x ->> 'frequencyMonths')
       from public.screening_rule_sets s, jsonb_array_elements(s.config -> 'rules') x where s.version = 1 and x ->> 'code' = 'cervical_smear'));
  perform pg_temp.ck('antenatal booking and optional tests are never auto-scheduled', '0',
    (select count(*)::text from public.screening_rule_sets s, jsonb_array_elements(s.config -> 'rules') x
      where s.version = 1 and (x ->> 'code' = 'antenatal_booking' or (x ->> 'isOptional')::boolean) and (x ->> 'autoSchedule')::boolean));

  -- real person, guard off, no signed rules
  perform pg_temp.ck('guard off: the scheduler does nothing (all patients)', 'guard_off', private.run_screening_scheduler() ->> 'reason');
  perform pg_temp.ck('guard off: nothing for a real patient either', 'guard_off', private.run_screening_scheduler(v_real) ->> 'reason');
  perform pg_temp.ck('...and no calendar row was made', '0', pg_temp.cervical_rows(v_real)::text);

  -- the acceptance test (test pair rule lets a test patient run it against the unsigned rules)
  r := private.run_screening_scheduler(v_f);
  perform pg_temp.ck('ACCEPTANCE: a 45-year-old woman is scheduled for cervical screening by the configured rule', '1', pg_temp.cervical_rows(v_f)::text);
  perform pg_temp.ck('...the row names the rule set it used (INV-16)', 'true',
    (select (ss.rule_set_id is not null)::text from public.screening_schedules ss join public.screen_types st on st.id = ss.screen_type_id where ss.patient_id = v_f and st.code = 'cervical_smear'));
  perform pg_temp.ck('...due today, pending', 'pending|true',
    (select ss.status || '|' || (ss.due_date = current_date) from public.screening_schedules ss join public.screen_types st on st.id = ss.screen_type_id where ss.patient_id = v_f and st.code = 'cervical_smear'));
  perform pg_temp.ck('...a due event with an id only was emitted', 'screening_schedule_id',
    (select string_agg(k, ',') from (select distinct jsonb_object_keys(payload) k from public.domain_events e where e.event_type = 'screening.due' and e.patient_id = v_f) x));
  perform private.run_screening_scheduler(v_y);
  perform pg_temp.ck('a 24-year-old woman is not scheduled for cervical screening', '0', pg_temp.cervical_rows(v_y)::text);
  perform private.run_screening_scheduler(v_m);
  perform pg_temp.ck('a man is not scheduled for cervical screening', '0', pg_temp.cervical_rows(v_m)::text);
  perform pg_temp.ck('...but is scheduled for his own checks (blood pressure)', 'true',
    exists (select 1 from public.screening_schedules ss join public.screen_types st on st.id = ss.screen_type_id where ss.patient_id = v_m and st.code = 'blood_pressure')::text);
  r := private.run_screening_scheduler(v_f);
  perform pg_temp.ck('a second run creates nothing new', '0', r ->> 'created');
end $$;

-- the guard, forced on for the rest of this proof, and the signing rules
create function pg_temp.guards_on(p_keys text[]) returns void language plpgsql as
$f$ begin
  execute format($q$create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
    as $b$select p_key = any (%L::text[])$b$$q$, p_keys);
end $f$;
do $$
declare v_real uuid := pg_temp.f('real'); v_set uuid;
begin
  perform pg_temp.guards_on(array['screening_scheduler_enabled']);
  perform pg_temp.ck('guard on but rules unsigned: still nothing', 'rules_not_signed', private.run_screening_scheduler() ->> 'reason');
  select id into v_set from public.screening_rule_sets where version = 1;
  perform pg_temp.setf('rules', v_set);
  perform pg_temp.ck('a doctor cannot sign the rules', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format('select public.sign_screening_rule_set(%L)::text', v_set)) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('the CMO can', v_set::text, pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_screening_rule_set(%L)::text', v_set)));
  perform pg_temp.ck('...it is now signed and active', 'true', private.screening_rules_signed()::text);
  perform pg_temp.ck('signing is audited', '1', (select count(*)::text from public.audit_log where action = 'screening_rules.signed' and entity_id = v_set));
  perform pg_temp.ck('signed and guard on: a real patient is scheduled for cervical screening', 'true',
    ((private.run_screening_scheduler(v_real) ->> 'ran')::boolean and pg_temp.cervical_rows(v_real) = 1)::text);
end $$;

-- not_applicable and declined, with stored reasons
do $$
declare v_real uuid := pg_temp.f('real'); v_other uuid := pg_temp.f('real2'); v_sched uuid; v_bp uuid; v_ins integer;
begin
  select ss.id into v_sched from public.screening_schedules ss join public.screen_types st on st.id = ss.screen_type_id where ss.patient_id = v_real and st.code = 'cervical_smear';
  select ss.id into v_bp from public.screening_schedules ss join public.screen_types st on st.id = ss.screen_type_id where ss.patient_id = v_real and st.code = 'blood_pressure';
  perform pg_temp.setf('sched', v_sched);
  perform pg_temp.ck('no reason, no state change', 'true',
    (pg_temp.q_as(v_real, format('select public.set_screening_state(%L, ''not_applicable'', ''medical_reason'', '' '')::text', v_sched)) like 'ERR:reason_required%')::text);
  perform pg_temp.ck('only declined or not_applicable are allowed', 'true',
    (pg_temp.q_as(v_real, format('select public.set_screening_state(%L, ''completed'', ''other'', ''x'')::text', v_sched)) like 'ERR:state_must_be%')::text);
  perform pg_temp.ck('another patient cannot change my item', 'true',
    (pg_temp.q_as(v_other, format('select public.set_screening_state(%L, ''declined'', ''other'', ''x'')::text', v_sched)) like 'ERR:not_authorised%')::text);
  perform pg_temp.ck('a bare update to not_applicable with no reason breaks the check', '23514',
    pg_temp.try_sql(format('update public.screening_schedules set status = ''not_applicable'' where id = %L', v_sched)));
  perform pg_temp.ck('the patient marks it not applicable with a reason', v_sched::text,
    pg_temp.q_as(v_real, format('select public.set_screening_state(%L, ''not_applicable'', ''medical_reason'', ''Had a hysterectomy'')::text', v_sched)));
  perform pg_temp.ck('...the reason code and note are stored', 'not_applicable|medical_reason|Had a hysterectomy|true',
    (select status || '|' || closed_reason_code || '|' || not_applicable_reason || '|' || (not_applicable_at is not null) from public.screening_schedules where id = v_sched));
  perform pg_temp.ck('...a later run does not bring it back', '0', (private.run_screening_scheduler(v_real) ->> 'created') || '' );
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date)
    select organisation_id, patient_id, screen_type_id, 'pending', current_date from public.screening_schedules where id = v_sched;
  get diagnostics v_ins = row_count;
  perform pg_temp.ck('...and the decline trigger blocks a fresh pending row', '0', v_ins::text);
  perform pg_temp.ck('declined works the same way', v_bp::text, pg_temp.q_as(v_real, format('select public.set_screening_state(%L, ''declined'', ''cost'', ''Cannot afford it now'')::text', v_bp)));
  perform pg_temp.ck('...declined reason stored', 'declined|cost|Cannot afford it now',
    (select status || '|' || closed_reason_code || '|' || declined_reason from public.screening_schedules where id = v_bp));
  perform pg_temp.ck('another patient cannot reopen it', 'true', (pg_temp.q_as(v_other, format('select public.reopen_screening(%L)::text', v_sched)) like 'ERR:not_authorised%')::text);
  perform pg_temp.ck('the patient can reopen it', v_sched::text, pg_temp.q_as(v_real, format('select public.reopen_screening(%L)::text', v_sched)));
  perform pg_temp.ck('...it is pending again with the reason fields cleared', 'pending|null|null',
    (select status || '|' || coalesce(closed_reason_code, 'null') || '|' || coalesce(not_applicable_reason, 'null') from public.screening_schedules where id = v_sched));
  perform pg_temp.ck('anon cannot set a state', '42501', pg_temp.try_anon(format('select public.set_screening_state(%L, ''declined'', ''other'', ''x'')', v_sched)));
end $$;

-- 5. Packages -------------------------------------------------------------------------------------------------------------------------
do $$
declare v_f uuid := pg_temp.f('fpat'); v_real uuid := pg_temp.f('real'); v_m uuid := pg_temp.f('mpat');
begin
  perform pg_temp.ck('the essential package shows a price, its tests and a rate card before checkout', 'true',
    (pg_temp.q_as(v_real, $q$select (price_kobo > 0 and cardinality(test_codes) > 0 and jsonb_array_length(rate_card) = cardinality(test_codes))::text from public.list_screening_packages() where code = 'essential'$q$)));
  perform pg_temp.ck('...and says it holds sensitive tests (HIV), so release rules apply', 'true',
    pg_temp.q_as(v_real, $q$select includes_sensitive::text from public.list_screening_packages() where code = 'essential'$q$));
  perform pg_temp.ck('HPV DNA is not available to a real patient while its guard is off', 'false|not_available_yet',
    pg_temp.q_as(v_real, $q$select eligible || '|' || ineligible_reason from public.list_screening_packages() where code = 'hpv_dna'$q$));
  perform pg_temp.ck('HPV DNA needs a positive-result pathway and a guard, both recorded', 'true|hpv_dna_enabled',
    (select requires_positive_pathway || '|' || guard_key from public.screening_packages where code = 'hpv_dna'));
  perform pg_temp.ck('no bundled video consult exists on any package', '0',
    (select count(*)::text from public.screening_packages p join public.panel_bundles b on b.id = p.panel_bundle_id where b.test_codes && array['video_consult'] or p.extra_test_codes && array['video_consult']));
  perform pg_temp.ck('an essential package is open to an adult', 'true',
    pg_temp.q_as(v_m, $q$select eligible::text from public.list_screening_packages() where code = 'essential'$q$));
  perform pg_temp.ck('anon cannot list packages', '42501', pg_temp.try_anon('select * from public.list_screening_packages()'));
  perform pg_temp.ck('package names are provisional until confirmed', '0', (select count(*)::text from public.screening_packages where name_status <> 'provisional'));
end $$;

-- 6. Home collection and 7. INV-04 ---------------------------------------------------------------------------------------------------------
create function pg_temp.mkorder(p_pat uuid, p_bundle_code text, p_home boolean, p_excl text default '[]') returns uuid language plpgsql as
$f$ declare v uuid; v_doc uuid;
begin
  select id into v_doc from public.clinical_staff where profile_id = pg_temp.f('doc');
  insert into public.lab_orders (organisation_id, patient_id, provider_id, fulfilment, status, origin, ordered_by, clinical_indication, payment_confirmed_at,
      panel_bundle_id, excluded_test_codes, home_visit_scheduled_at)
  values (pg_temp.f('org'), p_pat, pg_temp.f('lab_provider'), 'partner', 'pending_payment', 'clinically_triggered', v_doc, 'S45 proof order', now() - interval '1 hour',
      (select id from public.panel_bundles where code = p_bundle_code), p_excl::jsonb, case when p_home then now() + interval '2 days' end)
  returning id into v;
  return v;
end $f$;
do $$
declare v_real uuid := pg_temp.f('real'); v_test uuid := pg_temp.f('mpat'); o uuid; r text; rid uuid;
begin
  -- every live bundle is guidance_only today (never billed, so no order can be placed); open them inside this rolled-back proof only
  update public.panel_bundles set guidance_only = false where code in ('screen_essential', 'single_hba1c', 'blood_borne_virus_screen');
  perform pg_temp.ck('a partner-site order with HIV in the bundle is unaffected', 'ok',
    pg_temp.try_sql(format('select pg_temp.mkorder(%L, ''screen_essential'', false)', v_real)));
  perform pg_temp.ck('home collection of a bundle holding HIV is refused', 'P0001',
    pg_temp.try_sql(format('select pg_temp.mkorder(%L, ''screen_essential'', true)', v_real)));
  perform pg_temp.ck('home collection of a bundle with no sensitive test is allowed', 'ok',
    pg_temp.try_sql(format('select pg_temp.mkorder(%L, ''single_hba1c'', true)', v_real)));
  perform pg_temp.ck('a test patient can exercise the flow (test pair rule)', 'ok',
    pg_temp.try_sql(format('select pg_temp.mkorder(%L, ''screen_essential'', true)', v_test)));
  perform pg_temp.ck('blood-borne virus screen at home is refused too', 'P0001',
    pg_temp.try_sql(format('select pg_temp.mkorder(%L, ''blood_borne_virus_screen'', true)', v_real)));

  -- INV-04: an order from a package, a reactive hepatitis B surface antigen, the S27 release rule
  o := pg_temp.mkorder(v_real, 'screen_essential', false);
  update public.lab_orders set status = 'payment_confirmed' where id = o;
  update public.lab_orders set status = 'sample_collected' where id = o;
  r := pg_temp.q_as(pg_temp.f('lab'), format($q$select public.lab_partner_submit_result(%L, 'annual_health_check', %L::jsonb)::text$q$, o,
        pg_temp.items(0.9, ',{"analyte_code":"ast","value_numeric":20},{"analyte_code":"haemoglobin","value_numeric":14},{"analyte_code":"wbc","value_numeric":6},{"analyte_code":"platelets","value_numeric":250},{"analyte_code":"tsh","value_numeric":2},{"analyte_code":"hbsag","value_text":"positive"}')));
  perform pg_temp.ck('ACCEPTANCE INV-04: the submit worked', 'false', (r like 'ERR:%')::text);
  rid := (r::jsonb ->> 'lab_result_id')::uuid;
  perform pg_temp.ck('ACCEPTANCE INV-04: a sensitive positive from a package order is never auto-released', 'clinician_disclosure_required',
    (select release_state from public.lab_results where id = rid));
  perform pg_temp.ck('...and the patient cannot read it', '0', pg_temp.q_as(v_real, format('select count(*)::text from public.lab_results where id = %L', rid)));
end $$;

-- 8. Sabotage ------------------------------------------------------------------------------------------------------------------------------
-- A: the decline trigger back to declined only. A pending insert for a not-applicable item must then slip through.
do $$
declare v_real uuid := pg_temp.f('real'); v_sched uuid := pg_temp.f('sched'); v_n integer;
begin
  perform pg_temp.q_as(v_real, format('select public.set_screening_state(%L, ''not_applicable'', ''other'', ''back for the sabotage'')::text', v_sched));
  create or replace function private.block_screening_schedule_after_decline() returns trigger language plpgsql security definer set search_path = '' as
  $f$ begin
    if new.status = 'pending' and exists (select 1 from public.screening_schedules where patient_id = new.patient_id and screen_type_id = new.screen_type_id and status = 'declined') then return null; end if;
    return new; end $f$;
  with ins as (insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date)
               select organisation_id, patient_id, screen_type_id, 'pending', current_date from public.screening_schedules where id = v_sched returning 1)
  select count(*) into v_n from ins;
  insert into results values ('sabotaged', 'a pending row for a not-applicable item is blocked', '0', v_n::text);
end $$;
-- B: the scoring guard removed. A real patient must then be scored while the guard is off.
do $$
declare v_def text; r text;
begin
  perform pg_temp.guards_on(array[]::text[]);
  v_def := pg_get_functiondef('public.record_risk_assessment(uuid,uuid,text,text,jsonb,text,text,text[],uuid)'::regprocedure);
  v_def := replace(v_def, 'if not private.go_live_open_patient(''risk_instrument_who2019_enabled'', p_patient) then', 'if false then');
  execute replace(v_def, 'if not (v_ver.is_active and v_ver.approved_by is not null) and coalesce(v_prof.is_test, false) is not true then', 'if false then');
  r := pg_temp.as_service(format('select public.record_risk_assessment(%L, %L, ''scored'', ''lab'', ''{}''::jsonb, ''lt5'', ''manual'', ''{}'', null)::text', pg_temp.f('real2'), pg_temp.f('ver')));
  insert into results values ('sabotaged', 'a scored band is refused for a real person while the guard is off', 'refused', case when r like 'ERR:%' then 'refused' else 'scored' end);
end $$;
-- C: the rule config says cervical is not auto-scheduled. The scheduler must then skip a fresh 45-year-old woman.
do $$
declare v_set uuid := pg_temp.f('rules'); v_new uuid; v_org uuid := pg_temp.f('org');
begin
  perform pg_temp.guards_on(array['screening_scheduler_enabled']);
  v_new := pg_temp.mkuser(v_org, 'sab', 'patient', 'female', 45);
  update public.screening_rule_sets set config = jsonb_set(config, '{rules}',
    (select jsonb_agg(case when x ->> 'code' = 'cervical_smear' then jsonb_set(x, '{autoSchedule}', 'false'::jsonb) else x end) from jsonb_array_elements(config -> 'rules') x))
   where id = v_set;
  perform private.run_screening_scheduler(v_new);
  insert into results values ('sabotaged', 'a 45-year-old woman is scheduled for cervical screening by the configured rule', '1', pg_temp.cervical_rows(v_new)::text);
end $$;
-- D: the home-kit trigger dropped. A sensitive bundle must then be accepted for home collection.
do $$
declare v_real uuid := pg_temp.f('real2');
begin
  drop trigger lab_orders_zz_home_sensitive_kit_guard on public.lab_orders;
  insert into results values ('sabotaged', 'home collection of a bundle holding HIV is refused', 'P0001',
    pg_temp.try_sql(format('select pg_temp.mkorder(%L, ''screen_essential'', true)', v_real)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S45 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
