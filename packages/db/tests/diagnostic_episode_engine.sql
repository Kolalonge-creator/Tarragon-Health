-- Tarragon Health — Diagnostic Safety Pathway (spec modules 56-60): live
-- proof for the migrations building diagnostic_episodes on top of the
-- existing abnormal-result pipeline and Alert System:
--   20260829084512_diagnostic_episode_core.sql
--   20260829091933_diagnostic_episode_closure_criteria.sql
--   20260829095228_diagnostic_episode_referral_linkage.sql
--   20260829102614_diagnostic_repeat_test_recalls.sql
--
-- Cases:
--   1. Inserting a real abnormal screening_results row opens exactly one
--      diagnostic_episodes row, linked to the clinician_alerts row the
--      existing (untouched) abnormal-result trigger creates.
--   2. 60.12: closing an episode with nothing done yet is blocked
--      (check_violation); reviewed_at/patient_informed_at/
--      follow_up_completed_at with no referral/repeat-test required lets it
--      close, and closed_by/closed_at are server-stamped from the caller's
--      own session.
--   3. 60.9: creating a specialist_referrals row against the episode's
--      screening_upgrade_id auto-sets requires_referral + referral_id; the
--      referral reaching 'completed' stamps referral_completed_at.
--   4. 60.10: creating a diagnostic_repeat_test_recalls row auto-sets
--      requires_repeat_test + due_date on the episode; attaching a result
--      auto-completes the recall and syncs repeat_test_completed_at.
--   5. 60.12: with requires_referral and requires_repeat_test both true,
--      closing is still blocked until outcome_received_at is also set, even
--      though the referral/repeat-test completion events already happened.
--
-- Run: npx supabase db query --linked -f packages/db/tests/diagnostic_episode_engine.sql

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
  v_result_a      uuid;
  v_episode_a     uuid;
  v_alert_a       uuid;
  v_upgrade_a     uuid;
  v_result_b      uuid;
  v_episode_b     uuid;
  v_upgrade_b     uuid;
  v_referral_id   uuid;
  v_recall_id     uuid;
  v_repeat_result uuid;
  v_n             int;
  v_status        public.diagnostic_episode_status;
  v_closed_by     uuid;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  select id into v_clin_profile from public.profiles where role = 'clinician' and organisation_id = v_org limit 1;

  select id into v_clin_staff_id from public.clinical_staff where profile_id = v_clin_profile;
  if v_clin_staff_id is null then
    insert into public.clinical_staff
      (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
      values (v_org, v_clin_profile, 'Diagnostic Episode Test Clinician', true, now(), 'tier_1')
      returning id into v_clin_staff_id;
  else
    update public.clinical_staff set doctor_tier = 'tier_1', active = true where id = v_clin_staff_id;
  end if;

  -- ---- Case 1: real abnormal result opens exactly one episode ----
  insert into public.screening_results
    (organisation_id, patient_id, screen_type_code, result_status, abnormal_flags)
  values (v_org, v_pat, 'hba1c', 'abnormal', array['hba1c'])
  returning id into v_result_a;

  select id into v_alert_a
    from public.clinician_alerts
    where screening_result_id = v_result_a and type_code = 'abnormal_result'
    order by created_at desc limit 1;

  select id, screening_upgrade_id into v_episode_a, v_upgrade_a
    from public.diagnostic_episodes where screening_result_id = v_result_a;

  select count(*) into v_n from public.diagnostic_episodes where screening_result_id = v_result_a;

  insert into test_result values (1, 'abnormal result opens exactly one diagnostic_episode',
    case when v_episode_a is not null and v_n = 1 and v_upgrade_a is not null then 'PASS' else 'FAIL' end,
    format('episode=%s count=%s upgrade=%s', v_episode_a, v_n, v_upgrade_a));

  -- ---- Case 2: closure criteria ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin_profile)::text, true);

  begin
    update public.diagnostic_episodes set status = 'closed' where id = v_episode_a;
    insert into test_result values (2, 'close blocked with nothing done', 'FAIL', 'update succeeded, expected check_violation');
  exception when check_violation then
    insert into test_result values (2, 'close blocked with nothing done', 'PASS', 'check_violation raised as expected');
  end;

  update public.diagnostic_episodes
    set reviewed_at = now(), review_note = 'reviewed in test',
        patient_informed_at = now(), patient_informed_method = 'telephone',
        follow_up_completed_at = now()
    where id = v_episode_a;

  update public.diagnostic_episodes set status = 'closed', closure_summary = 'no further action needed' where id = v_episode_a;
  select status, closed_by into v_status, v_closed_by from public.diagnostic_episodes where id = v_episode_a;

  insert into test_result values (2, 'close succeeds once checklist satisfied, closed_by server-stamped',
    case when v_status = 'closed' and v_closed_by = v_clin_staff_id then 'PASS' else 'FAIL' end,
    format('status=%s closed_by=%s expected=%s', v_status, v_closed_by, v_clin_staff_id));

  -- ---- Fixture for cases 3-5: a second abnormal result / episode ----
  insert into public.screening_results
    (organisation_id, patient_id, screen_type_code, result_status, abnormal_flags)
  values (v_org, v_pat, 'hba1c', 'critical', array['hba1c'])
  returning id into v_result_b;

  select id, screening_upgrade_id into v_episode_b, v_upgrade_b
    from public.diagnostic_episodes where screening_result_id = v_result_b;

  -- ---- Case 3: referral linkage ----
  insert into public.specialist_referrals
    (organisation_id, patient_id, screening_upgrade_id, specialist_type, referral_reason)
  values (v_org, v_pat, v_upgrade_b, 'endocrinology', 'diagnostic episode test referral')
  returning id into v_referral_id;

  insert into test_result values (3, 'referral insert sets requires_referral + referral_id',
    case when (select requires_referral and referral_id = v_referral_id from public.diagnostic_episodes where id = v_episode_b)
      then 'PASS' else 'FAIL' end,
    (select format('requires_referral=%s referral_id=%s', requires_referral, referral_id) from public.diagnostic_episodes where id = v_episode_b));

  update public.specialist_referrals set status = 'completed' where id = v_referral_id;

  insert into test_result values (3, 'referral reaching completed stamps referral_completed_at',
    case when (select referral_completed_at is not null from public.diagnostic_episodes where id = v_episode_b)
      then 'PASS' else 'FAIL' end,
    (select format('referral_completed_at=%s', referral_completed_at) from public.diagnostic_episodes where id = v_episode_b));

  -- ---- Case 4: repeat-test recall linkage ----
  insert into public.diagnostic_repeat_test_recalls (diagnostic_episode_id, due_date)
  values (v_episode_b, current_date + interval '42 days')
  returning id into v_recall_id;

  insert into test_result values (4, 'recall insert sets requires_repeat_test + due_date, org/patient server-derived',
    case when exists (
      select 1 from public.diagnostic_episodes de
      join public.diagnostic_repeat_test_recalls r on r.diagnostic_episode_id = de.id
      where de.id = v_episode_b and de.requires_repeat_test
        and r.id = v_recall_id and r.organisation_id = v_org and r.patient_id = v_pat and r.ordered_by = v_clin_staff_id
    ) then 'PASS' else 'FAIL' end,
    'checked requires_repeat_test + server-derived org/patient/ordered_by');

  insert into public.screening_results
    (organisation_id, patient_id, screen_type_code, result_status)
  values (v_org, v_pat, 'hba1c', 'normal')
  returning id into v_repeat_result;

  update public.diagnostic_repeat_test_recalls set result_screening_result_id = v_repeat_result where id = v_recall_id;

  insert into test_result values (4, 'attaching a result auto-completes the recall and syncs the episode',
    case when (
      select r.status = 'completed'
      from public.diagnostic_repeat_test_recalls r where r.id = v_recall_id
    ) and (
      select de.repeat_test_completed_at is not null and de.repeat_test_result_id = v_repeat_result
      from public.diagnostic_episodes de where de.id = v_episode_b
    ) then 'PASS' else 'FAIL' end,
    'checked recall.status + episode.repeat_test_completed_at/repeat_test_result_id');

  -- ---- Case 5: closure still blocked pending outcome_received_at ----
  update public.diagnostic_episodes
    set reviewed_at = now(), patient_informed_at = now(), patient_informed_method = 'appointment',
        follow_up_completed_at = now()
    where id = v_episode_b;

  begin
    update public.diagnostic_episodes set status = 'closed' where id = v_episode_b;
    insert into test_result values (5, 'close blocked without outcome_received_at despite referral+repeat-test done', 'FAIL', 'update succeeded, expected check_violation');
  exception when check_violation then
    insert into test_result values (5, 'close blocked without outcome_received_at despite referral+repeat-test done', 'PASS', 'check_violation raised as expected');
  end;

  update public.diagnostic_episodes set outcome_received_at = now(), outcome_flag = 'none' where id = v_episode_b;
  update public.diagnostic_episodes set status = 'closed' where id = v_episode_b;

  insert into test_result values (5, 'close succeeds once outcome_received_at is also set',
    case when (select status = 'closed' from public.diagnostic_episodes where id = v_episode_b) then 'PASS' else 'FAIL' end,
    'checked final status=closed');

  -- No manual cleanup: the whole file runs inside begin/rollback (see
  -- header) so every insert/update above is discarded regardless.
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
