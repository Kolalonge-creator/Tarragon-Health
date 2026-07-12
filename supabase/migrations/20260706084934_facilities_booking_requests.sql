-- Tarragon Health — V1 consumer spec reconciliation (Phase 0)
-- 06 · Facility directory + booking requests (Care Coordination, lite)
--
-- facilities mirrors lab_providers/pharmacy_partners: a curated, admin-
-- maintained directory, global (no organisation_id). booking_requests is a
-- request, not a real-time confirmed booking — facility contact confirms
-- manually, same low-tech-on-purpose shape as the V1 spec describes. No
-- seed rows this phase: real facility data needs partner sourcing, not
-- fabrication.

create type public.facility_type as enum (
  'hospital', 'lab', 'pharmacy', 'radiology', 'optician', 'vaccination_centre'
);

create type public.booking_request_status as enum (
  'requested', 'confirmed', 'completed', 'cancelled'
);

create table public.facilities (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  type              public.facility_type not null,
  state             text not null,
  city              text not null,
  contact_phone     text,
  contact_email     text,
  address           text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  constraint facilities_phone_e164 check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$')
);

create index facilities_state_city_idx on public.facilities (state, city);
create index facilities_type_idx on public.facilities (type);

create table public.booking_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  facility_id       uuid not null references public.facilities (id) on delete restrict,
  service_type      text not null,
  requested_date    date not null,
  status            public.booking_request_status not null default 'requested',
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index booking_requests_profile_idx on public.booking_requests (profile_id, requested_date desc);
create index booking_requests_org_status_idx on public.booking_requests (organisation_id, status);
create index booking_requests_facility_idx on public.booking_requests (facility_id);

create trigger booking_requests_set_updated_at
  before update on public.booking_requests
  for each row execute function private.set_updated_at();

alter table public.facilities enable row level security;
alter table public.booking_requests enable row level security;

-- facilities: global directory — authenticated read, admin write (same
-- pattern as lab_providers/pharmacy_partners).
create policy facilities_select on public.facilities
  for select to authenticated using (true);
create policy facilities_insert on public.facilities
  for insert to authenticated with check (private.is_admin());
create policy facilities_update on public.facilities
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy facilities_delete on public.facilities
  for delete to authenticated using (private.is_admin());

-- booking_requests: profile owner reads/writes own; staff manage org.
create policy booking_requests_select on public.booking_requests
  for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy booking_requests_insert on public.booking_requests
  for insert to authenticated
  with check (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy booking_requests_update on public.booking_requests
  for update to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy booking_requests_delete on public.booking_requests
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select on public.facilities to authenticated;
grant insert, update, delete on public.facilities to authenticated;
grant select, insert, update, delete on public.booking_requests to authenticated;
