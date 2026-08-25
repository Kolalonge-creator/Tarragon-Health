-- Tarragon Health — device shop: advisory, condition-based device recommendations
--
-- Patients buy their own BP monitor / glucometer / etc. from a retailer — Tarragon
-- does not import, bundle, or sell devices (founder decision 2026-08-02, see
-- CLAUDE.md). This is a link-out catalogue only: `device_offerings` records which
-- models exist and where to buy them; `fulfilment_type` distinguishes an outbound
-- affiliate/retailer link (the only path actually wired up right now) from a future
-- Tarragon-hosted checkout, which is not decided or built yet — the column exists so
-- that decision doesn't require a schema change later, not because checkout works.
--
-- Same shape/ownership as pharmacy_partners / chronic_condition_programmes: a
-- global reference catalogue (no organisation_id), authenticated read of active
-- rows, admin (or a delegated partners.devices.manage grant) write.
--
-- Condition-based recommendation is advisory only, computed in the app from a
-- patient's active chronic_programme_enrolments -> chronic_condition_programmes
-- .monitoring_vitals -> device_type — never a purchase gate. Nothing in this
-- migration restricts which offerings a patient can see or link out to.
-- ---------------------------------------------------------------------------

create table public.device_offerings (
  id               uuid primary key default gen_random_uuid(),
  device_type      public.patient_device_type not null,
  make             text not null,
  model            text not null,
  retailer_name    text,
  -- 'affiliate_link' is the only fulfilment path actually wired up today (see
  -- device-shop-section.tsx). 'direct_checkout' is reserved for a possible future
  -- Tarragon-hosted purchase flow — not decided, not built; storing the column now
  -- avoids a migration later, it does not imply checkout exists.
  fulfilment_type  text not null default 'affiliate_link'
                     check (fulfilment_type in ('affiliate_link', 'direct_checkout')),
  affiliate_url    text,
  price_kobo       bigint check (price_kobo is null or price_kobo >= 0),
  image_url        text,
  description      text,
  -- True only for a model actually paired against real hardware per CLAUDE.md's
  -- "Device & Wearable Integration" section (currently neither curated model has
  -- been). Purely informational — never gates purchase or display.
  ble_validated    boolean not null default false,
  is_active        boolean not null default true,
  display_order    integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (device_type, make, model),
  constraint device_offerings_affiliate_url_required
    check (fulfilment_type <> 'affiliate_link' or affiliate_url is not null)
);

create index device_offerings_active_idx
  on public.device_offerings (is_active, device_type, display_order);

create trigger device_offerings_set_updated_at
  before update on public.device_offerings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: any authenticated user reads active offerings; admins (or a delegated
-- partners.devices.manage grant) read/write everything, including inactive
-- draft rows while a new listing is being set up.
-- ---------------------------------------------------------------------------
alter table public.device_offerings enable row level security;

create policy device_offerings_select on public.device_offerings
  for select to authenticated
  using (is_active or private.is_admin() or private.has_permission('partners.devices.manage'));

create policy device_offerings_insert on public.device_offerings
  for insert to authenticated
  with check (private.is_admin() or private.has_permission('partners.devices.manage'));

create policy device_offerings_update on public.device_offerings
  for update to authenticated
  using (private.is_admin() or private.has_permission('partners.devices.manage'))
  with check (private.is_admin() or private.has_permission('partners.devices.manage'));

create policy device_offerings_delete on public.device_offerings
  for delete to authenticated
  using (private.is_admin() or private.has_permission('partners.devices.manage'));

-- A freshly created table needs its own table-level grant — RLS restricts rows,
-- it does not grant table access (see CLAUDE.md's standing lesson on this).
grant select, insert, update, delete on public.device_offerings to authenticated;

-- ---------------------------------------------------------------------------
-- Register the delegable permission key (catalogue seeded in
-- 20260718230000_rbac_permissions.sql; keep apps/web/src/lib/auth/permissions.ts
-- PERMISSION_KEYS in sync with this).
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description)
values (
  'partners.devices.manage',
  'Manage device catalogue',
  'Partners',
  'Add and edit the recommended BP monitor / glucometer / scale listings patients can buy'
)
on conflict (key) do nothing;

-- No seed rows: no real retailer/affiliate relationship exists yet (still being
-- decided per CLAUDE.md's device-sourcing note) — an admin adds real listings via
-- /admin/settings/partners/devices once one does, rather than shipping placeholder
-- data.
