-- Episodic-fee rebuild, step 5/6.
--
-- Repoints every entitlement that used to key off an active subscription to
-- key off an active programme_purchases row instead. private.patient_has_
-- feature_access is defined in exactly one place
-- (20260804232022_gate_result_document_review_to_paid_plans.sql), and every
-- one of the five vitals red-flag trigger functions
-- (20260810022401_gate_vitals_red_flag_escalation_to_paid_plans.sql) calls it
-- by name — so rewriting this one function's body repoints the entire
-- escalation gate with zero call-site changes.
--
-- Recommendation encoded here (flagged for founder confirmation, see the
-- implementation plan): a SINGLE per-patient boolean — any active programme
-- purchase, any condition — grants vitals_red_flag_doctor_escalation,
-- lifestyle_coaching, quarterly_report, and ai_coach alike. SpO2/temperature/
-- generic symptom red flags are cross-cutting safety signals, not tied to one
-- product; gating escalation by "which specific programme did you buy" would
-- be clinically indefensible, and a false negative there is categorically
-- worse than a false positive. Cutoff at the end of a purchase's window is
-- immediate (ends_at >= current_date), no grace period — mitigated by
-- reminders, not an architectural grace window; the emergency-tier safety net
-- (emergency_events, hospital-now dialog, emergency-contact notify) stays
-- completely unconditional regardless of purchase status, unchanged from
-- today. Health Check purchases (one-off diagnostics) grant none of this —
-- they are not an ongoing monitoring relationship.
--
-- ai_coach is added to the allow-list here though it was not one of the
-- features the original research surfaced — public.has_ai_coach_access()
-- (20260712201523_generalized_feature_access.sql) falls back to
-- has_feature_access('ai_coach') once its own per-patient/org-wide override
-- checks come up empty, and leaving it off this list would have silently
-- taken AI Coach away from every patient. This preserves today's exact shape
-- (no paid plan -> no coach, unless an admin override says otherwise).
--
-- result_document_review and multi_condition_review are deliberately NOT in
-- this function's allow-list any more: both need context this function
-- doesn't have (a specific document/order, or a specific condition), so they
-- are rewritten as their own bespoke checks below instead of generic
-- feature-string branches.

create or replace function private.patient_has_feature_access(p_patient_id uuid, p_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = p_patient_id;

  if v_role = 'admin' then
    return true;
  end if;

  if p_feature in ('vitals_red_flag_doctor_escalation', 'lifestyle_coaching', 'quarterly_report', 'ai_coach') then
    return exists (
      select 1
      from public.programme_purchases pp
      where pp.patient_id = p_patient_id
        and pp.status = 'active'
        and pp.ends_at >= current_date
    );
  end if;

  return false;
end;
$$;

-- Simplified to delegate rather than duplicate the resolution logic — same
-- behaviour, one source of truth.
create or replace function public.has_feature_access(feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.patient_has_feature_access((select auth.uid()), feature);
$$;

-- ---------------------------------------------------------------------------
-- Per-condition variant, for the one place that genuinely needs it: whether a
-- specific chronic condition's scheduled review is covered.
-- ---------------------------------------------------------------------------
create or replace function private.patient_has_active_programme_purchase(
  p_patient_id uuid,
  p_condition public.care_plan_condition
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.programme_purchases pp
    join public.chronic_condition_programmes ccp on ccp.id = pp.programme_id
    where pp.patient_id = p_patient_id
      and ccp.condition = p_condition
      and pp.status = 'active'
      and pp.ends_at >= current_date
  );
$$;

-- ---------------------------------------------------------------------------
-- ensure_medication_review — same trigger, same signature. Retires the "first
-- condition is always free" carve-out from 20260810023507: that migration's
-- own comment admits it was "nothing ever stopped a clinician enrolling an
-- Essential patient into two enrolments", not a designed entitlement. Under
-- the episodic model, a scheduled proactive review is exactly what the
-- programme fee pays for — every condition's first review is now gated on
-- THAT condition having an active purchase, not just a patient's second one.
-- Emergency escalation, diagnosis, and enrolment creation itself remain free
-- and ungated regardless — unchanged, non-negotiable.
-- ---------------------------------------------------------------------------
create or replace function private.ensure_medication_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_care_plan public.care_plans%rowtype;
  v_has_ever_had_review boolean;
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

  if not v_has_ever_had_review
     and not private.patient_has_active_programme_purchase(v_care_plan.patient_id, v_care_plan.condition)
  then
    -- Column name predates this migration (it originally guarded only a
    -- patient's second-or-later condition); left as-is rather than renamed —
    -- it is a purely internal one-time-nudge guard with a single reader here,
    -- and its meaning ("have we already told them to buy the programme for
    -- this care plan") still holds for every condition now, not just extra
    -- ones. Same for the notification template name below.
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

  perform private.schedule_medication_review(v_care_plan);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: when a programme_purchases row becomes active, schedule the first
-- review for any of that patient's EXISTING active care_plans (for the same
-- condition) that never got one — i.e. was gated by ensure_medication_review
-- above because they had no purchase yet at the time. Replaces the
-- subscriptions-triggered version; a freshly-created draft care_plan from the
-- same purchase (enrol_patient_in_purchased_programme) does not match this
-- query's `status = 'active'` filter, which is correct — that one goes through
-- a clinician's own targets-setting step first, at which point activating it
-- fires ensure_medication_review directly.
-- ---------------------------------------------------------------------------
create or replace function private.backfill_gated_medication_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condition public.care_plan_condition;
  v_care_plan public.care_plans%rowtype;
begin
  select condition into v_condition
    from public.chronic_condition_programmes
   where id = new.programme_id;
  if v_condition is null then return new; end if;

  for v_care_plan in
    select cp.* from public.care_plans cp
    where cp.patient_id = new.patient_id
      and cp.condition = v_condition
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

drop trigger if exists programme_purchases_backfill_gated_reviews on public.programme_purchases;
create trigger programme_purchases_backfill_gated_reviews
  after update of status on public.programme_purchases
  for each row
  when (new.status = 'active' and old.status is distinct from 'active')
  execute function private.backfill_gated_medication_reviews();

-- ---------------------------------------------------------------------------
-- Assert.
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_get_functiondef('private.patient_has_feature_access(uuid,text)'::regprocedure) ~ 'subscription' then
    raise exception 'FAIL: patient_has_feature_access still references subscriptions';
  end if;
  if pg_get_functiondef('private.ensure_medication_review()'::regprocedure) ~ 'v_is_additional_condition' then
    raise exception 'FAIL: ensure_medication_review still has the retired additional-condition carve-out';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'programme_purchases_backfill_gated_reviews'
  ) then
    raise exception 'FAIL: programme_purchases backfill trigger missing';
  end if;
  if exists (
    select 1 from pg_trigger where tgname = 'subscriptions_backfill_gated_reviews'
  ) then
    raise exception 'FAIL: old subscriptions backfill trigger was not dropped';
  end if;
end $$;
