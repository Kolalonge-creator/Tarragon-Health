-- Tarragon Health — patient-facing receipts / payment history (spec §25.7).
--
-- Nothing today lets a patient see what they were charged, for what, or
-- when — payment_transactions carries the full webhook history but its only
-- select policy is private.is_org_staff(organisation_id) (see
-- 20260712201507_payment_transactions.sql), which never admits the patient
-- themselves. A receipt is a basic expectation on every paid platform, not a
-- speculative feature, so this closes that gap directly rather than
-- widening payment_transactions' own RLS (which would still miss video
-- consultations and care-voucher instalments — see below).
--
-- One SECURITY DEFINER RPC, always scoped to auth.uid() (no patient-id
-- parameter — nothing to authorise, nothing to get wrong), normalising five
-- payment sources into one receipt shape:
--   - membership/subscription charges (payment_transactions -> subscriptions)
--   - laboratory / pharmacy / specialist-referral bookings
--     (payment_transactions.booking_order_type/booking_order_id, added by
--     20260715001642_booking_payment_columns.sql)
--   - video consultations (video_visit_requests carries its own
--     amount/currency/provider_ref directly — commission_type has no
--     'consultation' member, so these were never reachable through
--     payment_transactions' polymorphic booking_order_* columns)
--   - care voucher instalments the patient paid themselves
--     (care_voucher_payments.payer_profile_id)
--
-- This is a receipt/payment-history view, not the formal per-service invoice
-- document §25.6 also describes (numbered PDF, VAT breakdown, etc.) — that
-- stays a separate, later piece of work; what ships here answers "what did I
-- pay, for what, when" for every paid interaction the platform already
-- tracks, which is what a patient actually asks for.

create or replace function public.patient_receipts()
returns jsonb
language plpgsql
stable
security definer
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
        -- Membership / subscription charges.
        select
          pt.id,
          coalesce(pt.processed_at, pt.created_at) as occurred_at,
          'membership'::text as service_type,
          coalesce(sp.name, 'Membership') as service_label,
          coalesce(pt.provider_event_id, pt.id::text) as reference,
          pt.amount_minor,
          pt.currency,
          case
            when pt.error is not null then 'failed'
            when pt.event_type::text in ('charge.failed', 'invoice.payment_failed') then 'failed'
            when pt.processed_at is not null then 'successful'
            else 'pending'
          end as status,
          pt.provider::text as provider
        from public.payment_transactions pt
        join public.subscriptions s on s.id = pt.subscription_id
        left join public.subscription_plans sp on sp.id = s.plan_id
        where s.subscriber_id = v_caller
          and pt.event_type::text in
            ('charge.success', 'charge.failed', 'invoice.payment_succeeded',
             'invoice.payment_failed', 'checkout.session.completed')

        union all

        -- Laboratory bookings.
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
          pt.provider::text
        from public.payment_transactions pt
        join public.lab_orders lo on lo.id = pt.booking_order_id
        left join public.panel_bundles pb on pb.id = lo.panel_bundle_id
        where pt.booking_order_type = 'lab' and lo.patient_id = v_caller

        union all

        -- Pharmacy bookings.
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
          pt.provider::text
        from public.payment_transactions pt
        join public.pharmacy_orders po on po.id = pt.booking_order_id
        where pt.booking_order_type = 'pharmacy' and po.patient_id = v_caller

        union all

        -- Specialist referrals.
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
          pt.provider::text
        from public.payment_transactions pt
        join public.specialist_referrals sr on sr.id = pt.booking_order_id
        where pt.booking_order_type = 'referral' and sr.patient_id = v_caller

        union all

        -- Video consultations — never reach payment_transactions'
        -- booking_order_* columns (commission_type has no 'consultation'
        -- member), so this table is its own receipt source.
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
          vvr.payment_provider
        from public.video_visit_requests vvr
        where vvr.patient_id = v_caller and vvr.amount_minor > 0

        union all

        -- Care voucher instalments the patient paid for themselves (a
        -- voucher bought as a gift is the purchaser's receipt, not the
        -- beneficiary's).
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
          cvp.provider::text
        from public.care_voucher_payments cvp
        join public.care_vouchers cv on cv.id = cvp.voucher_id
        where cvp.payer_profile_id = v_caller
      ) r
    ),
    '[]'::jsonb
  );
end;
$$;

-- Revoke the default PUBLIC execute before granting to authenticated —
-- otherwise anon inherits execute through the PUBLIC pseudo-role (the
-- gotcha this codebase has hit repeatedly; see the migration-replay CI
-- job note in 20260812041044_service_role_write_actor_attribution.sql).
-- The function itself rejects a null auth.uid() with an exception, but
-- the grant should not admit an unauthenticated caller in the first place.
revoke all on function public.patient_receipts() from public;
revoke all on function public.patient_receipts() from anon;
grant execute on function public.patient_receipts() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'patient_receipts' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'FAIL: patient_receipts was not created';
  end if;

  if not has_function_privilege('authenticated', 'public.patient_receipts()', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute patient_receipts';
  end if;

  if has_function_privilege('anon', 'public.patient_receipts()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute patient_receipts';
  end if;

  raise notice 'PASS: patient_receipts created, executable by authenticated, denied to anon';
end $$;
