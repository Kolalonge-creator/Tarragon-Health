-- R2 proof: the glucose shadow divergence report and the blood pressure report it must not disturb (migration *_r2_glucose_shadow_divergence.sql).
--
--   1. Glucose classes: both_urgent (red result and an older-pipeline emergency), neither_urgent, shadow_only_urgent (a level 3 sign: the new rule),
--      live_only_urgent (the older pipeline raised an emergency and the draft said green: the dangerous row). Test accounts are left out.
--   2. The blood pressure report counts only blood pressure results: a glucose result is never in it.
--   3. Gating: a signed-in patient is refused (42501), an admin reads, anon cannot execute, the row function is not callable by a signed-in user.
--   4. SABOTAGE: the blood pressure rows function without its rule-set condition (the S12b original) lets a glucose result into the blood pressure report,
--      which is exactly the corruption the fix prevents; check 2 must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'r2d-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'R2D ' || p_label, (current_date - interval '50 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;

create or replace function pg_temp.res(p_phase text, p_check text, p_expected text, p_actual text) returns void
language sql as $f$ insert into results values (p_phase, p_check, p_expected, p_actual) $f$;

do $$
declare
  v_org uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_t uuid; v_bp uuid; v_admin uuid; v_pat uuid;
  v_rs uuid; v_bp_rs uuid; v_g uuid; v_r uuid; v_err text;
  v_green jsonb; v_red jsonb; v_bpred jsonb;
  v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_a := pg_temp.mkuser(v_org, 'both', 'patient', false);
  v_b := pg_temp.mkuser(v_org, 'neither', 'patient', false);
  v_c := pg_temp.mkuser(v_org, 'shadowonly', 'patient', false);
  v_d := pg_temp.mkuser(v_org, 'liveonly', 'patient', false);
  v_t := pg_temp.mkuser(v_org, 'test', 'patient', true);
  v_bp := pg_temp.mkuser(v_org, 'bp', 'patient', false);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  v_pat := pg_temp.mkuser(v_org, 'plain', 'patient', true);
  select id into v_rs from public.triage_rule_sets where code = 'glucose_care_triage' and version = 1;
  select id into v_bp_rs from public.triage_rule_sets where code = 'bp_care_triage' order by version asc limit 1;
  v_green := jsonb_build_object('status', 'graded', 'grade', 'green', 'ruleId', 'GL-G1', 'explanationKey', 'GLU-T05',
    'actions', '[{"kind":"show_message","code":"GLU-T05"}]'::jsonb, 'matchedRuleIds', '["GL-G1"]'::jsonb, 'taskKey', null,
    'ruleSet', jsonb_build_object('code', 'glucose_care_triage', 'version', 1));
  v_red := jsonb_build_object('status', 'graded', 'grade', 'red', 'ruleId', 'GL-R3', 'explanationKey', 'GLU-E02',
    'actions', '[{"kind":"show_emergency_guidance","code":"GLU-E02"},{"kind":"page_on_call"}]'::jsonb,
    'matchedRuleIds', '["GL-R3"]'::jsonb, 'taskKey', null, 'ruleSet', jsonb_build_object('code', 'glucose_care_triage', 'version', 1));
  v_bpred := jsonb_build_object('status', 'graded', 'grade', 'red', 'ruleId', 'BP-R1', 'explanationKey', 'EMG-001',
    'actions', '[{"kind":"show_emergency_guidance","code":"EMG-001"},{"kind":"page_on_call"}]'::jsonb,
    'matchedRuleIds', '["BP-R1"]'::jsonb, 'taskKey', null, 'ruleSet', jsonb_build_object('code', 'bp_care_triage', 'version', (select version from public.triage_rule_sets where id = v_bp_rs)));

  -- a: severe low, the older pipeline raises an emergency, the draft says red -> both_urgent
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source) values (v_org, v_a, 'glucose', 2.5, 'fasting', 'manual') returning id into v_g;
  perform public.record_glucose_triage_result(v_g, jsonb_set(v_red, '{ruleId}', '"GL-R1"'), v_rs);
  -- b: normal -> neither_urgent
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source) values (v_org, v_b, 'glucose', 6.0, 'random', 'manual') returning id into v_g;
  perform public.record_glucose_triage_result(v_g, v_green, v_rs);
  -- c: a normal number with a level 3 sign: only the new rules call it red -> shadow_only_urgent
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source) values (v_org, v_c, 'glucose', 8.0, 'random', 'manual') returning id into v_g;
  perform public.record_glucose_triage_result(v_g, v_red, v_rs);
  -- d: severe low, the older pipeline raises an emergency, but the draft was (wrongly) green -> live_only_urgent
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source) values (v_org, v_d, 'glucose', 2.4, 'night', 'manual') returning id into v_g;
  perform public.record_glucose_triage_result(v_g, v_green, v_rs);
  -- a test account's result is left out
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source) values (v_org, v_t, 'glucose', 2.2, 'night', 'manual') returning id into v_g;
  perform public.record_glucose_triage_result(v_g, v_red, v_rs);

  perform pg_temp.res('real', 'the older pipeline raised its emergency for the severe lows (a, d, test)', '3',
    (select count(*)::text from public.emergency_events where source::text = 'glucose_red_flag' and patient_id in (v_a, v_d, v_t)));
  perform pg_temp.res('real', 'both_urgent', '1', (select count(*)::text from private.glucose_divergence_rows(1) where divergence = 'both_urgent' and observation_id in (select id from public.vitals_readings where patient_id = v_a)));
  perform pg_temp.res('real', 'neither_urgent', '1', (select count(*)::text from private.glucose_divergence_rows(1) where divergence = 'neither_urgent' and observation_id in (select id from public.vitals_readings where patient_id = v_b)));
  perform pg_temp.res('real', 'shadow_only_urgent (the new rule: a sign at a normal number)', '1', (select count(*)::text from private.glucose_divergence_rows(1) where divergence = 'shadow_only_urgent' and observation_id in (select id from public.vitals_readings where patient_id = v_c)));
  perform pg_temp.res('real', 'live_only_urgent (the draft missed what the older pipeline raised)', '1', (select count(*)::text from private.glucose_divergence_rows(1) where divergence = 'live_only_urgent' and observation_id in (select id from public.vitals_readings where patient_id = v_d)));
  perform pg_temp.res('real', 'a test account is left out', '0', (select count(*)::text from private.glucose_divergence_rows(1) where observation_id in (select id from public.vitals_readings where patient_id = v_t)));
  perform pg_temp.res('real', 'the live level is named for the older pipeline', 'emergency|none',
    (select string_agg(distinct live_level, '|' order by live_level) from private.glucose_divergence_rows(1) where observation_id in (select id from public.vitals_readings where patient_id in (v_a, v_b))));

  -- 2. The blood pressure report counts blood pressure only
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_bp, 'blood_pressure', 190, 125, 'manual') returning id into v_r;
  perform public.record_triage_result(v_r, v_bpred, v_bp_rs);
  perform pg_temp.res('real', 'the blood pressure report holds the blood pressure result', '1',
    (select count(*)::text from private.triage_divergence_rows(1) where observation_id = v_r));
  perform pg_temp.res('real', 'and no glucose result at all', '0',
    (select count(*)::text from private.triage_divergence_rows(1) d join public.triage_events e on e.id = d.triage_event_id where e.rule_set_code = 'glucose_care_triage'));
  perform pg_temp.res('real', 'and the glucose report holds no blood pressure result', '0',
    (select count(*)::text from private.glucose_divergence_rows(1) where observation_id = v_r));

  -- 3. Gating
  perform pg_temp.res('real', 'anon cannot execute the glucose reports or the row function', 'false',
    (has_function_privilege('anon', 'public.triage_glucose_shadow_divergence(integer)', 'execute') or has_function_privilege('anon', 'public.triage_glucose_shadow_disagreements(integer, integer)', 'execute')
     or has_function_privilege('anon', 'private.glucose_divergence_rows(integer)', 'execute') or has_function_privilege('authenticated', 'private.glucose_divergence_rows(integer)', 'execute'))::text);
  perform set_config('request.jwt.claim.sub', v_pat::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform * from public.triage_glucose_shadow_divergence(1); v_err := 'allowed'; exception when sqlstate '42501' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'a signed-in patient is refused the aggregate report', 'refused', v_err);
  begin perform * from public.triage_glucose_shadow_disagreements(1, 10); v_err := 'allowed'; exception when sqlstate '42501' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'and the disagreement list', 'refused', v_err);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.triage_glucose_shadow_disagreements(1, 50);
  perform pg_temp.res('real', 'an admin reads the disagreements: the two classes of this proof', '2', v_n::text);
  perform pg_temp.res('real', 'and the list puts the dangerous row first', 'live_only_urgent',
    (select divergence from public.triage_glucose_shadow_disagreements(1, 50) limit 1));
  select count(*) into v_n from public.triage_glucose_shadow_divergence(1);
  perform pg_temp.res('real', 'and the aggregate has a row per class and grade', '4', v_n::text);
  execute 'reset role';

  -- 4. SABOTAGE: the S12b original body, without the rule-set condition
  execute $e$create or replace function private.triage_divergence_rows(p_days integer)
    returns table (triage_event_id uuid, observation_id uuid, shadow_grade text, shadow_rule_id text, live_level text, created_at timestamptz, divergence text)
    language sql stable security definer set search_path = '' as $f$
    select e.id, e.trigger_id, e.grade, e.rule_id, private.classify_bp_level(v.systolic::int, v.diastolic::int), e.created_at, 'x'::text
    from public.triage_events e join public.vitals_readings v on v.id = e.trigger_id
    where e.trigger_type = 'observation' and e.shadow and not e.is_test
      and e.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365))) $f$ $e$;
  perform pg_temp.res('sabotaged', 'and no glucose result at all', '0',
    (select count(*)::text from private.triage_divergence_rows(1) d join public.triage_events e on e.id = d.triage_event_id where e.rule_set_code = 'glucose_care_triage'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'R2 glucose divergence proof FAILED: %', (select string_agg(check_name || ' => expected [' || expected || '] got [' || coalesce(actual, 'null') || ']', '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotaged blood pressure report did not change'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
