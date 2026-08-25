-- ---------------------------------------------------------------------------
-- device_catalog — curated third-party (and, later, Tarragon-owned) health
-- devices: BP monitor / scale / glucometer / wearable band.
--
-- Per Tarragon Health — Device Pairing & Integration Spec v2 §4. This is a
-- global reference catalogue (no organisation_id), same shape as
-- lab_tests/pharmacy_medications in 20260705211315_care_coordination.sql:
-- authenticated read, admin write, app layer decides what a patient actually
-- sees (active + clinically_reviewed).
--
-- Deliberately does NOT introduce a `device_readings` table — that would be a
-- parallel source of truth for exactly the metrics `vitals_readings`
-- (source='device'/'wearable') and `wearable_readings`/`activity_log_entries`
-- already own (see CLAUDE.md's wearable-integration section). This table is
-- product-catalogue data only: what to recommend and where to buy it, not
-- where a reading lands once paired.
-- ---------------------------------------------------------------------------

create type public.device_catalog_category as enum (
  'blood_pressure',
  'weight',
  'blood_glucose',
  'band'
);

create type public.device_catalog_fulfillment_type as enum (
  'affiliate',
  'tarragon_owned'
);

create type public.device_catalog_pairing_path as enum (
  'ble_open_gatt',
  'ble_vendor_sdk',
  'health_connect_bridge',
  'manual_only'
);

create table public.device_catalog (
  id                   uuid primary key default gen_random_uuid(),
  device_name          text not null,
  category             public.device_catalog_category not null,
  fulfillment_type     public.device_catalog_fulfillment_type not null default 'affiliate',
  pairing_path         public.device_catalog_pairing_path not null,
  vendor_name          text,
  -- One-line "why we recommend it" — shown on both the marketing card and
  -- the in-app Shop card (spec §9.1/§9.2).
  description          text,
  image_url            text,
  -- Free-form on purpose (spec §4's own schema comment: 'jumia' | 'konga' |
  -- null) — a device can be a direct-manufacturer link with no Jumia/Konga
  -- affiliate relationship at all (e.g. a brand's own Nigeria store).
  affiliate_partner    text,
  affiliate_link       text,
  price_range_ngn      text,
  -- Populated only when pairing_path = 'ble_open_gatt' (spec §4 comment).
  gatt_service_uuids   text[] not null default '{}',
  -- Populated only when pairing_path = 'ble_vendor_sdk', e.g.
  -- 'yucheng-ycaviation' — the native-module bridge itself is a separate,
  -- per-vendor engineering effort (spec §2.3), not built by this migration.
  vendor_sdk_ref       text,
  display_order        integer not null default 0,
  -- Both gates start false: the spec's own onboarding checklist (§4.1) requires
  -- a real end-to-end pairing test before `active`, and clinical sign-off
  -- before `clinically_reviewed` — a device recommendation inside a chronic-
  -- disease pathway is a clinical decision, not just a product one. Only an
  -- admin flips these once that's actually happened.
  active               boolean not null default false,
  clinically_reviewed  boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint device_catalog_affiliate_link_required
    check (fulfillment_type <> 'affiliate' or affiliate_link is not null),
  constraint device_catalog_gatt_uuids_scope
    check (pairing_path = 'ble_open_gatt' or gatt_service_uuids = '{}'),
  constraint device_catalog_vendor_sdk_ref_scope
    check (pairing_path = 'ble_vendor_sdk' or vendor_sdk_ref is null)
);

create index device_catalog_category_active_idx
  on public.device_catalog (category, active, display_order);

create trigger device_catalog_set_updated_at
  before update on public.device_catalog
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — global catalogue pattern (see lab_tests/pharmacy_medications):
-- authenticated read, admin write. No anon grant: the marketing site's
-- devices page renders from static content, not this table directly (see
-- CLAUDE.md — "Marketing pages must not import platform/auth modules").
-- ---------------------------------------------------------------------------

alter table public.device_catalog enable row level security;

create policy device_catalog_select on public.device_catalog
  for select to authenticated using (true);
create policy device_catalog_insert on public.device_catalog
  for insert to authenticated with check (private.is_admin());
create policy device_catalog_update on public.device_catalog
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy device_catalog_delete on public.device_catalog
  for delete to authenticated using (private.is_admin());

-- RLS restricts rows, it does not grant table-level access (see CLAUDE.md's
-- recurring "freshly created table needs its own grant" lesson).
grant select on public.device_catalog to authenticated;
grant insert, update, delete on public.device_catalog to authenticated;

-- ---------------------------------------------------------------------------
-- Seed the 3 curated devices from spec v1 §4. Left active=false /
-- clinically_reviewed=false on purpose — see the column comments above and
-- spec §4.1 step 5/6. price_range_ngn intentionally left null: CLAUDE.md
-- explicitly warns against trusting a stale price, and none was verified at
-- build time. An admin fills in price and flips both flags once the real
-- pairing test (spec §4.1 step 5) has actually run.
--
-- No wearable-band row is seeded: the band is a Path A-2 (vendor-SDK)
-- device per spec §2.3, and no real Yucheng/YCAviation device model, price,
-- or link exists to seed truthfully yet. The 'band' category and
-- 'ble_vendor_sdk' pairing_path exist above so that row can be added later
-- without a further migration.
-- ---------------------------------------------------------------------------

insert into public.device_catalog
  (device_name, category, fulfillment_type, pairing_path, vendor_name, description, affiliate_partner, affiliate_link, display_order)
values
  (
    'Omron 10 Series Wireless Upper Arm (BP7450)',
    'blood_pressure',
    'affiliate',
    'health_connect_bridge',
    'Omron',
    'The most clinically trusted consumer BP brand globally; syncs via the OMRON connect app to both Apple Health and Health Connect.',
    'jumia',
    'https://www.jumia.com.ng/omron-10-series-wireless-upper-arm-blood-pressure-monitor-bp7450-418251415.html',
    1
  ),
  (
    'Xiaomi Mi Body Composition Scale 2',
    'weight',
    'affiliate',
    'health_connect_bridge',
    'Xiaomi',
    'Bluetooth Low Energy 5.0, affordable and widely available; syncs via the Mi Fit app. Verify current Health Connect/Apple Health export reliability before activating.',
    null,
    'https://www.mi.com/ng/product/mi-body-composition-scale-2/',
    1
  ),
  (
    'Accu-Chek Instant',
    'blood_glucose',
    'affiliate',
    'health_connect_bridge',
    'Roche',
    'Globally trusted glucose-monitoring brand, Bluetooth-enabled, syncs via the mySugr app, and already stocked locally in Nigeria.',
    'jumia',
    'https://www.jumia.com.ng/blood-glucose-monitors/accu-chek/',
    1
  );
