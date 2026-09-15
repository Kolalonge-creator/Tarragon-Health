-- Patient Engagement Engine, step 5a: types + log table for the disengagement
-- recovery ladder (§16.8/16.16 — missed task -> reminder -> repeated miss ->
-- support message -> persistent non-engagement -> care coordinator ->
-- high-risk + non-engagement -> clinical review).
--
-- Deliberately reuses care_outreach_tasks (the existing coordinator worklist) for the
-- "care coordinator" hop rather than inventing a parallel worklist table — this
-- mirrors how queue_care_outreach() already handles every other outreach reason.
-- The final "clinical review" hop deliberately does NOT auto-create a
-- clinician_alerts row: that table's taxonomy (alert_rules, type_code, owner-tier
-- routing) is a separate, actively-evolving system this migration doesn't have full
-- visibility into, and CLAUDE.md's own history records is_org_staff-class functions
-- being gotten wrong more than once. Instead a high-risk + non-engaged patient gets
-- outreach priority 1 plus an explicit 'clinical_review_flag' log entry, so staff
-- triaging the coordinator worklist can see it needs escalation and route it through
-- the existing, already-correct clinician alert paths themselves.
--
-- The ADD VALUE below is intentionally its own migration file, used only in a later
-- one — a new enum value can't safely be referenced in the same transaction that adds
-- it; every prior outreach_trigger_type addition in this codebase follows the same
-- split.
alter type public.outreach_trigger_type add value if not exists 'disengagement_risk';

create type public.engagement_intervention_type as enum (
  'reminder', 'support_message', 'alternative_channel', 'care_coordinator_outreach', 'clinical_review_flag'
);

create table if not exists public.patient_engagement_interventions (
  id                           uuid primary key default gen_random_uuid(),
  organisation_id              uuid not null references public.organisations (id) on delete restrict,
  patient_id                   uuid not null references public.profiles (id) on delete cascade,
  trigger_reason               text not null,
  intervention_type            public.engagement_intervention_type not null,
  engagement_level_at_trigger  public.care_engagement_level not null,
  outreach_task_id             uuid references public.care_outreach_tasks (id) on delete set null,
  notification_id              uuid references public.notifications (id) on delete set null,
  created_at                   timestamptz not null default now()
);

create index if not exists patient_engagement_interventions_patient_idx
  on public.patient_engagement_interventions (patient_id, created_at desc);

alter table public.patient_engagement_interventions enable row level security;

-- Staff-only, same shape as care_outreach_tasks: this is an internal intervention
-- log, not patient-facing data (the patient sees the resulting notification itself).
drop policy if exists patient_engagement_interventions_staff on public.patient_engagement_interventions;
create policy patient_engagement_interventions_staff on public.patient_engagement_interventions
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_engagement_interventions to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'outreach_trigger_type' and e.enumlabel = 'disengagement_risk'
  ) then
    raise exception 'outreach_trigger_type is missing disengagement_risk after migration';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'patient_engagement_interventions'
  ) then
    raise exception 'patient_engagement_interventions table missing after migration';
  end if;
end $$;
