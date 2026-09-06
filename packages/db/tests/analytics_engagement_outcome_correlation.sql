-- Tarragon Health — platform-wide engagement x outcome correlation verification
--
-- Proves public.analytics_engagement_outcome_correlation(): a non-analyst
-- session (a plain patient) gets an empty result, same gate style as its
-- sibling analytics_engagement_summary()/analytics_retention_cohorts(); a
-- simulated analyst session correctly buckets by latest engagement tier x
-- latest bp_control level, counting cohort_size and bp_in_range_count per
-- bucket. Caught a real bug on first write: revoking EXECUTE from PUBLIC
-- also removes it for `authenticated` unless granted back explicitly — the
-- function was uncallable by any real authenticated user until that grant
-- was added (see the migration's own note).
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed. Uses set_config('request.jwt.claims', ...) +
-- set_config('role', 'authenticated', true) to simulate a real session,
-- same pattern as packages/db/tests/appointment_engine_core.sql.

begin;

do $$
declare
  v_org uuid;
  v_analyst uuid := gen_random_uuid();
  v_p1 uuid := gen_random_uuid();
  v_p2 uuid := gen_random_uuid();
  v_p3 uuid := gen_random_uuid();
  v_result jsonb;
  v_high jsonb;
begin
  select id into v_org from public.organisations limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_analyst, 'engagement-corr-test-analyst@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set role = 'analyst', organisation_id = null, full_name = 'Engagement Corr Test Analyst'
    where id = v_analyst;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_p1, 'engagement-corr-test-p1@example.invalid', 'x', now(), '{}', '{}'),
         (v_p2, 'engagement-corr-test-p2@example.invalid', 'x', now(), '{}', '{}'),
         (v_p3, 'engagement-corr-test-p3@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set role = 'patient', organisation_id = v_org where id in (v_p1, v_p2, v_p3);

  insert into public.patient_engagement_scores (organisation_id, patient_id, tier, computed_at)
  values (v_org, v_p1, 'highly_engaged', now()),
         (v_org, v_p2, 'highly_engaged', now()),
         (v_org, v_p3, 'disengaged', now());

  insert into public.patient_risk_scores (organisation_id, patient_id, score_type, risk_level, computed_at)
  values (v_org, v_p1, 'bp_control', 'low', now()),
         (v_org, v_p2, 'bp_control', 'high', now()),
         (v_org, v_p3, 'bp_control', 'low', now());

  -- Simulate a plain patient session first: must get an empty result.
  perform set_config('request.jwt.claims', json_build_object('sub', v_p1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_result := public.analytics_engagement_outcome_correlation();
  perform set_config('role', 'postgres', true);
  if v_result <> '[]'::jsonb then
    raise exception 'FAIL: a plain patient session got a non-empty result: %', v_result;
  end if;
  raise notice 'PASS: a non-analyst session gets an empty result';

  -- Now simulate the analyst session.
  perform set_config('request.jwt.claims', json_build_object('sub', v_analyst, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_result := public.analytics_engagement_outcome_correlation();
  perform set_config('role', 'postgres', true);

  select elem into v_high from jsonb_array_elements(v_result) elem where elem->>'tier' = 'highly_engaged';
  if v_high is null then
    raise exception 'FAIL: no highly_engaged bucket in result: %', v_result;
  end if;
  if (v_high->>'cohort_size')::int <> 2 then
    raise exception 'FAIL: highly_engaged cohort_size = %, expected 2', v_high->>'cohort_size';
  end if;
  if (v_high->>'bp_in_range_count')::int <> 1 then
    raise exception 'FAIL: highly_engaged bp_in_range_count = %, expected 1', v_high->>'bp_in_range_count';
  end if;
  raise notice 'PASS: analyst session sees highly_engaged bucket with cohort_size=2, bp_in_range_count=1';

  raise notice 'ALL ANALYTICS_ENGAGEMENT_OUTCOME_CORRELATION CHECKS PASSED';
end $$;

rollback;
