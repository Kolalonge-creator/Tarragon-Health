-- Tarragon Health
-- Extends AI-drafted case briefs to the clinician worklist (founder-
-- confirmed, same session as the PHI-to-Anthropic policy confirmation
-- below). Re-keys case_briefs from escalation_id to clinician_alert_id so
-- ONE brief serves both worklists: a clinician generates it on acknowledge
-- (lib/queries/clinician-alerts.ts useAcknowledgeAlert), and if that same
-- alert is later escalated to a doctor, the doctor sees the SAME brief
-- immediately -- no wasted regeneration, since clinician_alert_id is the
-- one identifier every escalation already carries
-- (escalations.clinician_alert_id, verified live: 0 of the current rows
-- have it null, though the column is nullable so the app-layer guards for
-- that case rather than assuming).
--
-- Table had zero rows (unshipped feature, only ever held deleted test
-- fixtures), so this is a clean structural swap, not a data migration.

drop table public.case_briefs;

create table public.case_briefs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  clinician_alert_id uuid not null unique references public.clinician_alerts (id) on delete cascade,
  patient_id uuid not null references public.profiles (id),
  status public.case_brief_status not null,
  model_id text not null,
  summary_text text,
  suggested_action_text text,
  input_snapshot jsonb not null,
  error_message text,
  generated_at timestamptz not null default now()
);

comment on table public.case_briefs is
  'AI-drafted (Claude Haiku) case summaries, keyed to the clinician_alert so one brief serves both the clinician worklist (generated on acknowledge) and the doctor escalation worklist (same brief, no regeneration on escalation). Assistive only. Written only by the server-role case-brief generator, never by a user session.';
comment on column public.case_briefs.input_snapshot is
  'The exact minimized data snapshot sent to the model -- vitals/risk-score/care-plan/escalation-history fields only, never free-text clinical notes. Kept for audit and to detect staleness.';

alter table public.case_briefs enable row level security;

create policy case_briefs_select on public.case_briefs
  for select
  using (private.is_org_staff(organisation_id));

-- The GRANT, not just the RLS policy -- RLS restricts rows, it does not by
-- itself grant table-level access. Missing this exact line was a real,
-- live bug in the first version of this table (caught live-verifying
-- Phase 3, see the 2026-07-30 changelog entry) -- fixed here from the start
-- this time instead of as a follow-up migration.
grant select on public.case_briefs to authenticated;

create index case_briefs_clinician_alert_id_idx on public.case_briefs (clinician_alert_id);

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

  if not has_table_privilege('authenticated', 'public.case_briefs', 'SELECT') then
    raise exception 'authenticated must have a table-level SELECT grant on case_briefs';
  end if;
end $$;
