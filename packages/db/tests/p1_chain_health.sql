-- P1 proof: chain health, reliability measures and legacy-versus-engine parity (migration *_p1_chain_health_measures_parity.sql).
--
-- Proves in one rolled-back transaction:
--   1. Access: admin and the active CMO read; a patient, a plain clinician and anon do not (chain_health, chain_reliability_report,
--      triage_engine_parity, triage_engine_parity_cases); the reliability report writes an audit_log row.
--   2. chain_health status: no canary yet is 'attention'; a failed canary run is 'down' and names the stage; a dead letter on a chain
--      subscriber is 'down'; a passed canary run with no other fault is 'ok'.
--   3. Timings: real (non-test) events are summarised, fewer than the minimum sample are withheld, test events never count as real.
--   4. Parity: an approved-rule engine grade is compared with the legacy action actually taken; engine red with a quiet legacy and a
--      legacy urgent action with an engine non-red are both listed, ids only; the old shadow report still runs (and is shadow only by design).
--   5. analytics.v_chain_timings: service role only, no identifier column, no test row.
--   6. SABOTAGE: the view pointed at test rows shows them, so the INV-13 check can fail.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.res(p_check text, p_expected text, p_actual text) returns void language sql as
$f$ insert into results values ('real', p_check, p_expected, p_actual) $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'p1h-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'P1H ' || p_label, (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  if p_role = 'patient' then
    insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test) values (p_org, v, 'purchase', 'active', true);
  end if;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_pat uuid; v_h jsonb; v_rs uuid; v_rsv integer;
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_te uuid; v_ev uuid; v_before integer; v_run uuid; v_s public.chain_canary_subjects; v_rep jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_cmo, v_org, 'P1H CMO', 'chief_medical_officer', true, now(), 'employed', true, v_admin, true),
         (v_doc, v_org, 'P1H Doc', 'senior_medical_officer', true, now(), 'employed', false, null, true);
  select id, version into v_rs, v_rsv from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved' order by version desc limit 1;

  -- 1. Access ---------------------------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_pat);
  perform pg_temp.res('a patient is refused chain_health', '42501', pg_temp.try('select public.chain_health()'));
  perform pg_temp.res('a patient is refused the reliability report', '42501', pg_temp.try('select public.chain_reliability_report(30)'));
  perform pg_temp.res('a patient is refused the parity summary', '42501', pg_temp.try('select * from public.triage_engine_parity(30)'));
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.res('a plain clinician is refused chain_health', '42501', pg_temp.try('select public.chain_health()'));
  perform pg_temp.res('a plain clinician is refused the parity cases', '42501', pg_temp.try('select * from public.triage_engine_parity_cases(30, 10)'));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.res('an admin reads chain_health', 'ok', pg_temp.try('select public.chain_health()'));
  select count(*) into v_before from public.audit_log where action = 'chain.reliability_report';
  v_rep := public.chain_reliability_report(30);
  perform pg_temp.res('an admin reads the reliability report and the read is audited', 'true',
    ((select count(*) from public.audit_log where action = 'chain.reliability_report') = v_before + 1)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.res('the active CMO reads chain_health', 'ok', pg_temp.try('select public.chain_health()'));
  perform pg_temp.res('the active CMO reads parity', 'ok', pg_temp.try('select * from public.triage_engine_parity(30)'));
  perform pg_temp.back();
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  perform pg_temp.res('anon is refused chain_health', '42501', pg_temp.try('select public.chain_health()'));
  reset role;

  -- 2. Status ---------------------------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_admin);
  v_h := public.chain_health();
  perform pg_temp.back();
  perform pg_temp.res('no canary result yet is attention and says so', 'attention,true', (v_h ->> 'status') || ',' || ((v_h -> 'reasons')::text like '%has not reported yet%')::text);
  -- a failed canary run, stopped processor
  v_s := private.chain_canary_ensure();
  v_run := private.chain_canary_start();
  perform private.chain_canary_evaluate(v_run);
  perform pg_temp.act(v_admin); v_h := public.chain_health(); perform pg_temp.back();
  perform pg_temp.res('a failed canary run is down and names the stage', 'down,true', (v_h ->> 'status') || ',' || ((v_h -> 'reasons')::text like '%stage%graded%')::text);
  perform pg_temp.res('the page lists the recent runs', 'false', ((v_h #>> '{canary,recent,0,passed}'))::text);
  -- a passing run (processor emulated) clears the canary reason
  v_run := private.chain_canary_start();
  declare it jsonb; v_res jsonb; v_id uuid;
  begin
    for it in select * from jsonb_array_elements((select fixtures from public.chain_canary_runs where run_id = v_run and kind = 'started')) loop
      if it ->> 'fixture' = 'bp_red_chest_pain' then
        v_res := jsonb_build_object('status', 'graded', 'grade', 'red', 'ruleId', 'BP-R1', 'explanationKey', 'EMG-001', 'actions', '[{"kind":"page_on_call"}]'::jsonb,
          'matchedRuleIds', '["BP-R1"]'::jsonb, 'taskKey', null, 'ruleSet', jsonb_build_object('code', 'bp_care_triage', 'version', v_rsv));
      else
        v_res := jsonb_build_object('status', 'graded', 'grade', 'amber', 'ruleId', 'BP-A7', 'explanationKey', 'TRI-004',
          'actions', '[{"kind":"create_task","task":"low_bp_review","dueMinutes":1440}]'::jsonb, 'matchedRuleIds', '["BP-A7"]'::jsonb, 'taskKey', 'low_bp_review',
          'ruleSet', jsonb_build_object('code', 'bp_care_triage', 'version', v_rsv));
      end if;
      perform public.record_triage_result((it ->> 'reading_id')::uuid, v_res, v_rs, null, '');
      select id into v_id from public.triage_events where trigger_id = (it ->> 'reading_id')::uuid;
      perform public.create_tasks_from_triage_event(v_id);
      perform public.create_red_page(v_id);
    end loop;
    update public.domain_event_deliveries d set status = 'done', done_at = now()
     where d.status = 'pending' and d.event_id in (select e.id from public.domain_events e where e.event_type = 'triage.graded' and e.is_test);
    set constraints all immediate; set constraints all deferred;
  end;
  perform private.chain_canary_evaluate(v_run);
  perform pg_temp.act(v_admin); v_h := public.chain_health(); perform pg_temp.back();
  perform pg_temp.res('after a passed run the canary is not blamed', 'true,true', ((v_h #>> '{canary,last_passed}') = 'true')::text || ',' || (not ((v_h -> 'reasons')::text like '%canary%'))::text);
  perform pg_temp.res('the test events did not count as real timings', '0', (v_h #>> '{timings_7d,reading_to_graded,n}'));
  perform pg_temp.res('the canary timings are reported apart', 'true', ((v_h #>> '{canary_timings_7d,reading_to_graded,n}')::int >= 1)::text);
  -- a dead letter on a chain subscriber
  v_ev := private.emit_domain_event('triage.graded', v_org, jsonb_build_object('grade', 'green', 'triage_event_id', gen_random_uuid()), 'p1h-dead:' || gen_random_uuid());
  update public.domain_event_deliveries set status = 'dead', last_error = 'p1 proof' where event_id = v_ev and subscriber_key = 'paging.on_red';
  perform pg_temp.act(v_admin); v_h := public.chain_health(); perform pg_temp.back();
  perform pg_temp.res('a dead letter on the chain is down', 'down', v_h ->> 'status');
  perform pg_temp.res('the dead letter is counted', '1', v_h #>> '{bus,dead}');

  -- 3. Timings -----------------------------------------------------------------------------------------------------------------------
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, created_at)
    values (v_org, v_pat, 'blood_pressure', 120, 80, 'manual', now() - interval '1 hour', now() - interval '1 hour') returning id into v_r1;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, created_at)
    values (v_org, v_pat, 'blood_pressure', 118, 78, 'manual', now() - interval '50 minutes', now() - interval '50 minutes') returning id into v_r2;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis, created_at)
    values (v_org, v_pat, 'observation', v_r1, 'green', 'BP-G1', v_rs, 'bp_care_triage', v_rsv, 'approved', '[]'::jsonb, false, false, 'a', now() - interval '1 hour' + interval '30 seconds'),
           (v_org, v_pat, 'observation', v_r2, 'green', 'BP-G1', v_rs, 'bp_care_triage', v_rsv, 'approved', '[]'::jsonb, false, false, 'b', now() - interval '50 minutes' + interval '50 seconds');
  perform pg_temp.res('under the minimum sample the percentiles are withheld', 'true,2', (private.chain_percentiles('reading_to_graded', 7, false, 20) ->> 'withheld') || ',' || (private.chain_percentiles('reading_to_graded', 7, false, 20) ->> 'n'));
  perform pg_temp.res('with a lower minimum the median is shown', '40.0', private.chain_percentiles('reading_to_graded', 7, false, 2) ->> 'p50');

  -- 4. Parity ----------------------------------------------------------------------------------------------------------------------------
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, v_pat, 'blood_pressure', 192, 126, 'manual', now()) returning id into v_r3;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
    values (v_org, v_pat, 'observation', v_r3, 'amber', 'BP-A1', v_rs, 'bp_care_triage', v_rsv, 'approved', '[]'::jsonb, false, false, 'c');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, created_at)
    values (v_org, v_pat, 'blood_pressure', 118, 76, 'manual', now(), now()) returning id into v_r4;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
    values (v_org, v_pat, 'observation', v_r4, 'red', 'BP-R1', v_rs, 'bp_care_triage', v_rsv, 'approved', '[{"kind":"page_on_call"}]'::jsonb, false, false, 'd');
  perform pg_temp.act(v_admin);
  perform pg_temp.res('an approved amber against a legacy urgent action is counted', '1',
    (select coalesce(sum(readings), 0)::text from public.triage_engine_parity(30) where engine_status = 'approved' and engine_grade = 'amber' and legacy_class in ('emergency', 'priority1')));
  perform pg_temp.res('an approved red against a quiet legacy is counted', '1',
    (select coalesce(sum(readings), 0)::text from public.triage_engine_parity(30) where engine_status = 'approved' and engine_grade = 'red' and legacy_class = 'none'));
  perform pg_temp.res('the two concerns are listed by name', 'engine_red_legacy_quiet,legacy_urgent_engine_not_red',
    (select string_agg(distinct concern, ',' order by concern) from public.triage_engine_parity_cases(30, 50)));
  perform pg_temp.res('the cases carry no patient column', '0', (select count(*)::text from information_schema.parameters where specific_schema = 'public' and parameter_mode = 'OUT' and parameter_name = 'patient_id' and specific_name like 'triage_engine_parity%'));
  perform pg_temp.res('the canary run is not in the parity counts (test events)', 'true', ((select coalesce(sum(readings), 0) from public.triage_engine_parity(30)) = 4)::text);
  perform pg_temp.res('the old shadow report still runs and, by design, sees no approved event', '0', (select coalesce(sum(readings), 0)::text from public.triage_shadow_divergence(30)));
  perform pg_temp.back();

  -- 5. The analytics view ------------------------------------------------------------------------------------------------------------------
  perform pg_temp.res('the view has no identifier column', '0', (select count(*)::text from information_schema.columns where table_schema = 'analytics' and table_name = 'v_chain_timings' and column_name ~ '(patient|profile|clinician|task|page|event).*id'));
  perform pg_temp.res('authenticated cannot read the view', 'false', has_table_privilege('authenticated', 'analytics.v_chain_timings', 'SELECT')::text);
  perform pg_temp.res('service role can read the view', 'true', has_table_privilege('service_role', 'analytics.v_chain_timings', 'SELECT')::text);
  perform pg_temp.res('the view holds the four real events and none of the test events', '4',
    (select count(*)::text from analytics.v_chain_timings where metric = 'reading_to_graded'));

  -- the report's credential block counts real staff only
  perform pg_temp.res('credential coverage counts non-test active staff only', (select count(*)::text from public.clinical_staff where active and status = 'active' and not is_test), v_rep #>> '{credential_coverage,active_staff}');

  -- 6. SABOTAGE -------------------------------------------------------------------------------------------------------------------------------
  create or replace view analytics.v_chain_timings with (security_invoker = off) as select metric, day, seconds from private.chain_timing_rows(365, true);
  insert into results values ('sabotaged', 'the view shows only real events', '4', (select count(*)::text from analytics.v_chain_timings where metric = 'reading_to_graded'));
end $$;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'P1 health proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  if (select count(*) from results where phase = 'sabotaged' and expected <> actual) = 0 then
    raise exception 'VACUOUS TEST: the sabotage did not change the outcome';
  end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
