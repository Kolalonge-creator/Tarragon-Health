-- Proof: T2 Phase 2 lab trend rules engine (migration *_t2_phase2_lab_trend_rules_and_health_status.sql).
--
--   a. UNSIGNED: v1 is inactive; the nightly run writes 'awaiting_signature' and raises no alert and no detection for a patient whose
--      HbA1c rose 6.1 -> 6.7 -> 7.3. SABOTAGE 1: the signed-only reader made to return the unsigned row; the same run must now raise an
--      alert (so the inert check discriminates). The reader is then restored.
--   b. Only the CMO signs (a senior doctor, an admin and a patient get 42501; anon cannot execute); the hub reader serves the CMO and an
--      admin and refuses a doctor and a patient; a draft with two change kinds or an unknown SLA pathway is refused (22023).
--   c. SIGNED: the run raises exactly one 'deterioration' clinician alert for the rising patient, due at the escalation_slas window for the
--      named pathway (read, not hard-coded), with a detection carrying the version; none for a patient whose values went down then up;
--      a persistent out-of-range potassium is found; the alert text never claims a diagnosis.
--   d. DEDUPE: a second run raises nothing; resolving the alert and running again raises nothing (same latest result); a new higher
--      result raises one new alert. SABOTAGE 2: the detections deleted, the next run raises again (the dedupe is the detections table).
--   e. Command centre: the clinical worklist and the organisation totals count 'deteriorating_trends'.
--   f. patient_health_status: the patient reads their own latest and previous HbA1c; another patient is refused; the patient cannot read
--      lab_trend_detections at all.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  begin
    execute p_sql into r;
    r := coalesce(nullif(r, ''), 'ok');
  exception when others then r := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
grant execute on function pg_temp.as_user(uuid, text) to public;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'labtrend-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'LabTrend ' || p_label, '+23481' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'LabTrend ' || p_label, 'MDCN', 'LabTrend-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true);
  return v;
end $f$;
create function pg_temp.lab(p_org uuid, p_patient uuid, p_code text, p_value numeric, p_unit text, p_months_ago integer,
                            p_lo numeric default null, p_hi numeric default null) returns void language sql as
$$ insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, reference_range_low, reference_range_high, report_status, range_source)
   values (p_org, p_patient, p_code, p_value, p_unit, now() - make_interval(months => p_months_ago), p_lo, p_hi, 'final', case when p_lo is null and p_hi is null then 'unspecified' else 'lab_report' end) $$;
create function pg_temp.trend_alerts(p_patient uuid) returns integer language sql as
$$ select count(*)::integer from public.clinician_alerts a where a.patient_id = p_patient and a.type_code = 'deterioration' and a.title = 'Lab trend to review' $$;

create temp table ids(k text primary key, v uuid) on commit drop;
grant all on ids to public;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_smo uuid; v_rise uuid; v_dip uuid; v_k uuid; v_other uuid; v_r jsonb; v_body text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_smo := pg_temp.mkdoc(v_org, v_admin, 'smo', 'senior_medical_officer');
  v_rise := pg_temp.mkuser(v_org, 'rise', 'patient');
  v_dip := pg_temp.mkuser(v_org, 'dip', 'patient');
  v_k := pg_temp.mkuser(v_org, 'potassium', 'patient');
  v_other := pg_temp.mkuser(v_org, 'other', 'patient');
  insert into ids values ('org', v_org), ('admin', v_admin), ('cmo', v_cmo), ('smo', v_smo), ('rise', v_rise), ('dip', v_dip), ('k', v_k), ('other', v_other);

  -- HbA1c 6.1 -> 6.7 -> 7.3 (in range at first, a clinically meaningful rise); a patient who went 6.4 -> 6.0 -> 6.9; potassium persistently high
  perform pg_temp.lab(v_org, v_rise, 'hba1c', 6.1, '%', 9);
  perform pg_temp.lab(v_org, v_rise, 'hba1c', 6.7, '%', 6);
  perform pg_temp.lab(v_org, v_rise, 'hba1c', 7.3, '%', 3);
  perform pg_temp.lab(v_org, v_dip, 'hba1c', 6.4, '%', 9);
  perform pg_temp.lab(v_org, v_dip, 'hba1c', 6.0, '%', 6);
  perform pg_temp.lab(v_org, v_dip, 'hba1c', 6.9, '%', 3);
  perform pg_temp.lab(v_org, v_k, 'potassium', 5.6, 'mmol/L', 9, 3.5, 5.1);
  perform pg_temp.lab(v_org, v_k, 'potassium', 5.8, 'mmol/L', 6, 3.5, 5.1);
  perform pg_temp.lab(v_org, v_k, 'potassium', 5.7, 'mmol/L', 3, 3.5, 5.1);

  -- a. unsigned: inert
  perform pg_temp.rec('a1 v1 is unsigned and inactive', 'false/null',
    (select is_active::text || '/' || coalesce(approved_by::text, 'null') from public.lab_trend_rule_sets where version = 1));
  v_r := private.run_lab_trend_rules();
  perform pg_temp.rec('a2 unsigned: the run says awaiting_signature', 'awaiting_signature', v_r ->> 'outcome');
  perform pg_temp.rec('a3 unsigned: no alert for the rising HbA1c', '0', pg_temp.trend_alerts(v_rise)::text);
  perform pg_temp.rec('a4 unsigned: no detection anywhere', '0', (select count(*)::text from public.lab_trend_detections));
  perform pg_temp.rec('a5 unsigned: the run is logged', 'awaiting_signature', (select outcome from public.lab_trend_rule_runs order by ran_at desc limit 1));
  perform pg_temp.rec('a6 unsigned: the hub reader shows the last run as awaiting_signature', 'awaiting_signature',
    pg_temp.as_user(v_cmo, $q$select public.lab_trend_rules_for_signoff() #>> '{last_run,outcome}'$q$));

  -- SABOTAGE 1: the signed-only reader returns the unsigned draft; the run must now raise
  v_body := pg_get_functiondef('private.lab_trend_rules_active()'::regprocedure);
  create or replace function private.lab_trend_rules_active() returns jsonb language sql stable security definer set search_path = ''
    as $s$ select jsonb_build_object('version', version, 'config', config) from public.lab_trend_rule_sets where version = 1 $s$;
  perform private.run_lab_trend_rules();
  insert into results values ('sabotaged', 'unsigned rules raise nothing', '0', pg_temp.trend_alerts(v_rise)::text);
  delete from public.lab_trend_detections;
  update public.clinician_alerts set status = 'resolved', resolved_at = now(), resolution_action = 'proof', resolution_outcome = 'no_action_needed', title = 'proof: sabotage leftover' where title = 'Lab trend to review';
  execute v_body;
  perform pg_temp.rec('a7 restored: the reader is signed-only again', 'null', coalesce(private.lab_trend_rules_active()::text, 'null'));

  -- b. who can sign and read
  perform pg_temp.rec('b1 a senior doctor cannot sign', '42501', pg_temp.as_user(v_smo, 'select public.sign_lab_trend_rules(1)::text'));
  perform pg_temp.rec('b2 an admin cannot sign', '42501', pg_temp.as_user(v_admin, 'select public.sign_lab_trend_rules(1)::text'));
  perform pg_temp.rec('b3 a patient cannot sign', '42501', pg_temp.as_user(v_rise, 'select public.sign_lab_trend_rules(1)::text'));
  perform pg_temp.rec('b4 anon cannot execute the sign function', 'false', has_function_privilege('anon', 'public.sign_lab_trend_rules(integer)', 'EXECUTE')::text);
  perform pg_temp.rec('b5 the CMO sees v1 pending', '1', pg_temp.as_user(v_cmo, $q$select public.lab_trend_rules_for_signoff() #>> '{pending,version}'$q$));
  perform pg_temp.rec('b6 an admin sees v1 pending', '1', pg_temp.as_user(v_admin, $q$select public.lab_trend_rules_for_signoff() #>> '{pending,version}'$q$));
  perform pg_temp.rec('b7 a senior doctor is refused the hub reader', '42501', pg_temp.as_user(v_smo, 'select public.lab_trend_rules_for_signoff()::text'));
  perform pg_temp.rec('b8 a patient is refused the hub reader', '42501', pg_temp.as_user(v_rise, 'select public.lab_trend_rules_for_signoff()::text'));
  insert into public.lab_trend_rule_sets (version, config, notes)
    select 98, jsonb_set(config, '{rules,0,fall_from_first}', '1'), 'proof: two change kinds' from public.lab_trend_rule_sets where version = 1;
  insert into public.lab_trend_rule_sets (version, config, notes)
    select 99, jsonb_set(config, '{review,sla_pathway}', '"no_such_pathway"'), 'proof: unknown pathway' from public.lab_trend_rule_sets where version = 1;
  perform pg_temp.rec('b9 a rule with two change kinds is refused', '22023', pg_temp.as_user(v_cmo, 'select public.sign_lab_trend_rules(98)::text'));
  perform pg_temp.rec('b10 an unknown SLA pathway is refused', '22023', pg_temp.as_user(v_cmo, 'select public.sign_lab_trend_rules(99)::text'));
  delete from public.lab_trend_rule_sets where version in (98, 99);

  -- c. the CMO signs; the run raises once
  perform pg_temp.rec('c1 the CMO signs v1', 'ok', pg_temp.as_user(v_cmo, 'select public.sign_lab_trend_rules(1)::text'));
  perform pg_temp.rec('c2 v1 is active and signed', 'true/true',
    (select is_active::text || '/' || (approved_by is not null)::text from public.lab_trend_rule_sets where version = 1));
  begin
    update public.lab_trend_rule_sets set config = jsonb_set(config, '{min_points}', '2') where version = 1;
    perform pg_temp.rec('c3 a signed version cannot be edited', '42501', 'updated');
  exception when others then perform pg_temp.rec('c3 a signed version cannot be edited', '42501', sqlstate);
  end;
  v_r := private.run_lab_trend_rules();
  perform pg_temp.rec('c4 signed: the run is ok', 'ok', v_r ->> 'outcome');
  perform pg_temp.rec('c5 signed: one alert for the rising HbA1c', '1', pg_temp.trend_alerts(v_rise)::text);
  perform pg_temp.rec('c6 the alert is due at the escalation_slas window for the named pathway', 'true',
    (select (abs(extract(epoch from (a.sla_due_at - a.created_at)) / 60 - private.escalation_sla_minutes('screening_abnormal_result', 'urgent_escalation')) < 1)::text
       from public.clinician_alerts a where a.patient_id = v_rise and a.title = 'Lab trend to review'));
  perform pg_temp.rec('c7 the alert is clinical, clinician_review', 'clinical/clinician_review',
    (select a.category::text || '/' || a.level::text from public.clinician_alerts a where a.patient_id = v_rise and a.title = 'Lab trend to review'));
  perform pg_temp.rec('c8 the detection names hba1c, trend, version 1, three points', 'hba1c/trend/1/3',
    (select d.analyte || '/' || d.rule_kind || '/' || d.rule_set_version || '/' || jsonb_array_length(d.points) from public.lab_trend_detections d where d.patient_id = v_rise));
  perform pg_temp.rec('c9 no alert for values that went down then up', '0', pg_temp.trend_alerts(v_dip)::text);
  perform pg_temp.rec('c10 persistent out-of-range potassium is found', 'potassium/persistent_out_of_range',
    (select string_agg(d.analyte || '/' || d.rule_kind, ',') from public.lab_trend_detections d where d.patient_id = v_k));
  perform pg_temp.rec('c11 the alert says it is not a diagnosis', 'true',
    (select (a.detail like '%not a diagnosis%' and a.detail like '%no change to any medicine%')::text from public.clinician_alerts a where a.patient_id = v_rise and a.title = 'Lab trend to review'));

  -- d. dedupe
  perform private.run_lab_trend_rules();
  perform pg_temp.rec('d1 a second run raises nothing new', '1', pg_temp.trend_alerts(v_rise)::text);
  update public.clinician_alerts set status = 'resolved', resolved_at = now(), resolution_action = 'proof', resolution_outcome = 'no_action_needed' where patient_id = v_rise and title = 'Lab trend to review';
  perform private.run_lab_trend_rules();
  perform pg_temp.rec('d2 resolved, same latest result: nothing new', '1', pg_temp.trend_alerts(v_rise)::text);
  perform pg_temp.lab(v_org, v_rise, 'hba1c', 8.0, '%', 0);
  perform private.run_lab_trend_rules();
  perform pg_temp.rec('d3 a new higher result raises one new alert', '2', pg_temp.trend_alerts(v_rise)::text);
  perform private.run_lab_trend_rules();
  perform pg_temp.rec('d4 and only one', '2', pg_temp.trend_alerts(v_rise)::text);
end $$;

-- e. command centre counts (as the senior doctor)
do $$
declare v_smo uuid := (select v from ids where k = 'smo'); v_rise uuid := (select v from ids where k = 'rise');
begin
  perform pg_temp.rec('e1 the worklist lists the open trend alert for the rising patient', '1',
    pg_temp.as_user(v_smo, format($q$select count(*)::text from public.clinical_worklist() where kind = 'deteriorating_trends' and patient_id = %L$q$, v_rise)));
  perform pg_temp.rec('e2 the organisation totals count deteriorating_trends', 'true',
    pg_temp.as_user(v_smo, $q$select (n >= 2)::text from public.org_open_work_counts() where kind = 'deteriorating_trends'$q$));
end $$;

-- f. health status for the patient
do $$
declare v_rise uuid := (select v from ids where k = 'rise'); v_other uuid := (select v from ids where k = 'other');
begin
  perform pg_temp.rec('f1 the patient reads their latest and previous HbA1c', '8.0000/7.3000/%',
    pg_temp.as_user(v_rise, $q$select (h ->> 'latest_value') || '/' || (h ->> 'previous_value') || '/' || (h ->> 'latest_unit')
                                 from jsonb_array_elements(public.patient_health_status() -> 'labs') h where h ->> 'code' = 'hba1c'$q$));
  perform pg_temp.rec('f2 another patient is refused', '42501',
    pg_temp.as_user(v_other, format('select public.patient_health_status(%L)::text', v_rise)));
  perform pg_temp.rec('f3 the patient cannot read lab_trend_detections', '42501',
    pg_temp.as_user(v_rise, 'select count(*)::text from public.lab_trend_detections'));
  perform pg_temp.rec('f4 anon cannot execute patient_health_status', 'false', has_function_privilege('anon', 'public.patient_health_status(uuid)', 'EXECUTE')::text);
end $$;

-- SABOTAGE 2: with the detections gone the dedupe has nothing to hold, so the next run raises again
do $$
declare v_rise uuid := (select v from ids where k = 'rise'); v_before integer;
begin
  update public.clinician_alerts set status = 'resolved', resolved_at = now(), resolution_action = 'proof', resolution_outcome = 'no_action_needed' where patient_id = v_rise and title = 'Lab trend to review';
  v_before := pg_temp.trend_alerts(v_rise);
  delete from public.lab_trend_detections where patient_id = v_rise;
  perform private.run_lab_trend_rules();
  insert into results values ('sabotaged', 'the same finding is never raised twice', v_before::text, pg_temp.trend_alerts(v_rise)::text);
end $$;

select phase, check_name, expected, actual, case when phase = 'real' and expected is distinct from actual then 'FAIL' else 'PASS' end as verdict
  from results order by phase, check_name;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Lab trend rules proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: % of 2 sabotage steps changed the outcome', v_caught; end if;
end $$;

rollback;
