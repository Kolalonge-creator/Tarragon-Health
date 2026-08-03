-- Tarragon Health
-- Emergency escalations require Tier 2+ (or the org's Clinical Director) to
-- claim or resolve.
--
-- Founder decision 2026-07-31, taken alongside the doctor->clinician account
-- role merge in 20260731020000. That merge deliberately unifies PAGE ACCESS
-- (every doctor sees the same worklists regardless of tier) but must not
-- silently unify CLINICAL AUTHORITY: before the merge, only a Tier 4/5
-- 'doctor'-role account could reach /doctor/escalations at all, so the
-- account-role split was doing double duty as an authority gate by accident.
-- Removing it without this migration would newly let a Tier 1 Medical
-- Officer claim and close an emergency-level case -- authority the Clinical
-- Tier Ladder (docs/Tarragon_Health_Master_Operating_Plan_v4.md §4/§8) never
-- gave them. Cheap to add now, while only 2 QA fixtures ever held the
-- 'doctor' role and no real doctor account depends on current behaviour.
--
-- DB-enforced, not app-layer only, for the same reason
-- 20260715181500_pharmacy_authority_by_tier.sql spells out: closing an
-- emergency clinical case is a regulated clinical act, the same class of
-- structural gate as private.has_prescribing_authority /
-- enforce_clinical_staff_indemnity -- not a logistics-only restriction like
-- Care Coordinator write access (which CLAUDE.md keeps app-layer only).
--
-- Same "RLS admits broadly, a trigger narrows" shape as
-- enforce_medication_confirm_only and enforce_alert_override_clinical_only:
-- escalations' UPDATE policy stays org-staff-wide (the gate depends on the
-- linked alert's level, a join an RLS policy shouldn't be carrying), and
-- this trigger refuses the two specific transitions.
--
-- SCOPE, deliberate and narrow -- everything not listed here is unchanged:
--   * Only 'emergency'. urgent_escalation / clinician_review / routine stay
--     open to every tier, since those are exactly what Tier 1 is defined to
--     handle. Same scoping call, and same reasoning, as
--     20260730092804_i5_emergency_escalation_synchronous_contact.
--   * Only two transitions: CLAIM (assigned_doctor_id null -> set) and
--     RESOLVE (status -> 'resolved'). Claiming is gated as well as resolving
--     because a claimed case leaves the unclaimed pool and reads as handled
--     -- a Tier 1 taking an emergency they cannot close is the actual harm,
--     and it is invisible until the SLA burns.
--   * 'referred' is NOT gated (forwarding a case on is not closing it) --
--     consistent with I5's own boundary.
--   * Reading, note-taking, starting a virtual review, and overriding the
--     classification are all untouched -- a Tier 1 can still fully work the
--     case up and hand it over.
--
-- EFFECTIVE LEVEL: the gate fires when EITHER clinician_alerts.level OR
-- override_level is 'emergency' -- not coalesce(override_level, level) as
-- the worklist ranking uses. Two reasons, both real:
--   (a) coalesce alone is trivially bypassable -- a Tier 1 holds an active
--       clinical_staff row, so enforce_alert_override_clinical_only lets them
--       override an emergency down to routine and then claim it.
--   (b) downgrading a system-flagged emergency is itself a senior judgment.
--       If the system said emergency, a Tier 2+ closes it either way.
-- Overriding a routine case UP to emergency also engages the gate, which is
-- the same rule read in the other direction.
--
-- MDCN/regulatory confirmation of this tier authority split remains a
-- founder open item (master plan §16) -- this enforces the documented
-- internal model, it does not claim regulator sign-off.

-- Deliberately a separate function from private.has_prescribing_authority
-- rather than a reuse, despite the tier list being identical today: these
-- gate different clinical acts and should be free to diverge without one
-- silently changing the other.
create or replace function private.can_handle_emergency_escalation(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and (
        is_clinical_director
        or doctor_tier in ('tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
      )
  );
$$;

comment on function private.can_handle_emergency_escalation(uuid) is
  'Tier 2+ or the org Clinical Director. Gates claiming/resolving an emergency-level escalation (see escalations_enforce_emergency_tier). Mirrored for friendly UI only by canHandleEmergencyEscalation() in apps/web/src/lib/clinical/doctor-tier.ts -- this function is the enforcement boundary.';

create or replace function private.enforce_emergency_escalation_tier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Either the system's own classification or a clinician's override being
  -- 'emergency' engages the gate -- see the EFFECTIVE LEVEL note above for
  -- why this is not coalesce(override_level, level).
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
$$;

-- TRIGGER NAME IS LOAD-BEARING, do not rename casually. Postgres fires
-- same-timing row triggers in alphabetical order, and
-- escalations_enforce_emergency_synchronous_contact (I5, 20260730092804)
-- is already BEFORE UPDATE on this table. "...authority" sorts before
-- "...synchronous_contact", so a Tier 1 attempting to resolve an emergency
-- gets the accurate "you need Tier 2" message rather than I5's
-- "start a virtual review first" -- which would be misleading advice, since
-- completing a virtual review still would not let them close the case.
create trigger escalations_enforce_emergency_authority
  before update on public.escalations
  for each row execute function private.enforce_emergency_escalation_tier();

-- ---------------------------------------------------------------------------
-- Assertions -- the migration is the test.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'escalations_enforce_emergency_authority'
      and tgrelid = 'public.escalations'::regclass
      and not tgisinternal
  ) then
    raise exception 'escalations_enforce_emergency_authority trigger was not created';
  end if;

  -- The ordering guarantee above, asserted rather than trusted: this name
  -- must sort before I5's synchronous-contact trigger so the tier message
  -- wins on a resolve attempt.
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.escalations'::regclass
      and not tgisinternal
      and tgname = 'escalations_enforce_emergency_synchronous_contact'
      and tgname < 'escalations_enforce_emergency_authority'
  ) then
    raise exception 'trigger ordering regression: the I5 synchronous-contact trigger now fires before the tier-authority trigger';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'can_handle_emergency_escalation'
  ) then
    raise exception 'private.can_handle_emergency_escalation was not created';
  end if;

  -- private-schema functions are never PostgREST-exposed, so there is no
  -- anon-execute revoke to make here (same as every other private.* helper);
  -- assert the schema placement instead, since putting this in public by
  -- mistake WOULD need one.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_handle_emergency_escalation'
  ) then
    raise exception 'can_handle_emergency_escalation must live in private, not public';
  end if;
end $$;
