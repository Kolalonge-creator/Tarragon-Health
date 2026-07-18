-- Tarragon Health — Sprint 1 foundation
-- 04 · Care Coordination (Category 3)
--
-- Lab network (providers, tests, orders, ML interpretations), panel bundles,
-- pharmacy network (partners, medications, orders), and the unified
-- commissions ledger for lab + pharmacy + referral revenue events.
--
-- Catalogue tables (lab_providers, lab_tests, panel_bundles,
-- pharmacy_partners, pharmacy_medications) are platform-global reference data:
-- no organisation_id, readable by any authenticated user, writable by admins.
-- All money is stored in kobo (bigint).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.lab_order_status as enum (
  'ordered', 'sample_collected', 'processing', 'resulted', 'cancelled'
);

create type public.pharmacy_order_status as enum (
  'requested', 'confirmed', 'dispensed', 'out_for_delivery', 'delivered', 'cancelled'
);

create type public.commission_type as enum ('lab', 'pharmacy', 'referral');

create type public.commission_status as enum ('pending', 'confirmed', 'paid');

-- ---------------------------------------------------------------------------
-- Lab catalogue (global)
-- ---------------------------------------------------------------------------

create table public.lab_providers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  home_collection   boolean not null default false,
  regions           text[] not null default '{}',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create table public.lab_tests (
  id                uuid primary key default gen_random_uuid(),
  provider_id       uuid not null references public.lab_providers (id) on delete cascade,
  code              text not null,
  name              text not null,
  price_kobo        bigint not null default 0,
  commission_rate   numeric(5, 4),
  turnaround_hours  integer,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (provider_id, code)
);

create index lab_tests_provider_idx on public.lab_tests (provider_id);

create table public.panel_bundles (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  description       text,
  price_kobo        bigint not null default 0,
  test_codes        text[] not null default '{}',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Lab orders + interpretations (tenant-scoped)
-- ---------------------------------------------------------------------------

create table public.lab_orders (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  provider_id             uuid references public.lab_providers (id) on delete set null,
  screening_schedule_id   uuid references public.screening_schedules (id) on delete set null,
  panel_bundle_id         uuid references public.panel_bundles (id) on delete set null,
  status                  public.lab_order_status not null default 'ordered',
  total_kobo              bigint not null default 0,
  ordered_at              timestamptz not null default now(),
  resulted_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index lab_orders_patient_idx on public.lab_orders (patient_id, ordered_at desc);
create index lab_orders_org_status_idx on public.lab_orders (organisation_id, status);
create index lab_orders_provider_idx on public.lab_orders (provider_id);
create index lab_orders_screening_schedule_idx on public.lab_orders (screening_schedule_id);
create index lab_orders_panel_bundle_idx on public.lab_orders (panel_bundle_id);

create trigger lab_orders_set_updated_at
  before update on public.lab_orders
  for each row execute function private.set_updated_at();

-- Deferred FK from migration 03: link a screening result to its lab order.
alter table public.screening_results
  add constraint screening_results_lab_order_id_fkey
  foreign key (lab_order_id) references public.lab_orders (id) on delete set null;

create index screening_results_lab_order_idx on public.screening_results (lab_order_id);

create table public.lab_result_interpretations (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  lab_order_id      uuid references public.lab_orders (id) on delete cascade,
  interpretation    jsonb not null default '{}'::jsonb,
  source            text not null default 'ml',   -- 'ml' | 'rule' | 'clinician'
  model_version     text,
  created_at        timestamptz not null default now()
);

create index lab_result_interpretations_patient_idx on public.lab_result_interpretations (patient_id);
create index lab_result_interpretations_org_idx on public.lab_result_interpretations (organisation_id);
create index lab_result_interpretations_order_idx on public.lab_result_interpretations (lab_order_id);

-- ---------------------------------------------------------------------------
-- Pharmacy catalogue (global)
-- ---------------------------------------------------------------------------

create table public.pharmacy_partners (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  delivery          boolean not null default true,
  regions           text[] not null default '{}',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create table public.pharmacy_medications (
  id                    uuid primary key default gen_random_uuid(),
  pharmacy_partner_id   uuid not null references public.pharmacy_partners (id) on delete cascade,
  drug_name             text not null,
  pack_size             text,
  price_kobo            bigint not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  unique (pharmacy_partner_id, drug_name, pack_size)
);

create index pharmacy_medications_partner_idx on public.pharmacy_medications (pharmacy_partner_id);

create table public.pharmacy_orders (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  pharmacy_partner_id   uuid references public.pharmacy_partners (id) on delete set null,
  status                public.pharmacy_order_status not null default 'requested',
  total_kobo            bigint not null default 0,
  items                 jsonb not null default '[]'::jsonb,
  requested_at          timestamptz not null default now(),
  delivered_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index pharmacy_orders_patient_idx on public.pharmacy_orders (patient_id, requested_at desc);
create index pharmacy_orders_org_status_idx on public.pharmacy_orders (organisation_id, status);
create index pharmacy_orders_partner_idx on public.pharmacy_orders (pharmacy_partner_id);

create trigger pharmacy_orders_set_updated_at
  before update on public.pharmacy_orders
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- commissions (unified ledger: lab + pharmacy + referral)
-- ---------------------------------------------------------------------------

create table public.commissions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  commission_type   public.commission_type not null,
  source_id         uuid,            -- lab_order / pharmacy_order / referral id
  partner_name      text,
  amount_kobo       bigint not null default 0,
  rate              numeric(5, 4),
  status            public.commission_status not null default 'pending',
  earned_at         timestamptz not null default now(),
  paid_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index commissions_org_idx on public.commissions (organisation_id, commission_type, status);
create index commissions_earned_idx on public.commissions (earned_at);

create trigger commissions_set_updated_at
  before update on public.commissions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.lab_providers               enable row level security;
alter table public.lab_tests                   enable row level security;
alter table public.panel_bundles               enable row level security;
alter table public.lab_orders                  enable row level security;
alter table public.lab_result_interpretations  enable row level security;
alter table public.pharmacy_partners           enable row level security;
alter table public.pharmacy_medications        enable row level security;
alter table public.pharmacy_orders             enable row level security;
alter table public.commissions                 enable row level security;

-- Global catalogues: authenticated read, admin write.
do $$
declare t text;
begin
  foreach t in array array[
    'lab_providers', 'lab_tests', 'panel_bundles',
    'pharmacy_partners', 'pharmacy_medications'
  ]
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated using (true);
      create policy %1$s_insert on public.%1$I
        for insert to authenticated with check (private.is_admin());
      create policy %1$s_update on public.%1$I
        for update to authenticated using (private.is_admin()) with check (private.is_admin());
      create policy %1$s_delete on public.%1$I
        for delete to authenticated using (private.is_admin());
    $f$, t);
  end loop;
end;
$$;

-- Patient-scoped coordination records: patient reads own; staff manage org.
do $$
declare t text;
begin
  foreach t in array array[
    'lab_orders', 'lab_result_interpretations', 'pharmacy_orders'
  ]
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (private.is_org_staff(organisation_id))
        with check (private.is_org_staff(organisation_id));
      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (private.is_org_staff(organisation_id));
    $f$, t);
  end loop;
end;
$$;

-- commissions: internal ledger — staff/admin of the org only, no patient access.
create policy commissions_select on public.commissions
  for select to authenticated using (private.is_org_staff(organisation_id));
create policy commissions_insert on public.commissions
  for insert to authenticated with check (private.is_org_staff(organisation_id));
create policy commissions_update on public.commissions
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy commissions_delete on public.commissions
  for delete to authenticated using (private.is_org_staff(organisation_id));

grant select on public.lab_providers, public.lab_tests, public.panel_bundles,
  public.pharmacy_partners, public.pharmacy_medications to authenticated;
grant insert, update, delete on public.lab_providers, public.lab_tests, public.panel_bundles,
  public.pharmacy_partners, public.pharmacy_medications to authenticated;
grant select, insert, update, delete on public.lab_orders to authenticated;
grant select, insert, update, delete on public.lab_result_interpretations to authenticated;
grant select, insert, update, delete on public.pharmacy_orders to authenticated;
grant select, insert, update, delete on public.commissions to authenticated;
