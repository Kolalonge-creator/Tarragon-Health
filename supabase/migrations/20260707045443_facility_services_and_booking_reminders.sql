-- Tarragon Health — Sprint 3 Phase 6 follow-up
-- Facility services ("what a facility offers") + booking appointment
-- reminders (30/7/3/1 days before requested_date).

-- ---------------------------------------------------------------------------
-- facility_services — mirrors lab_tests for lab_providers: a facility's
-- offerings, admin-maintained, same global-catalogue RLS shape as
-- facilities itself.
-- ---------------------------------------------------------------------------

create table public.facility_services (
  id                uuid primary key default gen_random_uuid(),
  facility_id       uuid not null references public.facilities (id) on delete cascade,
  name              text not null,
  description       text,
  price_kobo        bigint,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create index facility_services_facility_idx on public.facility_services (facility_id);

alter table public.facility_services enable row level security;

create policy facility_services_select on public.facility_services
  for select to authenticated using (true);
create policy facility_services_insert on public.facility_services
  for insert to authenticated with check (private.is_admin());
create policy facility_services_update on public.facility_services
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy facility_services_delete on public.facility_services
  for delete to authenticated using (private.is_admin());

grant select on public.facility_services to authenticated;
grant insert, update, delete on public.facility_services to authenticated;

-- ---------------------------------------------------------------------------
-- booking_reminder_sends — per-(booking_request, milestone) dedup state,
-- same trust model as vitals_reminder_state / medication_refill_state:
-- written exclusively by private.queue_booking_reminders() below.
-- ---------------------------------------------------------------------------

create table public.booking_reminder_sends (
  booking_request_id   uuid not null references public.booking_requests (id) on delete cascade,
  milestone_days        integer not null,
  sent_at                timestamptz not null default now(),
  primary key (booking_request_id, milestone_days)
);

alter table public.booking_reminder_sends enable row level security;

create policy booking_reminder_sends_admin_select
  on public.booking_reminder_sends for select
  to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- private.queue_booking_reminders() — daily milestone computation + queueing
--
-- Reminds a patient 30/7/3/1 days before their requested booking date,
-- for any request still 'requested' or 'confirmed' (not 'completed' or
-- 'cancelled'). The booking_reminder_sends PK is the dedup guard: the
-- insert...on conflict do nothing, then join back onto only the newly
-- inserted rows, ensures a milestone is only ever queued once even if this
-- function runs more than once on the same day.
-- ---------------------------------------------------------------------------

create or replace function private.queue_booking_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with milestones(days) as (values (30), (7), (3), (1)),
  due as (
    select
      br.id as booking_request_id,
      br.organisation_id,
      br.profile_id,
      br.service_type,
      br.requested_date,
      m.days as milestone_days,
      f.name as facility_name
    from public.booking_requests br
    join public.facilities f on f.id = br.facility_id
    cross join milestones m
    where br.status in ('requested', 'confirmed')
      and br.requested_date - current_date = m.days
  ),
  inserted_state as (
    insert into public.booking_reminder_sends (booking_request_id, milestone_days)
    select booking_request_id, milestone_days from due
    on conflict (booking_request_id, milestone_days) do nothing
    returning booking_request_id, milestone_days
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    d.organisation_id,
    d.profile_id,
    'whatsapp',
    'pending',
    'booking_reminder',
    jsonb_build_object(
      'facility_name', d.facility_name,
      'service_type', d.service_type,
      'requested_date', d.requested_date,
      'days_before', d.milestone_days
    )
  from due d
  join inserted_state s
    on s.booking_request_id = d.booking_request_id
   and s.milestone_days = d.milestone_days;
$$;

-- Daily schedule (07:00 Africa/Lagos = 06:00 UTC, no DST — matches the
-- vitals-reminders-daily / medication-refill cron cadence).
select cron.schedule(
  'booking-reminders-daily',
  '0 6 * * *',
  $$select private.queue_booking_reminders();$$
);
