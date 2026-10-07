-- S06 (offline outbox), founder decision S06-1.
--
-- Until now the three offline tables overwrote the time of every write with
-- server time: vitals_readings.taken_at (source = 'manual'), symptoms.reported_at
-- and medication_logs.logged_at. A reading logged offline at 08:00 and synced
-- at 14:00 was stored as 14:00, which corrupts trends and the red-flag windows.
-- The rule exists so a patient cannot backdate, so it is not removed, it is
-- bounded:
--   * received_at        server time of the insert, always (new).
--   * client_recorded_at what the phone says, stored untouched (new, nullable).
--   * taken_at / reported_at / logged_at stay THE one defined time every
--     existing reader already uses. They now hold the client time only when it
--     is not in the future (beyond a small skew) and not older than the
--     backdate window; otherwise the server time. time_basis says which.
-- Window, skew, stuck-notice and pull-overlap values are PROPOSED, versioned in
-- offline_sync_config, never in code.
--
-- Row counts at writing: no data conversion is needed, every existing row keeps
-- its stored time. The new columns are nullable and NOT backfilled: the three
-- tables are append-only (an UPDATE would be refused or would fire triggers),
-- and a null received_at on an old row honestly means 'not recorded then'.

create table if not exists public.offline_sync_config (
  version                   integer primary key,
  is_active                 boolean not null default false,
  backdate_window_hours     integer not null check (backdate_window_hours between 1 and 720),
  future_skew_minutes       integer not null check (future_skew_minutes between 0 and 120),
  stuck_notice_hours        integer not null check (stuck_notice_hours >= 1),
  stuck_notice_danger_hours integer not null check (stuck_notice_danger_hours >= 1),
  pull_overlap_minutes      integer not null check (pull_overlap_minutes >= 1),
  note                      text,
  created_at                timestamptz not null default now()
);
create unique index if not exists offline_sync_config_one_active
  on public.offline_sync_config (is_active) where is_active;
alter table public.offline_sync_config enable row level security;
create policy offline_sync_config_read on public.offline_sync_config
  for select to authenticated using (true);
revoke all on public.offline_sync_config from public, anon;
grant select on public.offline_sync_config to authenticated;

insert into public.offline_sync_config
  (version, is_active, backdate_window_hours, future_skew_minutes, stuck_notice_hours,
   stuck_notice_danger_hours, pull_overlap_minutes, note)
values (1, true, 72, 5, 12, 1, 10, 'PROPOSED values from founder decisions S06-1 to S06-4 (2026-10-02)')
on conflict (version) do nothing;

alter table public.vitals_readings
  add column if not exists client_recorded_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists time_basis text;
alter table public.symptoms
  add column if not exists client_recorded_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists time_basis text;
alter table public.medication_logs
  add column if not exists client_recorded_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists time_basis text;


alter table public.vitals_readings add constraint vitals_readings_time_basis_check
  check (time_basis is null or time_basis in ('server', 'client_bounded'));
alter table public.symptoms add constraint symptoms_time_basis_check
  check (time_basis is null or time_basis in ('server', 'client_bounded'));
alter table public.medication_logs add constraint medication_logs_time_basis_check
  check (time_basis is null or time_basis in ('server', 'client_bounded'));

comment on column public.vitals_readings.client_recorded_at is 'What the device clock said when the patient logged it (S06). Stored untouched; taken_at holds it only inside the bounded window, see time_basis.';
comment on column public.vitals_readings.received_at is 'Server time of the insert (S06). Always server time.';
comment on column public.vitals_readings.time_basis is 'server = taken_at is server time; client_bounded = taken_at is the accepted device time (S06).';
comment on column public.symptoms.client_recorded_at is 'Device clock at logging (S06); reported_at holds it only inside the bounded window.';
comment on column public.symptoms.received_at is 'Server time of the insert (S06).';
comment on column public.symptoms.time_basis is 'server or client_bounded (S06).';
comment on column public.medication_logs.client_recorded_at is 'Device clock at logging (S06); logged_at holds it only inside the bounded window.';
comment on column public.medication_logs.received_at is 'Server time of the insert (S06).';
comment on column public.medication_logs.time_basis is 'server or client_bounded (S06).';

-- One place that decides which time is trusted. Returns the time to store and
-- its basis. Pure function of the active config, so it is testable in isolation.
create or replace function private.resolve_offline_event_time(p_client timestamptz, p_received timestamptz)
returns table (effective_at timestamptz, basis text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_window integer := 72;
  v_skew   integer := 5;
begin
  select backdate_window_hours, future_skew_minutes
    into v_window, v_skew
    from public.offline_sync_config where is_active;
  v_window := coalesce(v_window, 72);
  v_skew := coalesce(v_skew, 5);

  if p_client is not null
     and p_client <= p_received + make_interval(mins => v_skew)
     and p_client >= p_received - make_interval(hours => v_window) then
    return query select least(p_client, p_received), 'client_bounded'::text;
  else
    return query select p_received, 'server'::text;
  end if;
end;
$$;
revoke all on function private.resolve_offline_event_time(timestamptz, timestamptz) from public, anon;

create or replace function private.stamp_symptom_timestamp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); r record;
begin
  select * into r from private.resolve_offline_event_time(new.client_recorded_at, v_now);
  new.received_at := v_now;
  new.reported_at := r.effective_at;
  new.time_basis := r.basis;
  return new;
end;
$$;

create or replace function private.stamp_medication_log_timestamp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); r record;
begin
  select * into r from private.resolve_offline_event_time(new.client_recorded_at, v_now);
  new.received_at := v_now;
  new.logged_at := r.effective_at;
  new.time_basis := r.basis;
  return new;
end;
$$;

create or replace function private.stamp_manual_vitals_timestamp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp(); r record;
begin
  new.received_at := v_now;
  if new.source = 'manual' then
    select * into r from private.resolve_offline_event_time(new.client_recorded_at, v_now);
    new.taken_at := r.effective_at;
    new.time_basis := r.basis;
  end if;
  return new;
end;
$$;

do $$
begin
  if exists (select 1 from information_schema.table_privileges
              where table_name = 'offline_sync_config' and grantee in ('anon', 'PUBLIC')) then
    raise exception 'offline_sync_config must not be readable by anon';
  end if;
  if (select count(*) from public.offline_sync_config where is_active) <> 1 then
    raise exception 'exactly one active offline_sync_config row expected';
  end if;
end $$;
