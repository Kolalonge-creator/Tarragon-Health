-- Tarragon Health
-- Item 4 of a 2026-08-26 indemnity/liability audit: "a hard-coded referral-out
-- gate. The system should be physically incapable of continuing to manage a
-- patient once they fall outside protocol criteria."
--
-- WHAT ALREADY EXISTED, AND WHY IT WASN'T ENOUGH. lib/case-cockpit/propose.ts
-- (INVARIANT 3) already refuses to OFFER the one-click "Resolve case" shortcut
-- when a patient's data breaches a protocol red-flag threshold -- but a doctor
-- could still resolve the same case through the plain escalation-queue form
-- (useResolveEscalation), which never consulted this determination at all.
-- Removing a UI shortcut is not a gate; the doctor's authority to close the
-- case any other way was untouched. That is the gap this migration closes.
--
-- DESIGN. clinician_alerts gains a flag the deterministic engine already
-- computes (matchRedFlags' `breached` -- a real, numeric-threshold protocol
-- breach, never the `requiresJudgement` bucket, which is deliberately NOT a
-- hard gate -- see propose.ts's own header on why treating an unparseable
-- clinical-judgment criterion as unresolved would have quietly killed the
-- resolve shortcut for the platform's single biggest condition). Once set:
--   * resolving (closing) the linked escalation is blocked outright --
--     'referred' is the only way out.
--   * referring it away additionally requires a REAL specialist_referrals
--     row for the same patient to already exist, so "refer" cannot become a
--     second no-op shortcut -- the case must actually leave the platform's
--     AI-assisted management, not just change a status label.
--
-- KNOWN LIMIT, STATED PLAINLY RATHER THAN PAPERED OVER. The flag is populated
-- by lib/case-cockpit/actions.ts's proposeCaseActionsAction (see the
-- accompanying app-code change) -- i.e. whenever a doctor opens or refreshes
-- the case cockpit for that alert, which this platform's own design intends
-- as the normal path into a case. A doctor who resolves an escalation
-- straight from the queue's plain form WITHOUT ever opening the cockpit for
-- that alert will not yet have this determination computed, and the gate
-- cannot fire on data that was never derived. Fully closing that residual
-- gap needs either porting matchRedFlags' threshold parsing into SQL (a
-- materially larger, separate change) or making cockpit fact-loading a
-- required step before the resolve control is enabled in the UI -- flagged
-- as a follow-up, not attempted here.
--
-- Also not attempted here, for the same "do not guess at something not
-- verified" reason: "locks further AI-assisted management" for the AI Coach
-- specifically was scoped out -- lib/ai-coach/graph.ts is a LangGraph
-- pipeline this change was not able to verify the structure of, and a wrong
-- guess there risks breaking a live patient-facing safety flow. The DB-level
-- resolve/refer gate below is real and load-bearing on its own; AI Coach
-- lockout is a separate, larger piece of follow-up work.

alter table public.clinician_alerts
  add column protocol_scope_exceeded boolean not null default false,
  add column protocol_scope_exceeded_note text,
  add column protocol_scope_exceeded_at timestamptz;

comment on column public.clinician_alerts.protocol_scope_exceeded is
  'Set by the case-cockpit deterministic rule engine (lib/case-cockpit/propose.ts matchRedFlags -- the `breached` bucket only, never `requiresJudgement`) when the patient''s own data breaches a numeric protocol red-flag threshold. While true, private.enforce_protocol_scope_referral_gate blocks resolving the linked escalation and requires a real referral before it can be marked referred.';

create or replace function private.enforce_protocol_scope_referral_gate()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_exceeded boolean;
  v_patient_id uuid;
  v_exceeded_at timestamptz;
  v_has_referral boolean;
begin
  -- Only engage on the transition INTO a terminal state -- everything else
  -- (notes, claiming, non-terminal edits) is untouched by this gate.
  if new.status not in ('resolved', 'referred') or old.status = new.status then
    return new;
  end if;

  select ca.protocol_scope_exceeded, ca.protocol_scope_exceeded_at, ca.patient_id
    into v_exceeded, v_exceeded_at, v_patient_id
  from public.clinician_alerts ca
  where ca.id = new.clinician_alert_id;

  if not coalesce(v_exceeded, false) then
    return new;
  end if;

  if new.status = 'resolved' then
    raise exception 'This case is flagged outside protocol scope (%). It cannot be resolved on-platform -- refer it to a specialist instead.',
      coalesce(nullif(btrim((select protocol_scope_exceeded_note from public.clinician_alerts where id = new.clinician_alert_id)), ''), 'a recorded protocol red flag')
      using errcode = '42501';
  end if;

  -- new.status = 'referred': still requires a REAL referral to exist for this
  -- patient -- matching patient_id and created after the case was flagged, so
  -- an old, unrelated referral cannot silently satisfy this. specialist_
  -- referrals carries no clinician_alert_id FK to join on directly (it long
  -- predates this gate), so patient_id + timestamp ordering is the strongest
  -- link available without a larger schema change -- stated plainly, not
  -- hidden, per this migration's header.
  select exists (
    select 1 from public.specialist_referrals sr
    where sr.patient_id = v_patient_id
      and sr.created_at >= coalesce(v_exceeded_at, new.created_at)
      and sr.status <> 'declined'
  ) into v_has_referral;

  if not v_has_referral then
    raise exception 'This case is flagged outside protocol scope. Create a specialist referral for this patient before marking the case referred.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function private.enforce_protocol_scope_referral_gate() is
  'Blocks resolving an escalation whose linked clinician_alerts.protocol_scope_exceeded is true, and requires a real specialist_referrals row for the same patient before it can be marked referred. See clinician_alerts.protocol_scope_exceeded''s own comment for how the flag is set and its known limit.';

create trigger escalations_enforce_protocol_scope_referral_gate
  before update on public.escalations
  for each row
  execute function private.enforce_protocol_scope_referral_gate();

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinician_alerts'
      and column_name = 'protocol_scope_exceeded'
  ) then
    raise exception 'clinician_alerts.protocol_scope_exceeded missing after migration';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.escalations'::regclass
      and tgname = 'escalations_enforce_protocol_scope_referral_gate'
      and not tgisinternal
  ) then
    raise exception 'escalations_enforce_protocol_scope_referral_gate trigger missing';
  end if;

  raise notice 'PASS: protocol-scope referral gate column + trigger present';
end $$;
