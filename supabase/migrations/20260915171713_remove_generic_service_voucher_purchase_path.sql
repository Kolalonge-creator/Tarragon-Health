-- Remove the generic "buy a service_product voucher for someone" purchase/
-- redeem path (the "Buy care for someone" section on the patient vouchers
-- card, and the admin voucher manager). This was the only purchasable-
-- voucher surface being retired here.
--
-- The shared voucher/reward engine is deliberately UNTOUCHED by this
-- migration: care_vouchers, care_voucher_config, care_voucher_payments,
-- care_voucher_events, voucher_refund_queue, and the functions
-- purchase_care_voucher, redeem_care_voucher, cancel_care_voucher,
-- private.issue_reward_voucher, redeem_promo_code, redeem_wellness_points
-- all stay exactly as they are — they still back wellness-points
-- redemption, referral rewards, promo-code discounting, and the diaspora
-- "Gift a Health Check" flow (purchase_care_voucher / panel_bundle_id),
-- none of which this migration affects.
--
-- Verified before writing this migration: 0 live care_vouchers rows have
-- service_product_id set (the only kind this path ever produced) — a pure
-- structural removal, no data migration needed.

drop function if exists public.redeem_service_voucher(p_voucher_id uuid);
drop function if exists public.purchase_service_voucher(p_beneficiary uuid, p_service_product_id uuid, p_gift_message text);

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('purchase_service_voucher', 'redeem_service_voucher')
  ) then
    raise exception 'purchase_service_voucher/redeem_service_voucher should no longer exist';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'purchase_care_voucher'
  ) then
    raise exception 'purchase_care_voucher (Gift a Health Check) must still exist';
  end if;
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'care_vouchers'
  ) then
    raise exception 'care_vouchers must still exist (shared reward/promo engine)';
  end if;
end $$;
