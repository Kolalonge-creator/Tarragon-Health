-- Tarragon Health — dispensed-medication record (medication pathway, Phase 8a)
--
-- Records what was actually dispensed against a pharmacy order — drug name,
-- quantity, and date. Per the pathway: a pharmacy records what it dispensed,
-- and the patient can also record it themselves (important for no-login
-- pharmacies, where the patient confirms collection). This is a fulfilment
-- record on the order, distinct from the medications regimen table.
--
-- Kept deliberately narrow (no stock/inventory — the founder was explicit the
-- pharmacist surface must not require pharmacies to load stock). RLS: the order
-- owner (patient) and org staff can read/add; a scoped pharmacist role for
-- login-using partners is a separate, security-reviewed follow-up (see the
-- Phase 8 note in CLAUDE.md — cross-tenant PHI access needs its own RLS design).
-- All idempotent-guarded.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'dispense_source') then
    create type public.dispense_source as enum ('patient', 'pharmacy');
  end if;
end $$;

create table if not exists public.pharmacy_order_dispenses (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  pharmacy_order_id  uuid not null references public.pharmacy_orders (id) on delete cascade,
  drug_name          text not null,
  quantity           text,
  dispensed_on       date not null default current_date,
  source             public.dispense_source not null default 'patient',
  recorded_by        uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists pharmacy_order_dispenses_order_idx
  on public.pharmacy_order_dispenses (pharmacy_order_id);
create index if not exists pharmacy_order_dispenses_patient_idx
  on public.pharmacy_order_dispenses (patient_id);

drop trigger if exists pharmacy_order_dispenses_set_updated_at on public.pharmacy_order_dispenses;
create trigger pharmacy_order_dispenses_set_updated_at
  before update on public.pharmacy_order_dispenses
  for each row execute function private.set_updated_at();

alter table public.pharmacy_order_dispenses enable row level security;

-- Patient reads/records dispenses on their own orders; org staff manage.
drop policy if exists pharmacy_order_dispenses_select on public.pharmacy_order_dispenses;
create policy pharmacy_order_dispenses_select on public.pharmacy_order_dispenses
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists pharmacy_order_dispenses_insert on public.pharmacy_order_dispenses;
create policy pharmacy_order_dispenses_insert on public.pharmacy_order_dispenses
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists pharmacy_order_dispenses_update on public.pharmacy_order_dispenses;
create policy pharmacy_order_dispenses_update on public.pharmacy_order_dispenses
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.pharmacy_order_dispenses to authenticated;
