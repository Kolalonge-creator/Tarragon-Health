-- Vitals proof: the shadow divergence report for pulse, SpO2 and temperature, and the engine parity report it must not disturb
-- (migration *_build_vitals_shadow_divergence.sql).
--
--   1. Classes: both_urgent, neither_urgent, shadow_only_urgent, live_only_urgent (the dangerous row), live_urgent_no_shadow (the older trigger raised
--      something and the engine left no result), the by_design marker for a child's heart rate, and the amber against amber row for a patient's own line.
--      Test accounts, wearable readings, readings made before the draft existed and readings made in the last quarter hour are left out.
--   2. The blood pressure shadow report and the engine parity report count blood pressure only: a vitals result is never in either.
--   3. Gating: a signed-in patient is refused (42501), an admin reads, anon cannot execute, the row functions are not callable by a signed-in user.
--   4. SABOTAGE: (a) the engine parity rows without their rule-set condition (the S19d body) let a vitals result into the parity report, which is
--      exactly the corruption the fix prevents; (b) a live-level function that says green for everything turns the both_urgent row into something else.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean, p_age integer default 50) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'vd-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'VD ' || p_label, (current_date - make_interval(years => p_age))::date, p_test)
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;

create or replace function pg_temp.res(p_phase text, p_check text, p_expected text, p_actual text) returns void
language sql as $f$ insert into results values (p_phase, p_check, p_expected, p_actual) $f$;

create or replace function pg_temp.result(p_grade text, p_rule text, p_key text) returns jsonb
language sql as $f$
  select jsonb_build_object('status', 'graded', 'grade', p_grade, 'ruleId', p_rule, 'explanationKey', p_key,
    'actions', case when p_grade = 'red' then jsonb_build_array(jsonb_build_object('kind', 'show_emergency_guidance', 'code', p_key), jsonb_build_object('kind', 'page_on_call'))
                    else jsonb_build_array(jsonb_build_object('kind', 'show_message', 'code', p_key)) end,
    'matchedRuleIds', jsonb_build_array(p_rule), 'taskKey', null, 'ruleSet', jsonb_build_object('code', 'vitals_care_triage', 'version', 1)) $f$;

do $$
declare
  v_org uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_kid uuid; v_line uuid; v_none uuid; v_t uuid; v_w uuid; v_old uuid; v_new uuid; v_bp uuid; v_admin uuid; v_pat uuid;
  v_rs uuid; v_r uuid; v_err text; v_n integer;
  v_ra uuid; v_rb uuid; v_rc uuid; v_rd uuid; v_rk uuid; v_rl uuid; v_rn uuid; v_rt uuid; v_rw uuid; v_ro uuid; v_rnew uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_a := pg_temp.mkuser(v_org, 'both', 'patient', false);
  v_b := pg_temp.mkuser(v_org, 'neither', 'patient', false);
  v_c := pg_temp.mkuser(v_org, 'shadowonly', 'patient', false);
  v_d := pg_temp.mkuser(v_org, 'liveonly', 'patient', false);
  -- (registration is adults only, so the account is an adult; the proof records the engine's under-18 result by hand)
  v_kid := pg_temp.mkuser(v_org, 'kid', 'patient', false);
  v_line := pg_temp.mkuser(v_org, 'line', 'patient', false);
  v_none := pg_temp.mkuser(v_org, 'noshadow', 'patient', false);
  v_old := pg_temp.mkuser(v_org, 'old', 'patient', false);
  v_new := pg_temp.mkuser(v_org, 'recent', 'patient', false);
  v_w := pg_temp.mkuser(v_org, 'wearable', 'patient', false);
  v_t := pg_temp.mkuser(v_org, 'test', 'patient', true);
  v_bp := pg_temp.mkuser(v_org, 'bp', 'patient', false);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  v_pat := pg_temp.mkuser(v_org, 'plain', 'patient', true);
  select id into v_rs from public.triage_rule_sets where code = 'vitals_care_triage' and version = 1;
  -- The draft has to be older than the readings that must count (the report only judges readings made since it existed).
  update public.triage_rule_sets set created_at = now() - interval '2 days' where id = v_rs;

  -- a: pulse 160 (older trigger: emergency), the draft says red -> both_urgent
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at) values (v_org, v_a, 'pulse', 160, 'manual', now() - interval '1 hour') returning id into v_ra;
  perform public.record_vitals_triage_result(v_ra, pg_temp.result('red', 'VT-PU1', 'VIT-E01'), v_rs);
  -- b: temperature 36.8, green -> neither_urgent
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, temperature_c, source, taken_at) values (v_org, v_b, 'temperature', 36.8, 'manual', now() - interval '1 hour') returning id into v_rb;
  perform public.record_vitals_triage_result(v_rb, pg_temp.result('green', 'VT-TE5', 'VIT-T02'), v_rs);
  -- c: a normal SpO2 that the (wrong) draft calls red -> shadow_only_urgent
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_c, 'spo2', 98, 'manual', now() - interval '1 hour') returning id into v_rc;
  perform public.record_vitals_triage_result(v_rc, pg_temp.result('red', 'VT-OX1', 'VIT-E01'), v_rs);
  -- d: SpO2 85 (older trigger: emergency) that the draft calls green -> live_only_urgent
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_d, 'spo2', 85, 'manual', now() - interval '1 hour') returning id into v_rd;
  perform public.record_vitals_triage_result(v_rd, pg_temp.result('green', 'VT-OX5', 'VIT-T02'), v_rs);
  -- a child: pulse 130 (older trigger: red), the draft routes to a clinician (amber VT-PU3) -> live_only_urgent, by design
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at) values (v_org, v_kid, 'pulse', 130, 'manual', now() - interval '1 hour') returning id into v_rk;
  perform public.record_vitals_triage_result(v_rk, pg_temp.result('amber', 'VT-PU3', 'VIT-T03'), v_rs);
  -- the patient's own SpO2 line: 96 is green for everyone, amber for this patient on both sides -> amber against amber
  insert into public.patient_spo2_targets (organisation_id, patient_id, amber_threshold_pct, rationale) values (v_org, v_line, 96, 'proof');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_line, 'spo2', 96, 'manual', now() - interval '1 hour') returning id into v_rl;
  perform public.record_vitals_triage_result(v_rl, pg_temp.result('amber', 'VT-OX4', 'VIT-T01'), v_rs);
  -- no result at all: temperature 40.5 half an hour ago (the engine left nothing)
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, temperature_c, source, taken_at, created_at) values (v_org, v_none, 'temperature', 40.5, 'manual', now() - interval '30 minutes', now() - interval '30 minutes') returning id into v_rn;
  -- left out: made before the draft existed, made in the last quarter hour, a wearable reading, a test account
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, temperature_c, source, taken_at, created_at) values (v_org, v_old, 'temperature', 40.5, 'manual', now() - interval '3 days', now() - interval '3 days') returning id into v_ro;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, temperature_c, source, taken_at, created_at) values (v_org, v_new, 'temperature', 40.5, 'manual', now() - interval '5 minutes', now() - interval '5 minutes') returning id into v_rnew;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at, created_at) values (v_org, v_w, 'pulse', 170, 'wearable', now() - interval '1 hour', now() - interval '1 hour') returning id into v_rw;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at, created_at) values (v_org, v_t, 'pulse', 170, 'manual', now() - interval '1 hour', now() - interval '1 hour') returning id into v_rt;
  perform public.record_vitals_triage_result(v_rt, pg_temp.result('red', 'VT-PU1', 'VIT-E01'), v_rs);

  perform pg_temp.res('real', 'both_urgent', '1', (select count(*)::text from private.vitals_divergence_rows(7) where divergence = 'both_urgent' and observation_id = v_ra));
  perform pg_temp.res('real', 'neither_urgent', '1', (select count(*)::text from private.vitals_divergence_rows(7) where divergence = 'neither_urgent' and observation_id = v_rb));
  perform pg_temp.res('real', 'shadow_only_urgent', '1', (select count(*)::text from private.vitals_divergence_rows(7) where divergence = 'shadow_only_urgent' and observation_id = v_rc));
  perform pg_temp.res('real', 'live_only_urgent (the draft missed what the older trigger raises)', '1|false',
    (select count(*)::text || '|' || bool_or(by_design)::text from private.vitals_divergence_rows(7) where divergence = 'live_only_urgent' and observation_id = v_rd));
  perform pg_temp.res('real', 'a child''s heart rate routed to a clinician is live_only_urgent and marked by design', '1|true',
    (select count(*)::text || '|' || bool_or(by_design)::text from private.vitals_divergence_rows(7) where divergence = 'live_only_urgent' and observation_id = v_rk));
  perform pg_temp.res('real', 'the patient''s own amber line is amber against amber, not urgent', 'neither_urgent|amber|amber',
    (select divergence || '|' || shadow_grade || '|' || live_level from private.vitals_divergence_rows(7) where observation_id = v_rl));
  perform pg_temp.res('real', 'live_urgent_no_shadow (the older trigger raised something and the engine left no result)', '1|emergency|temperature',
    (select count(*)::text || '|' || min(live_level) || '|' || min(metric) from private.vitals_divergence_rows(7) where divergence = 'live_urgent_no_shadow' and observation_id = v_rn));
  perform pg_temp.res('real', 'a reading made before the draft existed is left out', '0', (select count(*)::text from private.vitals_divergence_rows(7) where observation_id = v_ro));
  perform pg_temp.res('real', 'a reading made in the last quarter hour is left out (its event may be on the way)', '0', (select count(*)::text from private.vitals_divergence_rows(7) where observation_id = v_rnew));
  perform pg_temp.res('real', 'a wearable reading is left out (the engine does not grade those in v1)', '0', (select count(*)::text from private.vitals_divergence_rows(7) where observation_id = v_rw));
  perform pg_temp.res('real', 'a test account is left out', '0', (select count(*)::text from private.vitals_divergence_rows(7) where observation_id = v_rt));
  perform pg_temp.res('real', 'the live level is named for the older classifier', 'amber|emergency|green|red',
    (select string_agg(distinct live_level, '|' order by live_level) from private.vitals_divergence_rows(7) where observation_id in (v_ra, v_rb, v_rk, v_rl)) );

  -- 2. The other reports count their own rule sets only
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at) values (v_org, v_bp, 'blood_pressure', 190, 125, 'manual', now()) returning id into v_r;
  perform pg_temp.res('real', 'the blood pressure shadow report holds no vitals result', '0',
    (select count(*)::text from private.triage_divergence_rows(7) d join public.triage_events e on e.id = d.triage_event_id where e.rule_set_code = 'vitals_care_triage'));
  perform pg_temp.res('real', 'the engine parity report holds no vitals result', '0',
    (select count(*)::text from private.triage_parity_rows(7) p join public.triage_events e on e.id = p.triage_event_id where e.rule_set_code = 'vitals_care_triage'));
  perform pg_temp.res('real', 'and the vitals report holds no blood pressure reading', '0', (select count(*)::text from private.vitals_divergence_rows(7) where observation_id = v_r));

  -- 3. Gating
  perform pg_temp.res('real', 'anon cannot execute the vitals reports or the row functions', 'false',
    (has_function_privilege('anon', 'public.triage_vitals_shadow_divergence(integer)', 'execute') or has_function_privilege('anon', 'public.triage_vitals_shadow_disagreements(integer, integer)', 'execute')
     or has_function_privilege('anon', 'private.vitals_divergence_rows(integer)', 'execute') or has_function_privilege('authenticated', 'private.vitals_divergence_rows(integer)', 'execute')
     or has_function_privilege('anon', 'private.live_level_of_vital(text, integer, integer, numeric)', 'execute'))::text);
  perform set_config('request.jwt.claim.sub', v_pat::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform * from public.triage_vitals_shadow_divergence(7); v_err := 'allowed'; exception when sqlstate '42501' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'a signed-in patient is refused the aggregate report', 'refused', v_err);
  begin perform * from public.triage_vitals_shadow_disagreements(7, 10); v_err := 'allowed'; exception when sqlstate '42501' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'and the disagreement list', 'refused', v_err);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.triage_vitals_shadow_disagreements(7, 50);
  perform pg_temp.res('real', 'an admin reads the disagreements: shadow-only (1), live-only (2: SpO2 and the child), no result (1)', '4', v_n::text);
  perform pg_temp.res('real', 'the list puts the dangerous rows first and the by-design one after the other dangerous rows', 'live_only_urgent,live_urgent_no_shadow,live_only_urgent,shadow_only_urgent|false,false,true,false',
    (select string_agg(divergence, ',' order by ord) || '|' || string_agg(by_design::text, ',' order by ord)
       from (select divergence, by_design, row_number() over () as ord from public.triage_vitals_shadow_disagreements(7, 50)) q));
  select count(*) into v_n from public.triage_vitals_shadow_divergence(7);
  perform pg_temp.res('real', 'and the aggregate has a row per metric, class, grade and live level', '7', v_n::text);
  execute 'reset role';

  -- 4. SABOTAGE (a): the S19d body of the parity rows, without the rule-set condition
  execute replace(pg_get_functiondef('private.triage_parity_rows(integer)'::regprocedure), 'te.rule_set_code = ''bp_care_triage'' and ', '');
  perform pg_temp.res('sabotaged', 'the engine parity report holds no vitals result', '0',
    (select count(*)::text from private.triage_parity_rows(7) p join public.triage_events e on e.id = p.triage_event_id where e.rule_set_code = 'vitals_care_triage'));
  -- (b): a live-level function that never sees anything wrong
  execute $e$create or replace function private.live_level_of_vital(p_type text, p_pulse integer, p_spo2 integer, p_temp numeric) returns text language sql immutable set search_path = '' as $f$ select 'green'::text $f$ $e$;
  perform pg_temp.res('sabotaged', 'both_urgent', '1', (select count(*)::text from private.vitals_divergence_rows(7) where divergence = 'both_urgent' and observation_id = v_ra));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'vitals divergence proof FAILED: %', (select string_agg(check_name || ' => expected [' || expected || '] got [' || coalesce(actual, 'null') || ']', '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed a result', v_caught; end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then case when expected is distinct from actual then 'PASS (caught)' else 'FAIL' end
            else case when expected = actual then 'PASS' else 'FAIL' end end as result
  from results order by phase desc, check_name;
rollback;
