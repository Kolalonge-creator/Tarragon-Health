-- Tarragon Health — risk-triggered proactive outreach engine.
--
-- The connecting layer between the risk/care-gap data the platform already
-- computes (patient_risk_scores, the patient_care_gaps view) and someone
-- actually acting on it. Until now a high-risk score or an open care gap sat
-- passively on dashboards; nothing turned it into work. This migration adds:
--
--   care_outreach_tasks — a coordinator worklist row per (patient, trigger),
--     produced nightly by private.queue_care_outreach(). Logistics-only:
--     coordinators contact/book/track — anything needing clinical judgment
--     still routes through the existing escalation/alert machinery, which this
--     deliberately does not touch. Internal worklist: patients never see these
--     rows (they get a warm nudge notification instead).
--
--   private.queue_care_outreach() + daily cron — scans the latest risk score
--     per patient (high/very_high, recent) and the open care-gap view, inserts
--     open tasks idempotently, and enqueues at most one aggregated patient
--     nudge notification per patient per run (only for newly created tasks, so
--     re-runs never re-nudge). WhatsApp/SMS here is notification-layer only —
--     the nudge asks the patient to open the app; nothing depends on the send.
--
-- The trigger_detail payload keeps the provenance (score id / gap shape) so a
-- coordinator sees WHY the patient surfaced without re-deriving it.

create type public.outreach_trigger_type as enum (
  'high_risk_score',
  'overdue_screening',
  'stale_monitoring',
  'unactioned_abnormal'
);

create type public.outreach_task_status as enum (
  'open',
  'in_progress',
  'contacted',
  'resolved',
  'dismissed'
);

create table public.care_outreach_tasks (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  trigger_type     public.outreach_trigger_type not null,
  trigger_detail   jsonb not null default '{}'::jsonb,
  -- 1 = act first (unactioned abnormal / very high risk), 3 = routine.
  priority         smallint not null default 2 check (priority between 1 and 3),
  status           public.outreach_task_status not null default 'open',
  assigned_to      uuid references public.profiles (id) on delete set null,
  outcome_note     text,
  nudge_sent_at    timestamptz,
  resolved_by      uuid references public.profiles (id) on delete set null,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index care_outreach_tasks_org_status_idx
  on public.care_outreach_tasks (organisation_id, status, priority);
create index care_outreach_tasks_patient_idx
  on public.care_outreach_tasks (patient_id);

-- One live task per patient+trigger shape — the nightly scan can run forever
-- without piling up duplicates; a resolved/dismissed task allows a fresh one
-- if the condition recurs later.
create unique index care_outreach_tasks_live_unique
  on public.care_outreach_tasks (patient_id, trigger_type)
  where status in ('open', 'in_progress', 'contacted');

create trigger care_outreach_tasks_set_updated_at
  before update on public.care_outreach_tasks
  for each row execute function private.set_updated_at();

-- Ops audit stamp, server-derived: whoever moves a task to resolved/dismissed
-- is recorded from their own session — client-supplied values are overwritten.
-- (This is an ops log, not a clinical-attribution claim; no UI renders it as
-- "reviewed by a doctor".)
create or replace function private.stamp_outreach_resolution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('resolved', 'dismissed') and old.status not in ('resolved', 'dismissed') then
    new.resolved_at := now();
    new.resolved_by := (select auth.uid());
  elsif new.status not in ('resolved', 'dismissed') then
    new.resolved_at := null;
    new.resolved_by := null;
  end if;
  return new;
end;
$$;

create trigger care_outreach_tasks_stamp_resolution
  before update on public.care_outreach_tasks
  for each row execute function private.stamp_outreach_resolution();

alter table public.care_outreach_tasks enable row level security;

-- Staff-only in both directions: this is an internal worklist. Coordinator
-- write access here is deliberate and allowed — outreach is logistics
-- (contact, book, note), never medication/escalation/protocol writes.
create policy care_outreach_tasks_select on public.care_outreach_tasks
  for select to authenticated
  using (private.is_org_staff(organisation_id));
create policy care_outreach_tasks_insert on public.care_outreach_tasks
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
create policy care_outreach_tasks_update on public.care_outreach_tasks
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.care_outreach_tasks to authenticated;

-- ---------------------------------------------------------------------------
-- The nightly engine.
-- ---------------------------------------------------------------------------
create or replace function private.queue_care_outreach()
returns void
language sql
security definer
set search_path = ''
as $$
  with latest_risk as (
    select distinct on (prs.patient_id)
      prs.patient_id, prs.organisation_id, prs.risk_level, prs.score_type,
      prs.id as score_id, prs.computed_at
    from public.patient_risk_scores prs
    where prs.computed_at >= now() - interval '120 days'
    order by prs.patient_id, prs.computed_at desc
  ),
  candidates as (
    -- High/very-high latest risk score → priority 1/2.
    select
      lr.organisation_id,
      lr.patient_id,
      'high_risk_score'::public.outreach_trigger_type as trigger_type,
      jsonb_build_object(
        'risk_level', lr.risk_level,
        'score_type', lr.score_type,
        'score_id', lr.score_id,
        'computed_at', lr.computed_at
      ) as trigger_detail,
      case when lr.risk_level = 'very_high' then 1 else 2 end as priority
    from latest_risk lr
    where lr.risk_level in ('high', 'very_high')

    union all

    -- Open care gaps (derived view; recomputed live each run).
    select
      g.organisation_id,
      g.patient_id,
      case g.gap_type
        when 'unactioned_abnormal' then 'unactioned_abnormal'
        when 'overdue_screening' then 'overdue_screening'
        else 'stale_monitoring'
      end::public.outreach_trigger_type,
      g.detail || jsonb_build_object('condition_or_type', g.condition_or_type, 'opened_at', g.opened_at),
      case g.gap_type
        when 'unactioned_abnormal' then 1
        when 'overdue_screening' then 2
        else 3
      end
    from public.patient_care_gaps g
  ),
  inserted as (
    -- nudge_sent_at is stamped at insert because the nudge below is enqueued
    -- for every newly inserted task's patient in this same transaction. (A
    -- post-hoc UPDATE can't work here: data-modifying CTEs share one snapshot,
    -- so a sibling statement never sees the rows this INSERT creates.)
    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail, priority, nudge_sent_at)
    select organisation_id, patient_id, trigger_type, trigger_detail, priority, now()
    from candidates
    on conflict (patient_id, trigger_type)
      where status in ('open', 'in_progress', 'contacted')
      do nothing
    returning id, organisation_id, patient_id, trigger_type
  )
  -- One aggregated, warm nudge per patient per run — only when something NEW
  -- surfaced (re-runs insert nothing, so nobody is re-nudged nightly).
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    i.organisation_id,
    i.patient_id,
    'whatsapp',
    'pending',
    'care_outreach_checkin',
    jsonb_build_object('reasons', array_agg(distinct i.trigger_type::text))
  from inserted i
  group by i.organisation_id, i.patient_id;
$$;

select cron.schedule(
  'care-outreach-daily',
  '45 6 * * *',
  $$select private.queue_care_outreach();$$
);
