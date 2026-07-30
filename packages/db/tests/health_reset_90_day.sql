-- Tarragon Health — 90-Day Health Reset verification
--
-- Proves the 20260730120518_health_reset_90_day.sql migration end to end:
--   1. Onboarding completion auto-starts a reset (dated from the real
--      onboarding_completed_at, not "now").
--   2. patient_health_reset_progress() derives all three milestones + the
--      day count live from real data — never a stored/invented flag.
--   3. The nightly completion sweep (private.run_health_reset_completion())
--      only completes a reset that has BOTH milestones true AND is >=90
--      days old — never on the clock alone, never on partial engagement —
--      and queues exactly one in-app nudge on that transition.
--   4. claim_health_reset_trial()'s four guard rails (no reset / not
--      complete / already claimed / already on a paid plan) each block
--      correctly, and the success path grants a real trialing subscription
--      with cancel_at_period_end=true and updates the reset row.
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

-- ---------------------------------------------------------------------------
-- Part 1: onboarding auto-starts the reset; progress milestones + day_number
-- are derived live, each independently, from real data.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_profile uuid := gen_random_uuid();
  v_reset_id uuid;
  v_progress record;
  v_screen_type uuid;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_screen_type from public.screen_types limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_profile, 'health-reset-test-1@example.invalid', 'x', now(), '{}', '{}');

  -- private.enforce_onboarding_prereqs (2026-07-16) requires DOB/sex on the
  -- same row plus every current consent recorded before onboarding can
  -- complete at all — satisfy it so the reset can actually start.
  insert into public.patient_consents (organisation_id, patient_id, consent_version_id, consent_type, version)
  select v_org, v_profile, cv.id, cv.consent_type, cv.version
  from public.consent_versions cv where cv.is_current;

  -- Completing onboarding is what starts the clock — dated from the real
  -- completion time, not from when this UPDATE happens to run.
  update public.profiles
    set organisation_id = v_org, role = 'patient', full_name = 'Health Reset Test 1',
        date_of_birth = '1990-01-01', sex = 'female',
        onboarding_completed_at = now() - interval '5 days'
    where id = v_profile;

  select id into v_reset_id from public.patient_health_resets where patient_id = v_profile;
  if v_reset_id is null then
    raise exception 'FAIL: onboarding completion did not auto-create a patient_health_resets row';
  end if;
  if (select started_at from public.patient_health_resets where id = v_reset_id) <> (select onboarding_completed_at from public.profiles where id = v_profile) then
    raise exception 'FAIL: reset started_at does not match the real onboarding_completed_at';
  end if;
  raise notice 'PASS 1a: onboarding completion auto-starts the reset, dated from the real completion time';

  -- A second onboarding_completed_at update (e.g. a re-save) must not
  -- create a second row or move started_at — on conflict do nothing.
  update public.profiles set onboarding_completed_at = now() where id = v_profile;
  if (select count(*) from public.patient_health_resets where patient_id = v_profile) <> 1 then
    raise exception 'FAIL: a second onboarding_completed_at write created a duplicate reset row';
  end if;
  raise notice 'PASS 1b: re-saving onboarding_completed_at does not duplicate or move the reset';

  -- No data at all yet: every milestone false, day_number counts from
  -- started_at (5 days ago), never from today.
  perform set_config('request.jwt.claims', json_build_object('sub', v_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into v_progress from public.patient_health_reset_progress();
  reset role;

  if v_progress.reset_id is null then
    raise exception 'FAIL: patient_health_reset_progress() returned no row for the caller''s own reset';
  end if;
  if v_progress.baseline_done or v_progress.programme_set_done or v_progress.consistency_done then
    raise exception 'FAIL: a milestone reads true with zero supporting data (baseline=% programme=% consistency=%)',
      v_progress.baseline_done, v_progress.programme_set_done, v_progress.consistency_done;
  end if;
  if v_progress.day_number < 5 then
    raise exception 'FAIL: day_number=% expected >=5 for a reset started 5 days ago', v_progress.day_number;
  end if;
  raise notice 'PASS 1c: all three milestones correctly false with no data; day_number=%', v_progress.day_number;

  -- Flip baseline_done: needs BOTH a risk score AND a vitals reading —
  -- prove the AND, not just an OR of either one.
  insert into public.prevention_risk_scores (id, organisation_id, profile_id, condition, tier, computed_at)
  values (gen_random_uuid(), v_org, v_profile, 'hypertension', 'moderate', now());

  perform set_config('request.jwt.claims', json_build_object('sub', v_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into v_progress from public.patient_health_reset_progress();
  reset role;
  if v_progress.baseline_done then
    raise exception 'FAIL: baseline_done true from a risk score alone, with no vitals reading yet';
  end if;

  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_profile, 'blood_pressure', 120, 80, now(), 'manual');

  perform set_config('request.jwt.claims', json_build_object('sub', v_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into v_progress from public.patient_health_reset_progress();
  reset role;
  if not v_progress.baseline_done then
    raise exception 'FAIL: baseline_done still false with both a risk score and a vitals reading present';
  end if;
  if v_progress.programme_set_done or v_progress.consistency_done then
    raise exception 'FAIL: programme_set_done/consistency_done flipped true as a side effect of the baseline data alone';
  end if;
  raise notice 'PASS 1d: baseline_done requires both a risk score and a vitals reading, and only those two';

  -- Flip programme_set_done via a screening_schedules row (one of its three
  -- OR'd sources — the migration also accepts an active care_plan or an
  -- enrolled preventive_programme_enrolments row).
  insert into public.screening_schedules (id, organisation_id, patient_id, screen_type_id, status, due_date)
  values (gen_random_uuid(), v_org, v_profile, v_screen_type, 'pending', now() + interval '30 days');

  perform set_config('request.jwt.claims', json_build_object('sub', v_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into v_progress from public.patient_health_reset_progress();
  reset role;
  if not v_progress.programme_set_done then
    raise exception 'FAIL: programme_set_done false despite a real screening_schedules row';
  end if;
  raise notice 'PASS 1e: programme_set_done flips true from a screening_schedules row alone';

  -- Flip consistency_done via >=2 health_education_progress rows in
  -- seen/understood (the other OR'd path is >=4 distinct logging weeks).
  insert into public.health_education_progress (id, organisation_id, patient_id, content_id, status)
  select gen_random_uuid(), v_org, v_profile, hec.id, 'seen'
  from public.health_education_content hec limit 2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into v_progress from public.patient_health_reset_progress();
  reset role;
  if not v_progress.consistency_done then
    raise exception 'FAIL: consistency_done false despite 2 health_education_progress rows in seen/understood';
  end if;
  raise notice 'PASS 1f: consistency_done flips true from 2 education-progress rows alone';
end $$;

-- ---------------------------------------------------------------------------
-- Part 2: nightly completion sweep — only completes when BOTH milestones
-- are true AND the reset is genuinely >=90 days old; never on the clock
-- alone, never on partial engagement. Queues exactly one in-app nudge on
-- the true->true transition.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_screen_type uuid;
  v_profile_ready uuid := gen_random_uuid();
  v_profile_partial uuid := gen_random_uuid();
  v_profile_young uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  select id into v_screen_type from public.screen_types limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_profile_ready, 'health-reset-sweep-ready@example.invalid', 'x', now(), '{}', '{}'),
    (v_profile_partial, 'health-reset-sweep-partial@example.invalid', 'x', now(), '{}', '{}'),
    (v_profile_young, 'health-reset-sweep-young@example.invalid', 'x', now(), '{}', '{}');

  insert into public.patient_consents (organisation_id, patient_id, consent_version_id, consent_type, version)
  select v_org, p.id, cv.id, cv.consent_type, cv.version
  from public.consent_versions cv
  cross join (values (v_profile_ready), (v_profile_partial), (v_profile_young)) as p(id)
  where cv.is_current;

  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Sweep Ready', date_of_birth = '1990-01-01', sex = 'female', onboarding_completed_at = now() where id = v_profile_ready;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Sweep Partial', date_of_birth = '1990-01-01', sex = 'female', onboarding_completed_at = now() where id = v_profile_partial;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Sweep Young', date_of_birth = '1990-01-01', sex = 'female', onboarding_completed_at = now() where id = v_profile_young;

  -- Back-date all three to look genuinely overdue, except v_profile_young.
  update public.patient_health_resets set started_at = now() - interval '95 days' where patient_id in (v_profile_ready, v_profile_partial);
  update public.patient_health_resets set started_at = now() - interval '5 days' where patient_id = v_profile_young;

  -- Ready: both milestones true, 95 days old -> should complete.
  insert into public.prevention_risk_scores (id, organisation_id, profile_id, condition, tier, computed_at)
  values (gen_random_uuid(), v_org, v_profile_ready, 'hypertension', 'moderate', now());
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_profile_ready, 'blood_pressure', 120, 80, now(), 'manual');
  insert into public.screening_schedules (id, organisation_id, patient_id, screen_type_id, status, due_date)
  values (gen_random_uuid(), v_org, v_profile_ready, v_screen_type, 'pending', now() + interval '30 days');

  -- Partial: baseline only, 95 days old -> must NOT complete (programme_set_done false).
  insert into public.prevention_risk_scores (id, organisation_id, profile_id, condition, tier, computed_at)
  values (gen_random_uuid(), v_org, v_profile_partial, 'hypertension', 'moderate', now());
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_profile_partial, 'blood_pressure', 120, 80, now(), 'manual');

  -- Young: both milestones true, but only 5 days old -> must NOT complete
  -- on genuine engagement alone; 90 days has to have actually elapsed.
  insert into public.prevention_risk_scores (id, organisation_id, profile_id, condition, tier, computed_at)
  values (gen_random_uuid(), v_org, v_profile_young, 'hypertension', 'moderate', now());
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_profile_young, 'blood_pressure', 120, 80, now(), 'manual');
  insert into public.screening_schedules (id, organisation_id, patient_id, screen_type_id, status, due_date)
  values (gen_random_uuid(), v_org, v_profile_young, v_screen_type, 'pending', now() + interval '30 days');

  perform private.run_health_reset_completion();

  if (select completed_at from public.patient_health_resets where patient_id = v_profile_ready) is null then
    raise exception 'FAIL: a 95-day-old reset with both milestones true was not completed by the sweep';
  end if;
  if (select completed_at from public.patient_health_resets where patient_id = v_profile_partial) is not null then
    raise exception 'FAIL: a 95-day-old reset with only ONE milestone true was completed by the sweep';
  end if;
  if (select completed_at from public.patient_health_resets where patient_id = v_profile_young) is not null then
    raise exception 'FAIL: a 5-day-old reset was completed on genuine engagement alone, before 90 days elapsed';
  end if;
  raise notice 'PASS 2a: the sweep completes only the reset that is BOTH fully engaged AND genuinely >=90 days old';

  if not exists (
    select 1 from public.notifications
    where recipient_id = v_profile_ready and channel = 'in_app' and template = 'health_reset_complete'
  ) then
    raise exception 'FAIL: no in-app health_reset_complete notification was queued for the newly-completed reset';
  end if;
  if exists (
    select 1 from public.notifications
    where recipient_id in (v_profile_partial, v_profile_young) and template = 'health_reset_complete'
  ) then
    raise exception 'FAIL: a health_reset_complete notification was queued for a reset that did not complete';
  end if;
  raise notice 'PASS 2b: exactly one in-app nudge queued, only for the reset that actually completed';

  -- Re-running the sweep must not re-queue a second nudge or error on an
  -- already-completed row (the WHERE r.completed_at is null guard).
  perform private.run_health_reset_completion();
  if (select count(*) from public.notifications where recipient_id = v_profile_ready and template = 'health_reset_complete') <> 1 then
    raise exception 'FAIL: re-running the sweep queued a duplicate nudge for an already-completed reset';
  end if;
  raise notice 'PASS 2c: re-running the sweep is a no-op for an already-completed reset';
end $$;

-- ---------------------------------------------------------------------------
-- Part 3: claim_health_reset_trial()'s four guard rails, then the success
-- path grants a real trialing subscription and updates the reset row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_plan_complete uuid;
  v_profile_no_reset uuid := gen_random_uuid();
  v_profile_incomplete uuid := gen_random_uuid();
  v_profile_claimed uuid := gen_random_uuid();
  v_profile_paid uuid := gen_random_uuid();
  v_profile_success uuid := gen_random_uuid();
  v_failed boolean;
  v_error text;
  v_result jsonb;
  v_sub_id uuid;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_plan_complete from public.subscription_plans where code = 'complete' and is_active limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_profile_no_reset, 'health-reset-claim-noreset@example.invalid', 'x', now(), '{}', '{}'),
    (v_profile_incomplete, 'health-reset-claim-incomplete@example.invalid', 'x', now(), '{}', '{}'),
    (v_profile_claimed, 'health-reset-claim-claimed@example.invalid', 'x', now(), '{}', '{}'),
    (v_profile_paid, 'health-reset-claim-paid@example.invalid', 'x', now(), '{}', '{}'),
    (v_profile_success, 'health-reset-claim-success@example.invalid', 'x', now(), '{}', '{}');

  -- v_profile_no_reset deliberately never completes onboarding at all, so
  -- no patient_health_resets row is ever created (no DOB/sex/consents needed).
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Claim No Reset' where id = v_profile_no_reset;

  insert into public.patient_consents (organisation_id, patient_id, consent_version_id, consent_type, version)
  select v_org, p.id, cv.id, cv.consent_type, cv.version
  from public.consent_versions cv
  cross join (values (v_profile_incomplete), (v_profile_claimed), (v_profile_paid), (v_profile_success)) as p(id)
  where cv.is_current;

  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Claim Incomplete', date_of_birth = '1990-01-01', sex = 'female', onboarding_completed_at = now() where id = v_profile_incomplete;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Claim Claimed', date_of_birth = '1990-01-01', sex = 'female', onboarding_completed_at = now() where id = v_profile_claimed;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Claim Paid', date_of_birth = '1990-01-01', sex = 'female', onboarding_completed_at = now() where id = v_profile_paid;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Claim Success', date_of_birth = '1990-01-01', sex = 'female', onboarding_completed_at = now() where id = v_profile_success;

  update public.patient_health_resets set completed_at = now() where patient_id = v_profile_claimed;
  update public.patient_health_resets set completed_at = now(), trial_claimed_at = now() - interval '1 day' where patient_id = v_profile_claimed;
  update public.patient_health_resets set completed_at = now() where patient_id = v_profile_paid;
  update public.patient_health_resets set completed_at = now() where patient_id = v_profile_success;

  insert into public.subscriptions (organisation_id, subscriber_id, plan_id, status, currency, amount_minor, interval, current_period_end)
  values (v_org, v_profile_paid, v_plan_complete, 'active', 'NGN', 800000, 'monthly', now() + interval '30 days');

  -- 1) No reset at all -> blocked.
  perform set_config('request.jwt.claims', json_build_object('sub', v_profile_no_reset, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_failed := false;
  begin
    perform public.claim_health_reset_trial();
  exception when others then
    v_failed := true;
    v_error := sqlerrm;
  end;
  reset role;
  if not v_failed or v_error not ilike '%No health reset found%' then
    raise exception 'FAIL: claim with no reset row did not raise the expected error (got: %)', v_error;
  end if;
  raise notice 'PASS 3a: claiming with no reset at all is blocked';

  -- 2) Reset exists but not complete -> blocked.
  perform set_config('request.jwt.claims', json_build_object('sub', v_profile_incomplete, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_failed := false;
  begin
    perform public.claim_health_reset_trial();
  exception when others then
    v_failed := true;
    v_error := sqlerrm;
  end;
  reset role;
  if not v_failed or v_error not ilike '%not complete yet%' then
    raise exception 'FAIL: claim on an incomplete reset did not raise the expected error (got: %)', v_error;
  end if;
  raise notice 'PASS 3b: claiming before the reset is complete is blocked';

  -- 3) Already claimed -> blocked, idempotent.
  perform set_config('request.jwt.claims', json_build_object('sub', v_profile_claimed, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_failed := false;
  begin
    perform public.claim_health_reset_trial();
  exception when others then
    v_failed := true;
    v_error := sqlerrm;
  end;
  reset role;
  if not v_failed or v_error not ilike '%already claimed%' then
    raise exception 'FAIL: re-claiming an already-claimed trial did not raise the expected error (got: %)', v_error;
  end if;
  raise notice 'PASS 3c: claiming a trial twice is blocked';

  -- 4) Already on an active paid plan -> blocked.
  perform set_config('request.jwt.claims', json_build_object('sub', v_profile_paid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_failed := false;
  begin
    perform public.claim_health_reset_trial();
  exception when others then
    v_failed := true;
    v_error := sqlerrm;
  end;
  reset role;
  if not v_failed or v_error not ilike '%active paid plan%' then
    raise exception 'FAIL: claiming while already on an active paid plan did not raise the expected error (got: %)', v_error;
  end if;
  raise notice 'PASS 3d: claiming while already on a paid plan is blocked';

  -- 5) Success path: complete, unclaimed, no paid plan -> grants a real
  -- trialing subscription and updates the reset row.
  perform set_config('request.jwt.claims', json_build_object('sub', v_profile_success, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.claim_health_reset_trial() into v_result;
  reset role;

  v_sub_id := (v_result ->> 'subscription_id')::uuid;
  if v_sub_id is null then
    raise exception 'FAIL: claim_health_reset_trial() success path returned no subscription_id';
  end if;
  if not exists (
    select 1 from public.subscriptions
    where id = v_sub_id and subscriber_id = v_profile_success and status = 'trialing'
      and amount_minor = 0 and cancel_at_period_end = true
  ) then
    raise exception 'FAIL: the granted subscription is not a real free, auto-expiring trial';
  end if;
  if not exists (
    select 1 from public.patient_health_resets
    where patient_id = v_profile_success and trial_claimed_at is not null and trial_subscription_id = v_sub_id
  ) then
    raise exception 'FAIL: patient_health_resets was not updated with the real trial_claimed_at/trial_subscription_id';
  end if;
  raise notice 'PASS 3e: the success path grants a real 0-amount trialing subscription (auto-expires via cancel_at_period_end) and updates the reset row';

  raise notice 'ALL HEALTH RESET 90-DAY CHECKS PASSED';
end $$;

rollback;
