-- Tarragon Health — Appointment Engine, Phase 6 (resource scheduling scaffold
-- + capacity analytics)
--
-- 10.15/10.16 resource scheduling. CLAUDE.md is explicit: "Tarragon does NOT
-- sell/import/bundle" hardware and has "no owned clinics" — Tarragon has no
-- room or equipment inventory of its own to schedule today. This is
-- deliberately schema-scaffolded only (same posture as the wearable cloud
-- providers before real credentials existed): the table, the resource_id
-- link, and its own double-booking EXCLUDE constraint are real and correct,
-- but nothing in the booking flow sets resource_id yet — a partner facility
-- (hospital/lab/imaging centre) that wants Tarragon to schedule its own
-- rooms/machines is a future partnership integration, not built here.
--
-- 10.19/10.20 capacity analytics — the employed-care-team analog of
-- 20260827202313's analytics_provider_capacity(), which covers the referral-
-- network specialist_providers pool. Deliberately internal/admin-facing
-- rollups only, same guardrail posture: counts and aggregates existing
-- appointments/waiting-list rows, never a patient-facing ranking.

create type public.clinical_resource_type as enum ('room', 'equipment');

create table public.clinical_resources (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  resource_type   public.clinical_resource_type not null,
  name            text not null,
  location        text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

comment on table public.clinical_resources is
  '10.15/10.16 scaffold: a consultation room, diagnostic machine, or phlebotomy chair a physical_clinic/procedure/laboratory/imaging appointment could reserve. Schema-only for now — see migration header for why.';

create index clinical_resources_org_idx on public.clinical_resources (organisation_id) where is_active;

alter table public.clinical_resources enable row level security;

create policy clinical_resources_select on public.clinical_resources
  for select to authenticated using (private.is_org_staff(organisation_id));
create policy clinical_resources_insert on public.clinical_resources
  for insert to authenticated with check (private.is_org_staff(organisation_id));
create policy clinical_resources_update on public.clinical_resources
  for update to authenticated
  using (private.is_org_staff(organisation_id)) with check (private.is_org_staff(organisation_id));
create policy clinical_resources_delete on public.clinical_resources
  for delete to authenticated using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.clinical_resources to authenticated;

alter table public.appointments
  add column resource_id uuid references public.clinical_resources (id) on delete set null;

create index appointments_resource_idx on public.appointments (resource_id) where resource_id is not null;

-- Same EXCLUDE idiom as appointments_no_provider_overlap, scoped to
-- resource_id so a room/machine can't be double-booked either, once
-- something actually starts setting it.
alter table public.appointments
  add constraint appointments_no_resource_overlap
  exclude using gist (
    resource_id with =,
    tstzrange(scheduled_for, ends_at, '[)') with &&
  )
  where (
    resource_id is not null
    and status not in ('cancelled', 'patient_cancelled', 'provider_cancelled', 'no_show', 'expired', 'failed', 'rescheduled')
  );

-- ---------------------------------------------------------------------------
-- 10.19/10.20 capacity analytics
-- ---------------------------------------------------------------------------
create or replace function public.analytics_appointment_capacity()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;

  return jsonb_build_object(
    'by_appointment_type_90d', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'appointment_type', appointment_type,
        'total', total,
        'completed', completed,
        'cancelled', cancelled,
        'no_show', no_show,
        'cancellation_rate_pct', case when total > 0 then round(100.0 * cancelled / total, 1) else null end,
        'no_show_rate_pct', case when (completed + no_show) > 0 then round(100.0 * no_show / (completed + no_show), 1) else null end
      ) order by total desc), '[]'::jsonb)
      from (
        select
          appointment_type,
          count(*) as total,
          count(*) filter (where status = 'completed') as completed,
          count(*) filter (where status in ('cancelled', 'patient_cancelled', 'provider_cancelled')) as cancelled,
          count(*) filter (where status = 'no_show') as no_show
        from public.appointments
        where created_at >= now() - interval '90 days'
        group by appointment_type
      ) t
    ),

    'upcoming_7_days_by_type', (
      select coalesce(jsonb_agg(jsonb_build_object('appointment_type', appointment_type, 'count', cnt) order by cnt desc), '[]'::jsonb)
      from (
        select appointment_type, count(*) as cnt
        from public.appointments
        where status in ('booked', 'confirmed')
          and scheduled_for >= now() and scheduled_for < now() + interval '7 days'
        group by appointment_type
      ) t
    ),

    'waiting_list_by_type', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'appointment_type', appointment_type,
        'currently_waiting', waiting,
        'avg_wait_hours', avg_wait_hours
      ) order by waiting desc), '[]'::jsonb)
      from (
        select appointment_type,
          count(*) filter (where status = 'waiting') as waiting,
          round((avg(extract(epoch from (now() - created_at))) filter (where status = 'waiting') / 3600)::numeric, 1) as avg_wait_hours
        from public.appointment_waiting_list
        group by appointment_type
      ) t
    ),

    'demand_by_location_90d', (
      select coalesce(jsonb_agg(jsonb_build_object('location', loc, 'count', cnt) order by cnt desc), '[]'::jsonb)
      from (
        select coalesce(location, 'Unspecified') as loc, count(*) as cnt
        from public.appointments
        where created_at >= now() - interval '90 days'
        group by coalesce(location, 'Unspecified')
        order by count(*) desc
        limit 20
      ) t
    ),

    'avg_lead_time_days_by_type', (
      select coalesce(jsonb_agg(jsonb_build_object('appointment_type', appointment_type, 'avg_lead_time_days', avg_days) order by appointment_type), '[]'::jsonb)
      from (
        select appointment_type,
          round((avg(extract(epoch from (scheduled_for - created_at))) / 86400)::numeric, 1) as avg_days
        from public.appointments
        where status in ('completed', 'booked', 'confirmed') and created_at >= now() - interval '90 days'
        group by appointment_type
      ) t
    )
  );
end;
$$;

comment on function public.analytics_appointment_capacity() is
  '10.19/10.20 employed-care-team capacity rollup: utilisation, cancellation/no-show rate, upcoming demand, waiting-list size/age, and lead time, all by appointment_type. Complements analytics_provider_capacity() (the referral-network/specialist_providers pool) rather than duplicating it — see that function''s own comment on why the two capacity pools are kept visibly separate.';

revoke execute on function public.analytics_appointment_capacity() from public, anon;
grant execute on function public.analytics_appointment_capacity() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.analytics_appointment_capacity()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_appointment_capacity';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass and conname = 'appointments_no_resource_overlap'
  ) then
    raise exception 'appointments_no_resource_overlap exclusion constraint missing';
  end if;
  raise notice 'PASS: resource scheduling scaffold + capacity analytics in place';
end $$;
