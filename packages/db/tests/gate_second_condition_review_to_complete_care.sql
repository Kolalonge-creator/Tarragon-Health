-- Tarragon Health — verification for
-- 20260810131922_gate_second_condition_review_to_complete_care.sql
--
-- Proves, for a genuinely fresh Essential-tier patient vs. a genuinely fresh
-- Complete-tier patient:
--   1. A patient's FIRST active condition always gets a scheduled
--      medication_reviews row, on either plan.
--   2. An Essential patient's SECOND concurrent active condition gets NO
--      scheduled review, but exactly one second_condition_needs_upgrade
--      in_app notification — and re-triggering the same care_plan (status
--      flips draft->active again) does not send a second notification.
--   3. A Complete patient's second condition DOES get a scheduled review
--      immediately, same as the first.
--   4. Upgrading the Essential patient's subscription to Complete backfills
--      the missed review for the previously-gated second condition, without
--      touching the first condition's already-scheduled review.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.

begin;

create temporary table gscr_fixture(k text primary key, v uuid) on commit drop;

do $$
declare
  v_org             uuid;
  v_essential_pat   uuid := gen_random_uuid();
  v_complete_pat    uuid := gen_random_uuid();
  v_essential_plan  uuid;
  v_complete_plan   uuid;
begin
  select organisation_id into v_org
  from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_essential_plan from public.subscription_plans where code = 'essential' limit 1;
  select id into v_complete_plan from public.subscription_plans where code = 'complete' limit 1;
  if v_essential_plan is null or v_complete_plan is null then
    raise exception 'essential/complete subscription_plans rows not found — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_essential_pat, 'gscr-test-essential@example.invalid', 'x', now(), '{}', '{}'),
    (v_complete_pat, 'gscr-test-complete@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_essential_pat, v_org, 'patient', 'GSCR Test Essential Patient'),
    (v_complete_pat, v_org, 'patient', 'GSCR Test Complete Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.subscriptions (organisation_id, subscriber_id, plan_id, status)
  values
    (v_org, v_essential_pat, v_essential_plan, 'active'),
    (v_org, v_complete_pat, v_complete_plan, 'active');

  insert into gscr_fixture(k, v) values
    ('org', v_org),
    ('essential_pat', v_essential_pat), ('complete_pat', v_complete_pat),
    ('essential_plan', v_essential_plan), ('complete_plan', v_complete_plan);
end $$;

-- ==========================================================================
-- 1 + 2. Essential patient: first condition scheduled, second gated with
--        exactly one notification, re-triggering doesn't duplicate it.
-- ==========================================================================
do $$
declare
  v_org    uuid := (select v from gscr_fixture where k = 'org');
  v_pat    uuid := (select v from gscr_fixture where k = 'essential_pat');
  v_plan1  uuid;
  v_plan2  uuid;
  v_review_count integer;
  v_notif_count integer;
begin
  insert into public.care_plans (organisation_id, patient_id, condition, status)
  values (v_org, v_pat, 'hypertension', 'active')
  returning id into v_plan1;

  select count(*) into v_review_count from public.medication_reviews where care_plan_id = v_plan1;
  if v_review_count <> 1 then
    raise exception 'FAIL: Essential patient first condition (hypertension) got % scheduled reviews, expected 1', v_review_count;
  end if;
  raise notice 'PASS 1: Essential patient first condition scheduled a review';

  insert into public.care_plans (organisation_id, patient_id, condition, status)
  values (v_org, v_pat, 'diabetes', 'active')
  returning id into v_plan2;

  select count(*) into v_review_count from public.medication_reviews where care_plan_id = v_plan2;
  if v_review_count <> 0 then
    raise exception 'FAIL: Essential patient second condition (diabetes) got % scheduled reviews, expected 0 (should be gated)', v_review_count;
  end if;

  select count(*) into v_notif_count from public.notifications
    where recipient_id = v_pat and template = 'second_condition_needs_upgrade';
  if v_notif_count <> 1 then
    raise exception 'FAIL: Essential patient second condition raised % upgrade notifications, expected 1', v_notif_count;
  end if;
  raise notice 'PASS 2: Essential patient second condition gated, exactly one upgrade notification';

  -- Re-trigger the same care_plan (status flips away and back) — must not
  -- send a second notification, and must still not schedule a review.
  update public.care_plans set status = 'draft' where id = v_plan2;
  update public.care_plans set status = 'active' where id = v_plan2;

  select count(*) into v_notif_count from public.notifications
    where recipient_id = v_pat and template = 'second_condition_needs_upgrade';
  if v_notif_count <> 1 then
    raise exception 'FAIL: re-triggering the gated care_plan raised % total upgrade notifications, expected still 1', v_notif_count;
  end if;

  select count(*) into v_review_count from public.medication_reviews where care_plan_id = v_plan2;
  if v_review_count <> 0 then
    raise exception 'FAIL: re-triggering the gated care_plan unexpectedly scheduled a review';
  end if;
  raise notice 'PASS 3: re-triggering the gated care_plan is idempotent — no duplicate notification, still no review';

  insert into gscr_fixture(k, v) values ('essential_plan2', v_plan2)
  on conflict (k) do update set v = excluded.v;
end $$;

-- ==========================================================================
-- 3. Complete patient: both conditions get scheduled reviews immediately.
-- ==========================================================================
do $$
declare
  v_org   uuid := (select v from gscr_fixture where k = 'org');
  v_pat   uuid := (select v from gscr_fixture where k = 'complete_pat');
  v_plan1 uuid;
  v_plan2 uuid;
  v_review_count integer;
begin
  insert into public.care_plans (organisation_id, patient_id, condition, status)
  values (v_org, v_pat, 'hypertension', 'active')
  returning id into v_plan1;

  insert into public.care_plans (organisation_id, patient_id, condition, status)
  values (v_org, v_pat, 'diabetes', 'active')
  returning id into v_plan2;

  select count(*) into v_review_count from public.medication_reviews
  where care_plan_id in (v_plan1, v_plan2);
  if v_review_count <> 2 then
    raise exception 'FAIL: Complete patient with two conditions has % scheduled reviews, expected 2', v_review_count;
  end if;
  raise notice 'PASS 4: Complete patient — both conditions scheduled a review immediately';
end $$;

-- ==========================================================================
-- 4. Upgrade backfill: essential_pat's gated second condition (diabetes)
--    gets its first review scheduled once they move to Complete; the first
--    condition's already-scheduled review is untouched (still exactly one
--    review row, not duplicated).
-- ==========================================================================
do $$
declare
  v_org           uuid := (select v from gscr_fixture where k = 'org');
  v_pat           uuid := (select v from gscr_fixture where k = 'essential_pat');
  v_plan1         uuid;
  v_plan2         uuid := (select v from gscr_fixture where k = 'essential_plan2');
  v_complete_plan uuid := (select v from gscr_fixture where k = 'complete_plan');
  v_review_count  integer;
begin
  select id into v_plan1 from public.care_plans
  where patient_id = v_pat and condition = 'hypertension';

  insert into public.subscriptions (organisation_id, subscriber_id, plan_id, status)
  values (v_org, v_pat, v_complete_plan, 'active');

  select count(*) into v_review_count from public.medication_reviews where care_plan_id = v_plan2;
  if v_review_count <> 1 then
    raise exception 'FAIL: upgrading to Complete backfilled % reviews for the gated second condition, expected 1', v_review_count;
  end if;
  raise notice 'PASS 5: upgrading to Complete backfilled the gated second condition''s first review';

  select count(*) into v_review_count from public.medication_reviews where care_plan_id = v_plan1;
  if v_review_count <> 1 then
    raise exception 'FAIL: upgrading to Complete changed the first condition''s review count to %, expected still 1 (untouched)', v_review_count;
  end if;
  raise notice 'PASS 6: first condition''s already-scheduled review was untouched by the upgrade';
  raise notice 'ALL GATE_SECOND_CONDITION_REVIEW_TO_COMPLETE_CARE CHECKS PASSED';
end $$;

rollback;
