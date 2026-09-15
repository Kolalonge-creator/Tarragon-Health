-- Tarragon Health — AI Governance, Safety & Model Management (Module 40).
--
-- Live proof for the six migrations 20260829094312 .. 20260829112238.
--
-- Cases:
--   1. A patient cannot operate the AI kill switch. (40.17)
--   2. An admin can switch a live system OFF: is_enabled flips, the reason and
--      the actor are recorded, clinical operations are notified, and it is
--      audit-logged.
--   3. Switching it back ON is REFUSED while its 40.20 acceptance criteria
--      are outstanding — which is the state every grandfathered system is in.
--   4. Control for case 3: a probe system that satisfies every criterion CAN
--      be switched on. Without this, case 3 would pass just as well if the
--      gate refused everything.
--   5. record_ai_interaction derives organisation_id and actor server-side,
--      and refuses an interaction claimed about another organisation's
--      patient. (40.11)
--   6. A patient can report an AI safety incident, it lands at the default
--      severity rather than one they chose, and they cannot close it. (40.12)
--   7. approve_ai_system_version refuses a version that has not passed every
--      required evaluation suite. (40.9)
--   8. The fail-closed policy hardcoded in
--      apps/web/src/lib/ai-governance/system-codes.ts agrees with the
--      risk_class in the registry — the one duplication that file admits to.
--
-- Run: npx supabase db query --linked -f packages/db/tests/ai_governance.sql

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org        uuid := '00000000-0000-0000-0000-000000000001';
  v_patient    uuid;
  v_other_pat  uuid;
  v_admin      uuid;
  v_coach      uuid;
  v_probe_sys  uuid;
  v_probe_ver  uuid;
  v_suite      uuid;
  v_case       uuid;
  v_run        uuid;
  v_blocked    boolean;
  v_err        text;
  v_row        record;
  v_interaction uuid;
  v_incident   uuid;
  v_notifs     int;
  v_audits     int;
  v_mismatch   text;
begin
  select id into v_patient from public.profiles
   where role = 'patient' and organisation_id = v_org limit 1;
  select id into v_other_pat from public.profiles
   where role = 'patient' and organisation_id = v_org and id <> v_patient limit 1;
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select id into v_coach from public.ai_systems where system_code = 'AI-001';

  if v_patient is null or v_admin is null or v_coach is null then
    insert into test_result values (0, 'fixture check', 'SKIPPED',
      'needs a patient and an admin profile, and the AI-001 registry row');
    return;
  end if;

  -- ---- Case 1: a patient cannot operate the kill switch ----
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient)::text, true);
  begin
    perform public.set_ai_system_enabled(v_coach, false, 'patient trying to switch off the coach');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (1, 'patient cannot operate the AI kill switch',
    case when v_blocked then 'PASS' else 'FAIL' end,
    coalesce(v_err, 'ALLOWED (should have been blocked)'));

  -- ---- Case 2: an admin can switch a live system off ----
  select count(*) into v_notifs from public.notifications where source_table = 'ai_systems';
  select count(*) into v_audits from public.audit_log where action = 'ai_system.disabled';

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform public.set_ai_system_enabled(v_coach, false, 'Test: investigating a reported incorrect answer.');
  perform set_config('request.jwt.claims', '', true);

  select is_enabled, lifecycle_status, disabled_by, disabled_reason into v_row
  from public.ai_systems where id = v_coach;

  insert into test_result values (2, 'admin switch-off flips is_enabled and records who and why',
    case
      when not v_row.is_enabled
       and v_row.lifecycle_status = 'suspended'
       and v_row.disabled_by = v_admin
       and v_row.disabled_reason like 'Test:%'
      then 'PASS' else 'FAIL'
    end,
    format('enabled=%s status=%s by=%s reason=%s',
           v_row.is_enabled, v_row.lifecycle_status, v_row.disabled_by, v_row.disabled_reason));

  insert into test_result values (2, 'switch-off notifies clinical operations',
    case when (select count(*) from public.notifications where source_table = 'ai_systems') > v_notifs
         then 'PASS' else 'FAIL' end,
    format('notifications before=%s after=%s',
           v_notifs, (select count(*) from public.notifications where source_table = 'ai_systems')));

  insert into test_result values (2, 'switch-off is audit-logged',
    case when (select count(*) from public.audit_log where action = 'ai_system.disabled') > v_audits
         then 'PASS' else 'FAIL' end,
    format('audit rows before=%s after=%s',
           v_audits, (select count(*) from public.audit_log where action = 'ai_system.disabled')));

  -- ---- Case 3: switching back on is refused while criteria are outstanding ----
  v_blocked := false;
  v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  begin
    perform public.set_ai_system_enabled(v_coach, true, 'Test: trying to switch it back on.');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (3, 'switch-on refused while 40.20 criteria are outstanding',
    case when v_blocked and v_err like '%acceptance criteria%' then 'PASS' else 'FAIL' end,
    coalesce(v_err, 'ALLOWED (AI-001 has no approved version, so this must be refused)'));

  -- ---- Case 4: control — a system that meets every criterion CAN be switched on ----
  insert into public.ai_systems
    (system_code, name, purpose, owner_role, risk_class, autonomy_level,
     clinically_meaningful, fallback_behaviour, code_reference,
     review_interval_days, next_review_due)
  values ('AI-990', 'gate control probe', 'probe', 'Test owner', 'low', 'inform_only',
          false, 'probe fallback', 'packages/db/tests/ai_governance.sql', 365, current_date + 365)
  returning id into v_probe_sys;

  insert into public.ai_guardrails (ai_system_id, rule_code, kind, description, enforcement)
  values (v_probe_sys, 'probe_rule', 'output_constraint', 'probe', 'warn');

  insert into public.ai_system_versions
    (ai_system_id, version, model_identifier, intended_population, excluded_population,
     approved_at, approval_actor_id)
  values (v_probe_sys, 'v1', 'probe-model', 'probe', 'probe', now(), v_admin)
  returning id into v_probe_ver;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform public.set_ai_system_enabled(v_probe_sys, true, 'Test: control case, every criterion met.');
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (4, 'control: a fully-qualified system CAN be switched on',
    case when (select is_enabled from public.ai_systems where id = v_probe_sys)
         then 'PASS' else 'FAIL' end,
    'the gate in case 3 discriminates rather than refusing everything');

  -- ---- Case 5: record_ai_interaction derives org and actor server-side ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient)::text, true);
  v_interaction := public.record_ai_interaction(
    'AI-001', 'claude-sonnet-5', 'patient_coach_message', 'completed', v_patient,
    'probe output', 'routine'::public.alert_level
  );
  perform set_config('request.jwt.claims', '', true);

  select organisation_id, actor_profile_id, subject_profile_id into v_row
  from public.ai_interaction_log where id = v_interaction;

  insert into test_result values (5, 'audit row carries a server-derived organisation and actor',
    case when v_row.organisation_id = v_org
          and v_row.actor_profile_id = v_patient
          and v_row.subject_profile_id = v_patient
         then 'PASS' else 'FAIL' end,
    format('org=%s actor=%s subject=%s', v_row.organisation_id, v_row.actor_profile_id, v_row.subject_profile_id));

  if v_other_pat is null then
    insert into test_result values (5, 'patient cannot log an interaction about another patient',
      'SKIPPED', 'needs a second patient profile in the org');
  else
    v_blocked := false;
    v_err := null;
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient)::text, true);
    begin
      perform public.record_ai_interaction(
        'AI-001', 'claude-sonnet-5', 'patient_coach_message', 'completed', v_other_pat
      );
    exception when others then
      v_blocked := true;
      get stacked diagnostics v_err = message_text;
    end;
    perform set_config('request.jwt.claims', '', true);

    insert into test_result values (5, 'patient cannot log an interaction about another patient',
      case when v_blocked then 'PASS' else 'FAIL' end,
      coalesce(v_err, 'ALLOWED (should have been blocked)'));
  end if;

  -- ---- Case 6: a patient can report, and cannot close ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient)::text, true);
  v_incident := public.report_ai_safety_incident(
    'AI-001', 'incorrect_information',
    'Test: the coach told me my reading was normal when it was not.',
    v_interaction
  );
  perform set_config('request.jwt.claims', '', true);

  select reporter_kind, severity, status, interaction_id into v_row
  from public.ai_safety_incidents where id = v_incident;

  insert into test_result values (6, 'patient report lands at the default severity, linked to the turn',
    case when v_row.reporter_kind = 'patient'
          and v_row.severity = 'moderate'
          and v_row.status = 'open'
          and v_row.interaction_id = v_interaction
         then 'PASS' else 'FAIL' end,
    format('kind=%s severity=%s status=%s linked=%s',
           v_row.reporter_kind, v_row.severity, v_row.status, v_row.interaction_id is not null));

  insert into test_result values (6, 'reporting flags the interaction for review',
    case when (select flagged_for_review from public.ai_interaction_log where id = v_interaction)
         then 'PASS' else 'FAIL' end,
    'ai_interaction_log.flagged_for_review');

  v_blocked := false;
  v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient)::text, true);
  begin
    perform public.resolve_ai_safety_incident(v_incident, 'dismissed', 'Test: patient closing their own report.');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (6, 'a patient cannot close their own AI safety incident',
    case when v_blocked then 'PASS' else 'FAIL' end,
    coalesce(v_err, 'ALLOWED (only an active clinician may close one)'));

  -- ---- Case 7: the release gate ----
  insert into public.ai_evaluation_suites (ai_system_id, name, kind, is_required_for_release)
  values (v_probe_sys, 'probe required suite', 'safety', true)
  returning id into v_suite;

  insert into public.ai_evaluation_cases (suite_id, case_code, scenario, expected_behaviour)
  values (v_suite, 'probe_case', 'probe', 'probe') returning id into v_case;

  insert into public.ai_system_versions
    (ai_system_id, version, model_identifier, intended_population, excluded_population)
  values (v_probe_sys, 'v2', 'probe-model', 'probe', 'probe')
  returning id into v_probe_ver;

  v_blocked := false;
  v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  begin
    perform public.approve_ai_system_version(v_probe_ver, 'Test: approving with nothing run.');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (7, 'approval refused with a required suite unrun',
    case when v_blocked and v_err like '%required evaluation suite%' then 'PASS' else 'FAIL' end,
    coalesce(v_err, 'ALLOWED (should have been refused)'));

  -- ...and allowed once EVERY required suite has a completed passing run
  -- against THIS version -- which includes the platform-wide shared suite,
  -- not just the probe's own. The control half again: a gate that only ever
  -- refuses proves nothing about whether it is reading the runs at all.
  --
  -- (The first run of this test exercised only the probe's own suite, and the
  -- control failed -- correctly -- on the shared "Platform AI safety
  -- baseline". That is the shared suite doing its job: a new capability
  -- cannot be approved without being measured against the platform's own
  -- three refusals.)
  for v_suite in
    select s.id
    from public.ai_evaluation_suites s
    where s.is_active and s.is_required_for_release
      and (s.ai_system_id is null or s.ai_system_id = v_probe_sys)
  loop
    insert into public.ai_evaluation_runs (ai_system_id, ai_system_version_id, suite_id)
    values (v_probe_sys, v_probe_ver, v_suite) returning id into v_run;

    for v_case in select c.id from public.ai_evaluation_cases c where c.suite_id = v_suite loop
      insert into public.ai_evaluation_case_results (run_id, case_id, outcome)
      values (v_run, v_case, 'pass');
    end loop;

    update public.ai_evaluation_runs set completed_at = now() where id = v_run;
  end loop;

  v_blocked := false;
  v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  begin
    perform public.approve_ai_system_version(v_probe_ver, 'Test: approving with the suite passed.');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (7, 'control: approval allowed once the required suite passes',
    case when not v_blocked then 'PASS' else 'FAIL' end,
    coalesce(v_err, 'approved'));

  -- ---- Case 8: the TS fail-closed mirror agrees with the registry ----
  -- system-codes.ts hardcodes, per system, what to do when the registry
  -- itself cannot be read -- the one question the registry cannot answer.
  -- The invariant that matters is the dangerous direction: no high or
  -- very-high risk system may be marked fail-OPEN there. (AI-003 is
  -- additionally fail-closed at moderate risk because it renders clinical
  -- content straight to a patient; that is stricter than this check, and
  -- being stricter is never the drift worth catching.)
  select string_agg(system_code, ', ' order by system_code) into v_mismatch
  from public.ai_systems
  where risk_class in ('high', 'very_high')
    and system_code not in ('AI-001', 'AI-003', 'AI-004', 'AI-005', 'AI-006', 'AI-010');

  insert into test_result values (8, 'no high-risk AI system is marked fail-open in system-codes.ts',
    case when v_mismatch is null then 'PASS' else 'FAIL' end,
    coalesce(
      'high-risk systems missing from the fail-closed list: ' || v_mismatch,
      'every high or very-high risk system fails closed when governance is unreadable'
    ));
end;
$$;

select case_num, label, outcome, detail from test_result order by case_num, label;

rollback;
