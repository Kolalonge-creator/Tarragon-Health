-- Tarragon Health
-- Specialist Network & Provider Platform — availability & calendar for
-- specialist_providers (66.5/66.6): working hours, consultation slots,
-- telemedicine/physical slots, leave, blocked times, emergency/unavailable
-- periods, plus a computed weekly-slot view for a calendar UI.
--
-- Deliberately NOT wired into the Appointment Engine
-- (provider_availability_rules/provider_time_off/appointments/
-- get_available_appointment_slots): that engine is built entirely against
-- profiles.id/clinical_staff (confirmed — clinician_id on every one of those
-- tables FKs to profiles, never specialist_providers), because it assumes
-- the provider has a Tarragon login. specialist_providers rows do not (no
-- profile_id/auth linkage exists on that table) — giving referral-network
-- specialists a real Tarragon account/self-service login is a materially
-- bigger, still-open founder question (see
-- docs/CLINICAL_NETWORK_SPEC.md §5 "Does 'Clinical Network' mean opening
-- the platform to independent/contracted providers...") that this migration
-- does not decide. Availability here is therefore admin-entered on the
-- specialist's behalf (same posture as the rest of specialist_providers
-- today — an admin-maintained catalogue, not partner self-service), reusing
-- the Appointment Engine's own table shape and naming so a future move to
-- real self-service is a data-migration, not a redesign.
--
-- Booking against these slots still goes through the existing
-- specialist_referrals workflow (fulfilment_mode self_arranged/partner) —
-- this migration adds visibility/coordination data, not a new booking
-- mechanism, and does not touch the referral-matching guardrail.
create table public.specialist_provider_availability_rules (
  id                               uuid primary key default gen_random_uuid(),
  specialist_provider_id           uuid not null references public.specialist_providers (id) on delete cascade,
  specialist_provider_location_id uuid references public.specialist_provider_locations (id) on delete set null,
  day_of_week                     smallint not null check (day_of_week between 0 and 6),
  start_time                      time not null,
  end_time                        time not null check (end_time > start_time),
  consultation_method             public.appointment_consultation_method not null,
  duration_type                   public.consultation_duration_type not null default 'standard',
  slot_duration_minutes           int not null check (slot_duration_minutes > 0),
  buffer_minutes                  int not null default 0 check (buffer_minutes >= 0),
  effective_from                  date not null default current_date,
  effective_until                 date check (effective_until is null or effective_until >= effective_from),
  is_active                       boolean not null default true,
  created_by                      uuid references public.profiles (id) on delete set null,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

create index specialist_provider_availability_rules_provider_idx
  on public.specialist_provider_availability_rules (specialist_provider_id, day_of_week);

alter table public.specialist_provider_availability_rules enable row level security;

create policy specialist_provider_availability_rules_select
  on public.specialist_provider_availability_rules
  for select to authenticated using (true);
create policy specialist_provider_availability_rules_insert
  on public.specialist_provider_availability_rules
  for insert to authenticated
  with check (private.is_admin() or private.has_permission('partners.specialists.manage'));
create policy specialist_provider_availability_rules_update
  on public.specialist_provider_availability_rules
  for update to authenticated
  using (private.is_admin() or private.has_permission('partners.specialists.manage'))
  with check (private.is_admin() or private.has_permission('partners.specialists.manage'));
create policy specialist_provider_availability_rules_delete
  on public.specialist_provider_availability_rules
  for delete to authenticated
  using (private.is_admin() or private.has_permission('partners.specialists.manage'));

grant select, insert, update, delete on public.specialist_provider_availability_rules to authenticated;

-- Leave / blocked time / emergency-unavailable periods (66.5). A single
-- "kind" text column with a CHECK, same lightweight shape as
-- provider_time_off, extended with a third kind the Appointment Engine's
-- table doesn't have — specialist_providers are external, so an
-- "unexpectedly unavailable" period (e.g. the specialist notifies Tarragon
-- they can't hold their slots this week) is worth distinguishing from a
-- planned leave/blocked entry for reporting purposes.
create table public.specialist_provider_time_off (
  id                      uuid primary key default gen_random_uuid(),
  specialist_provider_id  uuid not null references public.specialist_providers (id) on delete cascade,
  kind                    text not null check (kind in ('leave', 'blocked', 'emergency_unavailable')),
  starts_at               timestamptz not null,
  ends_at                 timestamptz not null check (ends_at > starts_at),
  reason                  text,
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now()
);

create index specialist_provider_time_off_provider_idx
  on public.specialist_provider_time_off (specialist_provider_id, starts_at);

alter table public.specialist_provider_time_off enable row level security;

create policy specialist_provider_time_off_select on public.specialist_provider_time_off
  for select to authenticated using (true);
create policy specialist_provider_time_off_insert on public.specialist_provider_time_off
  for insert to authenticated
  with check (private.is_admin() or private.has_permission('partners.specialists.manage'));
create policy specialist_provider_time_off_update on public.specialist_provider_time_off
  for update to authenticated
  using (private.is_admin() or private.has_permission('partners.specialists.manage'))
  with check (private.is_admin() or private.has_permission('partners.specialists.manage'));
create policy specialist_provider_time_off_delete on public.specialist_provider_time_off
  for delete to authenticated
  using (private.is_admin() or private.has_permission('partners.specialists.manage'));

grant select, insert, update, delete on public.specialist_provider_time_off to authenticated;

-- Computed weekly/day-range slot view for the specialist calendar UI (66.6)
-- — mirrors get_available_appointment_slots' generate_series-over-rules
-- shape, minus any appointments-overlap check (there is no per-slot booking
-- record for specialist_providers to exclude against; booking stays
-- fulfilled through specialist_referrals as today). Plain SQL + STABLE, no
-- SECURITY DEFINER: the underlying tables are already select-open to any
-- authenticated caller (matching specialist_providers_select's own
-- world-readable-to-authenticated posture), so there is nothing this
-- function needs to see that RLS wouldn't already grant the caller.
create or replace function public.get_available_specialist_slots(
  p_specialist_provider_id uuid,
  p_from date default current_date,
  p_to date default current_date + 13
)
returns table (
  slot_start timestamptz,
  slot_end timestamptz,
  consultation_method public.appointment_consultation_method,
  duration_type public.consultation_duration_type,
  location_id uuid
)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select
      greatest(p_from, current_date) as v_from,
      least(greatest(p_to, p_from), greatest(p_from, current_date) + 60) as v_to
  ),
  days as (
    select generate_series(bounds.v_from, bounds.v_to, interval '1 day')::date as d
    from bounds
  ),
  rule_slots as (
    select
      gs.slot_start,
      r.slot_duration_minutes,
      r.consultation_method,
      r.duration_type,
      r.specialist_provider_location_id
    from public.specialist_provider_availability_rules r
    cross join days d
    cross join lateral generate_series(
      (d.d + r.start_time) at time zone 'Africa/Lagos',
      ((d.d + r.end_time) at time zone 'Africa/Lagos') - (r.slot_duration_minutes || ' minutes')::interval,
      ((r.slot_duration_minutes + r.buffer_minutes) || ' minutes')::interval
    ) as gs (slot_start)
    where r.specialist_provider_id = p_specialist_provider_id
      and r.is_active
      and extract(dow from d.d)::smallint = r.day_of_week
      and d.d >= r.effective_from
      and (r.effective_until is null or d.d <= r.effective_until)
  )
  select
    rs.slot_start,
    rs.slot_start + (rs.slot_duration_minutes || ' minutes')::interval as slot_end,
    rs.consultation_method,
    rs.duration_type,
    rs.specialist_provider_location_id as location_id
  from rule_slots rs
  where not exists (
    select 1 from public.specialist_provider_time_off t
    where t.specialist_provider_id = p_specialist_provider_id
      and (rs.slot_start, rs.slot_start + (rs.slot_duration_minutes || ' minutes')::interval) overlaps (t.starts_at, t.ends_at)
  )
  order by rs.slot_start;
$$;

revoke all on function public.get_available_specialist_slots(uuid, date, date) from public, anon;
grant execute on function public.get_available_specialist_slots(uuid, date, date) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'specialist_provider_availability_rules'
  ) then
    raise exception 'specialist_provider_availability_rules was not created';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'specialist_provider_time_off'
  ) then
    raise exception 'specialist_provider_time_off was not created';
  end if;
  if has_function_privilege('anon', 'public.get_available_specialist_slots(uuid, date, date)', 'EXECUTE') then
    raise exception 'anon must not be able to execute get_available_specialist_slots';
  end if;
end $$;
