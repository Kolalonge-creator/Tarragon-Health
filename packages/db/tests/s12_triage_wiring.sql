-- S12 proof: triage wiring (migration *_s12_triage_events_and_wiring.sql).
--
--   1. A blood pressure reading emits one observation.recorded event (and a delivery for the triage
--      subscriber); other vitals emit none; a red-flag symptom just after a reading regrades it.
--   2. triage_context_for_observation: the reading, nearby symptoms, history, target, the repeat state.
--   3. record_triage_result: green/amber/red rows, shadow while the rule set is a draft, not shadow once
--      approved, duplicate suppression, urgent event for red, red without page_on_call refused,
--      a result graded with a different rule set refused, rejected writes nothing.
--   4. Recheck: a pending row and ONE repeat task for the patient; a graded repeat resolves both;
--      the sweep emits one timed_out event once; the sweep re-emits a reading that lost its event.
--   5. RLS and grants: a patient sees only their own results; another patient, a clinician and anon see
--      none; admin sees all; nobody signed in writes; the functions are service role only; the pending
--      table has no API access; the table is append only.
--   6. SABOTAGE: with the append-only trigger dropped a result can be edited, proving check 5 can fail.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's12-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S12 ' || p_label, (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;

create or replace function pg_temp.res(p_check text, p_expected text, p_actual text) returns void
language sql as $f$ insert into results values ('real', p_check, p_expected, p_actual) $f$;

do $$
declare
  v_org uuid; v_p uuid; v_p2 uuid; v_admin uuid; v_clin uuid; v_cmo uuid;
  v_draft uuid; v_appr uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_r5 uuid; v_sym uuid;
  v_ctx jsonb; v_out jsonb; v_te uuid; v_n integer; v_err text;
  v_green jsonb;
  v_red jsonb;
  v_recheck jsonb;
  v_ev uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type)
  values (v_cmo, v_org, 'S12 CMO', 'chief_medical_officer', true, now(), 'employed') on conflict do nothing;

  select id into v_draft from public.triage_rule_sets where code = 'bp_care_triage' and version = 1;
  v_green := jsonb_build_object('status', 'graded', 'grade', 'green', 'ruleId', 'BP-G1', 'explanationKey', 'TRI-001',
    'actions', '[{"kind":"show_message","code":"TRI-001"}]'::jsonb, 'matchedRuleIds', '["BP-G1"]'::jsonb, 'taskKey', null,
    'ruleSet', jsonb_build_object('code', 'bp_care_triage', 'version', 1));
  v_red := jsonb_build_object('status', 'graded', 'grade', 'red', 'ruleId', 'BP-R1', 'explanationKey', 'EMG-001',
    'actions', '[{"kind":"show_emergency_guidance","code":"EMG-001"},{"kind":"page_on_call"}]'::jsonb,
    'matchedRuleIds', '["BP-R1"]'::jsonb, 'taskKey', null, 'ruleSet', jsonb_build_object('code', 'bp_care_triage', 'version', 1));
  v_recheck := jsonb_build_object('status', 'recheck_required', 'grade', null, 'ruleId', 'BP-A1', 'explanationKey', 'TRI-005',
    'actions', '[]'::jsonb, 'matchedRuleIds', '["BP-A1"]'::jsonb, 'recheck', jsonb_build_object('afterMinutes', 5, 'windowMinutes', 15, 'waitMinutes', 5),
    'ruleSet', jsonb_build_object('code', 'bp_care_triage', 'version', 1));

  -- 1. Producers
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, created_at)
    values (v_org, v_p, 'blood_pressure', 118, 76, 'device', now() - interval '3 days', now() - interval '3 days') returning id into v_r1;
  perform pg_temp.res('bp reading emits one observation.recorded', '1',
    (select count(*)::text from public.domain_events where event_type = 'observation.recorded' and idempotency_key = 'bp:' || v_r1));
  perform pg_temp.res('the triage subscriber gets a delivery', '1',
    (select count(*)::text from public.domain_event_deliveries d join public.domain_events e on e.id = d.event_id
      where e.idempotency_key = 'bp:' || v_r1 and d.subscriber_key = 'triage.grade_observation'));
  perform pg_temp.res('the event carries ids only', 'false',
    (select (payload ? 'systolic' or payload ? 'diastolic')::text from public.domain_events where idempotency_key = 'bp:' || v_r1));
  perform pg_temp.res('the event is marked is_test for a test patient', 'true',
    (select is_test::text from public.domain_events where idempotency_key = 'bp:' || v_r1));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at)
    values (v_org, v_p, 'pulse', 72, 'manual', now());
  perform pg_temp.res('a pulse reading emits nothing', '1',
    (select count(*)::text from public.domain_events where event_type = 'observation.recorded' and patient_id = v_p));

  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, v_p, 'blood_pressure', 150, 95, 'manual', now()) returning id into v_r2;
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity)
    values (v_org, v_p, 'severe_headache', 3) returning id into v_sym;
  perform pg_temp.res('a red-flag symptom after a reading regrades it', '1',
    (select count(*)::text from public.domain_events where idempotency_key = 'bp:' || v_r2 || ':sym:' || v_sym));

  -- 2. Context
  v_ctx := public.triage_context_for_observation(v_r2);
  perform pg_temp.res('context finds the reading', 'true', (v_ctx ->> 'found'));
  perform pg_temp.res('context reading systolic', '150', (v_ctx #>> '{input,trigger,reading,systolic}'));
  perform pg_temp.res('context includes the nearby symptom', 'severe_headache', (v_ctx #>> '{input,trigger,symptoms,0}'));
  perform pg_temp.res('context history holds the earlier reading only', '1', (jsonb_array_length(v_ctx #> '{input,history}'))::text);
  perform pg_temp.res('context has a target', 'true', ((v_ctx #> '{input,target,systolic}') is not null)::text);
  perform pg_temp.res('context is not pregnant', 'false', (v_ctx #>> '{input,pregnant}'));
  perform pg_temp.res('context age', '50', (v_ctx #>> '{input,ageYears}'));
  perform pg_temp.res('context has no recheck', 'null', coalesce(v_ctx #>> '{input,trigger,recheck}', 'null'));
  perform pg_temp.res('context for a pulse reading is not found', 'false',
    (public.triage_context_for_observation((select id from public.vitals_readings where patient_id = v_p and vital_type::text = 'pulse')) ->> 'found'));
  perform pg_temp.res('timed_out is passed through', 'timed_out',
    (public.triage_context_for_observation(v_r2, 'timed_out') #>> '{input,trigger,recheck,kind}'));

  -- 3. Recording results (draft rule set: shadow)
  v_out := public.record_triage_result(v_r1, v_green, v_draft);
  perform pg_temp.res('a green result is recorded', 'graded|true|true', (v_out ->> 'status') || '|' || (v_out ->> 'created') || '|' || (v_out ->> 'shadow'));
  v_te := (v_out ->> 'triage_event_id')::uuid;
  perform pg_temp.res('the row records the rule set id and version', v_draft::text || '|1|draft',
    (select rule_set_id::text || '|' || rule_set_version || '|' || rule_set_status from public.triage_events where id = v_te));
  perform pg_temp.res('the reading is linked to its result', v_te::text, (select triage_event_id::text from public.vitals_readings where id = v_r1));
  perform pg_temp.res('triage.graded is emitted once, normal priority', '1|normal',
    (select count(*) || '|' || min(priority) from public.domain_events where event_type = 'triage.graded' and aggregate_id = v_te));
  perform pg_temp.res('triage.graded is flagged shadow', 'true',
    (select payload ->> 'shadow' from public.domain_events where event_type = 'triage.graded' and aggregate_id = v_te));
  v_out := public.record_triage_result(v_r1, v_green, v_draft);
  perform pg_temp.res('a repeat of the same result creates nothing', 'false', (v_out ->> 'created'));
  perform pg_temp.res('and emits no second event', '1',
    (select count(*)::text from public.domain_events where event_type = 'triage.graded' and aggregate_id = v_te));

  v_out := public.record_triage_result(v_r2, v_red, v_draft);
  perform pg_temp.res('a red result emits an urgent event', 'urgent',
    (select priority from public.domain_events where event_type = 'triage.graded' and aggregate_id = (v_out ->> 'triage_event_id')::uuid));
  perform pg_temp.res('the red event carries the page action', 'true',
    (select (payload -> 'actions' @> '[{"kind":"page_on_call"}]'::jsonb)::text from public.domain_events
      where event_type = 'triage.graded' and aggregate_id = (v_out ->> 'triage_event_id')::uuid));

  begin
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow)
    values (v_org, v_p, 'observation', gen_random_uuid(), 'red', v_draft, 'bp_care_triage', 1, 'draft', '[]'::jsonb, true);
    v_err := 'accepted';
  exception when check_violation then v_err := 'check'; end;
  perform pg_temp.res('a red row without page_on_call is refused (INV-05)', 'check', v_err);

  begin
    perform public.record_triage_result(v_r1, jsonb_set(v_green, '{ruleSet,version}', '2'), v_draft);
    v_err := 'accepted';
  exception when sqlstate '22023' then v_err := 'refused'; end;
  perform pg_temp.res('a result graded with another rule set version is refused', 'refused', v_err);

  select count(*) into v_n from public.triage_events where patient_id = v_p;
  v_out := public.record_triage_result(v_r1, jsonb_build_object('status', 'rejected', 'reason', 'implausible_reading',
    'ruleSet', jsonb_build_object('code', 'bp_care_triage', 'version', 1)), v_draft);
  perform pg_temp.res('a rejected result writes nothing', v_n::text, (select count(*)::text from public.triage_events where patient_id = v_p));

  -- Approved rule set: not shadow
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at)
    values ('s12_probe', 1, 'approved', jsonb_build_object('code', 's12_probe', 'version', 1), v_cmo, now()) returning id into v_appr;
  v_out := public.record_triage_result(v_r1, jsonb_set(jsonb_set(v_green, '{ruleSet,code}', '"s12_probe"'), '{ruleSet,version}', '1'), v_appr);
  perform pg_temp.res('a result from an approved rule set is not shadow', 'false', (v_out ->> 'shadow'));

  -- 4. Recheck
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, v_p2, 'blood_pressure', 182, 112, 'manual', now()) returning id into v_r3;
  v_out := public.record_triage_result(v_r3, v_recheck, v_draft);
  perform pg_temp.res('a first elevated reading is pending', '1',
    (select count(*)::text from public.triage_pending_rechecks where observation_id = v_r3 and state = 'pending'));
  perform pg_temp.res('and the patient gets one repeat task with no clinical title', '1|log_bp|patient|',
    (select count(*) || '|' || min(kind) || '|' || min(owner_role::text) || '|' || min(title) from public.care_tasks where patient_id = v_p2 and source = 'triage_recheck'));
  perform public.record_triage_result(v_r3, v_recheck, v_draft);
  perform pg_temp.res('asking again does not duplicate the task', '1',
    (select count(*)::text from public.care_tasks where patient_id = v_p2 and source = 'triage_recheck'));
  perform pg_temp.res('the patient view exposes source', '1',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'patient_tasks' and column_name = 'source'));
  update public.triage_pending_rechecks set due_at = now() - interval '1 minute' where observation_id = v_r3;
  perform private.sweep_triage_rechecks();
  perform private.sweep_triage_rechecks();
  perform pg_temp.res('the sweep emits one timed_out event, once', '1',
    (select count(*)::text from public.domain_events where idempotency_key = 'bp:' || v_r3 || ':timeout'));
  perform pg_temp.res('the timed_out event names the recheck', 'timed_out',
    (select payload ->> 'recheck' from public.domain_events where idempotency_key = 'bp:' || v_r3 || ':timeout'));
  v_out := public.record_triage_result(v_r3, jsonb_set(jsonb_set(v_red, '{grade}', '"amber"'), '{actions}', '[]'::jsonb), v_draft);
  perform pg_temp.res('a graded timed-out reading closes the pending row', 'timed_out',
    (select state from public.triage_pending_rechecks where observation_id = v_r3));
  perform pg_temp.res('and completes the repeat task', 'completed',
    (select min(status::text) from public.care_tasks where patient_id = v_p2 and source = 'triage_recheck'));

  -- A repeat that arrives resolves the first reading
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, v_p2, 'blood_pressure', 181, 111, 'device', now() - interval '20 minutes') returning id into v_r4;
  perform public.record_triage_result(v_r4, v_recheck, v_draft);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, v_p2, 'blood_pressure', 181, 111, 'device', now() - interval '15 minutes') returning id into v_r5;
  v_ctx := public.triage_context_for_observation(v_r5);
  perform pg_temp.res('a reading inside the window of a pending one is a repeat', 'repeat',
    (v_ctx #>> '{input,trigger,recheck,kind}'));
  perform pg_temp.res('with the minutes since the first', '5.00', (v_ctx #>> '{input,trigger,recheck,minutesSincePrevious}'));
  perform public.record_triage_result(v_r5, jsonb_set(jsonb_set(v_red, '{grade}', '"amber"'), '{actions}', '[]'::jsonb), v_draft);
  perform pg_temp.res('a graded repeat resolves the earlier pending reading', 'resolved',
    (select state from public.triage_pending_rechecks where observation_id = v_r4));

  -- Gap catch-up: a reading whose event never happened is re-emitted
  alter table public.vitals_readings disable trigger vitals_readings_emit_observation_recorded;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, created_at)
    values (v_org, v_p, 'blood_pressure', 130, 80, 'manual', now() - interval '5 minutes', now() - interval '5 minutes') returning id into v_ev;
  alter table public.vitals_readings enable trigger vitals_readings_emit_observation_recorded;
  perform pg_temp.res('before the sweep the lost reading has no event', '0',
    (select count(*)::text from public.domain_events where idempotency_key = 'bp:' || v_ev));
  perform private.sweep_triage_rechecks();
  perform pg_temp.res('the sweep re-emits it', '1',
    (select count(*)::text from public.domain_events where idempotency_key = 'bp:' || v_ev));

  -- 5. RLS and grants
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  select count(*) into v_n from public.triage_events;
  perform pg_temp.res('a patient sees only their own results (rows)', 'true', (v_n > 0 and v_n = (select count(*) from public.triage_events where patient_id = v_p))::text);
  begin
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow)
    values (v_org, v_p, 'observation', gen_random_uuid(), 'green', v_draft, 'bp_care_triage', 1, 'draft', true);
    v_err := 'accepted';
  exception when insufficient_privilege then v_err := 'denied'; end;
  perform pg_temp.res('a patient cannot write a result', 'denied', v_err);
  begin
    perform 1 from public.triage_pending_rechecks;
    v_err := 'accepted';
  exception when insufficient_privilege then v_err := 'denied'; end;
  perform pg_temp.res('a patient cannot read the pending table', 'denied', v_err);
  begin
    perform public.record_triage_result(v_r1, v_green, v_draft);
    v_err := 'accepted';
  exception when insufficient_privilege then v_err := 'denied'; end;
  perform pg_temp.res('a patient cannot call record_triage_result', 'denied', v_err);
  begin
    update public.vitals_readings set triage_event_id = v_te where id = v_r2;
    v_err := 'accepted';
  exception when insufficient_privilege then v_err := 'denied'; end;
  perform pg_temp.res('a patient cannot relink a reading to another result (INV-16)', 'denied', v_err);
  select count(*) into v_n from public.patient_tasks where source = 'triage_recheck';
  perform pg_temp.res('a patient sees no other patient repeat task', '0', v_n::text);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.res('another patient does not see the first patient results', '0',
    (select count(*)::text from public.triage_events where patient_id = v_p));
  perform pg_temp.res('a patient sees their own repeat task row on the view', 'true',
    ((select count(*) from public.patient_tasks where source = 'triage_recheck') >= 1)::text);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.res('a clinician with no task sees no result (INV-12)', '0', (select count(*)::text from public.triage_events));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.res('admin sees results', 'true', ((select count(*) from public.triage_events) >= 3)::text);
  reset role;

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform 1 from public.triage_events;
    v_err := 'accepted';
  exception when insufficient_privilege then v_err := 'denied'; end;
  perform pg_temp.res('anon cannot read results', 'denied', v_err);
  reset role;

  perform pg_temp.res('record_triage_result is service role only', 'false|false|true',
    has_function_privilege('anon', 'public.record_triage_result(uuid, jsonb, uuid, uuid)', 'execute')::text || '|' ||
    has_function_privilege('authenticated', 'public.record_triage_result(uuid, jsonb, uuid, uuid)', 'execute')::text || '|' ||
    has_function_privilege('service_role', 'public.record_triage_result(uuid, jsonb, uuid, uuid)', 'execute')::text);
  perform pg_temp.res('the context function is service role only', 'false|false|true',
    has_function_privilege('anon', 'public.triage_context_for_observation(uuid, text, integer)', 'execute')::text || '|' ||
    has_function_privilege('authenticated', 'public.triage_context_for_observation(uuid, text, integer)', 'execute')::text || '|' ||
    has_function_privilege('service_role', 'public.triage_context_for_observation(uuid, text, integer)', 'execute')::text);

  -- Append only
  begin
    update public.triage_events set grade = 'green' where id = v_te;
    v_err := 'changed';
  exception when sqlstate '55000' then v_err := 'refused'; end;
  perform pg_temp.res('a result cannot be edited', 'refused', v_err);
  begin
    delete from public.triage_events where id = v_te;
    v_err := 'deleted';
  exception when sqlstate '55000' then v_err := 'refused'; end;
  perform pg_temp.res('a result cannot be deleted', 'refused', v_err);
  update public.triage_events set patient_id = null where id = v_te;
  perform pg_temp.res('erasing the profile may still detach it', 'null', coalesce((select patient_id::text from public.triage_events where id = v_te), 'null'));

  -- 6. SABOTAGE
  drop trigger triage_events_no_update on public.triage_events;
  update public.triage_events set grade = 'amber' where id = (select id from public.triage_events where patient_id = v_p limit 1);
  insert into results values ('sabotaged', 'a result cannot be edited', 'refused',
    case when (select grade from public.triage_events where patient_id = v_p limit 1) = 'amber' then 'changed' else 'refused' end);
end $$;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S12 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  if (select count(*) from results where phase = 'sabotaged' and expected <> actual) = 0 then
    raise exception 'VACUOUS TEST: the sabotage did not change the outcome';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
