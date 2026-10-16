-- Vitals proof: pulse, SpO2 and temperature readings reach the triage engine in shadow
-- (migrations *_build_vitals_care_triage_v1_draft.sql and *_build_vitals_triage_wiring.sql).
--
--   1. The draft rule set exists unsigned with 15 rules; its task type awaits the CMO.
--   2. A manual or Bluetooth reading emits one observation.recorded event (kind vitals, ids only); urgent when the older classifier says anything but
--      green, normal when green; wearable readings, blood pressure and glucose emit none of the vitals kind; a reading entered in error is not graded.
--   3. triage_context_for_vitals_observation: the value, the age, the patient's own amber line; a blood pressure reading is not found.
--   4. record_vitals_triage_result: shadow while the rule set is a draft, one row per reading, urgent event for red, rejected writes nothing, a result graded
--      with another rule set is refused, and it NEVER touches a pending blood pressure recheck.
--   5. Shadow is respected downstream: no clinical task, no page. Once the rule set is approved (inside this rolled-back transaction only) an amber creates one
--      amber_vitals_review task, and a red pages once.
--   6. The sweep re-emits a reading that lost its event, once; it runs every ten minutes, not every minute.
--   7. Grants: the context, the writer and the sweep are not executable by anon or authenticated.
--   8. SABOTAGE: with the producer trigger dropped the emit check flips; the blood pressure writer used on a vitals reading resolves a pending recheck.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'vt-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'VT ' || p_label, (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;

create or replace function pg_temp.res(p_phase text, p_check text, p_expected text, p_actual text) returns void
language sql as $f$ insert into results values (p_phase, p_check, p_expected, p_actual) $f$;

do $$
declare
  v_org uuid; v_p uuid; v_p2 uuid; v_p3 uuid; v_cmo uuid; v_admin uuid;
  v_rs uuid; v_bp_rs uuid;
  v_pu1 uuid; v_pu2 uuid; v_ox1 uuid; v_ox2 uuid; v_te1 uuid; v_te2 uuid; v_w uuid; v_bp uuid; v_bp2 uuid; v_g uuid; v_dev uuid; v_ee uuid; v_ox3 uuid; v_sw uuid; v_ox4 uuid;
  v_ctx jsonb; v_out jsonb; v_te uuid; v_n integer; v_err text; v_pending_before integer;
  v_green jsonb; v_red jsonb; v_amber jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_p3 := pg_temp.mkuser(v_org, 'patient3', 'patient');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by)
  values (v_cmo, v_org, 'VT CMO', 'chief_medical_officer', true, now(), 'employed', true, v_admin) on conflict do nothing;
  select id into v_rs from public.triage_rule_sets where code = 'vitals_care_triage' and version = 1;
  select id into v_bp_rs from public.triage_rule_sets where code = 'bp_care_triage' order by version desc limit 1;

  -- 1. The draft
  perform pg_temp.res('real', 'the vitals rule set exists and is a draft', 'draft', (select status from public.triage_rule_sets where id = v_rs));
  perform pg_temp.res('real', 'it has 15 rules, five for each metric', '15|5|5|5',
    (select jsonb_array_length(rules -> 'rules')::text from public.triage_rule_sets where id = v_rs) || '|' ||
    (select count(*)::text from public.triage_rule_sets t, jsonb_array_elements(t.rules -> 'rules') r where t.id = v_rs and r -> 'triggers' ->> 0 = 'pulse') || '|' ||
    (select count(*)::text from public.triage_rule_sets t, jsonb_array_elements(t.rules -> 'rules') r where t.id = v_rs and r -> 'triggers' ->> 0 = 'spo2') || '|' ||
    (select count(*)::text from public.triage_rule_sets t, jsonb_array_elements(t.rules -> 'rules') r where t.id = v_rs and r -> 'triggers' ->> 0 = 'temperature'));
  perform pg_temp.res('real', 'nothing about it is signed', 'null|null', coalesce((select approved_by::text from public.triage_rule_sets where id = v_rs), 'null') || '|' || coalesce((select approved_at::text from public.triage_rule_sets where id = v_rs), 'null'));
  perform pg_temp.res('real', 'its task type is active, creatable and awaits the CMO', 'true|true|true|null',
    (select is_active::text || '|' || creatable::text || '|' || needs_confirmation::text || '|' || coalesce(confirmed_at::text, 'null') from public.task_types where code = 'amber_vitals_review'));

  v_green := jsonb_build_object('status', 'graded', 'grade', 'green', 'ruleId', 'VT-PU5', 'explanationKey', 'VIT-T02',
    'actions', '[{"kind":"show_message","code":"VIT-T02"}]'::jsonb, 'matchedRuleIds', '["VT-PU5"]'::jsonb, 'taskKey', null,
    'ruleSet', jsonb_build_object('code', 'vitals_care_triage', 'version', 1));
  v_red := jsonb_build_object('status', 'graded', 'grade', 'red', 'ruleId', 'VT-OX1', 'explanationKey', 'VIT-E01',
    'actions', '[{"kind":"show_emergency_guidance","code":"VIT-E01"},{"kind":"page_on_call"}]'::jsonb,
    'matchedRuleIds', '["VT-OX1"]'::jsonb, 'taskKey', null, 'ruleSet', jsonb_build_object('code', 'vitals_care_triage', 'version', 1));

  -- 2. Producer
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at) values (v_org, v_p, 'pulse', 72, 'manual', now() - interval '2 hours') returning id into v_pu1;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at) values (v_org, v_p, 'pulse', 160, 'manual', now() - interval '1 hour') returning id into v_pu2;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_p, 'spo2', 97, 'device', now() - interval '3 hours') returning id into v_ox1;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_p, 'spo2', 88, 'manual', now() - interval '30 minutes') returning id into v_ox2;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, temperature_c, source, taken_at) values (v_org, v_p, 'temperature', 36.8, 'manual', now() - interval '4 hours') returning id into v_te1;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, temperature_c, source, taken_at) values (v_org, v_p, 'temperature', 40.4, 'manual', now() - interval '20 minutes') returning id into v_te2;
  perform pg_temp.res('real', 'each pulse, SpO2 and temperature reading emits exactly one observation.recorded event', '6',
    (select count(*)::text from public.domain_events where event_type = 'observation.recorded' and idempotency_key in ('vit:' || v_pu1, 'vit:' || v_pu2, 'vit:' || v_ox1, 'vit:' || v_ox2, 'vit:' || v_te1, 'vit:' || v_te2)));
  perform pg_temp.res('real', 'the event says kind vitals and carries the reading id only', 'vitals|false|true',
    (select (payload ->> 'kind') || '|' || (payload ? 'pulse_bpm' or payload ? 'value' or payload ? 'spo2_pct')::text || '|' || ((payload ->> 'observation_id')::uuid = v_pu2)::text from public.domain_events where idempotency_key = 'vit:' || v_pu2));
  perform pg_temp.res('real', 'a dangerous reading is urgent, a normal one is not', 'urgent,urgent,urgent|normal,normal,normal',
    (select string_agg(priority, ',' order by idempotency_key) from public.domain_events where idempotency_key in ('vit:' || v_pu2, 'vit:' || v_ox2, 'vit:' || v_te2)) || '|' ||
    (select string_agg(priority, ',' order by idempotency_key) from public.domain_events where idempotency_key in ('vit:' || v_pu1, 'vit:' || v_ox1, 'vit:' || v_te1)));
  perform pg_temp.res('real', 'the triage subscriber gets a delivery', '1',
    (select count(*)::text from public.domain_event_deliveries d join public.domain_events e on e.id = d.event_id where e.idempotency_key = 'vit:' || v_pu2 and d.subscriber_key = 'triage.grade_observation'));
  perform pg_temp.res('real', 'the event is marked is_test for a test patient', 'true', (select is_test::text from public.domain_events where idempotency_key = 'vit:' || v_pu2));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at) values (v_org, v_p3, 'pulse', 170, 'wearable', now()) returning id into v_w;
  perform pg_temp.res('real', 'a wearable reading is not graded by this engine (no event)', '0', (select count(*)::text from public.domain_events where idempotency_key = 'vit:' || v_w));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at) values (v_org, v_p3, 'pulse', 58, 'device', now()) returning id into v_dev;
  perform pg_temp.res('real', 'a Bluetooth device reading is graded (one event)', '1', (select count(*)::text from public.domain_events where idempotency_key = 'vit:' || v_dev));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at) values (v_org, v_p, 'blood_pressure', 118, 76, 'device', now() - interval '3 hours') returning id into v_bp;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at) values (v_org, v_p, 'glucose', 6.0, 'fasting', 'manual', now()) returning id into v_g;
  perform pg_temp.res('real', 'blood pressure and glucose readings emit no vitals event', '0',
    (select count(*)::text from public.domain_events where idempotency_key in ('vit:' || v_bp, 'vit:' || v_g)));
  perform pg_temp.res('real', 'the blood pressure and glucose readings still emit their own events', '1|1',
    (select count(*)::text from public.domain_events where idempotency_key = 'bp:' || v_bp) || '|' || (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || v_g));

  -- 3. Context
  v_ctx := public.triage_context_for_vitals_observation(v_pu2);
  perform pg_temp.res('real', 'context finds the pulse reading', 'true|pulse|160|50',
    (v_ctx ->> 'found') || '|' || (v_ctx #>> '{input,trigger,type}') || '|' || (v_ctx #>> '{input,trigger,reading,value}') || '|' || (v_ctx #>> '{input,ageYears}'));
  perform pg_temp.res('real', 'the basis is empty (nothing but the reading decides the grade)', '', v_ctx ->> 'basis');
  perform pg_temp.res('real', 'no personal line is sent for a pulse or for a patient with none', 'false', ((v_ctx -> 'input') ? 'personalAmberLine')::text);
  insert into public.patient_spo2_targets (organisation_id, patient_id, amber_threshold_pct, rationale) values (v_org, v_p, 96, 'proof');
  insert into public.patient_temperature_targets (organisation_id, patient_id, amber_threshold_c, rationale) values (v_org, v_p, 37.5, 'proof');
  perform pg_temp.res('real', 'the patient''s own SpO2 line and temperature line are carried for their own metric', '96|37.5|false',
    (public.triage_context_for_vitals_observation(v_ox1) #>> '{input,personalAmberLine}') || '|' || (public.triage_context_for_vitals_observation(v_te1) #>> '{input,personalAmberLine}') || '|' ||
    ((public.triage_context_for_vitals_observation(v_pu1) -> 'input') ? 'personalAmberLine')::text);
  perform pg_temp.res('real', 'context for a blood pressure or glucose reading is not found', 'false|false',
    (public.triage_context_for_vitals_observation(v_bp) ->> 'found') || '|' || (public.triage_context_for_vitals_observation(v_g) ->> 'found'));
  perform pg_temp.res('real', 'context for an unknown id is not found', 'false', public.triage_context_for_vitals_observation(gen_random_uuid()) ->> 'found');
  update public.profiles set date_of_birth = null where id = v_p3;
  perform pg_temp.res('real', 'a patient with no date of birth has a context without an age key (the engine reads absent as not recorded)', 'true|false',
    ((public.triage_context_for_vitals_observation(v_dev) ->> 'found') = 'true')::text || '|' || ((public.triage_context_for_vitals_observation(v_dev) -> 'input') ? 'ageYears')::text);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_p3, 'spo2', 85, 'manual', now()) returning id into v_ee;
  perform set_config('request.jwt.claim.sub', v_p3::text, true);
  perform public.correct_clinical_value('vitals_readings', v_ee, 'entered_in_error', 'typed by mistake in the proof');
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.res('real', 'a reading marked entered in error is not graded', 'false', public.triage_context_for_vitals_observation(v_ee) ->> 'found');

  -- 4. Writer (the rule set is a draft: shadow)
  select count(*) into v_pending_before from public.triage_pending_rechecks;
  v_out := public.record_vitals_triage_result(v_pu1, v_green, v_rs);
  perform pg_temp.res('real', 'a green result is recorded in shadow', 'graded|true|true', (v_out ->> 'status') || '|' || (v_out ->> 'created') || '|' || (v_out ->> 'shadow'));
  v_te := (v_out ->> 'triage_event_id')::uuid;
  perform pg_temp.res('real', 'the row records the vitals rule set id, version and status', v_rs::text || '|1|draft|vitals_care_triage',
    (select rule_set_id::text || '|' || rule_set_version || '|' || rule_set_status || '|' || rule_set_code from public.triage_events where id = v_te));
  perform pg_temp.res('real', 'the reading is linked to its result', v_te::text, (select triage_event_id::text from public.vitals_readings where id = v_pu1));
  perform pg_temp.res('real', 'triage.graded is emitted once and flagged shadow', '1|true',
    (select count(*) || '|' || min(payload ->> 'shadow') from public.domain_events where event_type = 'triage.graded' and aggregate_id = v_te));
  v_out := public.record_vitals_triage_result(v_pu1, v_green, v_rs);
  perform pg_temp.res('real', 'the same result again creates nothing and emits nothing more', 'false|1',
    (v_out ->> 'created') || '|' || (select count(*)::text from public.domain_events where event_type = 'triage.graded' and aggregate_id = v_te));
  v_out := public.record_vitals_triage_result(v_ox2, v_red, v_rs);
  perform pg_temp.res('real', 'a red result emits an urgent event carrying the page action', 'urgent|true',
    (select priority || '|' || (payload -> 'actions' @> '[{"kind":"page_on_call"}]'::jsonb)::text from public.domain_events
      where event_type = 'triage.graded' and aggregate_id = (v_out ->> 'triage_event_id')::uuid));
  begin
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow)
    values (v_org, v_p, 'observation', gen_random_uuid(), 'red', v_rs, 'vitals_care_triage', 1, 'draft', '[]'::jsonb, true);
    v_err := 'accepted';
  exception when check_violation then v_err := 'check'; end;
  perform pg_temp.res('real', 'a red row without page_on_call is refused (INV-05)', 'check', v_err);
  begin perform public.record_vitals_triage_result(v_pu1, jsonb_set(v_green, '{ruleSet,version}', '2'), v_rs); v_err := 'accepted';
  exception when sqlstate '22023' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'a result graded with another version is refused', 'refused', v_err);
  begin perform public.record_vitals_triage_result(v_pu1, jsonb_set(jsonb_set(v_green, '{ruleSet,code}', '"bp_care_triage"'), '{ruleSet,version}', (select version::text from public.triage_rule_sets where id = v_bp_rs)::jsonb), v_bp_rs); v_err := 'accepted';
  exception when sqlstate '22023' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'the vitals writer refuses another rule set', 'refused', v_err);
  begin perform public.record_vitals_triage_result(v_bp, v_green, v_rs); v_err := 'accepted';
  exception when sqlstate '22023' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'the vitals writer refuses a blood pressure reading', 'refused', v_err);
  begin perform public.record_vitals_triage_result(v_pu1, jsonb_set(v_green, '{status}', '"recheck_required"'), v_rs); v_err := 'accepted';
  exception when sqlstate '22023' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'there is no recheck status for these vitals', 'refused', v_err);
  begin perform public.record_vitals_triage_result(v_pu1, jsonb_set(v_green, '{grade}', '"blue"'), v_rs, null, 'x'); v_err := 'accepted';
  exception when sqlstate '22023' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'a graded result needs a real grade', 'refused', v_err);
  select count(*) into v_n from public.triage_events where patient_id = v_p;
  v_out := public.record_vitals_triage_result(v_te1, jsonb_build_object('status', 'rejected', 'reason', 'implausible_reading', 'ruleSet', jsonb_build_object('code', 'vitals_care_triage', 'version', 1)), v_rs);
  perform pg_temp.res('real', 'a rejected result writes nothing', v_n::text, (select count(*)::text from public.triage_events where patient_id = v_p));

  -- THE regression the separate writer exists for: a vitals result must never resolve a pending BP recheck.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at) values (v_org, v_p, 'blood_pressure', 182, 112, 'manual', now() - interval '30 minutes') returning id into v_bp2;
  insert into public.triage_pending_rechecks (observation_id, organisation_id, patient_id, due_at) values (v_bp2, v_org, v_p, now() + interval '30 minutes');
  insert into public.care_tasks (organisation_id, patient_id, title, owner_role, priority, due_at, source, kind) values (v_org, v_p, '', 'patient', 1, now(), 'triage_recheck', 'log_bp');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at) values (v_org, v_p, 'pulse', 66, 'manual', now()) returning id into v_pu2;
  perform public.record_vitals_triage_result(v_pu2, v_green, v_rs, null, 'later');
  perform pg_temp.res('real', 'a vitals result leaves a pending blood pressure recheck pending', 'pending', (select state from public.triage_pending_rechecks where observation_id = v_bp2));
  perform pg_temp.res('real', 'and leaves the patient''s repeat-reading task open', 'not_started', (select status::text from public.care_tasks where patient_id = v_p and source = 'triage_recheck'));

  -- 5. Shadow downstream
  perform pg_temp.res('real', 'a shadow vitals event creates no clinical task', '0', public.create_tasks_from_triage_event(v_te)::text);
  perform pg_temp.res('real', 'a shadow red vitals event pages nobody', 'null',
    coalesce(public.create_red_page((select id from public.triage_events where trigger_id = v_ox2 limit 1))::text, 'null'));

  -- 6. Sweep
  alter table public.vitals_readings disable trigger vitals_readings_emit_vitals_observation;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, temperature_c, source, taken_at, created_at) values (v_org, v_p2, 'temperature', 38.6, 'manual', now() - interval '10 minutes', now() - interval '10 minutes') returning id into v_sw;
  alter table public.vitals_readings enable trigger vitals_readings_emit_vitals_observation;
  perform pg_temp.res('real', 'a reading inserted without its trigger has no event', '0', (select count(*)::text from public.domain_events where idempotency_key = 'vit:' || v_sw));
  perform private.sweep_vitals_observation_events();
  perform private.sweep_vitals_observation_events();
  perform pg_temp.res('real', 'the sweep emits the missing event once', '1', (select count(*)::text from public.domain_events where idempotency_key = 'vit:' || v_sw));
  perform pg_temp.res('real', 'the sweep leaves a wearable reading alone', '0', (select count(*)::text from public.domain_events where idempotency_key = 'vit:' || v_w));
  perform pg_temp.res('real', 'and the sweep is scheduled every ten minutes, staggered, not every minute', '9-59/10 * * * *', (select schedule from cron.job where jobname = 'triage-vitals-sweep'));

  -- 7. Grants
  perform pg_temp.res('real', 'the context, the writer, the producer and the sweep are not executable by anon or authenticated', 'false',
    (has_function_privilege('anon', 'public.triage_context_for_vitals_observation(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.triage_context_for_vitals_observation(uuid)', 'execute')
     or has_function_privilege('anon', 'public.record_vitals_triage_result(uuid, jsonb, uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.record_vitals_triage_result(uuid, jsonb, uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'private.sweep_vitals_observation_events()', 'execute')
     or has_function_privilege('authenticated', 'private.sweep_vitals_observation_events()', 'execute')
     or has_function_privilege('anon', 'private.emit_vitals_observation_recorded()', 'execute')
     or has_function_privilege('authenticated', 'private.emit_vitals_observation_recorded()', 'execute'))::text);
  perform pg_temp.res('real', 'the service role can run the context and the writer', 'true',
    (has_function_privilege('service_role', 'public.triage_context_for_vitals_observation(uuid)', 'execute')
     and has_function_privilege('service_role', 'public.record_vitals_triage_result(uuid, jsonb, uuid, uuid, text)', 'execute'))::text);

  -- 8. SABOTAGE 1: the blood pressure writer, used on a vitals reading, resolves a pending blood pressure recheck
  perform public.record_triage_result(v_pu2, jsonb_set(v_green, '{explanationKey}', '"TRI-001"'), v_rs, null, 'wrong writer');
  perform pg_temp.res('sabotaged', 'a vitals result leaves a pending blood pressure recheck pending', 'pending', (select state from public.triage_pending_rechecks where observation_id = v_bp2));

  -- SABOTAGE 2: producer trigger dropped -> the emit check must flip
  drop trigger vitals_readings_emit_vitals_observation on public.vitals_readings;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_p2, 'spo2', 91, 'manual', now()) returning id into v_ox3;
  perform pg_temp.res('sabotaged', 'each pulse, SpO2 and temperature reading emits exactly one observation.recorded event', '1',
    (select count(*)::text from public.domain_events where event_type = 'observation.recorded' and idempotency_key = 'vit:' || v_ox3));

  -- Approved path last: an approved row is immutable, so it cannot be undone inside this transaction (the rollback undoes it).
  update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now() where id = v_rs;
  update public.task_types set confirmed_by = v_cmo, confirmed_at = now() where code = 'amber_vitals_review';
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_p, 'spo2', 94, 'manual', now()) returning id into v_ox4;
  v_amber := jsonb_build_object('status', 'graded', 'grade', 'amber', 'ruleId', 'VT-OX3', 'explanationKey', 'VIT-T01',
    'actions', jsonb_build_array(jsonb_build_object('kind', 'show_message', 'code', 'VIT-T01'),
      jsonb_build_object('kind', 'create_task', 'task', 'amber_vitals_review', 'dueMinutes', 4320, 'notifyKey', 'notify.triage.task_created')),
    'matchedRuleIds', '["VT-OX3"]'::jsonb, 'taskKey', 'VT-OX3:2026-W42', 'ruleSet', jsonb_build_object('code', 'vitals_care_triage', 'version', 1));
  v_out := public.record_vitals_triage_result(v_ox4, v_amber, v_rs);
  perform pg_temp.res('real', 'a result from the approved vitals rule set is not shadow', 'false', v_out ->> 'shadow');
  v_te := (v_out ->> 'triage_event_id')::uuid;
  execute $e$create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select false $f$ $e$;
  perform public.create_tasks_from_triage_event(v_te);
  perform pg_temp.res('real', 'a Free patient''s approved amber vitals event opens no doctor task', '0', (select count(*)::text from public.clinical_tasks where patient_id = v_p and type = 'amber_vitals_review'));
  execute $e$create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$ $e$;
  perform public.create_tasks_from_triage_event(v_te);
  perform public.create_tasks_from_triage_event(v_te);
  perform pg_temp.res('real', 'a Member''s approved amber vitals event opens one amber_vitals_review task, a repeat merges', '1',
    (select count(*)::text from public.clinical_tasks where patient_id = v_p and type = 'amber_vitals_review'));
  perform pg_temp.res('real', 'the task is for a senior medical officer and tied to the event and the rule set version', 'senior_medical_officer|true|1',
    (select min_tier::text || '|' || (triage_event_id = v_te)::text || '|' || rule_set_version from public.clinical_tasks where patient_id = v_p and type = 'amber_vitals_review'));
  v_out := public.record_vitals_triage_result(v_ox4, jsonb_set(v_red, '{ruleId}', '"VT-OX2"'), v_rs, null, 'red later');
  perform pg_temp.res('real', 'a red from the approved vitals rule set pages a Member once, and the page names the event', '1|1',
    (public.create_red_page((v_out ->> 'triage_event_id')::uuid) is not null)::int::text || '|' || (select count(*)::text from public.pages where triage_event_id = (v_out ->> 'triage_event_id')::uuid));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'vitals wiring proof FAILED: %', (select string_agg(check_name || ' => expected [' || expected || '] got [' || coalesce(actual, 'null') || ']', '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed a result', v_caught; end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then case when expected is distinct from actual then 'PASS (caught)' else 'FAIL' end
            else case when expected = actual then 'PASS' else 'FAIL' end end as result
  from results order by phase desc, check_name;
rollback;
