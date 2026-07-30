-- Wellness gamification, part 4: workout classes & health workshops.
-- Dormant-until-real, same pattern as home_visit_providers/logistics_partners
-- (20260715230120): a global, admin-managed catalogue seeded with zero real
-- ACTIVE rows. The patient-facing "nothing scheduled yet" state is simply
-- what renders with no active provider/class — no feature flag, no separate
-- launch step. Flipping a real partner's row to active is the entire
-- mechanism that turns the booking UI on.
--
-- Attendance is patient self-reported (register -> mark attended), the same
-- trust level already given to lpe_measurements/lifestyle telemetry — this is
-- an engagement layer, not a clinical record, so it doesn't need staff
-- verification to award the modest points_reward attached to a class.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'wellness_class_type') then
    create type public.wellness_class_type as enum ('virtual', 'in_person');
  end if;
  if not exists (select 1 from pg_type where typname = 'wellness_class_registration_status') then
    create type public.wellness_class_registration_status as enum
      ('registered', 'attended', 'no_show', 'cancelled');
  end if;
end $$;

create table public.wellness_class_providers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  regions    text[] not null default '{}',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.wellness_classes (
  id                uuid primary key default gen_random_uuid(),
  provider_id       uuid not null references public.wellness_class_providers (id) on delete cascade,
  title             text not null,
  description       text,
  class_type        public.wellness_class_type not null default 'virtual',
  starts_at         timestamptz not null,
  duration_minutes  integer not null default 45 check (duration_minutes > 0),
  capacity          integer check (capacity is null or capacity > 0),
  location_or_link  text,
  points_reward     integer not null default 20 check (points_reward >= 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index wellness_classes_starts_idx on public.wellness_classes (starts_at) where is_active;

create table public.wellness_class_registrations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  class_id        uuid not null references public.wellness_classes (id) on delete cascade,
  status          public.wellness_class_registration_status not null default 'registered',
  registered_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (patient_id, class_id)
);

drop trigger if exists wellness_classes_set_updated_at on public.wellness_classes;
create trigger wellness_classes_set_updated_at
  before update on public.wellness_classes
  for each row execute function private.set_updated_at();

drop trigger if exists wellness_class_registrations_set_updated_at on public.wellness_class_registrations;
create trigger wellness_class_registrations_set_updated_at
  before update on public.wellness_class_registrations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Points on self-reported attendance.
-- ---------------------------------------------------------------------------
create or replace function private.wellness_points_on_class_attended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_points integer;
begin
  if new.status = 'attended' and old.status is distinct from 'attended' then
    select points_reward into v_points from public.wellness_classes where id = new.class_id;
    perform private.award_wellness_points(
      new.patient_id, coalesce(v_points, 0), 'wellness_class_attended',
      'wellness_class_registrations', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists wellness_class_registrations_wellness_points on public.wellness_class_registrations;
create trigger wellness_class_registrations_wellness_points
  after update on public.wellness_class_registrations
  for each row execute function private.wellness_points_on_class_attended();

-- ---------------------------------------------------------------------------
-- RLS — providers/classes: authenticated read (active-or-admin), admin write.
-- Registrations: patient self-manages own (register, self-report attended);
-- org staff read + can also mark attended/no_show.
-- ---------------------------------------------------------------------------
alter table public.wellness_class_providers enable row level security;
alter table public.wellness_classes enable row level security;
alter table public.wellness_class_registrations enable row level security;

create policy wellness_class_providers_select on public.wellness_class_providers
  for select to authenticated using (is_active or private.is_admin());
create policy wellness_class_providers_write on public.wellness_class_providers
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy wellness_classes_select on public.wellness_classes
  for select to authenticated using (is_active or private.is_admin());
create policy wellness_classes_write on public.wellness_classes
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy wellness_class_registrations_select on public.wellness_class_registrations
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy wellness_class_registrations_insert on public.wellness_class_registrations
  for insert to authenticated
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());
create policy wellness_class_registrations_update on public.wellness_class_registrations
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.wellness_class_providers to authenticated;
grant select, insert, update, delete on public.wellness_classes to authenticated;
grant select, insert, update on public.wellness_class_registrations to authenticated;

-- ---------------------------------------------------------------------------
-- Documentation/testing placeholder rows — is_active = false throughout, so
-- nothing surfaces the real booking UI until ops contracts a real instructor/
-- studio partner and flips a row (or adds a new one).
-- ---------------------------------------------------------------------------
insert into public.wellness_class_providers (name, regions, is_active) values
  ('[Placeholder] Community Wellness Studio', array['Lagos'], false)
on conflict (name) do nothing;

insert into public.wellness_classes (provider_id, title, description, class_type, starts_at, duration_minutes, capacity, location_or_link, points_reward, is_active)
select id, 'Morning Movement (sample)', 'A gentle guided movement session.', 'virtual',
       now() + interval '14 days', 45, 30, null, 20, false
from public.wellness_class_providers where name = '[Placeholder] Community Wellness Studio'
on conflict do nothing;
