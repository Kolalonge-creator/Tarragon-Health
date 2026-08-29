-- Tarragon Health — Appointment Engine, Phase 7 (facility profile + clinician roster)
--
-- 69.3 facility profile: location/services/opening-hours already exist
-- (state/city/address/hours on facilities, name/description/price_kobo on
-- facility_services); this closes the remaining profile fields —
-- specialties, accessibility, diagnostic capabilities, insurance
-- arrangements, and a free-text appointment-capacity note. The actual
-- capacity *numbers* (available/booked/cancelled/no-show, 69.12) are a live
-- query — analytics_facility_capacity_today() in a later migration — never
-- stored here, so this note can never drift from reality; it is purely
-- descriptive (e.g. "3 consult rooms, 2 GPs on-site").
--
-- accepted_hmos matches the column name/shape specialist_providers already
-- uses (20260716103000_specialist_provider_matching_fields.sql) rather than
-- inventing a new name for the same idea.
--
-- 69.3 "clinicians" + 69.5 booking-flow "Facility -> Clinician" step:
-- facility_clinicians is the roster join table — which of Tarragon's own
-- employed clinicians (profiles.role clinician, per the unified account-role
-- rule in CLAUDE.md) practise at a given facility. Same posture as
-- facility_services: admin-maintained, authenticated-read, admin-write —
-- this is Tarragon staffing its own physical-clinic sessions at a partner
-- facility, not a partner's own self-service staff directory (that stays out
-- of scope, same as docs/CLINICAL_NETWORK_SPEC.md §4.13/4.14's "no
-- self-service org hierarchy" gap).

alter table public.facilities
  add column specialties text[] not null default '{}',
  add column accessibility_features text[] not null default '{}',
  add column diagnostic_capabilities text[] not null default '{}',
  add column accepted_hmos text[] not null default '{}',
  add column appointment_capacity_notes text;

comment on column public.facilities.accessibility_features is
  'Free-form tags (e.g. "wheelchair_access", "ground_floor") — deliberately not an enum, no canonical accessibility taxonomy has been specified.';
comment on column public.facilities.appointment_capacity_notes is
  'Descriptive ops note (e.g. "3 consult rooms, 2 GPs on-site") — the live booked/available/cancelled/no-show counts are analytics_facility_capacity_today(), never stored here, so this can never drift from reality.';

create table public.facility_clinicians (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  facility_id     uuid not null references public.facilities (id) on delete cascade,
  clinician_id    uuid not null references public.profiles (id) on delete cascade,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (facility_id, clinician_id)
);

comment on table public.facility_clinicians is
  '69.3/69.5 roster: which of Tarragon''s employed clinicians practise at a given facility, so the booking flow''s Facility -> Clinician step (69.5) and get_available_appointment_slots() can offer only clinicians who actually see patients there.';

create index facility_clinicians_facility_idx on public.facility_clinicians (facility_id) where is_active;
create index facility_clinicians_clinician_idx on public.facility_clinicians (clinician_id) where is_active;
create index facility_clinicians_org_idx on public.facility_clinicians (organisation_id);

alter table public.facility_clinicians enable row level security;

create policy facility_clinicians_select on public.facility_clinicians
  for select to authenticated using (true);
create policy facility_clinicians_insert on public.facility_clinicians
  for insert to authenticated with check (private.is_admin());
create policy facility_clinicians_update on public.facility_clinicians
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy facility_clinicians_delete on public.facility_clinicians
  for delete to authenticated using (private.is_admin());

grant select on public.facility_clinicians to authenticated;
grant insert, update, delete on public.facility_clinicians to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'facilities' and column_name = 'accepted_hmos'
  ) then
    raise exception 'facilities.accepted_hmos missing after migration';
  end if;

  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'facility_clinicians') then
    raise exception 'facility_clinicians missing after migration';
  end if;

  if has_table_privilege('anon', 'public.facility_clinicians', 'SELECT') then
    raise exception 'FAIL: anon can select facility_clinicians';
  end if;
  if not has_table_privilege('authenticated', 'public.facility_clinicians', 'SELECT') then
    raise exception 'authenticated lacks SELECT on facility_clinicians';
  end if;

  raise notice 'PASS: facility profile enrichment + clinician roster in place';
end $$;
