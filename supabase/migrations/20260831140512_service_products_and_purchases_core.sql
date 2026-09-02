-- Tarragon Health — Pay-per-service business model, Phase 1 (schema)
--
-- Founder decision 2026-08-31: retire the recurring subscription-tier model
-- (subscription_plans/subscriptions/subscription_add_ons/add_ons) in favour
-- of pay-per-service — a patient buys a bounded-duration "pack" (or a
-- perpetual/single-use grant) instead of an auto-renewing plan. Confirmed
-- pre-revenue (at most one real subscriber ever existed, an explicitly
-- flagged QA/test account already deactivated — see
-- 20260802214403_deactivate_stale_locked_complete_usd.sql) — this is a pure
-- schema/code migration, not a customer-migration problem.
--
-- This migration only adds the new catalogue/purchase tables and seeds the
-- initial packs. It deliberately does NOT touch
-- subscription_plans/subscriptions/subscription_add_ons/add_ons or the
-- entitlement functions yet — that rewire is the next migration, kept
-- separate so each migration proves one thing and can be reviewed/rolled
-- back independently, matching this repo's established convention (e.g. the
-- Screening ladder core/advanced/comprehensive build was similarly split
-- schema-then-rewire across files).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.service_purchase_status as enum (
  'pending_payment', 'active', 'expired', 'cancelled', 'refunded'
);

-- ---------------------------------------------------------------------------
-- service_products (global catalogue, replaces subscription_plans/add_ons)
-- ---------------------------------------------------------------------------

create table public.service_products (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  name                  text not null,
  description           text,
  price_kobo            bigint not null default 0,
  currency              public.currency not null default 'NGN',
  -- null = perpetual/single-use grant (e.g. a one-off async visit credit);
  -- otherwise the access window length in days from purchased_at.
  access_duration_days  integer,
  features              text[] not null default '{}',
  ai_coach_daily_limit  integer,
  stripe_price_id       text,   -- a ONE-OFF Stripe Price, never a recurring one
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint service_products_duration_non_negative
    check (access_duration_days is null or access_duration_days > 0)
);

create trigger service_products_set_updated_at
  before update on public.service_products
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- service_purchases (per patient, replaces subscriptions/subscription_add_ons)
-- ---------------------------------------------------------------------------

create table public.service_purchases (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisations (id) on delete restrict,
  patient_id                    uuid not null references public.profiles (id) on delete cascade,
  -- Usually = patient_id; differs when a sponsor buys on the patient's
  -- behalf, same shape as care_vouchers.purchaser_profile_id.
  purchaser_profile_id          uuid references public.profiles (id) on delete set null,
  service_product_id            uuid not null references public.service_products (id) on delete restrict,
  status                        public.service_purchase_status not null default 'pending_payment',
  amount_kobo                   bigint not null,
  currency                      public.currency not null,
  payment_provider              public.payment_provider,
  payment_provider_ref          text,
  pending_payment_provider_ref  text,
  -- Polymorphic scope for a purchase tied to one specific object rather than
  -- a platform-wide grant (e.g. 'chronic_programme_enrolment' for the
  -- 12-week doctor-supported add-on) — null means the grant applies
  -- platform-wide to the patient, same shape as care_vouchers' bundle-or-plan
  -- SKU distinction but generalised to any future scope.
  scoped_entity_type            text,
  scoped_entity_id              uuid,
  purchased_at                  timestamptz,
  expires_at                    timestamptz,
  cancelled_at                  timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint service_purchases_active_has_purchased_at
    check (status <> 'active' or purchased_at is not null)
);

create index service_purchases_patient_active_idx
  on public.service_purchases (patient_id, status) where status = 'active';
create index service_purchases_org_idx on public.service_purchases (organisation_id, status);
create index service_purchases_product_idx on public.service_purchases (service_product_id);
create index service_purchases_scoped_entity_idx
  on public.service_purchases (scoped_entity_type, scoped_entity_id) where scoped_entity_id is not null;
create unique index service_purchases_pending_ref_unique
  on public.service_purchases (pending_payment_provider_ref) where pending_payment_provider_ref is not null;

create trigger service_purchases_set_updated_at
  before update on public.service_purchases
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — catalogue: authenticated read, admin write. Purchases: patient reads
-- own, org staff read/write within org; inserts only ever happen through the
-- checkout server action (service-role) + the payment-confirmation trigger,
-- same shape as lab_orders/payment_transactions.
-- ---------------------------------------------------------------------------

alter table public.service_products  enable row level security;
alter table public.service_purchases enable row level security;

create policy service_products_select on public.service_products
  for select to authenticated using (true);
create policy service_products_insert on public.service_products
  for insert to authenticated with check (private.is_admin());
create policy service_products_update on public.service_products
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy service_products_delete on public.service_products
  for delete to authenticated using (private.is_admin());

create policy service_purchases_select on public.service_purchases
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or purchaser_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );
create policy service_purchases_insert on public.service_purchases
  for insert to authenticated
  with check (
    purchaser_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );
create policy service_purchases_update on public.service_purchases
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy service_purchases_delete on public.service_purchases
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.service_products to authenticated;
grant select, insert, update, delete on public.service_purchases to authenticated;
revoke all on public.service_products from anon;

-- ---------------------------------------------------------------------------
-- Seed: reuse today's live tier feature-groupings verbatim (confirmed live
-- 2026-08-31 against subscription_plans), only the commercial mechanic
-- changes — a 30-day pack instead of an auto-renewing plan. Prices/features
-- copied as-is; re-bundling the 14 feature strings is a real product
-- decision already made once and is deliberately NOT re-litigated here.
-- chronic_doctor_supported_pack is new (12-week programme add-on, priced
-- pending founder sign-off — ships inactive until a real price is set).
-- ---------------------------------------------------------------------------

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, features, ai_coach_daily_limit, is_active)
select
  p.code || '_pack',
  p.name || ' Pack',
  p.description,
  p.price_minor,
  p.currency,
  30,
  p.features,
  p.ai_coach_daily_limit,
  p.is_active
from public.subscription_plans p
where p.code in ('free', 'prevent', 'essential', 'complete')
on conflict (code) do nothing;

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
values (
  'chronic_doctor_supported_pack',
  '12-Week Doctor-Supported Programme Add-On',
  'Adds 3 pooled-doctor check-in calls, active medication titration, and doctor-suggested testing to a 12-week chronic-care enrolment. Price pending founder sign-off — ships inactive.',
  1500000, -- proposed ₦15,000, flagged in the plan as a starting number to adjust
  'NGN',
  84, -- exactly the 12-week programme window, not the generic 30-day pack cycle
  array['chronic_doctor_supported_track'],
  false -- inactive until the founder confirms pricing
)
on conflict (code) do nothing;

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, features, ai_coach_daily_limit, is_active)
select
  a.code || '_pack',
  a.name || ' Pack',
  a.description,
  a.price_minor,
  a.currency,
  30,
  a.features,
  null,
  a.is_active
from public.add_ons a
where a.code = 'ai-coach' or a.features @> array['ai_coach']
on conflict (code) do nothing;

do $$
begin
  if not exists (select 1 from public.service_products where code = 'chronic_doctor_supported_pack') then
    raise exception 'seed failed: chronic_doctor_supported_pack missing';
  end if;
  if (select count(*) from public.service_products where code in ('free_pack','prevent_pack','essential_pack','complete_pack')) <> 4 then
    raise exception 'seed failed: expected 4 tier packs copied from subscription_plans, got %',
      (select count(*) from public.service_products where code in ('free_pack','prevent_pack','essential_pack','complete_pack'));
  end if;
  if has_table_privilege('anon', 'public.service_products', 'INSERT') then
    raise exception 'FAIL: anon must not be able to write service_products';
  end if;
  raise notice 'PASS: service_products/service_purchases schema + seed in place';
end $$;
