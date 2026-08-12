-- Tarragon Health — gate a second concurrent condition's SCHEDULED review to
-- Complete Care, honestly this time.
--
-- Two claims on the pricing page were found to be pure marketing copy with
-- nothing behind them: "manages multiple conditions" and "priority doctor
-- escalation" for Complete Care. `priority_escalation` sits in
-- subscription_plans.features but is read by zero lines of code anywhere in
-- the repo, and nothing ever stopped a clinician enrolling an Essential
-- patient into two chronic_programme_enrolments rows. This migration makes
-- the first claim real, in the one place it's safe to gate.
--
-- What stays UNGATED, on every plan including Free (non-negotiable per
-- CLAUDE.md — an abnormal/dangerous reading is never deprioritised for
-- money): programme enrolment itself, care_plans creation, any emergency or
-- red-flag escalation on any condition. A doctor can always see, diagnose,
-- and act on a second condition regardless of what the patient pays.
--
-- What's actually gated: only the PROACTIVE, ROLLING SCHEDULED-REVIEW
-- CADENCE (medication_reviews) for a patient's second-or-later concurrent
-- active condition. Essential Care's first condition is untouched — it
-- always gets scheduled reviews, same as today. Once a second condition's
-- first review has been gated, the gate never re-applies to that same
-- care_plan even on a later downgrade — this platform doesn't claw back
-- care already flowing (same instinct as honouring a paid annual plan
-- through its term). Upgrading later backfills the missed first review via
-- a new subscriptions trigger.

-- ============================================================================
-- 1. The real feature flag, granted only to Complete Care (and its diaspora
--    currency variants — all match 'complete%'). Idempotent on rerun.
-- ============================================================================
update public.subscription_plans
set features = array_append(features, 'multi_condition_review')
where code like 'complete%'
  and not ('multi_condition_review' = any(features));

-- ============================================================================
-- 2. One-time-notification guard column on care_plans, same idiom as
--    medication_reviews.reminder_sent_at.
-- ============================================================================
alter table public.care_plans
  add column if not exists multi_condition_notified_at timestamptz;

-- ============================================================================
-- 3. Shared scheduling helper, factored out of the old inline logic in
--    ensure_medication_review so the new backfill trigger (step 5) can reuse
--    the exact same cadence lookup + insert instead of drifting from it.
-- ============================================================================
create or replace function private.schedule_medication_review(p_care_plan public.care_plans)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_months integer;
begin
  select interval_months into v_months
  from public.medication_review_cadences where condition = p_care_plan.condition;
  v_months := coalesce(v_months, 6);

  if not exists (
    select 1 from public.medication_reviews
    where care_plan_id = p_care_plan.id and status = 'pending'
  ) then
    insert into public.medication_reviews (organisation_id, patient_id, care_plan_id, due_date)
    values (
      p_care_plan.organisation_id,
      p_care_plan.patient_id,
      p_care_plan.id,
      current_date + (v_months || ' months')::interval
    );
  end if;
end;
$$;

-- ============================================================================
-- 4. ensure_medication_review — same trigger, same signature, new gate up
--    front. A care_plan that has NEVER had a medication_reviews row (pending
--    or completed) AND is not the patient's only active condition AND the
--    patient lacks multi_condition_review gets a one-time in_app nudge
--    instead of a scheduled review. Every other case (first condition ever,
--    or already-scheduled-at-least-once, or entitled) is byte-identical to
--    the prior behaviour.
-- ============================================================================
create or replace function private.ensure_medication_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_care_plan public.care_plans%rowtype;
  v_has_ever_had_review boolean;
  v_is_additional_condition boolean;
begin
  if tg_table_name = 'care_plans' then
    v_care_plan := new;
  else
    select * into v_care_plan from public.care_plans where id = new.care_plan_id;
  end if;

  if v_care_plan.status <> 'active' then
    return new;
  end if;

  select exists (
    select 1 from public.medication_reviews where care_plan_id = v_care_plan.id
  ) into v_has_ever_had_review;

  if not v_has_ever_had_review then
    select exists (
      select 1 from public.care_plans
      where patient_id = v_care_plan.patient_id
        and status = 'active'
        and id <> v_care_plan.id
    ) into v_is_additional_condition;

    if v_is_additional_condition
       and not private.patient_has_feature_access(v_care_plan.patient_id, 'multi_condition_review')
    then
      if v_care_plan.multi_condition_notified_at is null then
        insert into public.notifications
          (organisation_id, recipient_id, channel, status, template, payload)
        values (
          v_care_plan.organisation_id, v_care_plan.patient_id, 'in_app', 'pending',
          'second_condition_needs_upgrade',
          jsonb_build_object('condition', v_care_plan.condition, 'care_plan_id', v_care_plan.id::text)
        );
        update public.care_plans
          set multi_condition_notified_at = now()
          where id = v_care_plan.id;
      end if;
      return new;
    end if;
  end if;

  perform private.schedule_medication_review(v_care_plan);
  return new;
end;
$$;

-- ============================================================================
-- 5. Backfill: when a patient's subscription becomes active/trialing on a
--    plan that grants multi_condition_review, schedule the first review for
--    any of their active care_plans that never got one (i.e. was gated by
--    step 4 above). Same trigger shape as subscriptions_lock_plan_price
--    (20260712201431_subscription_plans_paystack_sync.sql).
-- ============================================================================
create or replace function private.backfill_gated_medication_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_care_plan public.care_plans%rowtype;
begin
  if new.status not in ('active', 'trialing') or new.subscriber_id is null then
    return new;
  end if;

  if not private.patient_has_feature_access(new.subscriber_id, 'multi_condition_review') then
    return new;
  end if;

  for v_care_plan in
    select cp.* from public.care_plans cp
    where cp.patient_id = new.subscriber_id
      and cp.status = 'active'
      and not exists (
        select 1 from public.medication_reviews mr where mr.care_plan_id = cp.id
      )
  loop
    perform private.schedule_medication_review(v_care_plan);
  end loop;

  return new;
end;
$$;

drop trigger if exists subscriptions_backfill_gated_reviews on public.subscriptions;
create trigger subscriptions_backfill_gated_reviews
  after insert or update of status on public.subscriptions
  for each row execute function private.backfill_gated_medication_reviews();

-- ============================================================================
-- 6. Prove it landed.
-- ============================================================================
do $$
declare
  v_missing_plans text;
  v_leaked_plans text;
begin
  select string_agg(code, ', ') into v_missing_plans
  from public.subscription_plans
  where code like 'complete%' and not ('multi_condition_review' = any(features));
  if v_missing_plans is not null then
    raise exception 'FAIL: complete-tier plans missing multi_condition_review: %', v_missing_plans;
  end if;

  select string_agg(code, ', ') into v_leaked_plans
  from public.subscription_plans
  where code not like 'complete%' and ('multi_condition_review' = any(features));
  if v_leaked_plans is not null then
    raise exception 'FAIL: multi_condition_review leaked onto non-complete plans: %', v_leaked_plans;
  end if;

  raise notice 'PASS: multi_condition_review granted to complete-tier plans only';
end $$;
