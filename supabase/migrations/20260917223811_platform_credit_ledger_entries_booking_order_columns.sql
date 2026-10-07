-- Tarragon Health — Platform Credit, part 6: booking-order correlation
-- columns, so a pharmacy/referral spend has somewhere to record what it
-- paid for.
--
-- platform_credit_ledger_entries already correlates a service_purchases
-- spend via service_purchase_id (a real FK, since that's the only booking
-- kind that existed when the table was created). A pharmacy_orders or
-- specialist_referrals spend has no equivalent column to land in — and no
-- single FK column can point at either table, the same polymorphic problem
-- payment_transactions.booking_order_id already solved for the Paystack path
-- (see 20260715001642_booking_payment_columns.sql: "No FK: polymorphic
-- across three tables").
--
-- Reusing public.commission_type for booking_order_type rather than adding a
-- new text+CHECK enum-substitute: it is already exactly {lab, pharmacy,
-- referral} — the three booking tables that ever carry a real Tarragon-
-- collected fee — and it is already the type payment_transactions.
-- booking_order_type uses for this identical polymorphic-id pattern. No FK
-- on booking_order_id for the same reason payment_transactions has none:
-- the target table varies by booking_order_type.
--
-- Purely additive: no existing row, query, or trigger reads these columns,
-- and private.platform_credit_apply/private.finance_post_platform_credit_
-- ledger_entry are untouched — both already operate only on entry_type/
-- paid_amount_kobo/promo_amount_kobo/description/organisation_id, with zero
-- knowledge of what was purchased (confirmed by reading their live
-- definitions before writing this), so a lab/pharmacy/referral spend posts
-- to the GL exactly the same way a service_purchases spend already does.

alter table public.platform_credit_ledger_entries
  add column booking_order_type public.commission_type,
  add column booking_order_id uuid;

comment on column public.platform_credit_ledger_entries.booking_order_id is
  'lab_order / pharmacy_order / specialist_referral id, disambiguated by booking_order_type — same polymorphic-id pattern as payment_transactions.booking_order_id. NULL for a service_purchases spend (see service_purchase_id instead), a topup, an admin_grant, or an admin_correction.';
comment on column public.platform_credit_ledger_entries.booking_order_type is
  'Which table booking_order_id belongs to. NULL whenever booking_order_id is NULL.';

create index platform_credit_ledger_entries_booking_order_idx
  on public.platform_credit_ledger_entries (booking_order_type, booking_order_id)
  where booking_order_id is not null;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_credit_ledger_entries'
      and column_name = 'booking_order_id'
  ) then
    raise exception 'booking_order_id was not added to platform_credit_ledger_entries';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_credit_ledger_entries'
      and column_name = 'booking_order_type'
  ) then
    raise exception 'booking_order_type was not added to platform_credit_ledger_entries';
  end if;
  -- The two writer paths this migration set exists to protect must remain
  -- untouched by this purely-additive change — spot-check their live
  -- definitions still make no reference to the new columns (a copy/paste
  -- accident here would otherwise silently start requiring them).
  if pg_get_functiondef('private.platform_credit_apply(uuid,uuid,public.platform_credit_entry_type,bigint,public.platform_credit_bucket,text,uuid,uuid,uuid,text,uuid)'::regprocedure) ilike '%booking_order%' then
    raise exception 'private.platform_credit_apply must stay generic — it must not reference booking_order_id/type';
  end if;
  if pg_get_functiondef('private.finance_post_platform_credit_ledger_entry()'::regprocedure) ilike '%booking_order%' then
    raise exception 'private.finance_post_platform_credit_ledger_entry must stay generic — it must not reference booking_order_id/type';
  end if;
  raise notice 'PASS: platform_credit_ledger_entries gained booking_order_id/booking_order_type, core primitives untouched';
end $$;
