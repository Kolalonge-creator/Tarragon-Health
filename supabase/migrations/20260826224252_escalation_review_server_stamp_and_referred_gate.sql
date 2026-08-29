-- Tarragon Health
-- Two related attribution/authority gaps found during a 2026-08-26 indemnity/
-- liability audit, both in the same function
-- (private.enforce_emergency_escalation_tier, 20260812003707):
--
-- 1. ATTRIBUTION IS STILL CLIENT-SUPPLIED. escalations.reviewed_by/reviewed_at
--    are set by the caller's own mutation (useResolveEscalation in
--    lib/queries/escalations.ts, writeResolution in
--    lib/case-cockpit/actions.ts) -- `reviewed_by: user.id` is trusted, not
--    re-derived. Every OTHER "who did this clinical act" column on this
--    platform (case_review_actions.confirmed_by_staff, protocol_versions.
--    approved_by, the four stamp_*_review_completion functions, async_consults
--    .answered_by) is server-derived from auth.uid() inside a trigger
--    precisely so a legitimate clinical-tier caller cannot write a colleague's
--    id into a "Reviewed by Dr. X" field. escalations.reviewed_by is the one
--    remaining exception, closed here the same way.
--
-- 2. 'referred' TRANSITIONS ARE UNGATED. v_resolving in the existing trigger
--    only recognised new.status = 'resolved' -- a transition to 'referred'
--    (the OTHER terminal state useResolveEscalation writes) fell through the
--    "if not (v_claiming or v_resolving) then return new" early-out entirely,
--    so a Care Coordinator could refer (and, per bug 1, get themselves
--    reviewed_by-stamped on) a non-emergency escalation with no clinical-tier
--    check at all. CLAUDE.md: "Care Coordinator write access ... must never
--    gain write access to ... escalation resolution" -- referring a case away
--    is the same clinical act as resolving it, just with a different outcome.
--
-- Fix: rename the local variable's intent to "terminal transition" (resolved
-- OR referred), gate both under the same clinical-tier + emergency-authority
-- checks as before, derive reviewed_by/reviewed_at server-side for both, block
-- re-deciding a case that already reached a terminal state (no retroactive
-- attribution, same discipline as protocol_versions/case_review_actions), and
-- otherwise leave a terminal row's reviewed_by/reviewed_at untouched by any
-- later, unrelated field edit.

create or replace function private.enforce_emergency_escalation_tier()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_is_emergency boolean;
  v_claiming boolean;
  v_terminal_transition boolean;
begin
  v_claiming := new.assigned_doctor_id is not null and old.assigned_doctor_id is null;
  v_terminal_transition := new.status in ('resolved', 'referred') and old.status is distinct from new.status;

  if not (v_claiming or v_terminal_transition) then
    -- No clinical act on this row. Still: attribution on an already-decided
    -- case is history, so an unrelated field edit (e.g. a later correction to
    -- reason) can never carry reviewed_by/reviewed_at along for the ride.
    if old.status in ('resolved', 'referred') then
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;
    return new;
  end if;

  -- No re-deciding a case that already reached a terminal state.
  if v_terminal_transition and old.status in ('resolved', 'referred') then
    raise exception 'This case was already %; it cannot be re-resolved or re-referred.', old.status
      using errcode = '42501';
  end if;

  -- Baseline for ANY escalation: claiming, resolving, or referring is a
  -- clinical act. A Care Coordinator may read a case, add notes, and hand it
  -- to a doctor (useRaiseEscalation), but must never claim, resolve, or refer
  -- one themselves.
  if not private.is_clinical_tier(new.organisation_id) then
    raise exception 'Only a clinical-tier member of the care team can % an escalation. A Care Coordinator can add notes and hand this to a doctor, but cannot claim, resolve, or refer it.',
      case when v_claiming then 'claim' when new.status = 'resolved' then 'resolve' else 'refer' end
      using errcode = '42501';
  end if;

  -- Either the system's own classification or a clinician's override being
  -- 'emergency' engages the stricter gate -- see the original 20260812003707
  -- header for why this is not coalesce(override_level, level). Applied to
  -- referring an emergency case away too: routing it off-platform is the same
  -- weight of decision as closing it, never a lighter one.
  select coalesce(level = 'emergency', false)
      or coalesce(override_level = 'emergency', false)
    into v_is_emergency
  from public.clinician_alerts
  where id = new.clinician_alert_id;

  if coalesce(v_is_emergency, false) and not private.can_handle_emergency_escalation(new.organisation_id) then
    raise exception 'An emergency escalation can only be % by a Tier 2 doctor or above, or the Clinical Director. You can still review this case, add notes, start a virtual review, and hand it to a senior colleague.',
      case when v_claiming then 'claimed' when new.status = 'resolved' then 'resolved' else 'referred' end
      using errcode = '42501';
  end if;

  -- Server-derived attribution -- never trust the client's reviewed_by/
  -- reviewed_at. This is the only place these columns are ever written, which
  -- is what lets ReviewedByDoctor null-gate on them safely.
  if v_terminal_transition then
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
  end if;

  return new;
end;
$function$;

comment on function private.enforce_emergency_escalation_tier() is
  'Gates claim/resolve/refer on an escalation to clinical-tier staff (emergency cases further gated to Tier 2+/Director), and server-derives reviewed_by/reviewed_at for the resolved/referred transition -- never client-supplied. No re-deciding a case once resolved or referred.';

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'enforce_emergency_escalation_tier';

  if v_def is null then
    raise exception 'private.enforce_emergency_escalation_tier missing after migration';
  end if;
  if v_def not ilike '%referred%' then
    raise exception 'FAIL: enforce_emergency_escalation_tier does not appear to gate the referred transition';
  end if;
  if v_def not ilike '%new.reviewed_by := (select auth.uid())%' then
    raise exception 'FAIL: enforce_emergency_escalation_tier does not appear to server-stamp reviewed_by';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.escalations'::regclass
      and tgname = 'escalations_enforce_emergency_authority'
      and not tgisinternal
  ) then
    raise exception 'escalations_enforce_emergency_authority trigger missing';
  end if;

  raise notice 'PASS: enforce_emergency_escalation_tier gates referred + server-stamps reviewed_by/reviewed_at';
end $$;
