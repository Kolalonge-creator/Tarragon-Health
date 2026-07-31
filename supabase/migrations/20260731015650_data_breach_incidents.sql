-- Tarragon Health
-- Operationalizes docs/legal/breach-notification-runbook.md — a runbook
-- nobody can actually use without somewhere real to log an incident and
-- track its 72-hour NDPC-notification clock. Admin-only, deliberately not
-- delegable via the RBAC permission system (unlike most /admin/settings/*
-- surfaces) given how sensitive an incident log's own contents are — this
-- is the "who knew what, and when" record, not something to broaden access
-- to casually.

create table public.data_breach_incidents (
  id                          uuid primary key default gen_random_uuid(),
  title                       text not null,
  discovered_at               timestamptz not null,
  reported_by                 uuid references public.profiles (id) on delete restrict,
  severity                    text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status                      text not null default 'open' check (status in ('open', 'contained', 'notified', 'closed')),
  affected_data_categories    text[] not null default '{}',
  estimated_affected_patients integer,
  description                 text not null,
  containment_actions         text,
  ndpc_notified_at            timestamptz,
  ndpc_notification_reference text,
  patients_notified_at        timestamptz,
  follow_up_actions           text,
  closed_at                   timestamptz,
  closed_by                   uuid references public.profiles (id) on delete restrict,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on table public.data_breach_incidents is
  'The record docs/legal/breach-notification-runbook.md tells staff to create the moment TarragonHealth becomes aware of a possible personal data breach. discovered_at starts the NDPA 72-hour NDPC-notification clock.';

create index data_breach_incidents_status_idx on public.data_breach_incidents (status, discovered_at desc);

alter table public.data_breach_incidents enable row level security;

create policy data_breach_incidents_select on public.data_breach_incidents
  for select to authenticated
  using (private.is_admin());

create policy data_breach_incidents_insert on public.data_breach_incidents
  for insert to authenticated
  with check (private.is_admin());

create policy data_breach_incidents_update on public.data_breach_incidents
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- No delete policy — a closed incident is retained as evidence the runbook
-- was followed, per the runbook's own "Closed" section.

grant select, insert, update on public.data_breach_incidents to authenticated;

create trigger data_breach_incidents_set_updated_at
  before update on public.data_breach_incidents
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Nightly deadline alert: any incident still open/contained (i.e. not yet
-- NDPC-notified) whose 72-hour window from discovered_at has less than 12
-- hours left, or has already lapsed, gets one aggregated in_app admin alert
-- per calendar day it stays in that state. Never blocks anything — the
-- runbook itself is what closes the incident, this is a nudge so the clock
-- can't quietly run out unnoticed. Dedup mirrors
-- partner_license_expiry_notifications (20260731010000) exactly.
-- ---------------------------------------------------------------------------

create table public.data_breach_deadline_notifications (
  id            uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references public.data_breach_incidents (id) on delete cascade,
  notified_on   date not null default current_date,
  created_at    timestamptz not null default now(),
  unique (incident_id, notified_on)
);

alter table public.data_breach_deadline_notifications enable row level security;

create policy data_breach_deadline_notifications_select
  on public.data_breach_deadline_notifications
  for select to authenticated
  using (private.is_admin());

grant select on public.data_breach_deadline_notifications to authenticated;

create or replace function private.queue_data_breach_deadline_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_admin record;
  v_hours_left numeric;
  v_message text;
  v_already_notified boolean;
begin
  for r in
    select id, title, discovered_at, severity
    from public.data_breach_incidents
    where ndpc_notified_at is null
      and status <> 'closed'
      and discovered_at + interval '72 hours' < now() + interval '12 hours'
  loop
    select exists (
      select 1 from public.data_breach_deadline_notifications
      where incident_id = r.id and notified_on = current_date
    ) into v_already_notified;

    if v_already_notified then
      continue;
    end if;

    insert into public.data_breach_deadline_notifications (incident_id)
    values (r.id)
    on conflict (incident_id, notified_on) do nothing;

    v_hours_left := extract(epoch from (r.discovered_at + interval '72 hours' - now())) / 3600;

    v_message := case
      when v_hours_left < 0 then
        format('Breach incident "%s" (%s) is past the 72-hour NDPC-notification window — notify now.', r.title, r.severity)
      else
        format('Breach incident "%s" (%s) has %s hours left in the 72-hour NDPC-notification window.', r.title, r.severity, round(v_hours_left))
    end;

    for v_admin in select id from public.profiles where role = 'admin'
    loop
      insert into public.notifications (recipient_id, channel, template, payload, status, content_class)
      values (
        v_admin.id,
        'in_app',
        'data_breach_deadline',
        jsonb_build_object('message', v_message, 'incident_id', r.id),
        'pending',
        'non_clinical'
      );
    end loop;
  end loop;
end;
$$;

revoke all on function private.queue_data_breach_deadline_alerts() from public;

select cron.schedule(
  'data-breach-deadline-alerts-daily',
  '0 */4 * * *',
  $$select private.queue_data_breach_deadline_alerts()$$
);

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'data_breach_incidents'
  ) then
    raise exception 'data_breach_incidents was not created';
  end if;

  if not exists (select 1 from cron.job where jobname = 'data-breach-deadline-alerts-daily') then
    raise exception 'data-breach-deadline-alerts-daily cron job was not scheduled';
  end if;
end;
$$;
