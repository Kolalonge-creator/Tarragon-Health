-- Care Vouchers, part 1 of N: enum surface + the order-side discount columns.
--
-- WHY THIS EXISTS (founder decision 2026-07-31, CBN structuring):
-- The Health Wallet held a fungible naira balance, fundable by third parties,
-- with no expiry. That is stored value in substance whatever it is called, and
-- the closed-loop argument against CBN e-money licensing is much weaker than it
-- needs to be. Care Vouchers replace it: the patient buys a NAMED SERVICE AT A
-- FIXED PRICE and holds an entitlement to that service, not an amount of
-- spending power. Non-transferable, single-purpose, never cash-redeemable,
-- 24-month expiry.
--
-- ROW COUNTS BEFORE THIS CHANGE (checked live, 2026-07-31):
--   health_wallets 0 · wallet_topups 0 · wallet_ledger 0
--   wallet_savings_goals 0 · referrals 0 · total balance NGN 0.00
-- Nothing ever flowed through the wallet, so this is a purely structural
-- change with no customer money to unwind and no refunds owed. That is why
-- there is no conversion step anywhere in this series.
--
-- This migration is deliberately split out: Postgres forbids USING a freshly
-- added enum value in the same transaction that adds it, and part 2 needs
-- 'voucher' immediately. Brand-new enum TYPES have no such restriction, so
-- they are created here too.

alter type public.payment_provider add value if not exists 'voucher';

-- A prepaid entitlement to one named service, or a promotional discount that
-- nobody paid cash for. The two are deliberately different kinds on one table
-- so the redemption path is shared, but they are never accounted for together:
-- prepaid_service is customer money (a real liability), reward_discount is a
-- marketing liability. See the finance migration later in this series.
create type public.care_voucher_kind as enum ('prepaid_service', 'reward_discount');

-- reserved  = layaway in progress, not yet fully paid, not yet redeemable
-- active    = paid in full (or granted, for rewards), redeemable until expiry
-- redeemed  = consumed against exactly one order
-- expired   = passed expires_at without being redeemed
-- cancelled = withdrawn by staff (refund handled out of band, see the RPC)
create type public.care_voucher_status as enum
  ('reserved', 'active', 'redeemed', 'expired', 'cancelled');

create type public.care_voucher_event_type as enum
  ('created', 'payment_applied', 'activated', 'redeemed', 'expired', 'extended', 'cancelled');

-- ---------------------------------------------------------------------------
-- Order-side: a reward discount reduces what is payable without rewriting the
-- order's real price. total_kobo stays the honest catalogue price for
-- accounting and commission; payable_kobo is what the patient actually owes.
-- Generated, so no checkout path can forget to apply it.
-- ---------------------------------------------------------------------------

alter table public.lab_orders
  add column if not exists discount_kobo bigint not null default 0 check (discount_kobo >= 0),
  add column if not exists applied_voucher_id uuid;

alter table public.pharmacy_orders
  add column if not exists discount_kobo bigint not null default 0 check (discount_kobo >= 0),
  add column if not exists applied_voucher_id uuid;

alter table public.specialist_referrals
  add column if not exists discount_kobo bigint not null default 0 check (discount_kobo >= 0),
  add column if not exists applied_voucher_id uuid;

alter table public.lab_orders
  add column if not exists payable_kobo bigint
  generated always as (greatest(coalesce(total_kobo, 0) - discount_kobo, 0)) stored;

alter table public.pharmacy_orders
  add column if not exists payable_kobo bigint
  generated always as (greatest(coalesce(total_kobo, 0) - discount_kobo, 0)) stored;

-- specialist_referrals prices its fee in referral_fee_kobo, not total_kobo.
alter table public.specialist_referrals
  add column if not exists payable_kobo bigint
  generated always as (greatest(coalesce(referral_fee_kobo, 0) - discount_kobo, 0)) stored;

do $$
begin
  if not exists (select 1 from pg_enum
                 where enumtypid = 'public.payment_provider'::regtype and enumlabel = 'voucher') then
    raise exception 'payment_provider is missing the voucher value';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'lab_orders'
                   and column_name = 'payable_kobo') then
    raise exception 'lab_orders.payable_kobo was not created';
  end if;
end $$;;
