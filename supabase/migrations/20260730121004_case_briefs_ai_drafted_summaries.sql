-- Tarragon Health
-- Phase 3 of the doctor-efficiency initiative: AI-drafted case briefs.
-- A doctor's limited minutes are dominated by reading/synthesizing a case,
-- not the decision itself -- this gives them a short, data-grounded summary
-- + suggested next action to read INSTEAD of the raw chart, never a
-- replacement for it (the raw data stays on the same page). Generated once
-- per escalation (on-claim, or on-demand via a "Generate" button), not
-- regenerated on every view/poll.
--
-- AI drafts, never decides: no diagnosis, no write path back into
-- clinical_notes/escalations/clinician_alerts, never auto-anything. This
-- table is a pure read/write surface for a display card, structurally
-- incapable of feeding back into a clinical action -- the app-layer session
-- calling it does not even hold the service-role write path this table
-- needs (see below), so a compromised patient/clinician session can neither
-- write nor overwrite one.

create type public.case_brief_status as enum ('generated', 'failed');

create table public.case_briefs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  escalation_id uuid not null unique references public.escalations (id) on delete cascade,
  patient_id uuid not null references public.profiles (id),
  status public.case_brief_status not null,
  model_id text not null,
  summary_text text,
  suggested_action_text text,
  -- Exactly what was sent to the model -- the audit/reproducibility record
  -- for a clinical-safety-adjacent AI output, same discipline as this
  -- codebase's other provenance columns (proof_log, audit_log).
  input_snapshot jsonb not null,
  error_message text,
  generated_at timestamptz not null default now()
);

comment on table public.case_briefs is
  'AI-drafted (Claude Haiku) case summaries for doctor escalations. Assistive only -- see the file header this migration ships with for the guardrails. Written only by the server-role case-brief generator, never by a user session.';
comment on column public.case_briefs.input_snapshot is
  'The exact minimized data snapshot sent to the model -- vitals/risk-score/care-plan/escalation-history fields only, never free-text clinical notes. Kept for audit and to detect staleness.';

alter table public.case_briefs enable row level security;

-- Read-only from a normal session: any org-staff member (is_org_staff) can
-- see a brief for a case in their org. There is deliberately NO insert/
-- update/delete policy -- every write goes through the service-role
-- generator function, matching payment_transactions' webhook-only-write
-- precedent. A patient never sees this table; escalations are staff-only.
create policy case_briefs_select on public.case_briefs
  for select
  using (private.is_org_staff(organisation_id));

create index case_briefs_escalation_id_idx on public.case_briefs (escalation_id);

do $$
begin
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'case_briefs'
  ) then
    raise exception 'case_briefs missing after migration';
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'case_briefs' and cmd = 'SELECT'
  ) then
    raise exception 'case_briefs has no SELECT policy';
  end if;

  if exists (
    select 1 from pg_policies
    where tablename = 'case_briefs' and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'case_briefs must have no direct write policy -- service-role only';
  end if;
end $$;
