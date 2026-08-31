-- Tarragon Health
-- Two automation gaps closed on explicit founder ask, following the
-- doctor-tier collapse (20260830231508): the CMO should not be a manual
-- dispatcher for every patient -- cases should route to a doctor's queue
-- automatically, with the CMO free to oversee, rebalance, and personally
-- pick up any case exactly like any other doctor, only where automation
-- can't decide on its own.
--
-- Part A -- escalations get the same push-based, least-loaded-doctor
-- auto-assignment public.clinician_alerts already has (classify_and_assign_
-- clinician_alert(), 20260828014055). Escalations never had this: they were
-- an open queue any qualifying doctor self-claimed from. "Claiming" is
-- redefined as starting review (status open -> under_review) on a case
-- that's already been routed to you, rather than the act of taking
-- ownership of an unowned case -- ownership now happens automatically at
-- creation.
--
-- Part B -- specialist_referrals gets the same shape of matching:
-- clinical_staff gains a `specialist_type` (the credentialed enum value
-- used for matching, distinct from the free-text `specialty` display
-- field), and a new referral is matched at creation to the least-loaded
-- active clinical_staff row of that specialist_type, if one exists.
-- Deliberately reuses the existing `fulfilment = 'partner'` value rather
-- than adding a new enum label -- ALTER TYPE ... ADD VALUE cannot be used
-- in the same transaction as anything that uses the new value, which would
-- have made this migration untestable in one shot; `partner` fulfilment's
-- only current constraint is "self_arranged forbids it", so reusing it for
-- an internally-matched referral doesn't conflict with anything, and the
-- existing payment/commission machinery (specialist_referrals_record_
-- commission, ...enqueue_notifications) is keyed off `status` reaching
-- 'payment_confirmed', not off `fulfilment` -- an internally-matched
-- referral never needs to reach that status, so it never touches that
-- machinery. `assigned_specialist_id` (new column) is what actually
-- distinguishes "matched to one of our own clinical_staff" from "matched to
-- an external specialist_providers row" (`specialist_provider_id`, existing,
-- untouched) -- the two are made mutually exclusive by a new CHECK.
-- "Instantly active once a specialist is onboarded": activating a
-- clinical_staff row (or giving an already-active one a specialist_type)
-- sweeps any currently-unmatched referral of that specialist_type and
-- assigns it retroactively, so a backlog that was waiting on a specialty
-- clears the moment that specialty becomes available, without anyone
-- re-running the referral flow.

-- ---------------------------------------------------------------------------
-- Part A: escalation auto-assignment
-- ---------------------------------------------------------------------------

create or replace function private.auto_assign_escalation()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_alert_owner_profile uuid;
  v_alert_owner_tier public.doctor_tier;
  v_needs_emergency_authority boolean;
  v_candidate_profile uuid;
begin
  -- An explicit assignment (e.g. a future admin/API path) is never overridden.
  if new.assigned_doctor_id is not null then
    return new;
  end if;

  -- Continuity first: if this escalation was raised from a clinician_alert
  -- that already has an auto-assigned owner (private.classify_and_assign_
  -- clinician_alert), keep the same doctor on it rather than re-routing --
  -- unless that owner's tier can't clear this case's emergency bar, in which
  -- case fall through to picking a senior doctor instead.
  if new.clinician_alert_id is not null then
    select (ca.level = 'emergency') or (ca.override_level = 'emergency'),
           cs.profile_id, cs.doctor_tier
      into v_needs_emergency_authority, v_alert_owner_profile, v_alert_owner_tier
    from public.clinician_alerts ca
    left join public.clinical_staff cs
      on cs.id = ca.responsible_clinician_id and cs.active
    where ca.id = new.clinician_alert_id;
  end if;

  if v_alert_owner_profile is not null
     and (
       not coalesce(v_needs_emergency_authority, false)
       or v_alert_owner_tier in ('senior_medical_officer', 'chief_medical_officer')
     )
  then
    new.assigned_doctor_id := v_alert_owner_profile;
    return new;
  end if;

  -- Otherwise: the least-loaded active doctor at a tier that can handle
  -- this case (Senior Medical Officer+ if it needs emergency authority,
  -- any clinical tier otherwise). Load = currently open/under_review
  -- escalations already assigned to them -- same shape of measure as
  -- lib/staffing/caseload.ts, just scoped to this one signal since that's
  -- all a placement decision needs.
  select cs.profile_id into v_candidate_profile
  from public.clinical_staff cs
  where cs.organisation_id = new.organisation_id
    and cs.active
    and cs.profile_id is not null
    and (
      (coalesce(v_needs_emergency_authority, false)
        and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer'))
      or
      (not coalesce(v_needs_emergency_authority, false)
        and cs.doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer'))
    )
  order by (
    select count(*) from public.escalations e
    where e.assigned_doctor_id = cs.profile_id and e.status in ('open', 'under_review')
  ) asc, cs.created_at asc
  limit 1;

  -- Stays null if nobody currently qualifies (e.g. a brand-new org with no
  -- staff yet, or everyone inactive) -- fails open to the CMO's manual
  -- assignment, or any qualifying doctor's self-claim once someone
  -- qualifies, rather than raising.
  new.assigned_doctor_id := v_candidate_profile;
  return new;
end;
$function$;

create trigger escalations_auto_assign
  before insert on public.escalations
  for each row execute function private.auto_assign_escalation();

-- Redefines "claiming" as starting review (status open -> under_review) on
-- an already-assigned case, rather than the act of taking ownership of an
-- unowned one -- ownership now happens at creation via the trigger above.
-- Restricts starting review to the assigned doctor or the Chief Medical
-- Officer (who may step directly into any case): letting a bystander doctor
-- start someone else's routed case would undermine the load-balanced
-- routing the whole point of this migration is to add. Reassignment itself
-- (changing assigned_doctor_id) is unaffected -- still governed solely by
-- private.enforce_escalation_reassignment_authority (20260830231508),
-- CMO-only unless self-assigning. The self-claim fallback for a case
-- auto-assignment couldn't route (assigned_doctor_id left null) still works
-- unchanged: any qualifying-tier doctor may set assigned_doctor_id to
-- themselves via that same reassignment trigger (self-assignment is exempt
-- from its CMO-only gate), then start review on it.
create or replace function private.enforce_emergency_escalation_tier()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_is_emergency boolean;
  v_starting boolean;
  v_terminal_transition boolean;
begin
  v_starting := new.status = 'under_review' and old.status = 'open';
  v_terminal_transition := new.status in ('resolved', 'referred') and old.status is distinct from new.status;

  if not (v_starting or v_terminal_transition) then
    if old.status in ('resolved', 'referred') then
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;
    return new;
  end if;

  if v_terminal_transition and old.status in ('resolved', 'referred') then
    raise exception 'This case was already %; it cannot be re-resolved or re-referred.', old.status
      using errcode = '42501';
  end if;

  if not private.is_clinical_tier(new.organisation_id) then
    raise exception 'Only a clinical-tier member of the care team can % an escalation. A Care Coordinator can add notes and hand this to a doctor, but cannot start, resolve, or refer it.',
      case when v_starting then 'start reviewing' when new.status = 'resolved' then 'resolve' else 'refer' end
      using errcode = '42501';
  end if;

  if v_starting
     and new.assigned_doctor_id is distinct from (select auth.uid())
     and not exists (
       select 1 from public.clinical_staff
       where profile_id = (select auth.uid())
         and organisation_id = new.organisation_id
         and active
         and doctor_tier = 'chief_medical_officer'
     )
  then
    raise exception 'Only the doctor this case is assigned to, or the Chief Medical Officer, can start reviewing it. Ask the Chief Medical Officer to reassign it if you should be the one working it.'
      using errcode = '42501';
  end if;

  if v_starting or new.status = 'resolved' then
    select coalesce(level = 'emergency', false)
        or coalesce(override_level = 'emergency', false)
      into v_is_emergency
    from public.clinician_alerts
    where id = new.clinician_alert_id;

    if coalesce(v_is_emergency, false) and not private.can_handle_emergency_escalation(new.organisation_id) then
      raise exception 'An emergency escalation can only be % by a Senior Medical Officer or the Chief Medical Officer. You can still review this case, add notes, start a virtual review, and hand it to a senior colleague.',
        case when v_starting then 'started' else 'resolved' end
        using errcode = '42501';
    end if;
  end if;

  if v_terminal_transition then
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Part B: specialist-referral matching
-- ---------------------------------------------------------------------------

alter table public.clinical_staff
  add column specialist_type public.specialist_type;

alter table public.clinical_staff
  add constraint clinical_staff_specialist_type_requires_senior_tier
  check (specialist_type is null or doctor_tier in ('senior_medical_officer', 'chief_medical_officer'));

create index clinical_staff_specialist_type_idx
  on public.clinical_staff (organisation_id, specialist_type)
  where active and specialist_type is not null;

alter table public.specialist_referrals
  add column assigned_specialist_id uuid references public.clinical_staff (id) on delete set null;

alter table public.specialist_referrals
  add constraint specialist_referrals_one_specialist_kind
  check (specialist_provider_id is null or assigned_specialist_id is null);

create index specialist_referrals_assigned_specialist_idx
  on public.specialist_referrals (assigned_specialist_id)
  where assigned_specialist_id is not null;

create or replace function private.enforce_referral_fulfilment()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.fulfilment = 'self_arranged' then
    if new.specialist_provider_id is not null then
      raise exception 'A self-arranged referral names no specialist: the patient chooses who to see'
        using errcode = '23514';
    end if;
    if new.assigned_specialist_id is not null then
      raise exception 'A self-arranged referral is not matched to one of Tarragon''s own specialists: the patient chooses who to see'
        using errcode = '23514';
    end if;
    if coalesce(new.referral_fee_kobo, 0) <> 0 then
      raise exception 'A self-arranged referral is not billed by Tarragon — the patient pays the specialist directly'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

-- Fires before enforce_specialist_referral_create/enforce_referral_fulfilment
-- (alphabetically "auto_match..." sorts before "enforce_...") so those
-- validate the final state this trigger produces. Derives organisation_id
-- itself from patient_id rather than depending on enforce_specialist_
-- referral_create having already run -- keeps this trigger correct
-- regardless of firing order.
create or replace function private.auto_match_internal_specialist()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_org uuid;
  v_match_id uuid;
begin
  -- A caller who already named a specific external partner or internal
  -- specialist made that call on purpose -- never silently override it.
  if new.specialist_provider_id is not null or new.assigned_specialist_id is not null then
    return new;
  end if;

  select organisation_id into v_org from public.profiles where id = new.patient_id;
  if v_org is null then
    return new;
  end if;

  select cs.id into v_match_id
  from public.clinical_staff cs
  where cs.organisation_id = v_org
    and cs.active
    and cs.specialist_type = new.specialist_type
  order by (
    select count(*) from public.specialist_referrals sr
    where sr.assigned_specialist_id = cs.id
      and sr.status not in ('completed', 'closed', 'declined')
  ) asc, cs.created_at asc
  limit 1;

  if v_match_id is not null then
    new.assigned_specialist_id := v_match_id;
    new.fulfilment := 'partner';
  end if;

  return new;
end;
$function$;

create trigger specialist_referrals_auto_match_internal_specialist
  before insert on public.specialist_referrals
  for each row execute function private.auto_match_internal_specialist();

-- "Instantly active once we get specialist onboard": the moment a
-- clinical_staff row becomes a real, active, matchable specialist (newly
-- activated with a specialist_type set, or given one while already active),
-- sweep any referral of that specialist_type nobody -- human or system --
-- has claimed yet and assign it. Clears a backlog that was waiting on a
-- specialty without anyone re-running the referral flow.
create or replace function private.sweep_referrals_on_specialist_activation()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.specialist_type is not null
     and new.active
     and (not old.active or old.specialist_type is distinct from new.specialist_type)
  then
    update public.specialist_referrals
      set assigned_specialist_id = new.id,
          fulfilment = 'partner'
      where organisation_id = new.organisation_id
        and specialist_type = new.specialist_type
        and assigned_specialist_id is null
        and specialist_provider_id is null
        and status not in ('completed', 'closed', 'declined');
  end if;
  return new;
end;
$function$;

create trigger clinical_staff_sweep_referrals_on_activation
  after update on public.clinical_staff
  for each row execute function private.sweep_referrals_on_specialist_activation();

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_col_count int;
  v_constraint_count int;
  v_trigger_count int;
begin
  select count(*) into v_col_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'clinical_staff' and column_name = 'specialist_type';
  if v_col_count <> 1 then
    raise exception 'clinical_staff.specialist_type was not added';
  end if;

  select count(*) into v_col_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'specialist_referrals' and column_name = 'assigned_specialist_id';
  if v_col_count <> 1 then
    raise exception 'specialist_referrals.assigned_specialist_id was not added';
  end if;

  select count(*) into v_constraint_count
  from pg_constraint
  where conname in ('clinical_staff_specialist_type_requires_senior_tier', 'specialist_referrals_one_specialist_kind');
  if v_constraint_count <> 2 then
    raise exception 'expected both new CHECK constraints, found %', v_constraint_count;
  end if;

  select count(*) into v_trigger_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal
    and t.tgname in (
      'escalations_auto_assign',
      'specialist_referrals_auto_match_internal_specialist',
      'clinical_staff_sweep_referrals_on_activation'
    );
  if v_trigger_count <> 3 then
    raise exception 'expected all 3 new triggers to exist, found %', v_trigger_count;
  end if;

  -- Proves the redefined enforce_emergency_escalation_tier still compiles
  -- and every gate function it calls still executes cleanly.
  perform private.is_clinical_tier('00000000-0000-0000-0000-000000000001');
  perform private.can_handle_emergency_escalation('00000000-0000-0000-0000-000000000001');
end $$;
