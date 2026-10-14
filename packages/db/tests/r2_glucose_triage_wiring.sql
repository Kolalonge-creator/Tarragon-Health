-- R2 proof: glucose readings reach the triage engine in shadow (migrations *_r2_glucose_care_triage_v1_draft.sql and *_r2_glucose_triage_wiring.sql).
--
--   1. A glucose reading emits one observation.recorded event (kind glucose, ids only) and a delivery for the triage subscriber; a blood pressure or
--      pulse reading emits none of the glucose kind.
--   2. triage_context_for_glucose_observation: reading, context, ketones on the row or from a nearby ketone reading, symptoms mapped, diabetes type,
--      pregnancy, age; a blood pressure reading is not found.
--   3. record_glucose_triage_result: shadow while the rule set is a draft, one row per reading and basis, urgent event for red, rejected writes nothing,
--      a result graded with another rule set or a non-glucose rule set is refused, and it NEVER touches a pending blood pressure recheck or its repeat task.
--   4. Shadow is respected downstream: no clinical task, no page, from a shadow glucose event. Once the rule set is approved (inside this rolled-back
--      transaction only) an urgent amber creates one amber_glucose_review task and a result is no longer shadow.
--   5. The sweep re-emits a glucose reading that lost its event, once.
--   6. Grants: the context, the writer and the sweep are not executable by anon or authenticated.
--   7. SABOTAGE: with the producer trigger dropped the emit check flips; and the blood pressure writer, used on a glucose reading, resolves a pending
--      blood pressure recheck, which is exactly what the separate glucose writer exists to prevent.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'r2-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'R2 ' || p_label, (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;

create or replace function pg_temp.res(p_phase text, p_check text, p_expected text, p_actual text) returns void
language sql as $f$ insert into results values (p_phase, p_check, p_expected, p_actual) $f$;

do $$
declare
  v_org uuid; v_p uuid; v_p2 uuid; v_cmo uuid; v_admin uuid; v_p3 uuid; v_g8 uuid; v_g9 uuid; v_k3 uuid;
  v_rs uuid; v_bp_rs uuid;
  v_g1 uuid; v_g2 uuid; v_g3 uuid; v_g4 uuid; v_k uuid; v_bp uuid; v_bp2 uuid; v_g5 uuid; v_g6 uuid; v_g7 uuid;
  v_ctx jsonb; v_out jsonb; v_te uuid; v_n integer; v_err text; v_n2 integer;
  v_green jsonb; v_red jsonb; v_amber jsonb;
  v_state text; v_pending_before integer; v_basis text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_p3 := pg_temp.mkuser(v_org, 'patient3', 'patient');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by)
  values (v_cmo, v_org, 'R2 CMO', 'chief_medical_officer', true, now(), 'employed', true, v_admin) on conflict do nothing;
  select id into v_rs from public.triage_rule_sets where code = 'glucose_care_triage' and version = 1;
  select id into v_bp_rs from public.triage_rule_sets where code = 'bp_care_triage' order by version desc limit 1;
  perform pg_temp.res('real', 'the glucose rule set exists and is a draft', 'draft', (select status from public.triage_rule_sets where id = v_rs));
  perform pg_temp.res('real', 'it has 15 rules', '15', (select jsonb_array_length(rules -> 'rules')::text from public.triage_rule_sets where id = v_rs));

  v_green := jsonb_build_object('status', 'graded', 'grade', 'green', 'ruleId', 'GL-G1', 'explanationKey', 'GLU-T05',
    'actions', '[{"kind":"show_message","code":"GLU-T05"}]'::jsonb, 'matchedRuleIds', '["GL-G1"]'::jsonb, 'taskKey', null,
    'ruleSet', jsonb_build_object('code', 'glucose_care_triage', 'version', 1));
  v_red := jsonb_build_object('status', 'graded', 'grade', 'red', 'ruleId', 'GL-R1', 'explanationKey', 'GLU-E01',
    'actions', '[{"kind":"show_emergency_guidance","code":"GLU-E01"},{"kind":"page_on_call"}]'::jsonb,
    'matchedRuleIds', '["GL-R1"]'::jsonb, 'taskKey', null, 'ruleSet', jsonb_build_object('code', 'glucose_care_triage', 'version', 1));

  -- 1. Producer
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at)
    values (v_org, v_p, 'glucose', 6.1, 'fasting', 'manual', now() - interval '2 hours') returning id into v_g1;
  perform pg_temp.res('real', 'a glucose reading emits one observation.recorded event', '1',
    (select count(*)::text from public.domain_events where event_type = 'observation.recorded' and idempotency_key = 'glu:' || v_g1));
  perform pg_temp.res('real', 'the event says kind glucose and carries ids only', 'glucose|false',
    (select (payload ->> 'kind') || '|' || (payload ? 'glucose_mmol_l' or payload ? 'value')::text from public.domain_events where idempotency_key = 'glu:' || v_g1));
  perform pg_temp.res('real', 'the triage subscriber gets a delivery', '1',
    (select count(*)::text from public.domain_event_deliveries d join public.domain_events e on e.id = d.event_id
      where e.idempotency_key = 'glu:' || v_g1 and d.subscriber_key = 'triage.grade_observation'));
  perform pg_temp.res('real', 'the event is marked is_test for a test patient', 'true',
    (select is_test::text from public.domain_events where idempotency_key = 'glu:' || v_g1));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, v_p, 'blood_pressure', 118, 76, 'device', now() - interval '3 hours') returning id into v_bp;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at)
    values (v_org, v_p, 'pulse', 72, 'manual', now());
  perform pg_temp.res('real', 'blood pressure and pulse readings emit no glucose event', '0',
    (select count(*)::text from public.domain_events where event_type = 'observation.recorded' and patient_id = v_p and payload ->> 'kind' = 'glucose'
        and idempotency_key <> 'glu:' || v_g1));
  perform pg_temp.res('real', 'the blood pressure reading still emits its own event', '1',
    (select count(*)::text from public.domain_events where idempotency_key = 'bp:' || v_bp));

  -- 2. Context
  insert into public.patient_diabetes_profile (patient_id, organisation_id, patient_reported_type) values (v_p, v_org, 'type_2');
  v_ctx := public.triage_context_for_glucose_observation(v_g1);
  perform pg_temp.res('real', 'context finds the reading', 'true', v_ctx ->> 'found');
  perform pg_temp.res('real', 'context mmol and context code', '6.10|fasting', (v_ctx #>> '{input,trigger,reading,mmol}') || '|' || (v_ctx #>> '{input,trigger,reading,context}'));
  perform pg_temp.res('real', 'context diabetes type is the reported one when none is confirmed', 'type_2', v_ctx #>> '{input,diabetesType}');
  perform pg_temp.res('real', 'context is not pregnant, age 50', 'false|50', (v_ctx #>> '{input,pregnant}') || '|' || (v_ctx #>> '{input,ageYears}'));
  perform pg_temp.res('real', 'context has no symptoms and no ketones', '0|{}', jsonb_array_length(v_ctx #> '{input,trigger,symptoms}')::text || '|' || (v_ctx #>> '{input,trigger,ketones}'));
  perform pg_temp.res('real', 'context for a blood pressure reading is not found', 'false', public.triage_context_for_glucose_observation(v_bp) ->> 'found');
  perform pg_temp.res('real', 'context for an unknown id is not found', 'false', public.triage_context_for_glucose_observation(gen_random_uuid()) ->> 'found');

  -- confirmed type wins; ketones from a nearby ketone reading; symptoms mapped
  update public.patient_diabetes_profile set confirmed_type = 'type_1', confirmed_at = now() where patient_id = v_p;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at)
    values (v_org, v_p, 'glucose', 14.2, 'random', 'manual', now() - interval '1 hour') returning id into v_g2;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, ketones_mmol_l, source, taken_at)
    values (v_org, v_p, 'ketones', 2.1, 'manual', now() - interval '1 hour' + interval '10 minutes') returning id into v_k;
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (v_org, v_p, 'lethargy', 2);
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (v_org, v_p, 'breathlessness', 2);
  perform pg_temp.res('real', 'a confusion, breathlessness, lethargy or dehydration symptom after a glucose reading regrades it (2 symptoms, 2 events)', '2',
    (select count(*)::text from public.domain_events where event_type = 'observation.recorded' and patient_id = v_p and idempotency_key like 'glu:%:sym:%'));
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (v_org, v_p, 'pain', 1);
  perform pg_temp.res('real', 'a symptom the glucose rules do not read regrades nothing', '2',
    (select count(*)::text from public.domain_events where event_type = 'observation.recorded' and patient_id = v_p and idempotency_key like 'glu:%:sym:%'));
  v_ctx := public.triage_context_for_glucose_observation(v_g2);
  perform pg_temp.res('real', 'a confirmed type wins over the reported one', 'type_1', v_ctx #>> '{input,diabetesType}');
  perform pg_temp.res('real', 'ketones come from a ketone reading within 30 minutes', '2.10', v_ctx #>> '{input,trigger,ketones,bloodMmol}');
  perform pg_temp.res('real', 'symptoms are mapped onto the engine codes', 'drowsiness,fast_breathing',
    (select string_agg(x, ',' order by x) from jsonb_array_elements_text(v_ctx #> '{input,trigger,symptoms}') x));
  v_basis := v_ctx ->> 'basis';
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, ketones_mmol_l, ketone_urine, source, taken_at)
    values (v_org, v_p, 'glucose', 12.0, 'random', 1.0, 'large', 'manual', now() - interval '1 hour') returning id into v_g7;
  v_ctx := public.triage_context_for_glucose_observation(v_g7);
  perform pg_temp.res('real', 'ketones on the row itself win over a nearby ketone reading', '1.00|large',
    (v_ctx #>> '{input,trigger,ketones,bloodMmol}') || '|' || (v_ctx #>> '{input,trigger,ketones,urine}'));
  insert into public.patient_pregnancy (patient_id, organisation_id, is_pregnant) values (v_p2, v_org, true);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at)
    values (v_org, v_p2, 'glucose', 7.0, 'post_meal', 'manual', now()) returning id into v_g3;
  perform pg_temp.res('real', 'the basis changes when the facts change', 'true',
    (v_basis is distinct from (public.triage_context_for_glucose_observation(v_g3) ->> 'basis'))::text);
  update public.profiles set date_of_birth = null where id = v_p2;
  perform pg_temp.res('real', 'a patient with no date of birth and no diabetes record has a context with neither key (the engine reads absent as not recorded)', 'true|true|true',
    ((public.triage_context_for_glucose_observation(v_g3) -> 'input') ? 'ageYears' = false)::text || '|' || ((public.triage_context_for_glucose_observation(v_g3) -> 'input') ? 'diabetesType' = false)::text || '|' ||
    ((public.triage_context_for_glucose_observation(v_g3) ->> 'found') = 'true')::text);
  perform pg_temp.res('real', 'pregnancy is carried', 'true|null',
    (public.triage_context_for_glucose_observation(v_g3) #>> '{input,pregnant}') || '|' || coalesce(public.triage_context_for_glucose_observation(v_g3) #>> '{input,diabetesType}', 'null'));


  -- Which readings, ketone regrade and retractions (code review): streaming sources are not graded; a ketone arriving after the glucose regrades it; a retracted ketone or
  -- glucose is never used.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at)
    values (v_org, v_p3, 'glucose', 2.5, 'random', 'wearable', now()) returning id into v_g8;
  perform pg_temp.res('real', 'a wearable or monitor glucose reading is not graded by this engine (no event)', '0',
    (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || v_g8));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at)
    values (v_org, v_p3, 'glucose', 15.0, 'random', 'device', now()) returning id into v_g9;
  perform pg_temp.res('real', 'a Bluetooth meter glucose reading is graded (one event)', '1',
    (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || v_g9));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, ketones_mmol_l, source, taken_at)
    values (v_org, v_p3, 'ketones', 3.5, 'manual', now()) returning id into v_k3;
  perform pg_temp.res('real', 'a ketone reading arriving after the glucose regrades it (one event with the ketone id)', '1',
    (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || v_g9 || ':ket:' || v_k3));
  perform pg_temp.res('real', 'and the regraded context now holds the ketone, with a different basis', 'true|true',
    ((public.triage_context_for_glucose_observation(v_g9) #>> '{input,trigger,ketones,bloodMmol}') = '3.50')::text || '|' ||
    ((public.triage_context_for_glucose_observation(v_g9) ->> 'basis') is distinct from md5('|' || '' || '|' || ''))::text);
  perform set_config('request.jwt.claim.sub', v_p3::text, true);
  perform public.correct_clinical_value('vitals_readings', v_k3, 'entered_in_error', 'typed by mistake in the proof');
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.res('real', 'a ketone marked entered in error is never used', 'null',
    coalesce(public.triage_context_for_glucose_observation(v_g9) #>> '{input,trigger,ketones,bloodMmol}', 'null'));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at)
    values (v_org, v_p3, 'glucose', 2.3, 'random', 'manual', now()) returning id into v_g8;
  perform pg_temp.res('real', 'a manual glucose reading is graded until it is retracted', 'true', public.triage_context_for_glucose_observation(v_g8) ->> 'found');
  perform set_config('request.jwt.claim.sub', v_p3::text, true);
  perform public.correct_clinical_value('vitals_readings', v_g8, 'entered_in_error', 'typed by mistake in the proof');
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.res('real', 'a glucose reading marked entered in error is not graded', 'false',
    public.triage_context_for_glucose_observation(v_g8) ->> 'found');

  -- 3. Writer (the rule set is a draft: shadow)
  select count(*) into v_pending_before from public.triage_pending_rechecks;
  v_out := public.record_glucose_triage_result(v_g1, v_green, v_rs);
  perform pg_temp.res('real', 'a green result is recorded in shadow', 'graded|true|true', (v_out ->> 'status') || '|' || (v_out ->> 'created') || '|' || (v_out ->> 'shadow'));
  v_te := (v_out ->> 'triage_event_id')::uuid;
  perform pg_temp.res('real', 'the row records the glucose rule set id and version', v_rs::text || '|1|draft|glucose_care_triage',
    (select rule_set_id::text || '|' || rule_set_version || '|' || rule_set_status || '|' || rule_set_code from public.triage_events where id = v_te));
  perform pg_temp.res('real', 'the reading is linked to its result', v_te::text, (select triage_event_id::text from public.vitals_readings where id = v_g1));
  perform pg_temp.res('real', 'triage.graded is emitted once and flagged shadow', '1|true',
    (select count(*) || '|' || min(payload ->> 'shadow') from public.domain_events where event_type = 'triage.graded' and aggregate_id = v_te));
  v_out := public.record_glucose_triage_result(v_g1, v_green, v_rs);
  perform pg_temp.res('real', 'the same result again creates nothing', 'false', v_out ->> 'created');
  perform pg_temp.res('real', 'and emits no second event', '1', (select count(*)::text from public.domain_events where event_type = 'triage.graded' and aggregate_id = v_te));
  v_out := public.record_glucose_triage_result(v_g1, v_green, v_rs, null, 'new facts');
  perform pg_temp.res('real', 'a regrade with new facts is a new row', 'true', v_out ->> 'created');
  v_out := public.record_glucose_triage_result(v_g2, v_red, v_rs);
  perform pg_temp.res('real', 'a red result emits an urgent event carrying the page action', 'urgent|true',
    (select priority || '|' || (payload -> 'actions' @> '[{"kind":"page_on_call"}]'::jsonb)::text from public.domain_events
      where event_type = 'triage.graded' and aggregate_id = (v_out ->> 'triage_event_id')::uuid));

  begin
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow)
    values (v_org, v_p, 'observation', gen_random_uuid(), 'red', v_rs, 'glucose_care_triage', 1, 'draft', '[]'::jsonb, true);
    v_err := 'accepted';
  exception when check_violation then v_err := 'check'; end;
  perform pg_temp.res('real', 'a red row without page_on_call is refused (INV-05)', 'check', v_err);

  begin perform public.record_glucose_triage_result(v_g1, jsonb_set(v_green, '{ruleSet,version}', '2'), v_rs); v_err := 'accepted';
  exception when sqlstate '22023' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'a result graded with another version is refused', 'refused', v_err);
  begin perform public.record_glucose_triage_result(v_g1, jsonb_set(jsonb_set(v_green, '{ruleSet,code}', '"bp_care_triage"'), '{ruleSet,version}', (select version::text from public.triage_rule_sets where id = v_bp_rs)::jsonb), v_bp_rs); v_err := 'accepted';
  exception when sqlstate '22023' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'the glucose writer refuses a non-glucose rule set', 'refused', v_err);
  begin perform public.record_glucose_triage_result(v_bp, v_green, v_rs); v_err := 'accepted';
  exception when sqlstate '22023' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'the glucose writer refuses a blood pressure reading', 'refused', v_err);
  begin perform public.record_glucose_triage_result(v_g1, jsonb_set(v_green, '{status}', '"recheck_required"'), v_rs); v_err := 'accepted';
  exception when sqlstate '22023' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'there is no recheck status for glucose', 'refused', v_err);
  begin perform public.record_glucose_triage_result(v_g1, jsonb_set(v_green, '{grade}', '"blue"'), v_rs, null, 'x'); v_err := 'accepted';
  exception when sqlstate '22023' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'a graded result needs a real grade', 'refused', v_err);

  select count(*) into v_n from public.triage_events where patient_id = v_p;
  v_out := public.record_glucose_triage_result(v_g1, jsonb_build_object('status', 'rejected', 'reason', 'implausible_reading',
    'ruleSet', jsonb_build_object('code', 'glucose_care_triage', 'version', 1)), v_rs);
  perform pg_temp.res('real', 'a rejected result writes nothing', v_n::text, (select count(*)::text from public.triage_events where patient_id = v_p));

  -- THE regression this separate writer exists for: a glucose result must never resolve a pending BP recheck or close the repeat task.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, v_p, 'blood_pressure', 182, 112, 'manual', now() - interval '30 minutes') returning id into v_bp2;
  insert into public.triage_pending_rechecks (observation_id, organisation_id, patient_id, due_at) values (v_bp2, v_org, v_p, now() + interval '30 minutes');
  insert into public.care_tasks (organisation_id, patient_id, title, owner_role, priority, due_at, source, kind)
    values (v_org, v_p, '', 'patient', 1, now(), 'triage_recheck', 'log_bp');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at)
    values (v_org, v_p, 'glucose', 5.5, 'random', 'manual', now()) returning id into v_g4;
  perform public.record_glucose_triage_result(v_g4, v_green, v_rs, null, 'later');
  perform pg_temp.res('real', 'a glucose result leaves a pending blood pressure recheck pending', 'pending',
    (select state from public.triage_pending_rechecks where observation_id = v_bp2));
  perform pg_temp.res('real', 'and leaves the patient''s repeat-reading task open', 'not_started',
    (select status::text from public.care_tasks where patient_id = v_p and source = 'triage_recheck'));

  -- 4. Shadow downstream, then approved (inside this transaction only)
  perform pg_temp.res('real', 'a shadow glucose event creates no clinical task', '0', public.create_tasks_from_triage_event(v_te)::text);
  perform pg_temp.res('real', 'a shadow red glucose event pages nobody', 'null',
    coalesce(public.create_red_page((select id from public.triage_events where trigger_id = v_g2 limit 1))::text, 'null'));


  -- 5. Sweep: a reading whose event never came
  alter table public.vitals_readings disable trigger vitals_readings_emit_glucose_observation;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at, created_at)
    values (v_org, v_p2, 'glucose', 4.5, 'fasting', 'manual', now() - interval '10 minutes', now() - interval '10 minutes') returning id into v_g6;
  alter table public.vitals_readings enable trigger vitals_readings_emit_glucose_observation;
  perform pg_temp.res('real', 'a reading inserted without its trigger has no event', '0', (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || v_g6));
  perform private.sweep_glucose_observation_events();
  perform private.sweep_glucose_observation_events();
  perform pg_temp.res('real', 'the sweep emits the missing event once', '1', (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || v_g6));
  perform pg_temp.res('real', 'and the sweep is scheduled every ten minutes, not every minute', '7-57/10 * * * *', (select schedule from cron.job where jobname = 'triage-glucose-sweep'));

  -- 6. Grants
  perform pg_temp.res('real', 'the context, the writer and the sweep are not executable by anon or authenticated', 'false',
    (has_function_privilege('anon', 'public.triage_context_for_glucose_observation(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.triage_context_for_glucose_observation(uuid)', 'execute')
     or has_function_privilege('anon', 'public.record_glucose_triage_result(uuid, jsonb, uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.record_glucose_triage_result(uuid, jsonb, uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'private.sweep_glucose_observation_events()', 'execute')
     or has_function_privilege('authenticated', 'private.sweep_glucose_observation_events()', 'execute'))::text);
  perform pg_temp.res('real', 'the service role can run the context and the writer', 'true',
    (has_function_privilege('service_role', 'public.triage_context_for_glucose_observation(uuid)', 'execute')
     and has_function_privilege('service_role', 'public.record_glucose_triage_result(uuid, jsonb, uuid, uuid, text)', 'execute'))::text);

  -- 7. SABOTAGE 1: producer trigger dropped -> the emit check must flip
  drop trigger vitals_readings_emit_glucose_observation on public.vitals_readings;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at)
    values (v_org, v_p2, 'glucose', 8.8, 'random', 'manual', now()) returning id into v_g6;
  perform pg_temp.res('sabotaged', 'a glucose reading emits one observation.recorded event', '1',
    (select count(*)::text from public.domain_events where event_type = 'observation.recorded' and idempotency_key = 'glu:' || v_g6));

  -- SABOTAGE 2: the blood pressure writer, used on a glucose reading, resolves a pending blood pressure recheck
  perform public.record_triage_result(v_g4, jsonb_set(v_green, '{explanationKey}', '"TRI-001"'), v_rs, null, 'wrong writer');
  perform pg_temp.res('sabotaged', 'a glucose result leaves a pending blood pressure recheck pending', 'pending',
    (select state from public.triage_pending_rechecks where observation_id = v_bp2));

  -- Approved path last: an approved row is immutable, so it cannot be undone inside this transaction (the rollback undoes it).
  update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now() where id = v_rs;
  update public.task_types set confirmed_by = v_cmo, confirmed_at = now() where code = 'amber_glucose_review';
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at)
    values (v_org, v_p, 'glucose', 21.0, 'random', 'manual', now()) returning id into v_g5;
  v_amber := jsonb_build_object('status', 'graded', 'grade', 'amber', 'ruleId', 'GL-A3', 'explanationKey', 'GLU-T03',
    'actions', jsonb_build_array(jsonb_build_object('kind', 'show_message', 'code', 'GLU-T03'),
      jsonb_build_object('kind', 'create_task', 'task', 'urgent_glucose_review', 'dueMinutes', 480, 'notifyKey', 'notify.triage.task_created')),
    'matchedRuleIds', '["GL-A3"]'::jsonb, 'taskKey', 'GL-A3:x', 'ruleSet', jsonb_build_object('code', 'glucose_care_triage', 'version', 1));
  v_out := public.record_glucose_triage_result(v_g5, v_amber, v_rs);
  perform pg_temp.res('real', 'a result from the approved glucose rule set is not shadow', 'false', v_out ->> 'shadow');
  v_te := (v_out ->> 'triage_event_id')::uuid;
  -- Free patient (two-tier): an approved urgent amber opens NO clinical task for a doctor. The function is replaced inside this transaction only.
  execute $e$create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select false $f$ $e$;
  perform public.create_tasks_from_triage_event(v_te);
  perform pg_temp.res('real', 'a Free patient''s approved urgent glucose event opens no doctor task', '0',
    (select count(*)::text from public.clinical_tasks where patient_id = v_p and type = 'amber_glucose_review'));
  -- Member: one task, of the glucose type, due in 480 minutes, and a repeat merges into it rather than making a second.
  execute $e$create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$ $e$;
  perform public.create_tasks_from_triage_event(v_te);
  perform public.create_tasks_from_triage_event(v_te);
  perform pg_temp.res('real', 'a Member''s approved urgent glucose event opens one amber_glucose_review task, a repeat merges', '1',
    (select count(*)::text from public.clinical_tasks where patient_id = v_p and type = 'amber_glucose_review'));
  perform pg_temp.res('real', 'the task is for a senior medical officer, tied to the triage event and the rule set version', 'senior_medical_officer|true|1',
    (select min_tier::text || '|' || (triage_event_id = v_te)::text || '|' || rule_set_version from public.clinical_tasks where patient_id = v_p and type = 'amber_glucose_review'));
  -- A red from the approved glucose rule set pages a Member (create_red_page), and the page is tied to the event.
  v_out := public.record_glucose_triage_result(v_g5, jsonb_set(v_red, '{ruleId}', '"GL-R6"'), v_rs, null, 'red later');
  perform pg_temp.res('real', 'a red from the approved glucose rule set pages a Member once', '1',
    (public.create_red_page((v_out ->> 'triage_event_id')::uuid) is not null)::int::text);
  perform pg_temp.res('real', 'and the page row names the triage event', '1',
    (select count(*)::text from public.pages where triage_event_id = (v_out ->> 'triage_event_id')::uuid));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'R2 glucose wiring proof FAILED: %', (select string_agg(check_name || ' => expected [' || expected || '] got [' || coalesce(actual, 'null') || ']', '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed a result', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
