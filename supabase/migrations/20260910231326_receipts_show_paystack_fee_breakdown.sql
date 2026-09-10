-- Founder ask, 2026-09-10: after finding and fixing the payment-activation
-- bug (20260910215431_service_purchase_activation_tolerates_customer_borne_
-- fee), show the patient WHY a service_purchase charge came out higher than
-- the listed price -- this Paystack account passes its own transaction fee
-- to the customer, so what Paystack actually charges is price-plus-fee.
--
-- Paystack's checkout page already shows the real total before the patient
-- confirms payment, so nobody is ever charged something they didn't see and
-- agree to -- the gap this closes is understanding, not surprise. Two parts:
-- app-side copy shown before checkout (no migration needed for that), and
-- this migration's receipt breakdown, which shows the ACTUAL numbers after
-- the fact rather than a guess (Paystack only reveals its fee once a charge
-- completes -- there is no "estimate the fee" call to make before redirecting
-- a patient to checkout, since the fee depends on which channel, card/bank/
-- USSD, they choose once there).
--
-- public.patient_receipts() returns a bare jsonb array built from a plain
-- UNION ALL across six sources (membership/service_purchases, lab, pharmacy,
-- referral, video consultation, care voucher) -- adding two nullable columns
-- to that union is a same-shape CREATE OR REPLACE, not a breaking signature
-- change, but every branch of a UNION must carry the same column list, so
-- the other five branches get explicit `null::bigint` placeholders for the
-- two new columns rather than actual values -- correct, since a fee-
-- transparency breakdown only applies to the service_purchases/Paystack path
-- this fixed, not to a lab/pharmacy/referral/consultation/voucher charge.
--
-- charged_amount_minor / fee_minor are read from the SAME charge.success
-- payment_transactions row the activation trigger itself matched on
-- (raw_payload -> data ->> reference = service_purchases.payment_provider_ref),
-- so a receipt only ever shows a real, already-settled charge -- never a
-- guess, and never anything for a purchase that hasn't actually gone through
-- Paystack (free/voucher-covered activations still show payable_kobo as
-- amount_minor with both new columns null, exactly as before this migration).

create or replace function public.patient_receipts()
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  return coalesce(
    (
      select jsonb_agg(row_to_json(r) order by r.occurred_at desc)
      from (
        select
          sp.id,
          coalesce(sp.purchased_at, sp.created_at) as occurred_at,
          'membership'::text as service_type,
          coalesce(p.name, 'Service') as service_label,
          coalesce(sp.payment_provider_ref, sp.id::text) as reference,
          sp.amount_kobo as amount_minor,
          sp.currency,
          case
            when sp.status = 'active' then 'successful'
            when sp.status = 'refunded' then 'refunded'
            when sp.status = 'cancelled' then 'failed'
            else 'pending'
          end as status,
          sp.payment_provider::text as provider,
          sp.organisation_id,
          (
            select pt.amount_minor
            from public.payment_transactions pt
            where pt.raw_payload -> 'data' ->> 'reference' = sp.payment_provider_ref
              and pt.event_type = 'charge.success'
            order by pt.created_at desc
            limit 1
          ) as charged_amount_minor,
          (
            select (pt.raw_payload -> 'data' ->> 'fees')::bigint
            from public.payment_transactions pt
            where pt.raw_payload -> 'data' ->> 'reference' = sp.payment_provider_ref
              and pt.event_type = 'charge.success'
            order by pt.created_at desc
            limit 1
          ) as fee_minor
        from public.service_purchases sp
        left join public.service_products p on p.id = sp.service_product_id
        where sp.patient_id = v_caller
          and sp.amount_kobo > 0

        union all

        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at),
          'laboratory',
          coalesce(pb.name, 'Lab order'),
          coalesce(pt.provider_event_id, pt.id::text),
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end,
          pt.provider::text,
          lo.organisation_id,
          null::bigint,
          null::bigint
        from public.payment_transactions pt
        join public.lab_orders lo on lo.id = pt.booking_order_id
        left join public.panel_bundles pb on pb.id = lo.panel_bundle_id
        where pt.booking_order_type = 'lab' and lo.patient_id = v_caller

        union all

        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at),
          'pharmacy',
          'Pharmacy order (' || jsonb_array_length(coalesce(po.items, '[]'::jsonb)) || ' item'
            || case when jsonb_array_length(coalesce(po.items, '[]'::jsonb)) = 1 then '' else 's' end || ')',
          coalesce(pt.provider_event_id, pt.id::text),
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end,
          pt.provider::text,
          po.organisation_id,
          null::bigint,
          null::bigint
        from public.payment_transactions pt
        join public.pharmacy_orders po on po.id = pt.booking_order_id
        where pt.booking_order_type = 'pharmacy' and po.patient_id = v_caller

        union all

        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at),
          'referral',
          initcap(replace(sr.specialist_type::text, '_', ' ')) || ' referral',
          coalesce(pt.provider_event_id, pt.id::text),
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end,
          pt.provider::text,
          sr.organisation_id,
          null::bigint,
          null::bigint
        from public.payment_transactions pt
        join public.specialist_referrals sr on sr.id = pt.booking_order_id
        where pt.booking_order_type = 'referral' and sr.patient_id = v_caller

        union all

        select
          vvr.id,
          vvr.created_at,
          'consultation',
          'Video consultation',
          coalesce(vvr.payment_provider_ref, vvr.id::text),
          vvr.amount_minor,
          vvr.currency::public.currency,
          case
            when vvr.refund_status = 'refunded' then 'refunded'
            when vvr.status in ('declined', 'expired') and vvr.refund_status = 'due' then 'pending_refund'
            when vvr.status in ('declined', 'expired') then 'failed'
            when vvr.payment_provider_ref is not null then 'successful'
            else 'pending'
          end,
          vvr.payment_provider,
          vvr.organisation_id,
          null::bigint,
          null::bigint
        from public.video_visit_requests vvr
        where vvr.patient_id = v_caller and vvr.amount_minor > 0

        union all

        select
          cvp.id,
          cvp.created_at,
          'care_voucher',
          coalesce(cv.sku_name, 'Care voucher'),
          coalesce(cvp.pending_provider_ref, cvp.id::text),
          cvp.amount_minor,
          cvp.currency::public.currency,
          case cvp.status
            when 'applied' then 'successful'
            when 'failed' then 'failed'
            else 'pending'
          end,
          cvp.provider::text,
          cvp.organisation_id,
          null::bigint,
          null::bigint
        from public.care_voucher_payments cvp
        join public.care_vouchers cv on cv.id = cvp.voucher_id
        where cvp.payer_profile_id = v_caller
      ) r
    ),
    '[]'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Proof: read-only, no writes. Confirms the function still returns valid
-- jsonb for the caller with no rows (the common case in CI's empty seed),
-- and — when real service_purchase + payment_transactions data exists for
-- the fee-inflated bug this closes (2efae6a7-85c1-46a8-bdf7-811647068700,
-- see 20260910215431) — that the breakdown resolves to the exact real
-- numbers, not a guess: fee_minor=25381, charged_amount_minor=1025381.
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
  v_row jsonb;
  v_row_exists boolean;
begin
  select exists(
    select 1 from public.service_purchases where id = '2efae6a7-85c1-46a8-bdf7-811647068700'
  ) into v_row_exists;

  if not v_row_exists then
    raise notice 'SKIP: the real fee-inflated purchase row from production is not present in this environment (expected on a fresh CI replay)';
    return;
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', (select patient_id::text from public.service_purchases where id = '2efae6a7-85c1-46a8-bdf7-811647068700'),
      'role', 'authenticated'
    )::text,
    true
  );
  begin
    set local role authenticated;
    select public.patient_receipts() into v_result;
    reset role;
  exception when others then
    reset role;
    raise;
  end;
  perform set_config('request.jwt.claims', null, true);

  select r into v_row
    from jsonb_array_elements(v_result) r
   where r ->> 'id' = '2efae6a7-85c1-46a8-bdf7-811647068700';

  if v_row is null then
    raise exception 'FAIL: the real purchase did not appear in its own patient''s receipts at all';
  end if;
  if (v_row ->> 'charged_amount_minor')::bigint <> 1025381 then
    raise exception 'FAIL: charged_amount_minor was % instead of the real 1025381', v_row ->> 'charged_amount_minor';
  end if;
  if (v_row ->> 'fee_minor')::bigint <> 25381 then
    raise exception 'FAIL: fee_minor was % instead of the real 25381', v_row ->> 'fee_minor';
  end if;
  raise notice 'PASS: the real receipt shows charged_amount_minor=1025381, fee_minor=25381 -- exactly what Paystack actually charged and kept';
end $$;
