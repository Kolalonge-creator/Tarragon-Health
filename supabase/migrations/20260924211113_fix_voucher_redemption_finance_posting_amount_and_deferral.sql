-- Fix two real bugs in private.finance_post_voucher_redeemed, found while
-- auditing whether promo-code/care-voucher-covered service purchases report
-- accurately on the finance dashboard.
--
-- BUG 1 — OVERSTATEMENT. The trigger always posted new.face_value_kobo (the
-- voucher's full face value) as revenue, not the amount actually applied to
-- the order it was redeemed against. redeem_care_voucher() itself computes
-- v_covered := least(face_value_kobo, payable) and marks the voucher
-- 'redeemed' unconditionally, whether coverage was full or partial — so a
-- reward_discount voucher worth more than the order it discounted (e.g. a
-- promo code producing a bigger reward voucher than a cheap order needs)
-- overstated revenue beyond what the order was ever priced at. This mirrors
-- the exact bug already fixed for the platform-credit spend path in
-- 20260917234555, just never carried over here.
--
-- BUG 2 — TIMING / MATCHING-PRINCIPLE VIOLATION. For a service_purchase, the
-- trigger always posted straight to 4100 (immediate revenue), with no check
-- for service_products.access_duration_days. The same bounded-duration pack
-- paid by card (private.finance_post_from_payment) or by platform credit
-- (private.finance_post_platform_credit_ledger_entry, fixed in 20260917234555)
-- correctly defers to 2000 and opens a revenue_recognition_schedules row,
-- recognising straight-line over the access window. A promo-code/voucher-
-- covered purchase of the identical product recognised 100% of its value on
-- redemption day regardless of whether it had a bounded window at all.
--
-- lab/pharmacy/referral order types have no access-window concept (one-off
-- bookings) and keep the existing immediate-4100 treatment unchanged — only
-- the amount fix applies to them.
--
-- Both fixes read from state redeem_care_voucher() already persists at
-- redemption time (the order's own voucher_covered_kobo, and the linked
-- service_product's access_duration_days), rather than recomputing anything.

create or replace function private.finance_post_voucher_redeemed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_liability text;
  v_covered bigint;
  v_access_duration_days integer;
  v_pstart date;
  v_pend date;
begin
  if new.status <> 'redeemed' or old.status = 'redeemed' then return new; end if;
  v_liability := case when new.kind = 'prepaid_service' then '2100' else '2600' end;

  -- The amount actually applied to the redeeming order, not the voucher's
  -- full face value. Falls back to face_value_kobo for a redeemed_order_type
  -- this trigger doesn't recognise (there is none today, but a future order
  -- type should still post something rather than silently posting zero).
  v_covered := case new.redeemed_order_type::text
    when 'lab' then (select voucher_covered_kobo from public.lab_orders where id = new.redeemed_order_id)
    when 'pharmacy' then (select voucher_covered_kobo from public.pharmacy_orders where id = new.redeemed_order_id)
    when 'referral' then (select voucher_covered_kobo from public.specialist_referrals where id = new.redeemed_order_id)
    when 'service_purchase' then (select voucher_covered_kobo from public.service_purchases where id = new.redeemed_order_id)
    else null
  end;
  v_covered := coalesce(v_covered, new.face_value_kobo);
  if v_covered <= 0 then return new; end if;

  if new.redeemed_order_type::text = 'service_purchase' then
    select sp.access_duration_days into v_access_duration_days
    from public.service_purchases p
    join public.service_products sp on sp.id = p.service_product_id
    where p.id = new.redeemed_order_id;
  end if;

  if v_access_duration_days is not null then
    perform private.finance_post_journal(
      current_date, 'NGN'::public.currency, 'voucher', 'redeem:' || new.id::text,
      'Voucher redeemed — ' || coalesce(new.sku_name, 'care'),
      jsonb_build_array(
        jsonb_build_object('account_code',v_liability,'debit_minor',v_covered,'credit_minor',0,
                           'organisation_id',new.organisation_id),
        jsonb_build_object('account_code','2000','debit_minor',0,'credit_minor',v_covered,
                           'organisation_id',new.organisation_id)),
      null);

    v_pstart := current_date;
    v_pend := (v_pstart + (v_access_duration_days || ' days')::interval)::date;
    if v_pend > v_pstart then
      perform private.finance_create_recognition_schedule(
        'service_purchase', new.redeemed_order_id, null, new.organisation_id,
        '4020', 'NGN'::public.currency, v_covered, v_pstart, v_pend);
    end if;
  else
    perform private.finance_post_journal(
      current_date, 'NGN'::public.currency, 'voucher', 'redeem:' || new.id::text,
      'Voucher redeemed — ' || coalesce(new.sku_name, 'care'),
      jsonb_build_array(
        jsonb_build_object('account_code',v_liability,'debit_minor',v_covered,'credit_minor',0,
                           'organisation_id',new.organisation_id),
        jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_covered,
                           'organisation_id',new.organisation_id,'cost_center_code','PARTNER_NET')),
      null);
  end if;
  return new;
exception when others then
  return new; -- accounting must never block a patient getting their care
end;
$$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'finance_post_voucher_redeemed')
      not like '%voucher_covered_kobo%' then
    raise exception 'finance_post_voucher_redeemed was not updated to post the covered amount';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'finance_post_voucher_redeemed')
      not like '%access_duration_days%' then
    raise exception 'finance_post_voucher_redeemed was not updated to defer bounded-duration service purchases';
  end if;
end $$;
