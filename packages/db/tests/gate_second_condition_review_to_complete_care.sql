-- Tarragon Health — verification for
-- 20260810131922_gate_second_condition_review_to_complete_care.sql
--
-- Rewritten 2026-08-31: the Essential-vs-Complete subscription-tier gate this
-- file originally proved was already fully retired the day before this
-- rewrite, by 20260830014719_entitlement_gates_use_programme_purchases.sql —
-- "the 'first condition is always free' carve-out ... under the episodic
-- model, a scheduled proactive review is exactly what the programme fee
-- pays for — every condition's first review is now gated on THAT condition
-- having an active purchase, not just a patient's second one." There is no
-- more Essential/Complete distinction and no more free first condition; the
-- gate is now purely per-condition against public.programme_purchases
-- (private.patient_has_active_programme_purchase), regardless of which
-- condition or how many a patient already has. This file previously still
-- asserted against public.subscriptions/subscription_plans, which by then no
-- longer existed on the live gate path at all — this rewrite makes it prove
-- the actual current trigger chain instead.
--
-- Proves:
--   1. A care_plan for a condition with NO active programme_purchases row
--      gets NO scheduled review, but exactly one second_condition_needs_
--      upgrade notification — true even for a patient's very FIRST
--      condition now (no more free first condition).
--   2. Re-triggering the same care_plan (status flips draft->active again)
--      does not send a second notification.
--   3. A care_plan for a condition WHERE the patient DOES have an active
--      programme_purchases row gets a review scheduled immediately.
--   4. Purchasing (activating) a programme_purchases row for a
--      previously-gated condition backfills the missed review, without
--      touching a different, already-covered condition's review count.
--
-- Rolled back. Fixtures resolved at runtime, per this repo's test
-- convention. Prices one chronic_condition_programmes row for the duration
-- of the transaction only (every real row is currently unpriced — a
-- founder-pricing gap unrelated to this gate, see
-- feature_access_reconciliation.sql's header for the same caveat).
begin;

do $$
declare
  v_org              uuid;
  v_patient          uuid := gen_random_uuid();
  v_htn_programme_id uuid;
  v_dm_programme_id  uuid;
  v_htn_plan         uuid;
  v_dm_plan          uuid;
  v_review_count     integer;
  v_notif_count      integer;
  v_purchase_id      uuid;
begin
  select organisation_id into v_org
  from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_htn_programme_id from public.chronic_condition_programmes where code = 'hypertension';
  select id into v_dm_programme_id from public.chronic_condition_programmes where code = 'diabetes';
  if v_htn_programme_id is null or v_dm_programme_id is null then
    raise exception 'need both hypertension and diabetes chronic_condition_programmes rows to run this test';
  end if;

  update public.chronic_condition_programmes
    set price_kobo = 1500000, default_duration_weeks = coalesce(default_duration_weeks, 12)
    where id in (v_htn_programme_id, v_dm_programme_id);

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'gscr-test-patient@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'GSCR Test Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  ---------------------------------------------------------------- 1. first-ever condition, no purchase: gated, exactly one notification
  insert into public.care_plans (organisation_id, patient_id, condition, status)
  values (v_org, v_patient, 'hypertension', 'active')
  returning id into v_htn_plan;

  select count(*) into v_review_count from public.medication_reviews where care_plan_id = v_htn_plan;
  if v_review_count <> 0 then
    raise exception 'FAIL 1: an unpurchased first condition (hypertension) got % scheduled reviews, expected 0 (no more free first condition)', v_review_count;
  end if;

  select count(*) into v_notif_count from public.notifications
    where recipient_id = v_patient and template = 'second_condition_needs_upgrade';
  if v_notif_count <> 1 then
    raise exception 'FAIL 1: unpurchased first condition raised % upgrade notifications, expected 1', v_notif_count;
  end if;
  raise notice 'PASS 1: unpurchased first-ever condition is gated with exactly one upgrade notification';

  ---------------------------------------------------------------- 2. re-triggering the same care_plan is idempotent
  update public.care_plans set status = 'draft' where id = v_htn_plan;
  update public.care_plans set status = 'active' where id = v_htn_plan;

  select count(*) into v_notif_count from public.notifications
    where recipient_id = v_patient and template = 'second_condition_needs_upgrade';
  if v_notif_count <> 1 then
    raise exception 'FAIL 2: re-triggering the gated care_plan raised % total upgrade notifications, expected still 1', v_notif_count;
  end if;

  select count(*) into v_review_count from public.medication_reviews where care_plan_id = v_htn_plan;
  if v_review_count <> 0 then
    raise exception 'FAIL 2: re-triggering the gated care_plan unexpectedly scheduled a review';
  end if;
  raise notice 'PASS 2: re-triggering the gated care_plan is idempotent';

  ---------------------------------------------------------------- 3. a different condition WITH an active purchase gets a review immediately
  insert into public.programme_purchases (patient_id, programme_id, payment_provider)
  values (v_patient, v_dm_programme_id, 'paystack')
  returning id into v_purchase_id;
  update public.programme_purchases
    set status = 'active', purchased_at = now(), starts_at = current_date, ends_at = current_date + 84
    where id = v_purchase_id;

  insert into public.care_plans (organisation_id, patient_id, condition, status)
  values (v_org, v_patient, 'diabetes', 'active')
  returning id into v_dm_plan;

  select count(*) into v_review_count from public.medication_reviews where care_plan_id = v_dm_plan;
  if v_review_count <> 1 then
    raise exception 'FAIL 3: a condition covered by an active programme_purchases row got % scheduled reviews, expected 1', v_review_count;
  end if;
  raise notice 'PASS 3: a condition covered by an active programme purchase gets its review scheduled immediately';

  ---------------------------------------------------------------- 4. purchasing the previously-gated condition backfills it, without touching the covered one
  insert into public.programme_purchases (patient_id, programme_id, payment_provider)
  values (v_patient, v_htn_programme_id, 'paystack')
  returning id into v_purchase_id;
  update public.programme_purchases
    set status = 'active', purchased_at = now(), starts_at = current_date, ends_at = current_date + 84
    where id = v_purchase_id;

  select count(*) into v_review_count from public.medication_reviews where care_plan_id = v_htn_plan;
  if v_review_count <> 1 then
    raise exception 'FAIL 4: purchasing the gated condition backfilled % reviews, expected 1', v_review_count;
  end if;

  select count(*) into v_review_count from public.medication_reviews where care_plan_id = v_dm_plan;
  if v_review_count <> 1 then
    raise exception 'FAIL 4: backfilling the hypertension condition changed diabetes'' review count to %, expected still 1 (untouched)', v_review_count;
  end if;
  raise notice 'PASS 4: purchasing the previously-gated condition backfills exactly its own review, leaving the already-covered condition untouched';

  raise notice 'ALL GATE_SECOND_CONDITION_REVIEW_TO_COMPLETE_CARE CHECKS PASSED (per-condition programme-purchase model)';
end $$;

rollback;
