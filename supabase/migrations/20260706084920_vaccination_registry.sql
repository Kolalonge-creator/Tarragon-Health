-- Tarragon Health — V1 consumer spec reconciliation (Phase 0)
-- 05 · Vaccination registry
--
-- vaccination_catalog mirrors screen_types (global reference catalogue, no
-- organisation_id). vaccination_records mirrors screening_results (org-
-- scoped, patient-visible). Self-reported entries are explicitly in scope,
-- same as screening history.

create table public.vaccination_catalog (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  description       text,
  recommended_age   jsonb not null default '{}'::jsonb,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create table public.vaccination_records (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations (id) on delete restrict,
  profile_id                uuid not null references public.profiles (id) on delete cascade,
  vaccination_catalog_id    uuid not null references public.vaccination_catalog (id) on delete restrict,
  dose_number               integer not null default 1 check (dose_number > 0),
  date_administered         date not null,
  provider                  text,
  certificate_url           text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (profile_id, vaccination_catalog_id, dose_number)
);

create index vaccination_records_profile_idx on public.vaccination_records (profile_id, date_administered desc);
create index vaccination_records_org_idx on public.vaccination_records (organisation_id);
create index vaccination_records_catalog_idx on public.vaccination_records (vaccination_catalog_id);

create trigger vaccination_records_set_updated_at
  before update on public.vaccination_records
  for each row execute function private.set_updated_at();

alter table public.vaccination_catalog enable row level security;
alter table public.vaccination_records enable row level security;

-- vaccination_catalog: global catalogue — any authenticated user reads; admins write.
create policy vaccination_catalog_select on public.vaccination_catalog
  for select to authenticated using (true);
create policy vaccination_catalog_insert on public.vaccination_catalog
  for insert to authenticated with check (private.is_admin());
create policy vaccination_catalog_update on public.vaccination_catalog
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy vaccination_catalog_delete on public.vaccination_catalog
  for delete to authenticated using (private.is_admin());

-- vaccination_records: patient reads/writes own (self-reported entries in
-- scope); staff manage org.
create policy vaccination_records_select on public.vaccination_records
  for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy vaccination_records_insert on public.vaccination_records
  for insert to authenticated
  with check (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy vaccination_records_update on public.vaccination_records
  for update to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy vaccination_records_delete on public.vaccination_records
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select on public.vaccination_catalog to authenticated;
grant insert, update, delete on public.vaccination_catalog to authenticated;
grant select, insert, update, delete on public.vaccination_records to authenticated;
