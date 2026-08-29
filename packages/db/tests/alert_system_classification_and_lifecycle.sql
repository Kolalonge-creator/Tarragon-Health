-- Tarragon Health — Alert System infrastructure: classification, ownership,
-- fatigue prevention, lifecycle and accountability.
--
-- Live proof for the migrations building out spec section 8 (Alert System)
-- on top of clinician_alerts: 20260828013011_alert_system_taxonomy_and_governance.sql,
-- 20260828013522_alert_status_add_snoozed_closed.sql,
-- 20260828014055_clinician_alerts_taxonomy_lifecycle_ownership.sql,
-- 20260828020247_alert_follow_up_tasks_on_snooze.sql.
--
-- Cases:
--   1. Auto-classification: severity is always derived from level, never
--      client-settable; type_code falls back correctly via the title-based
--      heuristic when a generator doesn't set it explicitly.
--   2. Auto-assignment: a new alert of a type with a governed owner_tier
--      gets responsible_clinician_id set to the least-loaded active
--      clinical_staff at that tier.
--   3. Fatigue prevention: a second alert of the same type/patient within
--      24h gets duplicate_of set (grouping always happens; suppression
--      only when alert_rules has it configured for that type).
--   4. 8.12: resolving a severity>=2 alert without resolution_action/
--      resolution_outcome is blocked by CHECK; with both, it succeeds and
--      resolved_by/resolved_at are server-stamped from the caller's own
--      clinical_staff record (forge-proof).
--   5. 8.10: snoozing without a reason is blocked; snoozing with one sets
--      status='snoozed', stamps snoozed_by, and creates exactly one
--      alert_follow_up_tasks row.
--   6. 8.10: a resolved/closed alert cannot be snoozed.
--   7. 8.15: deleting an open, unresolved severity>=2 alert is blocked;
--      once resolved, deletion succeeds (and audit_row_change_trg's
--      existing generic audit-log entry still fires — not re-proven here,
--      it predates this feature and is covered by row_change_audit_triggers'
--      own tests).
--
-- Run: npx supabase db query --linked -f packages/db/tests/alert_system_classification_and_lifecycle.sql

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org           uuid := '00000000-0000-0000-0000-000000000001';
  v_pat           uuid;
  v_clin_profile  uuid;
  v_clin_staff_id uuid;
  v_a1            uuid;
  v_a2            uuid;
  v_severity      smallint;
  v_type          public.alert_type_code;
  v_responsible   uuid;
  v_dup           uuid;
  v_status        public.alert_status;
  v_resolved_by   uuid;
  v_n             int;
begin
  -- Reuse existing org profiles: profiles.id is a foreign key to
  -- auth.users(id) (confirmed live, proved a naive `insert ... gen_random_uuid()`
  -- fixture wrong before this test was finalized), so a fresh profile row
  -- cannot be hand-constructed at all -- unlike clinical_staff or
  -- clinician_alerts, every profiles row must come from real signup.
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  select id into v_clin_profile from public.profiles where role = 'clinician' and organisation_id = v_org limit 1;

  -- The org's clinician profile may already carry a real clinical_staff row
  -- (profile_id is UNIQUE, so it can't be duplicated) -- reuse it and pin
  -- its tier for this test rather than assuming one doesn't exist; nothing
  -- here persists past the outer rollback regardless.
  select id into v_clin_staff_id from public.clinical_staff where profile_id = v_clin_profile;
  if v_clin_staff_id is null then
    insert into public.clinical_staff
      (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
      values (v_org, v_clin_profile, 'Alert System Test Clinician', true, now(), 'tier_1')
      returning id into v_clin_staff_id;
  else
    update public.clinical_staff set doctor_tier = 'tier_1', active = true where id = v_clin_staff_id;
  end if;

  -- ---- Case 1: severity always derived from level, type_code fallback ----
  -- No screening_result_id/vital_reading_id fixture needed: the title-based
  -- fallback (private.classify_and_assign_clinician_alert()'s last resort
  -- for the 8 pre-existing generators this feature deliberately does not
  -- touch, see part 2b's header) is exercised directly via title text —
  -- matches the real diabetic-foot-complication generator's own title.
  -- Title matches deterioration's fallback pattern (owner_tier=tier_1 in
  -- the seeded alert_rules config, matching the tier_1 fixture below) so
  -- case 1's classification and case 2's auto-assignment exercise the same
  -- alert consistently.
  insert into public.clinician_alerts (organisation_id, patient_id, level, title)
    values (v_org, v_pat, 'emergency', 'Lifestyle red flag (test): fixture_rule')
    returning id, severity, type_code into v_a1, v_severity, v_type;

  insert into test_result values (1, 'auto-classify severity+type_code',
    case when v_severity = 4 and v_type = 'deterioration' then 'PASS' else 'FAIL' end,
    format('severity=%s type_code=%s', v_severity, v_type));

  -- ---- Case 2: auto-assignment to a valid tier_1 staff member ----
  -- Asserts a real, correctly-tiered assignment happened rather than the
  -- specific fixture row, since the org may carry other real tier_1 staff
  -- whose lower existing alert load legitimately wins the least-loaded tie
  -- -- the invariant under test is "auto-assignment landed on someone
  -- eligible", not "landed on my fixture specifically".
  select responsible_clinician_id into v_responsible from public.clinician_alerts where id = v_a1;
  insert into test_result values (2, 'auto-assign responsible_clinician_id to a valid tier_1 staff member',
    case
      when v_responsible is not null and exists (
        select 1 from public.clinical_staff
        where id = v_responsible and organisation_id = v_org and doctor_tier = 'tier_1' and active
      ) then 'PASS'
      else 'FAIL'
    end,
    format('responsible_clinician_id=%s', v_responsible));

  -- ---- Case 3: dedup detection (duplicate_of) ----
  -- Same title pattern as case 1 -> same type_code ('deterioration') for
  -- the same patient within the 24h detection window -> dedup_key matches.
  insert into public.clinician_alerts (organisation_id, patient_id, level, title)
    values (v_org, v_pat, 'urgent_escalation', 'Lifestyle red flag (test): fixture_rule_2')
    returning id, duplicate_of into v_a2, v_dup;
  insert into test_result values (3, 'dedup detection sets duplicate_of',
    case when v_dup = v_a1 then 'PASS' else 'FAIL' end,
    format('duplicate_of=%s expected=%s', v_dup, v_a1));

  -- ---- Case 4: resolution documentation requirement + forge-proof stamp ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin_profile)::text, true);

  begin
    update public.clinician_alerts set status = 'resolved' where id = v_a1;
    insert into test_result values (4, 'resolve w/o docs blocked (severity>=2)', 'FAIL', 'update succeeded, expected check_violation');
  exception when check_violation then
    insert into test_result values (4, 'resolve w/o docs blocked (severity>=2)', 'PASS', 'check_violation raised as expected');
  end;

  update public.clinician_alerts
    set status = 'resolved', resolution_action = 'reviewed patient, advised follow-up', resolution_outcome = 'true_positive'
    where id = v_a1;
  select resolved_by, status into v_resolved_by, v_status from public.clinician_alerts where id = v_a1;
  insert into test_result values (4, 'resolve with docs stamps resolved_by',
    case when v_resolved_by = v_clin_staff_id and v_status = 'resolved' then 'PASS' else 'FAIL' end,
    format('resolved_by=%s status=%s', v_resolved_by, v_status));

  -- ---- Case 5: snooze requires reason, creates a follow-up task ----
  begin
    update public.clinician_alerts set snoozed_until = now() + interval '1 day' where id = v_a2;
    insert into test_result values (5, 'snooze w/o reason blocked', 'FAIL', 'update succeeded, expected check_violation');
  exception when check_violation then
    insert into test_result values (5, 'snooze w/o reason blocked', 'PASS', 'check_violation raised as expected');
  end;

  update public.clinician_alerts
    set snoozed_until = now() + interval '1 day', snooze_reason = 'follow up after clinic tomorrow'
    where id = v_a2;
  select status into v_status from public.clinician_alerts where id = v_a2;
  select count(*) into v_n from public.alert_follow_up_tasks where clinician_alert_id = v_a2;
  insert into test_result values (5, 'snooze sets status + creates exactly one follow-up task',
    case when v_status = 'snoozed' and v_n = 1 then 'PASS' else 'FAIL' end,
    format('status=%s follow_up_task_count=%s', v_status, v_n));

  -- ---- Case 6: cannot snooze a resolved alert ----
  begin
    update public.clinician_alerts
      set snoozed_until = now() + interval '1 day', snooze_reason = 'x'
      where id = v_a1;
    insert into test_result values (6, 'cannot snooze resolved alert', 'FAIL', 'update succeeded, expected 23514');
  exception when others then
    insert into test_result values (6, 'cannot snooze resolved alert',
      case when sqlstate = '23514' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  -- ---- Case 7: deletion guard (8.15 accountability) ----
  begin
    delete from public.clinician_alerts where id = v_a2; -- still snoozed, severity 3, not resolved/closed
    insert into test_result values (7, 'delete blocked: open severity>=2 not resolved', 'FAIL', 'delete succeeded, expected 42501');
  exception when others then
    insert into test_result values (7, 'delete blocked: open severity>=2 not resolved',
      case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlstate);
  end;

  update public.clinician_alerts
    set status = 'closed', resolution_action = 'no action needed, resolving test fixture', resolution_outcome = 'no_action_needed'
    where id = v_a2;
  delete from public.clinician_alerts where id = v_a2;
  insert into test_result values (7, 'delete allowed once resolved/closed',
    case when not exists (select 1 from public.clinician_alerts where id = v_a2) then 'PASS' else 'FAIL' end,
    'closed alert deleted successfully');

  -- No manual cleanup: the whole file runs inside begin/rollback (see
  -- header) so every insert/update above, including the fixture profile
  -- and clinical_staff rows, is discarded regardless.
end $$;

select * from test_result order by case_num;

do $$
declare v_fail_count int;
begin
  select count(*) into v_fail_count from test_result where outcome <> 'PASS';
  if v_fail_count > 0 then
    raise exception '% test case(s) FAILED — see rows above', v_fail_count;
  end if;
  raise notice 'ALL % CASES PASSED', (select count(*) from test_result);
end $$;

rollback;
