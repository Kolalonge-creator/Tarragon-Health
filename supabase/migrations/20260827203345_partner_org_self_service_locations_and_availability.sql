-- Tarragon Health
-- Clinical Network build, Phase 2 item (docs/CLINICAL_NETWORK_SPEC.md §4.13/
-- §4.14 "Organisation administration"), founder-approved to build. Confirmed
-- live before writing this: lab_provider_locations (the table that actually
-- feeds the public /coverage map) has admin-only RLS -- the lab-partner
-- portal's existing "Your branches" UI writes to public.facilities instead,
-- which was globally suspended (20260803163135) and is now a dead table.
-- Pharmacists have no branch concept at all: one row, one address, on
-- pharmacy_partners itself. Neither lab_tests nor pharmacy_medications has
-- any partner-facing write path -- price/availability editing is admin-only.
--
-- This migration closes the "a partner org can manage its own locations and
-- mark its own services available/unavailable" half of the gap. It
-- deliberately does NOT open price/commission editing to a partner -- those
-- figures feed the commission ledger and partner billing/reconciliation
-- pipeline (commissions, partner_statements) and changing them is a
-- financial-control question for the founder, not a schema question; a
-- partner gets is_active only, enforced by a trigger that overwrites every
-- other column back to its prior value on a plain-partner write (an
-- is_admin()/has_permission() writer is untouched -- same "RLS admits
-- broadly, trigger narrows" shape used for case_review_actions and
-- clinical_incident_reports).
--
-- is_partner_admin is a new, narrow flag: which lab_partner/pharmacist login
-- for a given provider can invite MORE staff logins for that same provider
-- (see the accompanying app-code server action) -- CHECKed to only ever be
-- true alongside one of those two roles, so it can't be mistakenly set on an
-- unrelated account.

alter table public.profiles
  add column is_partner_admin boolean not null default false,
  add constraint profiles_partner_admin_requires_partner_role check (
    not is_partner_admin or role in ('lab_partner', 'pharmacist')
  );

comment on column public.profiles.is_partner_admin is
  'True only for a lab_partner/pharmacist login authorised to invite further staff logins for its own provider (see the partner self-service staff-invite server action). Never itself a broader privilege -- an is_partner_admin lab_partner is still scoped to its own lab_provider_id like any other lab_partner login.';

-- ---------------------------------------------------------------------------
-- lab_provider_locations: let a lab_partner manage their own branches
-- ---------------------------------------------------------------------------
create policy lab_provider_locations_insert_partner
  on public.lab_provider_locations
  for insert to authenticated
  with check (lab_provider_id = private.lab_partner_provider());

create policy lab_provider_locations_update_partner
  on public.lab_provider_locations
  for update to authenticated
  using (lab_provider_id = private.lab_partner_provider())
  with check (lab_provider_id = private.lab_partner_provider());

create policy lab_provider_locations_delete_partner
  on public.lab_provider_locations
  for delete to authenticated
  using (lab_provider_id = private.lab_partner_provider());

-- ---------------------------------------------------------------------------
-- pharmacy_partner_locations: the branch table pharmacists never had.
-- Deliberately the same shape as lab_provider_locations.
-- ---------------------------------------------------------------------------
create table public.pharmacy_partner_locations (
  id                  uuid primary key default gen_random_uuid(),
  pharmacy_partner_id uuid not null references public.pharmacy_partners (id) on delete cascade,
  name                text not null,
  state               text not null,
  address             text,
  contact_phone       text,
  latitude            double precision,
  longitude           double precision,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

comment on table public.pharmacy_partner_locations is
  'Per-branch locations for a pharmacy partner -- the pharmacist-side equivalent of lab_provider_locations. pharmacy_partners itself keeps its single city/state/regions summary; this table is the real per-branch list once a partner has more than one.';

create index pharmacy_partner_locations_partner_idx
  on public.pharmacy_partner_locations (pharmacy_partner_id);

alter table public.pharmacy_partner_locations enable row level security;

create policy pharmacy_partner_locations_select on public.pharmacy_partner_locations
  for select to authenticated using (true);

create policy pharmacy_partner_locations_insert_admin on public.pharmacy_partner_locations
  for insert to authenticated
  with check (private.is_admin() or private.has_permission('partners.pharmacies.manage'));

create policy pharmacy_partner_locations_update_admin on public.pharmacy_partner_locations
  for update to authenticated
  using (private.is_admin() or private.has_permission('partners.pharmacies.manage'))
  with check (private.is_admin() or private.has_permission('partners.pharmacies.manage'));

create policy pharmacy_partner_locations_delete_admin on public.pharmacy_partner_locations
  for delete to authenticated
  using (private.is_admin() or private.has_permission('partners.pharmacies.manage'));

create policy pharmacy_partner_locations_insert_partner on public.pharmacy_partner_locations
  for insert to authenticated
  with check (pharmacy_partner_id = private.pharmacist_partner());

create policy pharmacy_partner_locations_update_partner on public.pharmacy_partner_locations
  for update to authenticated
  using (pharmacy_partner_id = private.pharmacist_partner())
  with check (pharmacy_partner_id = private.pharmacist_partner());

create policy pharmacy_partner_locations_delete_partner on public.pharmacy_partner_locations
  for delete to authenticated
  using (pharmacy_partner_id = private.pharmacist_partner());

grant select, insert, update, delete on public.pharmacy_partner_locations to authenticated;

-- ---------------------------------------------------------------------------
-- lab_tests / pharmacy_medications: a plain partner may toggle is_active on
-- their own catalogue rows, nothing else. RLS opens the door on the
-- partner's own rows; the trigger below is what actually narrows it to
-- is_active only for a non-admin writer.
-- ---------------------------------------------------------------------------
create policy lab_tests_update_partner
  on public.lab_tests
  for update to authenticated
  using (provider_id = private.lab_partner_provider())
  with check (provider_id = private.lab_partner_provider());

create policy pharmacy_medications_update_partner
  on public.pharmacy_medications
  for update to authenticated
  using (pharmacy_partner_id = private.pharmacist_partner())
  with check (pharmacy_partner_id = private.pharmacist_partner());

create or replace function private.restrict_lab_test_partner_edit_to_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_admin() or private.has_permission('partners.labs.manage') then
    return new;
  end if;
  -- A plain lab_partner writer: only is_active may change.
  new.provider_id := old.provider_id;
  new.code := old.code;
  new.name := old.name;
  new.price_kobo := old.price_kobo;
  new.commission_rate := old.commission_rate;
  new.commission_rate_type := old.commission_rate_type;
  new.commission_flat_kobo := old.commission_flat_kobo;
  new.turnaround_hours := old.turnaround_hours;
  return new;
end;
$$;

comment on function private.restrict_lab_test_partner_edit_to_availability() is
  'A lab_partner may only toggle is_active on their own lab_tests rows -- every other column is forced back to its prior value for a non-admin, non-partners.labs.manage writer. Pricing/commission changes stay admin-only, since they feed the commission ledger and partner billing pipeline.';

create trigger lab_tests_restrict_partner_edit
  before update on public.lab_tests
  for each row execute function private.restrict_lab_test_partner_edit_to_availability();

create or replace function private.restrict_pharmacy_medication_partner_edit_to_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_admin() or private.has_permission('partners.pharmacies.manage') then
    return new;
  end if;
  new.pharmacy_partner_id := old.pharmacy_partner_id;
  new.drug_name := old.drug_name;
  new.pack_size := old.pack_size;
  new.price_kobo := old.price_kobo;
  new.commission_rate := old.commission_rate;
  new.commission_rate_type := old.commission_rate_type;
  new.commission_flat_kobo := old.commission_flat_kobo;
  return new;
end;
$$;

comment on function private.restrict_pharmacy_medication_partner_edit_to_availability() is
  'A pharmacist may only toggle is_active on their own pharmacy_medications rows -- every other column is forced back to its prior value for a non-admin, non-partners.pharmacies.manage writer.';

create trigger pharmacy_medications_restrict_partner_edit
  before update on public.pharmacy_medications
  for each row execute function private.restrict_pharmacy_medication_partner_edit_to_availability();

revoke all on function private.restrict_lab_test_partner_edit_to_availability() from public;
revoke all on function private.restrict_pharmacy_medication_partner_edit_to_availability() from public;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_partner_admin'
  ) then
    raise exception 'profiles.is_partner_admin missing after migration';
  end if;

  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'pharmacy_partner_locations'
  ) then
    raise exception 'pharmacy_partner_locations missing after migration';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.lab_tests'::regclass and tgname = 'lab_tests_restrict_partner_edit'
      and not tgisinternal
  ) then
    raise exception 'lab_tests_restrict_partner_edit trigger missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pharmacy_medications'::regclass and tgname = 'pharmacy_medications_restrict_partner_edit'
      and not tgisinternal
  ) then
    raise exception 'pharmacy_medications_restrict_partner_edit trigger missing';
  end if;

  raise notice 'PASS: partner self-service locations + availability-only catalogue editing in place';
end $$;
