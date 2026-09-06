-- Tarragon Health — engagement segmentation verification
--
-- Proves private.compute_patient_engagement_tiers() (the
-- patient-engagement-scoring-daily cron job): scores a patient with zero
-- engagement events and an old enrolment date as 'disengaged'; raises
-- exactly one care_outreach_tasks row (trigger_type='engagement_decline')
-- for a patient newly degrading from highly_engaged into disengaged; does
-- NOT re-fire a duplicate task for a patient who was already disengaged the
-- day before (only a genuine degradation should notify a coordinator); and
-- is idempotent if run twice on the same day (the daily unique index).
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed. Fixture patients use throwaway @example.invalid
-- emails, which private.real_patient_ids() (excludes only @tarragon.test)
-- will treat as real for the duration of this rolled-back transaction —
-- that is intentional and matches how other tests in this suite fixture a
-- patient/clinician (see vitals_red_flag_notification_wiring.sql).

begin;

do $$
declare
  v_org uuid;
  v_high uuid := gen_random_uuid();
  v_low uuid := gen_random_uuid();
  v_row record;
  v_task_count int;
begin
  select organisation_id into v_org from public.profiles where role = 'patient' and organisation_id is not null limit 1;

  -- Fixture patient A: enrolled long ago, zero engagement events, was highly_engaged yesterday.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_high, 'engagement-test-high@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Engagement Test High',
    created_at = now() - interval '90 days'
  where id = v_high;
  insert into public.patient_engagement_scores (organisation_id, patient_id, tier, computed_at)
  values (v_org, v_high, 'highly_engaged', now() - interval '1 day');

  -- Fixture patient B: enrolled long ago, zero engagement events, was ALREADY disengaged yesterday.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_low, 'engagement-test-low@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Engagement Test Low',
    created_at = now() - interval '90 days'
  where id = v_low;
  insert into public.patient_engagement_scores (organisation_id, patient_id, tier, computed_at)
  values (v_org, v_low, 'disengaged', now() - interval '1 day');

  perform private.compute_patient_engagement_tiers();

  -- Patient A: today's row should be 'disengaged' (no events) and a NEW engagement_decline task should exist.
  select tier into v_row from public.patient_engagement_scores
    where patient_id = v_high and computed_at >= date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'
    order by computed_at desc limit 1;
  if v_row.tier is distinct from 'disengaged' then
    raise exception 'FAIL: patient A todays tier = %, expected disengaged', v_row.tier;
  end if;
  raise notice 'PASS: patient A (no events, enrolled long ago) scored disengaged today';

  select count(*) into v_task_count from public.care_outreach_tasks
    where patient_id = v_high and trigger_type = 'engagement_decline';
  if v_task_count <> 1 then
    raise exception 'FAIL: expected exactly 1 engagement_decline task for patient A (highly_engaged -> disengaged), got %', v_task_count;
  end if;
  raise notice 'PASS: patient A degrading from highly_engaged -> disengaged raised exactly 1 outreach task';

  -- Patient B: today's row should also be 'disengaged', but NO new task (was already disengaged yesterday).
  select tier into v_row from public.patient_engagement_scores
    where patient_id = v_low and computed_at >= date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'
    order by computed_at desc limit 1;
  if v_row.tier is distinct from 'disengaged' then
    raise exception 'FAIL: patient B todays tier = %, expected disengaged', v_row.tier;
  end if;

  select count(*) into v_task_count from public.care_outreach_tasks
    where patient_id = v_low and trigger_type = 'engagement_decline';
  if v_task_count <> 0 then
    raise exception 'FAIL: patient B was already disengaged yesterday, should NOT get a new task, got %', v_task_count;
  end if;
  raise notice 'PASS: patient B (already disengaged yesterday) did not re-fire a duplicate task';

  -- Re-running the same day must be a no-op (idempotent daily unique index).
  perform private.compute_patient_engagement_tiers();
  select count(*) into v_task_count from public.care_outreach_tasks
    where patient_id = v_high and trigger_type = 'engagement_decline';
  if v_task_count <> 1 then
    raise exception 'FAIL: re-running same day should not duplicate patient A''s task, got count %', v_task_count;
  end if;
  raise notice 'PASS: re-running the same day is idempotent';

  raise notice 'ALL PATIENT_ENGAGEMENT_SCORING CHECKS PASSED';
end $$;

rollback;
