-- Clinical-safety fix: any org staff (including a non-clinical Care
-- Coordinator) could previously claim or resolve a NON-emergency escalation,
-- because escalations_update RLS only checks private.is_org_staff (which
-- admits clinician/doctor/care_coordinator/admin) and the only tier-aware
-- trigger, escalations_enforce_emergency_authority, only engaged for
-- emergency-level cases. That let a Care Coordinator set escalations.reviewed_by
-- to their own id, which apps/web/src/components/reviewed-by-doctor.tsx then
-- renders as "Reviewed by Dr. <coordinator>" on the patient's own dashboard --
-- a false clinical attribution. CLAUDE.md: "Care Coordinator write access ...
-- must never gain write access to ... escalation resolution." Also closes the
-- write-before-check ordering issue in the case-cockpit confirm flow
-- (apps/web/src/lib/case-cockpit/actions.ts's writeResolution): the real
-- enforcement now lives on the write itself, not on which app code path
-- reaches it.
--
-- Also fixes private.stamp_async_consult_answer(), which gated on
-- "doctor_tier is not null" -- care_coordinator IS a non-null doctor_tier
-- value, so a Care Coordinator could answer a patient's async consult and be
-- rendered as "Answered by Dr. <coordinator>" (apps/web/src/app/(dashboard)/
-- patient/ask-a-doctor.tsx). Per the tier-authority-monotonicity invariant
-- (packages/db/tests/tier_authority_monotonicity.sql), non-clinical tiers must
-- be excluded BY NAME, never via an IS NOT NULL check.
--
-- Verified live in a rolled-back transaction: a real care_coordinator profile
-- was blocked (42501) from claiming a real open, non-emergency escalation;
-- a real tier_3 clinician in the same org succeeded on the same row.

create or replace function private.is_clinical_tier(org uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and (
        is_clinical_director
        or doctor_tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
      )
  );
$function$;

comment on function private.is_clinical_tier(uuid) is
  'Any clinical tier (1-5) or the Clinical Director -- excludes care_coordinator by name, per the tier-authority monotonicity invariant (packages/db/tests/tier_authority_monotonicity.sql). Mirrors apps/web/src/lib/clinical/doctor-tier.ts''s isClinicalTier(). The floor for "may act as a doctor at all" -- has_prescribing_authority/can_handle_emergency_escalation/can_confirm_medication_refill are narrower gates on top of this one.';

create or replace function private.enforce_emergency_escalation_tier()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_is_emergency boolean;
  v_claiming boolean;
  v_resolving boolean;
begin
  v_claiming := new.assigned_doctor_id is not null and old.assigned_doctor_id is null;
  v_resolving := new.status = 'resolved' and old.status is distinct from 'resolved';

  if not (v_claiming or v_resolving) then
    return new;
  end if;

  -- Baseline for ANY escalation: claiming or resolving is a clinical act. A
  -- Care Coordinator may read a case, add notes, and hand it to a doctor
  -- (useRaiseEscalation), but must never claim or close one out themselves.
  if not private.is_clinical_tier(new.organisation_id) then
    raise exception 'Only a clinical-tier member of the care team can % an escalation. A Care Coordinator can add notes and hand this to a doctor, but cannot claim or resolve it.',
      case when v_claiming then 'claim' else 'resolve' end
      using errcode = '42501';
  end if;

  -- Either the system's own classification or a clinician's override being
  -- 'emergency' engages the stricter gate -- see the EFFECTIVE LEVEL note
  -- above for why this is not coalesce(override_level, level).
  select coalesce(level = 'emergency', false)
      or coalesce(override_level = 'emergency', false)
    into v_is_emergency
  from public.clinician_alerts
  where id = new.clinician_alert_id;

  -- No linked alert (v_is_emergency null) is not an emergency.
  if not coalesce(v_is_emergency, false) then
    return new;
  end if;

  if not private.can_handle_emergency_escalation(new.organisation_id) then
    raise exception 'An emergency escalation can only be % by a Tier 2 doctor or above, or the Clinical Director. You can still review this case, add notes, start a virtual review, and hand it to a senior colleague.',
      case when v_claiming then 'claimed' else 'resolved' end
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

create or replace function private.stamp_async_consult_answer()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  if new.status = 'answered' and old.status <> 'answered' then
    select cs.id into v_staff
    from public.clinical_staff cs
    where cs.profile_id = (select auth.uid())
      and cs.organisation_id = new.organisation_id
      and cs.active
      and (
        cs.is_clinical_director
        or cs.doctor_tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
      );
    if v_staff is null then
      raise exception 'only an active doctor on this organisation''s care team can answer a consult'
        using errcode = '42501';
    end if;
    new.answered_by := v_staff;
    new.answered_at := now();
    if new.answer is null or length(btrim(new.answer)) = 0 then
      raise exception 'an answered consult must carry an answer';
    end if;
  elsif new.status <> 'answered' and old.status <> 'answered' then
    -- Not answered yet: nobody may pre-fill attribution.
    new.answered_by := null;
    new.answered_at := null;
    new.answer := null;
  else
    -- Already answered (e.g. answered -> closed): attribution is immutable.
    new.answered_by := old.answered_by;
    new.answered_at := old.answered_at;
    new.answer := old.answer;
  end if;
  return new;
end;
$function$;

do $$
declare
  v_gate_count int;
begin
  -- Non-vacuity: is_clinical_tier must be discoverable by the existing
  -- monotonicity test (private schema, single uuid arg, returns boolean,
  -- body mentions doctor_tier) and must deny care_coordinator.
  select count(*) into v_gate_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'is_clinical_tier'
    and pg_get_function_arguments(p.oid) = 'org uuid'
    and p.prorettype = 'boolean'::regtype
    and pg_get_functiondef(p.oid) ilike '%doctor_tier%';
  if v_gate_count <> 1 then
    raise exception 'private.is_clinical_tier not created in the shape the monotonicity test discovers it by';
  end if;
end $$;
