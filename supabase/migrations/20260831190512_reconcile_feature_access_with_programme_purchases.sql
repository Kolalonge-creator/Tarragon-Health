-- Reconciles two entitlement sources that were built independently and, as of
-- this migration, silently conflicted: this session's platform-wide
-- pay-per-service rewrite (20260831141943_rewire_feature_access_to_service_
-- purchases.sql, service_products/service_purchases) landed on top of the
-- prior day's "episodic-fee rebuild" (20260830014719_entitlement_gates_use_
-- programme_purchases.sql + 20260830015233_entitlement_allowlist_missed_
-- features.sql, chronic_condition_programmes/programme_purchases), and
-- 20260831141943's CREATE OR REPLACE overwrote the programme_purchases-based
-- body of private.patient_has_feature_access with a service_purchases-only
-- body — silently dropping vitals_red_flag_doctor_escalation,
-- lifestyle_coaching, quarterly_report, ai_coach, clinician_review,
-- doctor_checkin, async_doctor_visit, and health_education for any patient
-- whose only paid access was an active programme_purchases row (a 12-week
-- chronic-care programme fee) rather than a service_purchases pack.
--
-- Zero real patients were affected (programme_purchases had 0 rows, active or
-- otherwise, at the time this was caught — checked live before writing this
-- migration) — this closes a live logic bug before it can bite a real
-- purchase, it is not a data-repair migration.
--
-- Fix: private.patient_has_feature_access becomes the union (OR) of both
-- purchase systems, never a replacement of one by the other — this is also
-- what closes the second, related gap: the 12-week two-track programme's own
-- track-derivation trigger (private.derive_chronic_programme_track, this
-- session's 20260831163011_chronic_programme_two_track.sql) resolves
-- 'doctor_supported' by calling this exact function with feature =
-- 'chronic_doctor_supported_track' — so a patient who paid via the OLDER
-- programme_purchases route for a doctor-supported chronic programme (the
-- episodic-fee model's own product) was being silently placed on the free
-- self_monitoring track instead, despite having already paid for doctor
-- check-ins. Adding 'chronic_doctor_supported_track' to the programme_
-- purchases allow-list below closes that without touching the trigger itself
-- — same "one function, many callers" leverage the original 8d34d2ee/
-- 20260830015233 migrations relied on.
--
-- public.has_feature_access is restored to delegating to this function
-- (20260830014719's own "one source of truth" simplification, which
-- 20260831141943 had also inadvertently reverted to a duplicated inline
-- query) rather than re-diverging the two entry points again.

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

  if exists (
    select 1
    from public.service_purchases sp
    join public.service_products p on p.id = sp.service_product_id
    where sp.patient_id = p_patient_id
      and sp.status = 'active'
      and (sp.expires_at is null or sp.expires_at > now())
      and p_feature = any(p.features)
  ) then
    return true;
  end if;

  -- Any active programme purchase, any condition, grants this fixed set —
  -- these are cross-cutting safety/coaching/reporting features, not tied to
  -- which specific chronic programme was bought (see 20260830014719's own
  -- comment on why escalation must never be gated per-condition).
  if p_feature in (
    'vitals_red_flag_doctor_escalation', 'lifestyle_coaching', 'quarterly_report', 'ai_coach',
    'clinician_review', 'doctor_checkin', 'async_doctor_visit', 'health_education',
    'chronic_doctor_supported_track'
  ) then
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

create or replace function public.has_feature_access(feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.patient_has_feature_access((select auth.uid()), feature);
$$;

-- Same reconciliation for the health-reset trial's "already paid" guard: it
-- only checked service_purchases, so a patient who already had an active
-- programme_purchases row (a paid chronic-care programme) could still claim
-- a free complete_pack trial on top of it. Low severity (no safety impact,
-- just a double-benefit edge case) but the same class of gap — fixed while
-- this file was already reconciling the two purchase systems.
create or replace function public.claim_health_reset_trial()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reset public.patient_health_resets;
  v_already_paid boolean;
  v_product_id uuid;
  v_period_end timestamptz := now() + interval '30 days';
  v_purchase_id uuid;
begin
  select * into v_reset from public.patient_health_resets where patient_id = (select auth.uid());
  if v_reset.id is null then
    raise exception 'No health reset found for this account' using errcode = 'check_violation';
  end if;
  if v_reset.completed_at is null then
    raise exception 'Your 90-Day Health Reset is not complete yet' using errcode = 'check_violation';
  end if;
  if v_reset.trial_claimed_at is not null then
    raise exception 'You have already claimed this trial' using errcode = 'check_violation';
  end if;

  select exists(
    select 1
    from public.service_purchases sp
    join public.service_products p on p.id = sp.service_product_id
    where sp.patient_id = (select auth.uid())
      and sp.status = 'active'
      and (sp.expires_at is null or sp.expires_at > now())
      and p.code <> 'free_pack'
  ) or exists(
    select 1
    from public.programme_purchases pp
    where pp.patient_id = (select auth.uid())
      and pp.status = 'active'
      and pp.ends_at >= current_date
  ) into v_already_paid;
  if v_already_paid then
    raise exception 'You already have an active paid plan' using errcode = 'check_violation';
  end if;

  select id into v_product_id from public.service_products where code = 'complete_pack' and is_active limit 1;
  if v_product_id is null then
    raise exception 'The trial plan is not currently available' using errcode = 'check_violation';
  end if;

  insert into public.service_purchases (
    organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
    amount_kobo, currency, purchased_at, expires_at
  )
  values (
    v_reset.organisation_id, (select auth.uid()), (select auth.uid()), v_product_id, 'active',
    0, 'NGN', now(), v_period_end
  )
  returning id into v_purchase_id;

  update public.patient_health_resets
    set trial_claimed_at = now(), trial_subscription_id = v_purchase_id
    where id = v_reset.id;

  return jsonb_build_object('subscription_id', v_purchase_id, 'current_period_end', v_period_end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Assert (structural only — the fixture-based proof that both purchase
-- systems independently grant the shared feature set lives in
-- packages/db/tests/feature_access_reconciliation.sql, run rolled-back;
-- deleting throwaway profiles here hits an unrelated append-only guard on
-- record_corrections, which a rolled-back test session sidesteps entirely).
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_get_functiondef('private.patient_has_feature_access(uuid,text)'::regprocedure) !~ 'programme_purchases' then
    raise exception 'FAIL: patient_has_feature_access no longer checks programme_purchases';
  end if;
  if pg_get_functiondef('private.patient_has_feature_access(uuid,text)'::regprocedure) !~ 'service_purchases' then
    raise exception 'FAIL: patient_has_feature_access no longer checks service_purchases';
  end if;
  if pg_get_functiondef('public.has_feature_access(text)'::regprocedure) !~ 'patient_has_feature_access' then
    raise exception 'FAIL: public.has_feature_access no longer delegates to private.patient_has_feature_access';
  end if;
end $$;
