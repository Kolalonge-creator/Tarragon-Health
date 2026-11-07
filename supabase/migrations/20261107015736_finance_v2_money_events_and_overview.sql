-- ===========================================================================
-- Finance dashboard v2, Phase A: one money-events layer and the overview RPC.
-- Design: docs/design/FINANCE-DASHBOARD-V2.md (founder decisions FIN-V2-1..3).
--
-- WHY. Money reaches Tarragon through several unrelated tables:
--   * public.orders                  the v5 checkout (Membership today); the
--                                    Paystack webhook handles these BEFORE it
--                                    writes payment_transactions, so they never
--                                    appear there;
--   * public.payment_transactions    the legacy webhook log (doctor services,
--                                    lab/pharmacy bookings, screening days,
--                                    Care Vouchers, retired subscriptions);
--   * public.employer_invoices       employer seats, paid by invoice;
-- and refunds live in five more (refunds, lab_order_refunds,
-- pharmacy_order_refunds, service_purchase_refund_queue, voucher_refund_queue).
-- No finance page summed them together, so "how much did we collect" had no
-- single answer. private.finance_money_events gives every finance read the
-- same basis.
--
-- DEFINITIONS (mirrored in apps/web/src/lib/finance/definitions.ts, which is
-- what the glossary page shows):
--   payment          money a payer was charged and the provider confirmed:
--                    a paid order (including one later refunded: it was paid
--                    once, the refund is its own event), a Paystack
--                    charge.success, or an employer invoice marked paid.
--                    A charge.success whose processing failed on our side
--                    (payment_transactions.error) is still a payment: the
--                    money was taken. It carries processing_error = true so
--                    the reconciliation views can surface it.
--   failed_payment   an order that ended in state 'failed'. Never revenue,
--                    never a receivable.
--   refund           money returned that the provider (or an authorised
--                    reconciliation) confirmed: refunds.completed,
--                    lab/pharmacy refunds 'paid', queue rows 'refunded'.
--                    A requested or approved refund is not an event yet.
--   payer_type       individual | family_sponsor | employer. A sponsor is
--                    anyone who paid for a different person (order buyer is
--                    not the beneficiary; Care Voucher purchaser is not the
--                    beneficiary). Sponsorship grants no clinical access.
-- Wallet / voucher / employer provider rows in payment_transactions are
-- internal settlements, not cash in, and are excluded. Test data is excluded
-- (is_test rows and test profiles), without depending on any analytics_clean view.
--
-- SECURITY. The view is in `private`, owned by postgres, and every role but
-- the owner is revoked. Only SECURITY DEFINER finance RPCs that check
-- private.is_finance() read it. It returns no clinical data: amounts,
-- references, stream labels and profile ids only.
--
-- Nothing here writes to a payment, order, membership or ledger row.
-- ===========================================================================

create or replace view private.finance_money_events as
  -- 1. v5 orders that were paid (a later refund is a separate event below)
  select
    'order:' || o.id::text                                   as event_id,
    o.paid_at                                                as occurred_at,
    'payment'::text                                          as event_kind,
    case when ci.kind = 'membership' then 'membership' else coalesce(ci.kind, 'other') end as stream,
    case when o.beneficiary_patient_id is not null
              and o.buyer_profile_id is distinct from o.beneficiary_patient_id
         then 'family_sponsor' else 'individual' end         as payer_type,
    'paystack'::text                                         as provider,
    o.total_kobo                                             as amount_minor,
    o.fee_kobo                                               as fee_minor,
    'NGN'::text                                              as currency,
    o.paystack_reference                                     as reference,
    'order'::text                                            as record_type,
    o.id                                                     as record_id,
    o.buyer_profile_id                                       as payer_profile_id,
    o.beneficiary_patient_id                                 as beneficiary_profile_id,
    o.organisation_id,
    (o.renews_membership_id is not null)                     as is_renewal,
    false                                                    as processing_error
  from public.orders o
  left join public.catalog_items ci on ci.id = o.catalog_item_id
  where o.paid_at is not null
    and coalesce(o.total_kobo, 0) > 0
    and not o.is_test
    and not exists (select 1 from public.profiles p
                     where p.id in (o.buyer_profile_id, o.beneficiary_patient_id) and p.is_test)

  union all

  -- 2. v5 orders that failed (no money moved)
  select
    'order_failed:' || o.id::text, o.updated_at, 'failed_payment',
    case when ci.kind = 'membership' then 'membership' else coalesce(ci.kind, 'other') end,
    case when o.beneficiary_patient_id is not null
              and o.buyer_profile_id is distinct from o.beneficiary_patient_id
         then 'family_sponsor' else 'individual' end,
    'paystack', coalesce(o.total_kobo, o.amount_kobo), null::bigint, 'NGN',
    o.paystack_reference, 'order', o.id, o.buyer_profile_id, o.beneficiary_patient_id,
    o.organisation_id, (o.renews_membership_id is not null), false
  from public.orders o
  left join public.catalog_items ci on ci.id = o.catalog_item_id
  where o.state = 'failed'
    and not o.is_test
    and not exists (select 1 from public.profiles p
                     where p.id in (o.buyer_profile_id, o.beneficiary_patient_id) and p.is_test)

  union all

  -- 3. legacy Paystack charges
  select
    'ptx:' || pt.id::text, pt.created_at, 'payment',
    case
      when sdp.id is not null then 'screening_day'
      when cvp.id is not null then 'care_voucher'
      when pt.subscription_id is not null or pt.subscription_add_on_id is not null then 'legacy_subscription'
      when coalesce(pt.raw_payload #>> '{data,metadata,kind}', pt.raw_payload #>> '{metadata,kind}') = 'service_purchase'
        then 'doctor_services'
      when pt.booking_order_type is not null then pt.booking_order_type::text
      else 'other'
    end,
    case when cvp.id is not null and cv.beneficiary_profile_id is not null
              and cv.purchaser_profile_id is distinct from cv.beneficiary_profile_id
         then 'family_sponsor' else 'individual' end,
    pt.provider::text, pt.amount_minor, null::bigint, pt.currency::text,
    coalesce(pt.raw_payload #>> '{data,reference}', pt.provider_event_id),
    'payment_transaction', pt.id, private.resolve_payment_payer(pt),
    cv.beneficiary_profile_id, pt.organisation_id, false, (pt.error is not null)
  -- Reads the base table, not analytics_clean.payment_transactions: a view that depended on an
  -- analytics_clean view would block private.drop_analytics_clean_views() / rebuild (the OQ-39 recipe
  -- every column change on payment_transactions relies on). Test data is excluded below instead.
  from public.payment_transactions pt
  left join lateral (select s.id from public.screening_day_payments s
                      where s.payment_transaction_id = pt.id limit 1) sdp on true
  left join lateral (select c.id, c.voucher_id from public.care_voucher_payments c
                      where c.payment_transaction_id = pt.id limit 1) cvp on true
  left join public.care_vouchers cv on cv.id = cvp.voucher_id
  where not pt.is_test
    and pt.event_type = 'charge.success'
    and pt.provider in ('paystack', 'stripe')
    and coalesce(pt.amount_minor, 0) > 0
    -- Every charge is matched to its payer (and a voucher to its beneficiary): a test account's
    -- charge never counts, whatever kind of purchase it was.
    and not exists (select 1 from public.profiles tp
                     where tp.id in (private.resolve_payment_payer(pt), cv.beneficiary_profile_id) and tp.is_test)

  union all

  -- 4. employer invoices marked paid
  select
    'employer_invoice:' || i.id::text, i.paid_at, 'payment', 'employer_membership', 'employer',
    'invoice', i.amount_kobo, null::bigint, 'NGN', i.id::text, 'employer_invoice', i.id,
    null::uuid, null::uuid, i.organisation_id, false, false
  from public.employer_invoices i
  where i.status = 'paid' and i.paid_at is not null and i.amount_kobo > 0

  union all

  -- 5. refunds of v5 orders, completed (provider-confirmed)
  select
    'refund:' || r.id::text, r.completed_at, 'refund',
    case when ci.kind = 'membership' then 'membership' else coalesce(ci.kind, 'other') end,
    case when o.beneficiary_patient_id is not null
              and o.buyer_profile_id is distinct from o.beneficiary_patient_id
         then 'family_sponsor' else 'individual' end,
    r.provider, r.amount_kobo, null::bigint, 'NGN',
    coalesce(r.provider_reference, o.paystack_reference), 'refund', r.id,
    o.buyer_profile_id, o.beneficiary_patient_id, r.organisation_id,
    (o.renews_membership_id is not null), false
  from public.refunds r
  join public.orders o on o.id = r.order_id
  left join public.catalog_items ci on ci.id = o.catalog_item_id
  where r.state = 'completed' and r.completed_at is not null
    and not r.is_test and not o.is_test
    and not exists (select 1 from public.profiles p
                     where p.id in (o.buyer_profile_id, o.beneficiary_patient_id) and p.is_test)

  union all

  -- 6. lab order refunds, paid out
  select
    'lab_refund:' || lr.id::text, lr.paid_at, 'refund', 'lab', 'individual', 'paystack',
    lr.refund_total_kobo, null::bigint, 'NGN', lr.id::text, 'lab_order_refund', lr.id,
    lo.patient_id, lo.patient_id, lr.organisation_id, false, false
  from public.lab_order_refunds lr
  join public.lab_orders lo on lo.id = lr.lab_order_id
  where lr.status = 'paid' and lr.paid_at is not null and lr.refund_total_kobo > 0
    and not exists (select 1 from public.profiles p where p.id = lo.patient_id and p.is_test)

  union all

  -- 7. pharmacy order refunds, paid out
  select
    'pharmacy_refund:' || pr.id::text, pr.paid_at, 'refund', 'pharmacy', 'individual', 'paystack',
    pr.refund_total_kobo, null::bigint, 'NGN', pr.id::text, 'pharmacy_order_refund', pr.id,
    po.patient_id, po.patient_id, pr.organisation_id, false, false
  from public.pharmacy_order_refunds pr
  join public.pharmacy_orders po on po.id = pr.pharmacy_order_id
  where pr.status = 'paid' and pr.paid_at is not null and pr.refund_total_kobo > 0
    and not exists (select 1 from public.profiles p where p.id = po.patient_id and p.is_test)

  union all

  -- 8. doctor-service guarantee refunds, refunded by the provider
  select
    'service_refund:' || q.id::text, q.updated_at, 'refund', 'doctor_services', 'individual',
    q.provider, q.amount_minor, null::bigint, q.currency::text,
    coalesce(q.provider_refund_ref, q.provider_reference), 'service_purchase_refund', q.id,
    sp.patient_id, sp.patient_id, sp.organisation_id, false, false
  from public.service_purchase_refund_queue q
  join public.service_purchases sp on sp.id = q.service_purchase_id
  where q.status = 'refunded' and q.amount_minor > 0
    and not exists (select 1 from public.profiles p where p.id = sp.patient_id and p.is_test)

  union all

  -- 9. Care Voucher cancellation refunds, refunded by the provider
  select
    'voucher_refund:' || q.id::text, q.updated_at, 'refund', 'care_voucher',
    case when cv.beneficiary_profile_id is not null
              and cv.purchaser_profile_id is distinct from cv.beneficiary_profile_id
         then 'family_sponsor' else 'individual' end,
    q.provider::text, q.amount_minor, null::bigint, q.currency::text,
    coalesce(q.provider_refund_ref, q.provider_reference), 'voucher_refund', q.id,
    cvp.payer_profile_id, cv.beneficiary_profile_id, cv.organisation_id, false, false
  from public.voucher_refund_queue q
  join public.care_voucher_payments cvp on cvp.id = q.care_voucher_payment_id
  join public.care_vouchers cv on cv.id = q.voucher_id
  where q.status = 'refunded' and q.amount_minor > 0
    and not exists (select 1 from public.profiles p
                     where p.id in (cvp.payer_profile_id, cv.beneficiary_profile_id) and p.is_test);

revoke all on private.finance_money_events from public, anon, authenticated;

comment on view private.finance_money_events is
  'Finance v2: one row per payment, failed payment or confirmed refund across orders, legacy Paystack charges, employer invoices and the five refund tables. Test data excluded. Read only by SECURITY DEFINER finance RPCs. See 20261107015736.';

-- ---------------------------------------------------------------------------
-- Totals for one window. Private helper; callers check is_finance().
-- ---------------------------------------------------------------------------
create or replace function private.finance_money_totals(p_from date, p_to date, p_currency text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  with ev as (
    select * from private.finance_money_events e
     where e.currency = p_currency
       and (e.occurred_at at time zone 'Africa/Lagos')::date between p_from and p_to
  ),
  agg as (
    select
      coalesce(sum(amount_minor) filter (where event_kind = 'payment'), 0)::bigint        as gpv,
      count(*) filter (where event_kind = 'payment')::bigint                              as payments,
      coalesce(sum(amount_minor) filter (where event_kind = 'refund'), 0)::bigint         as refunds,
      count(*) filter (where event_kind = 'refund')::bigint                               as refund_count,
      count(*) filter (where event_kind = 'failed_payment')::bigint                       as failed,
      coalesce(sum(fee_minor) filter (where event_kind = 'payment'), 0)::bigint           as fees,
      count(*) filter (where event_kind = 'payment' and processing_error)::bigint         as processing_errors
    from ev
  ),
  rev as (
    -- Net recognised revenue, the income statement's basis: revenue credits
    -- less debits, less contra-revenue (which carries a debit balance).
    select coalesce(sum(l.credit_minor - l.debit_minor), 0)::bigint as recognised
      from analytics_clean.finance_journal_lines l
      join analytics_clean.finance_journal_entries e on e.id = l.entry_id
      join public.finance_accounts a on a.code = l.account_code
     where a.account_type in ('revenue', 'contra_revenue')
       and l.currency::text = p_currency
       and e.entry_date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'gross_payment_volume_minor', agg.gpv,
    'successful_payments', agg.payments,
    'refunds_minor', agg.refunds,
    'refund_count', agg.refund_count,
    'net_collections_minor', agg.gpv - agg.refunds,
    'failed_payments', agg.failed,
    -- Attempts that reached an outcome. Null (not 0%) when there were none.
    'success_rate', case when agg.payments + agg.failed = 0 then null
                         else round(agg.payments::numeric / (agg.payments + agg.failed), 4) end,
    'customer_fees_minor', agg.fees,
    'processing_errors', agg.processing_errors,
    'recognised_revenue_minor', rev.recognised
  )
  from agg, rev;
$$;

revoke all on function private.finance_money_totals(date, date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Paid Memberships in force on a given day (bought by the member or a sponsor, or by an employer).
-- ---------------------------------------------------------------------------
create or replace function private.finance_active_paid_memberships(p_on date)
returns bigint
language sql
stable
security definer
set search_path to ''
as $$
  select count(*)::bigint
    from public.patient_memberships m
   -- 'voucher' is left out: a Care Voucher can be a reward with no cash behind it. A voucher that was bought
   -- is counted in gross payment volume when it is paid for.
   where m.source in ('purchase', 'employer')
     and not m.is_test
     and m.state in ('active', 'lapsed', 'ended', 'scheduled')
     and (m.starts_at at time zone 'Africa/Lagos')::date <= p_on
     and (m.ends_at is null or (m.ends_at at time zone 'Africa/Lagos')::date > p_on)
     and (m.ended_at is null or (m.ended_at at time zone 'Africa/Lagos')::date > p_on)
     and not exists (select 1 from public.profiles p where p.id = m.patient_id and p.is_test);
$$;

revoke all on function private.finance_active_paid_memberships(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.finance_money_overview: everything the v2 homepage draws.
-- ---------------------------------------------------------------------------
create or replace function public.finance_money_overview(
  p_from date,
  p_to date,
  p_compare_from date default null,
  p_compare_to date default null,
  p_currency text default 'NGN',
  p_granularity text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_cur text := upper(coalesce(p_currency, 'NGN'));
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_bucket text;
  v_result jsonb;
begin
  if not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'finance_money_overview: p_from must be on or before p_to' using errcode = '22023';
  end if;
  if p_to - p_from > 3700 then
    raise exception 'finance_money_overview: range is limited to ten years' using errcode = '22023';
  end if;
  if (p_compare_from is null) <> (p_compare_to is null)
     or (p_compare_from is not null and p_compare_from > p_compare_to) then
    raise exception 'finance_money_overview: comparison period is incomplete' using errcode = '22023';
  end if;
  v_bucket := case p_granularity when 'day' then 'day' when 'week' then 'week' when 'month' then 'month' end;
  if v_bucket is null then
    raise exception 'finance_money_overview: granularity must be day, week or month' using errcode = '22023';
  end if;

  with ev as (
    select e.*, (e.occurred_at at time zone 'Africa/Lagos')::date as d
      from private.finance_money_events e
     where e.currency = v_cur
       and (e.occurred_at at time zone 'Africa/Lagos')::date between p_from and p_to
  ),
  prev as (
    select e.*
      from private.finance_money_events e
     where p_compare_from is not null
       and e.currency = v_cur
       and (e.occurred_at at time zone 'Africa/Lagos')::date between p_compare_from and p_compare_to
  ),
  buckets as (
    select date_trunc(v_bucket, g)::date as b
      from generate_series(date_trunc(v_bucket, p_from::timestamp), p_to::timestamp, ('1 ' || v_bucket)::interval) g
  ),
  rev_daily as (
    select date_trunc(v_bucket, e.entry_date::timestamp)::date as b,
           sum(l.credit_minor - l.debit_minor)::bigint as recognised
      from analytics_clean.finance_journal_lines l
      join analytics_clean.finance_journal_entries e on e.id = l.entry_id
      join public.finance_accounts a on a.code = l.account_code
     where a.account_type in ('revenue', 'contra_revenue')
       and l.currency::text = v_cur
       and e.entry_date between p_from and p_to
     group by 1
  ),
  series as (
    select b.b,
           coalesce(sum(ev.amount_minor) filter (where ev.event_kind = 'payment'), 0)::bigint as gross,
           coalesce(sum(ev.amount_minor) filter (where ev.event_kind = 'refund'), 0)::bigint as refunds,
           count(ev.*) filter (where ev.event_kind = 'payment')::bigint as payments,
           count(ev.*) filter (where ev.event_kind = 'failed_payment')::bigint as failed
      from buckets b
      left join ev on date_trunc(v_bucket, ev.d::timestamp)::date = b.b
     group by b.b
  ),
  comp as (
    select payer_type,
           coalesce(sum(amount_minor) filter (where event_kind = 'payment'), 0)::bigint as amount,
           count(*) filter (where event_kind = 'payment')::bigint as cnt
      from ev group by payer_type
  ),
  comp_prev as (
    select payer_type,
           coalesce(sum(amount_minor) filter (where event_kind = 'payment'), 0)::bigint as amount
      from prev group by payer_type
  ),
  streams as (
    select stream,
           coalesce(sum(amount_minor) filter (where event_kind = 'payment'), 0)::bigint as amount,
           count(*) filter (where event_kind = 'payment')::bigint as cnt,
           coalesce(sum(amount_minor) filter (where event_kind = 'refund'), 0)::bigint as refunds
      from ev group by stream
  ),
  providers as (
    select provider,
           count(*) filter (where event_kind = 'payment')::bigint as successful,
           coalesce(sum(amount_minor) filter (where event_kind = 'payment'), 0)::bigint as successful_minor,
           count(*) filter (where event_kind = 'failed_payment')::bigint as failed,
           coalesce(sum(amount_minor) filter (where event_kind = 'refund'), 0)::bigint as refunds_minor,
           count(*) filter (where event_kind = 'payment' and processing_error)::bigint as processing_errors
      from ev group by provider
  ),
  recent as (
    select e.*
      from private.finance_money_events e
     where e.currency = v_cur
     order by e.occurred_at desc nulls last
     limit 15
  )
  select jsonb_build_object(
    'currency', v_cur,
    'granularity', v_bucket,
    'generated_at', now(),
    'current', private.finance_money_totals(p_from, p_to, v_cur),
    'previous', case when p_compare_from is null then null
                     else private.finance_money_totals(p_compare_from, p_compare_to, v_cur) end,
    'active_paid_memberships', private.finance_active_paid_memberships(least(p_to, v_today)),
    'active_paid_memberships_previous', case when p_compare_to is null then null
                     else private.finance_active_paid_memberships(least(p_compare_to, v_today)) end,
    'open_reconciliation_items', (select count(*) from public.payment_reconciliation_flags f where f.status = 'open'),
    'series', (select coalesce(jsonb_agg(jsonb_build_object(
                 'bucket', s.b,
                 'gross_minor', s.gross,
                 'refunds_minor', s.refunds,
                 'net_minor', s.gross - s.refunds,
                 'recognised_minor', coalesce(r.recognised, 0),
                 'successful_payments', s.payments,
                 'failed_payments', s.failed) order by s.b), '[]'::jsonb)
               from series s left join rev_daily r on r.b = s.b),
    'composition', (select coalesce(jsonb_agg(jsonb_build_object(
                 'payer_type', t.payer_type,
                 'amount_minor', coalesce(c.amount, 0),
                 'count', coalesce(c.cnt, 0),
                 'previous_amount_minor', case when p_compare_from is null then null else coalesce(cp.amount, 0) end)
                 order by t.ord), '[]'::jsonb)
               from (values ('individual', 1), ('family_sponsor', 2), ('employer', 3)) t(payer_type, ord)
               left join comp c on c.payer_type = t.payer_type
               left join comp_prev cp on cp.payer_type = t.payer_type),
    'streams', (select coalesce(jsonb_agg(jsonb_build_object(
                 'stream', s.stream, 'amount_minor', s.amount, 'count', s.cnt, 'refunds_minor', s.refunds)
                 order by s.amount desc, s.stream), '[]'::jsonb) from streams s),
    'providers', (select coalesce(jsonb_agg(jsonb_build_object(
                 'provider', p.provider,
                 'successful', p.successful,
                 'successful_minor', p.successful_minor,
                 'failed', p.failed,
                 'refunds_minor', p.refunds_minor,
                 'processing_errors', p.processing_errors,
                 'success_rate', case when p.successful + p.failed = 0 then null
                                      else round(p.successful::numeric / (p.successful + p.failed), 4) end)
                 order by p.successful_minor desc), '[]'::jsonb) from providers p),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object(
                 'event_id', r.event_id,
                 'occurred_at', r.occurred_at,
                 'event_kind', r.event_kind,
                 'stream', r.stream,
                 'payer_type', r.payer_type,
                 'provider', r.provider,
                 'amount_minor', r.amount_minor,
                 'currency', r.currency,
                 'reference', r.reference,
                 'record_type', r.record_type,
                 'record_id', r.record_id,
                 'is_renewal', r.is_renewal,
                 'processing_error', r.processing_error,
                 'payer_label', case when r.payer_type = 'employer'
                                     then coalesce((select o.name from public.organisations o where o.id = r.organisation_id), 'Employer')
                                     else coalesce(nullif(trim(pp.full_name), ''), 'Member') end)
                 order by r.occurred_at desc nulls last), '[]'::jsonb)
               from recent r left join public.profiles pp on pp.id = r.payer_profile_id)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.finance_money_overview(date, date, date, date, text, text) from public, anon;
grant execute on function public.finance_money_overview(date, date, date, date, text, text) to authenticated;

comment on function public.finance_money_overview(date, date, date, date, text, text) is
  'Finance v2 homepage: gross payment volume, refunds, net collections, recognised revenue (GL), paid Memberships, payer-type composition, streams, providers and recent events for a Lagos-date window, with an optional comparison window. Raises 42501 for non-finance callers.';

-- ---------------------------------------------------------------------------
-- public.finance_open_item_counts: the sidebar badges. Exact counts (never a
-- capped list's length), so a badge cannot under-report.
-- ---------------------------------------------------------------------------
create or replace function public.finance_open_item_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'reconciliation', (select count(*) from public.payment_reconciliation_flags f where f.status = 'open'),
    'fraud', (select count(*) from public.payment_fraud_signals s where s.status = 'open'),
    'approvals', (select count(*) from public.finance_approval_requests r where r.status = 'pending')
  );
end;
$$;

revoke all on function public.finance_open_item_counts() from public, anon;
grant execute on function public.finance_open_item_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- Self-check: nothing but the owner can read the view or the helpers, and
-- anon cannot execute the RPC.
-- ---------------------------------------------------------------------------
do $$
begin
  -- OQ-39: nothing may depend on an analytics_clean view, or its drop/rebuild recipe breaks.
  if exists (select 1 from pg_depend d join pg_rewrite rw on rw.oid = d.objid
              join pg_class c on c.oid = d.refobjid
             where rw.ev_class = 'private.finance_money_events'::regclass
               and c.relnamespace = 'analytics_clean'::regnamespace) then
    raise exception 'private.finance_money_events must not depend on an analytics_clean view';
  end if;
  if has_table_privilege('authenticated', 'private.finance_money_events', 'SELECT')
     or has_table_privilege('anon', 'private.finance_money_events', 'SELECT') then
    raise exception 'finance_money_events must not be readable by anon or authenticated';
  end if;
  if has_function_privilege('anon', 'public.finance_money_overview(date, date, date, date, text, text)', 'EXECUTE') then
    raise exception 'anon must not execute finance_money_overview';
  end if;
  if has_function_privilege('anon', 'public.finance_open_item_counts()', 'EXECUTE') then
    raise exception 'anon must not execute finance_open_item_counts';
  end if;
  if has_function_privilege('authenticated', 'private.finance_money_totals(date, date, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.finance_active_paid_memberships(date)', 'EXECUTE') then
    raise exception 'finance private helpers must not be executable by authenticated';
  end if;
end $$;
