-- Tarragon Health
-- Corrects a mistake in the immediately-preceding migration
-- (20260826224252_escalation_review_server_stamp_and_referred_gate), caught by
-- packages/db/tests/emergency_escalation_tier_gate.sql's own existing case 5
-- before it was ever committed: "Tier 1 marks an emergency escalation
-- 'referred' -> ALLOWED (handing it on is not closing it)".
--
-- That migration correctly closed the gap where a 'referred' transition had
-- NO clinical-tier check at all, but over-corrected by also routing 'referred'
-- through the Tier 2+/Director emergency-authority check that
-- 'resolved' (closing the case) requires. That is backwards for patient
-- safety: a Tier 1 doctor facing an emergency case they are not senior enough
-- to CLOSE must still always be able to REFER it up the chain immediately --
-- requiring extra seniority to hand off is exactly the scenario where a junior
-- doctor would otherwise be stuck sitting on a case they cannot act on and
-- cannot escalate. The emergency-authority gate exists to stop a case being
-- declared safely closed by someone too junior to make that call; it was never
-- meant to block routing a case to someone MORE senior.
--
-- Fix: the extra Tier 2+/Director emergency check now applies only to
-- new.status = 'resolved'. Both 'resolved' and 'referred' still require the
-- clinical-tier baseline (Care Coordinator excluded) and still get
-- reviewed_by/reviewed_at server-stamped, and neither can re-decide an
-- already-terminal case -- none of that was wrong, only the emergency-scope
-- widening was.

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
    raise exception 'Only a clinical-tier member of the care team can % an escalation. A Care Coordinator can add notes and hand this to a doctor, but cannot claim, resolve, or refer it.',
      case when v_claiming then 'claim' when new.status = 'resolved' then 'resolve' else 'refer' end
      using errcode = '42501';
  end if;

  -- CORRECTED SCOPE: only claiming or actually CLOSING (resolving) an
  -- emergency case requires Tier 2+/Director. Referring one onward is always
  -- open to any clinical tier -- see the header above.
  if v_claiming or new.status = 'resolved' then
    select coalesce(level = 'emergency', false)
        or coalesce(override_level = 'emergency', false)
      into v_is_emergency
    from public.clinician_alerts
    where id = new.clinician_alert_id;

    if coalesce(v_is_emergency, false) and not private.can_handle_emergency_escalation(new.organisation_id) then
      raise exception 'An emergency escalation can only be % by a Tier 2 doctor or above, or the Clinical Director. You can still review this case, add notes, start a virtual review, and hand it to a senior colleague.',
        case when v_claiming then 'claimed' else 'resolved' end
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

comment on function private.enforce_emergency_escalation_tier() is
  'Gates claim/resolve/refer on an escalation to clinical-tier staff. Claiming or RESOLVING (closing) an emergency case additionally requires Tier 2+/Director -- REFERRING one does not, so a junior doctor can always hand an emergency up the chain. Server-derives reviewed_by/reviewed_at for the resolved/referred transition. No re-deciding a case once resolved or referred.';

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
  if v_def not ilike '%v_claiming or new.status = ''resolved''%' then
    raise exception 'FAIL: emergency-authority check no longer scoped to claim/resolve only';
  end if;

  raise notice 'PASS: emergency-authority extra gate is scoped to claim/resolve, not referred';
end $$;
