-- Tarragon Health — Alert System infrastructure: governance sign-off and
-- the ack-timeout escalation ladder.
--
-- Live proof for 20260828013011_alert_system_taxonomy_and_governance.sql
-- (public.sign_alert_rules) and 20260828015134_clinician_alert_ack_timeout_escalation_ladder.sql
-- (private.escalate_unacknowledged_clinician_alerts).
--
-- Cases:
--   1. A non-director (any active clinical_staff without is_clinical_director)
--      cannot sign an alert_rules draft version -- blocked, matching
--      sign_escalation_slas/sign_cv_risk_config/sign_vaccination_schedule's
--      own forge-proof shape.
--   2. An active Clinical Director CAN sign a draft version; approved_by/
--      approved_at are server-derived from the caller's own clinical_staff
--      record (never a client-supplied id), and signing retires any other
--      currently-active version (one active at a time).
--   3. Ack-timeout ladder hop thresholds: an alert open >=1x its governed
--      ack_timeout_minutes climbs to hop 1 (backup notified) only; one open
--      >=2x climbs to hop 1 AND hop 2 (senior/Clinical Director notified);
--      one open <1x climbs to neither.
--   4. The ladder is idempotent: running the sweep twice does not create
--      duplicate hop rows (clinician_alert_ack_escalations' unique index).
--
-- Run: npx supabase db query --linked -f packages/db/tests/alert_system_governance_and_ack_escalation.sql

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org              uuid := '00000000-0000-0000-0000-000000000001';
  v_pat              uuid;
  v_non_director     uuid; -- clinical_staff.id
  v_director_profile uuid;
  v_director_staff   uuid;
  v_draft_id         uuid;
  v_blocked          boolean;
  v_err              text;
  v_signed           record;
  v_a1               uuid;
  v_a2               uuid;
  v_a3               uuid;
  v_n1               int;
  v_n2               int;
  v_n3               int;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  select cs.id into v_non_director
  from public.clinical_staff cs
  where cs.organisation_id = v_org and cs.active and not cs.is_clinical_director
  limit 1;

  select cs.id, cs.profile_id into v_director_staff, v_director_profile
  from public.clinical_staff cs
  where cs.organisation_id = v_org and cs.active and cs.is_clinical_director
  limit 1;

  -- ---- Case 1/2 require both a non-director and a director fixture to exist ----
  if v_non_director is null or v_director_staff is null then
    insert into test_result values (0, 'fixture check', 'SKIPPED',
      'org 00000000-0000-0000-0000-000000000001 needs at least one active non-director and one active Clinical Director clinical_staff row for cases 1-2');
  else
    -- Includes ack_timeout_minutes: signing this draft in case 2 makes it
    -- the new active alert_rules version for the rest of this transaction
    -- (is_active is a single platform-wide singleton), retiring the v1
    -- seed cases 3-4 depend on for abnormal_result's governed timeout. A
    -- config entry missing that key would make private.alert_rule_config()
    -- return no timeout at all, and the ack-timeout sweep correctly (and
    -- silently) no-ops for a type with no governed timeout -- so cases 3-4
    -- would see 0 hops for reasons that have nothing to do with the sweep
    -- itself. Carrying the same value forward keeps cases 3-4 order-
    -- independent of cases 1-2.
    insert into public.alert_rules (version, config)
      values (
        (select coalesce(max(version), 0) + 1 from public.alert_rules),
        jsonb_build_array(jsonb_build_object('type_code', 'abnormal_result', 'default_severity', 3, 'ack_timeout_minutes', 30))
      )
      returning id into v_draft_id;

    -- Case 1: non-director blocked.
    v_blocked := false;
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', (select profile_id from public.clinical_staff where id = v_non_director))::text,
      true
    );
    begin
      perform public.sign_alert_rules(v_draft_id);
    exception when others then
      v_blocked := true;
      get stacked diagnostics v_err = message_text;
    end;
    perform set_config('request.jwt.claims', '', true);
    insert into test_result values (1, 'non-director sign attempt',
      case when v_blocked then 'PASS' else 'FAIL' end, coalesce(v_err, 'ALLOWED (should have been blocked)'));

    -- Case 2: Clinical Director signs; approved_by forced to their own id.
    perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile)::text, true);
    perform public.sign_alert_rules(v_draft_id);
    perform set_config('request.jwt.claims', '', true);

    select approved_by, is_active into v_signed from public.alert_rules where id = v_draft_id;
    insert into test_result values (2, 'director signs, approved_by forced to caller, is_active flips',
      case when v_signed.approved_by = v_director_staff then 'PASS' else 'FAIL' end,
      format('approved_by=%s expected=%s', v_signed.approved_by, v_director_staff));

    insert into test_result values (2, 'signing retires other active versions',
      case when (select count(*) from public.alert_rules where is_active) = 1 then 'PASS' else 'FAIL' end,
      format('active_count=%s', (select count(*) from public.alert_rules where is_active)));
  end if;

  -- ---- Cases 3-4: ack-timeout ladder ----
  -- abnormal_result's seeded ack_timeout_minutes is 30 (v1 config, part 1).
  insert into public.clinician_alerts (organisation_id, patient_id, level, title, created_at)
    values (v_org, v_pat, 'urgent_escalation', 'Ack-ladder test: 35 min open', now() - interval '35 minutes')
    returning id into v_a1;
  insert into public.clinician_alerts (organisation_id, patient_id, level, title, created_at)
    values (v_org, v_pat, 'urgent_escalation', 'Ack-ladder test: 65 min open', now() - interval '65 minutes')
    returning id into v_a2;
  insert into public.clinician_alerts (organisation_id, patient_id, level, title, created_at)
    values (v_org, v_pat, 'urgent_escalation', 'Ack-ladder test: 10 min open', now() - interval '10 minutes')
    returning id into v_a3;

  -- A backup clinician is required for hop 1 to fire.
  update public.clinician_alerts set backup_clinician_id = coalesce(v_non_director, v_director_staff)
    where id in (v_a1, v_a2, v_a3);

  perform private.escalate_unacknowledged_clinician_alerts();

  select count(*) into v_n1 from public.clinician_alert_ack_escalations where clinician_alert_id = v_a1;
  select count(*) into v_n2 from public.clinician_alert_ack_escalations where clinician_alert_id = v_a2;
  select count(*) into v_n3 from public.clinician_alert_ack_escalations where clinician_alert_id = v_a3;

  insert into test_result values (3, 'hop thresholds (35min->1 hop, 65min->2 hops, 10min->0 hops)',
    case when v_n1 = 1 and v_n2 = 2 and v_n3 = 0 then 'PASS' else 'FAIL' end,
    format('35min=%s hops, 65min=%s hops, 10min=%s hops', v_n1, v_n2, v_n3));

  -- Case 4: idempotency.
  perform private.escalate_unacknowledged_clinician_alerts();
  select count(*) into v_n2 from public.clinician_alert_ack_escalations where clinician_alert_id = v_a2;
  insert into test_result values (4, 'sweep is idempotent (no duplicate hop rows on re-run)',
    case when v_n2 = 2 then 'PASS' else 'FAIL' end, format('hop_count_after_second_run=%s', v_n2));
end $$;

select * from test_result order by case_num;

do $$
declare v_fail_count int;
begin
  select count(*) into v_fail_count from test_result where outcome not in ('PASS', 'SKIPPED');
  if v_fail_count > 0 then
    raise exception '% test case(s) FAILED — see rows above', v_fail_count;
  end if;
  raise notice 'ALL CASES PASSED (or explicitly skipped for missing fixtures)';
end $$;

rollback;
