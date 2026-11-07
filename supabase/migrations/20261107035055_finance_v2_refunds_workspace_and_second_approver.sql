-- ===========================================================================
-- Finance dashboard v2, Phase C1: the shared refunds workspace, a second approver
-- for large refunds, and two follow-ups from Phases A and B.
-- Design and founder decisions FIN-V2-2/3: docs/design/FINANCE-DASHBOARD-V2.md.
--
-- 1. Stable event dates (Phase A follow-up). orders.failed_at, and refunded_at on the
--    doctor-service and Care Voucher refund queues, are stamped once by trigger and
--    backfilled from updated_at. The money-events view uses them, so a later edit to
--    the row can no longer move the event into another period.
-- 2. Refunds linked to their payment (Phase B follow-up). The money-events view gains
--    refund_of_reference (the charge reference a refund pays back) for every refund
--    table, so the directory's "refunded" amount and the detail page cover lab,
--    pharmacy, doctor-service and Care Voucher refunds, not only checkout orders.
-- 3. Who may decide a refund (FIN-V2-2). An admin, the finance role, or anyone granted
--    the new finance.refunds.approve permission, in each case only with the platform's
--    two-step sign-in requirement met (private.mfa_requirement_met, the same rule
--    private.is_admin applies). Nobody decides a refund they requested.
-- 4. Second approver (FIN-V2-3). public.finance_refund_settings holds, per currency, the
--    amount at or above which a refund needs two different people to approve it. With no
--    row, one approval is enough, exactly as today: the founder is currently the only
--    approver and a missing setting must never strand a patient's refund. The first
--    approval is recorded on the refund (first_approved_by/at/note) and the refund stays
--    'pending'; only the second, by a different person, approves it and starts the
--    payout. A CHECK makes the same person approving twice impossible at the table.
--    Every first approval, approval and rejection is written to audit_log.
-- 5. public.finance_refund_queue: one read for the shared page (pending, awaiting a second
--    approval, in flight, failed, and the last 30 days of finished refunds), names and
--    amounts only, with whether the caller may decide.
--
-- decide_order_refund is redefined from its LIVE body (read with pg_get_functiondef on
-- 2026-11-07), changing only who may call it and adding the second-approval branch and
-- audit rows; what an approval does (end the Membership, revoke the entitlement, mark
-- the order refunded) is unchanged.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Stable dates
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists failed_at timestamptz;
alter table public.service_purchase_refund_queue add column if not exists refunded_at timestamptz;
alter table public.voucher_refund_queue add column if not exists refunded_at timestamptz;

create or replace function private.stamp_order_failed_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.state = 'failed' and new.failed_at is null and (tg_op = 'INSERT' or old.state is distinct from 'failed') then
    new.failed_at := now();
  end if;
  return new;
end $$;

create or replace function private.stamp_refund_queue_refunded_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.status = 'refunded' and new.refunded_at is null and (tg_op = 'INSERT' or old.status is distinct from 'refunded') then
    new.refunded_at := now();
  end if;
  return new;
end $$;

drop trigger if exists orders_stamp_failed_at on public.orders;
create trigger orders_stamp_failed_at before insert or update of state on public.orders
  for each row execute function private.stamp_order_failed_at();
drop trigger if exists service_refund_queue_stamp_refunded_at on public.service_purchase_refund_queue;
create trigger service_refund_queue_stamp_refunded_at before insert or update of status on public.service_purchase_refund_queue
  for each row execute function private.stamp_refund_queue_refunded_at();
drop trigger if exists voucher_refund_queue_stamp_refunded_at on public.voucher_refund_queue;
create trigger voucher_refund_queue_stamp_refunded_at before insert or update of status on public.voucher_refund_queue
  for each row execute function private.stamp_refund_queue_refunded_at();

revoke all on function private.stamp_order_failed_at() from public, anon, authenticated;
revoke all on function private.stamp_refund_queue_refunded_at() from public, anon, authenticated;

-- Backfill: the best evidence there is for rows that already failed or were refunded.
-- orders_state_machine refuses changes to an order's commercial fields, not this column.
update public.orders set failed_at = updated_at where state = 'failed' and failed_at is null;
update public.service_purchase_refund_queue set refunded_at = updated_at where status = 'refunded' and refunded_at is null;
update public.voucher_refund_queue set refunded_at = updated_at where status = 'refunded' and refunded_at is null;

-- ---------------------------------------------------------------------------
-- 2. The money-events view, with stable dates and refund_of_reference (added last).
-- ---------------------------------------------------------------------------
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
    false                                                    as processing_error,
    null::text                                               as refund_of_reference
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
    'order_failed:' || o.id::text, coalesce(o.failed_at, o.updated_at), 'failed_payment',
    case when ci.kind = 'membership' then 'membership' else coalesce(ci.kind, 'other') end,
    case when o.beneficiary_patient_id is not null
              and o.buyer_profile_id is distinct from o.beneficiary_patient_id
         then 'family_sponsor' else 'individual' end,
    'paystack', coalesce(o.total_kobo, o.amount_kobo), null::bigint, 'NGN',
    o.paystack_reference, 'order', o.id, o.buyer_profile_id, o.beneficiary_patient_id,
    o.organisation_id, (o.renews_membership_id is not null), false, null::text
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
    cv.beneficiary_profile_id, pt.organisation_id, false, (pt.error is not null), null::text
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
    null::uuid, null::uuid, i.organisation_id, false, false, null::text
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
    (o.renews_membership_id is not null), false, o.paystack_reference
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
    lo.patient_id, lo.patient_id, lr.organisation_id, false, false,
    (select coalesce(pt.raw_payload #>> '{data,reference}', pt.provider_event_id) from public.payment_transactions pt
      where pt.booking_order_type = 'lab' and pt.booking_order_id = lr.lab_order_id and pt.event_type = 'charge.success'
      order by pt.created_at limit 1)
  from public.lab_order_refunds lr
  join public.lab_orders lo on lo.id = lr.lab_order_id
  where lr.status = 'paid' and lr.paid_at is not null and lr.refund_total_kobo > 0
    and not exists (select 1 from public.profiles p where p.id = lo.patient_id and p.is_test)

  union all

  -- 7. pharmacy order refunds, paid out
  select
    'pharmacy_refund:' || pr.id::text, pr.paid_at, 'refund', 'pharmacy', 'individual', 'paystack',
    pr.refund_total_kobo, null::bigint, 'NGN', pr.id::text, 'pharmacy_order_refund', pr.id,
    po.patient_id, po.patient_id, pr.organisation_id, false, false,
    (select coalesce(pt.raw_payload #>> '{data,reference}', pt.provider_event_id) from public.payment_transactions pt
      where pt.booking_order_type = 'pharmacy' and pt.booking_order_id = pr.pharmacy_order_id and pt.event_type = 'charge.success'
      order by pt.created_at limit 1)
  from public.pharmacy_order_refunds pr
  join public.pharmacy_orders po on po.id = pr.pharmacy_order_id
  where pr.status = 'paid' and pr.paid_at is not null and pr.refund_total_kobo > 0
    and not exists (select 1 from public.profiles p where p.id = po.patient_id and p.is_test)

  union all

  -- 8. doctor-service guarantee refunds, refunded by the provider
  select
    'service_refund:' || q.id::text, coalesce(q.refunded_at, q.updated_at), 'refund', 'doctor_services', 'individual',
    q.provider, q.amount_minor, null::bigint, q.currency::text,
    coalesce(q.provider_refund_ref, q.provider_reference), 'service_purchase_refund', q.id,
    sp.patient_id, sp.patient_id, sp.organisation_id, false, false, q.provider_reference
  from public.service_purchase_refund_queue q
  join public.service_purchases sp on sp.id = q.service_purchase_id
  where q.status = 'refunded' and q.amount_minor > 0
    and not exists (select 1 from public.profiles p where p.id = sp.patient_id and p.is_test)

  union all

  -- 9. Care Voucher cancellation refunds, refunded by the provider
  select
    'voucher_refund:' || q.id::text, coalesce(q.refunded_at, q.updated_at), 'refund', 'care_voucher',
    case when cv.beneficiary_profile_id is not null
              and cv.purchaser_profile_id is distinct from cv.beneficiary_profile_id
         then 'family_sponsor' else 'individual' end,
    q.provider::text, q.amount_minor, null::bigint, q.currency::text,
    coalesce(q.provider_refund_ref, q.provider_reference), 'voucher_refund', q.id,
    cvp.payer_profile_id, cv.beneficiary_profile_id, cv.organisation_id, false, false, q.provider_reference
  from public.voucher_refund_queue q
  join public.care_voucher_payments cvp on cvp.id = q.care_voucher_payment_id
  join public.care_vouchers cv on cv.id = q.voucher_id
  where q.status = 'refunded' and q.amount_minor > 0
    and not exists (select 1 from public.profiles p
                     where p.id in (cvp.payer_profile_id, cv.beneficiary_profile_id) and p.is_test);

revoke all on private.finance_money_events from public, anon, authenticated;


create or replace function public.finance_transactions_list(
  p_from date,
  p_to date,
  p_event_kinds text[] default null,
  p_streams text[] default null,
  p_payer_types text[] default null,
  p_providers text[] default null,
  p_settlement text[] default null,
  p_min_minor bigint default null,
  p_max_minor bigint default null,
  p_search text default null,
  p_sort text default 'occurred_at',
  p_sort_dir text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0,
  p_for_export boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), case when p_for_export then 5000 else 200 end);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_desc boolean := lower(coalesce(p_sort_dir, 'desc')) <> 'asc';
  v_result jsonb;
begin
  if not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3700 then
    raise exception 'finance_transactions_list: choose a date range of up to ten years' using errcode = '22023';
  end if;
  if coalesce(p_sort, 'occurred_at') not in ('occurred_at', 'amount') then
    raise exception 'finance_transactions_list: sort by occurred_at or amount' using errcode = '22023';
  end if;
  if p_for_export then
    if not (exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('finance', 'admin') and is_active)
            or private.has_permission('finance.export')) then
      raise exception 'exporting finance data needs the finance.export permission' using errcode = '42501';
    end if;
  end if;
  if v_search is not null and char_length(v_search) > 100 then
    raise exception 'finance_transactions_list: search is limited to 100 characters' using errcode = '22023';
  end if;
  -- Typed text is matched literally: % and _ are not wildcards.
  v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with ev as (
    -- Settlement status costs three lookups a row, so it is worked out for every row only when it is a filter;
    -- otherwise only for the page shown (below).
    select e.*,
           case when p_settlement is not null
                then private.finance_settlement_status(e.event_kind, e.record_type, e.record_id, e.reference) end as settlement_status
      from private.finance_money_events e
     where (e.occurred_at at time zone 'Africa/Lagos')::date between p_from and p_to
       and (p_event_kinds is null or e.event_kind = any (p_event_kinds))
       and (p_streams is null or e.stream = any (p_streams))
       and (p_payer_types is null or e.payer_type = any (p_payer_types))
       and (p_providers is null or e.provider = any (p_providers))
       and (p_min_minor is null or e.amount_minor >= p_min_minor)
       and (p_max_minor is null or e.amount_minor <= p_max_minor)
  ),
  labelled as (
    select ev.*,
           case when ev.payer_type = 'employer'
                then coalesce((select o.name from public.organisations o where o.id = ev.organisation_id), 'Employer')
                else coalesce(nullif(trim(pp.full_name), ''), 'Member') end as payer_label,
           case when ev.beneficiary_profile_id is null or ev.beneficiary_profile_id = ev.payer_profile_id then null
                else coalesce(nullif(trim(bp.full_name), ''), 'Member') end as beneficiary_label
      from ev
      left join public.profiles pp on pp.id = ev.payer_profile_id
      left join public.profiles bp on bp.id = ev.beneficiary_profile_id
  ),
  filtered as (
    select * from labelled l
     where (p_settlement is null or l.settlement_status = any (p_settlement))
       and (v_search is null
            or l.reference ilike v_pattern escape '\'
            or l.payer_label ilike v_pattern escape '\'
            or coalesce(l.beneficiary_label, '') ilike v_pattern escape '\'
            or l.record_id::text = lower(v_search))
  ),
  ordered as (
    select * from filtered f
     order by
       case when p_sort = 'amount' and not v_desc then f.amount_minor end asc nulls last,
       case when p_sort = 'amount' and v_desc then f.amount_minor end desc nulls last,
       case when coalesce(p_sort, 'occurred_at') = 'occurred_at' and not v_desc then f.occurred_at end asc nulls last,
       f.occurred_at desc nulls last,
       f.event_id
     limit v_limit offset v_offset
  ),
  page as (
    select o.*,
           coalesce(o.settlement_status,
                    private.finance_settlement_status(o.event_kind, o.record_type, o.record_id, o.reference)) as settlement_now,
           -- Any confirmed refund that names this payment's charge reference, whichever refund table it came from.
           case when o.event_kind = 'payment' and o.reference is not null
                then (select coalesce(sum(x.amount_minor), 0) from private.finance_money_events x
                       where x.event_kind = 'refund' and x.refund_of_reference = o.reference)
                else 0 end::bigint as refunded_minor
      from ordered o
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'total_payments_minor', (select coalesce(sum(amount_minor), 0) from filtered where event_kind = 'payment'),
    'total_refunds_minor', (select coalesce(sum(amount_minor), 0) from filtered where event_kind = 'refund'),
    'limit', v_limit,
    'offset', v_offset,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
               'event_id', p.event_id,
               'occurred_at', p.occurred_at,
               'event_kind', p.event_kind,
               'stream', p.stream,
               'payer_type', p.payer_type,
               'provider', p.provider,
               'amount_minor', p.amount_minor,
               'fee_minor', p.fee_minor,
               'currency', p.currency,
               'reference', p.reference,
               'record_type', p.record_type,
               'record_id', p.record_id,
               'is_renewal', p.is_renewal,
               'processing_error', p.processing_error,
               'settlement_status', p.settlement_now,
               'refunded_minor', p.refunded_minor,
               'payer_label', p.payer_label,
               'beneficiary_label', p.beneficiary_label)
             order by
               case when p_sort = 'amount' and not v_desc then p.amount_minor end asc nulls last,
               case when p_sort = 'amount' and v_desc then p.amount_minor end desc nulls last,
               case when coalesce(p_sort, 'occurred_at') = 'occurred_at' and not v_desc then p.occurred_at end asc nulls last,
               p.occurred_at desc nulls last,
               p.event_id), '[]'::jsonb) from page p)
  ) into v_result;

  -- Every read of named rows is audited, not only exports: otherwise a view-only member could page through
  -- browse mode and rebuild an export with no trace. Browse reads are 'listed', exports 'exported'.
  if jsonb_array_length(v_result -> 'rows') > 0 or p_for_export then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, event)
    values (private.caller_org(), (select auth.uid()),
            case when p_for_export then 'finance.transactions.exported' else 'finance.transactions.listed' end,
            'finance_transactions',
            jsonb_build_object('from', p_from, 'to', p_to, 'rows', jsonb_array_length(v_result -> 'rows'),
                               'offset', v_offset, 'search', v_search is not null,
                               'filters', jsonb_strip_nulls(jsonb_build_object(
                                 'event_kinds', p_event_kinds, 'streams', p_streams, 'payer_types', p_payer_types,
                                 'providers', p_providers, 'settlement', p_settlement,
                                 'min_minor', p_min_minor, 'max_minor', p_max_minor))));
  end if;

  return v_result;
end;
$$;

create or replace function public.finance_transaction_detail(p_record_type text, p_record_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  e record;
  v_order_id uuid;
  v_ptx_id uuid;
  v_refs text[];
  v_result jsonb;
begin
  if not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_record_type not in ('order', 'payment_transaction', 'employer_invoice', 'refund',
                           'lab_order_refund', 'pharmacy_order_refund', 'service_purchase_refund', 'voucher_refund') then
    raise exception 'finance_transaction_detail: unknown record type' using errcode = '22023';
  end if;

  -- The event itself (a paid order and a failed order are different event ids; prefer the payment).
  select * into e
    from private.finance_money_events m
   where m.record_type = p_record_type and m.record_id = p_record_id
   order by case m.event_kind when 'payment' then 0 when 'refund' then 1 else 2 end
   limit 1;
  if not found then
    return null;
  end if;

  v_order_id := case when p_record_type = 'order' then p_record_id
                     when p_record_type = 'refund' then (select r.order_id from public.refunds r where r.id = p_record_id) end;
  v_ptx_id := case when p_record_type = 'payment_transaction' then p_record_id end;
  v_refs := array_remove(array[e.reference,
                               (select o.paystack_reference from public.orders o where o.id = v_order_id)], null);

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (private.caller_org(), (select auth.uid()), 'finance.transaction.viewed', p_record_type, p_record_id,
          jsonb_build_object('event_kind', e.event_kind), e.beneficiary_profile_id);

  with
  refunds_list as (
    select r.id, r.amount_kobo, r.state, r.reason, r.provider_reference, r.created_at, r.decided_at, r.completed_at,
           r.last_error_code, dp.full_name as decided_by_name, rp.full_name as requested_by_name
      from public.refunds r
      left join public.profiles dp on dp.id = r.decided_by
      left join public.profiles rp on rp.id = r.requested_by
     where v_order_id is not null and r.order_id = v_order_id and not r.is_test
  ),
  refund_steps as (
    select s.refund_id, s.step, s.created_at
      from public.refund_status_events s
     where s.refund_id in (select id from refunds_list)
  ),
  webhooks as (
    select pe.event_type, pe.status, pe.received_at, pe.processed_at, pe.attempt_count, pe.last_error, pe.signature_verified
      from public.provider_events pe
     where pe.provider = 'paystack'
       and exists (select 1 from unnest(v_refs) ref
                    where pe.idempotency_key = pe.event_type || ':' || ref
                       or pe.idempotency_key like pe.event_type || ':' || ref || ':%')
    union all
    select pt.event_type::text, case when pt.error is null then 'processed' else 'failed' end, pt.created_at, pt.processed_at,
           null::int, pt.error, null::boolean
      from public.payment_transactions pt
     where pt.provider = 'paystack'
       and (pt.id = v_ptx_id
            or (coalesce(pt.raw_payload #>> '{data,reference}', '') <> ''
                and pt.raw_payload #>> '{data,reference}' = any (v_refs)))
  ),
  settlement as (
    select sl.provider_reference, sl.amount_kobo, sl.fees_kobo, sl.status as line_status, sl.paid_at,
           sr.provider_settlement_id, sr.status as report_status, sr.settled_at
      from public.settlement_lines sl
      join public.settlement_reports sr on sr.id = sl.report_id
     where sl.provider_reference = any (v_refs)
    union all
    select null, m.amount_minor, fs.fees_minor, 'matched', null, fs.external_ref, fs.status, fs.settlement_date::timestamptz
      from public.finance_settlement_matches m
      join public.finance_settlements fs on fs.id = m.settlement_id
     where v_ptx_id is not null and m.payment_transaction_id = v_ptx_id
  ),
  recon as (
    select 'break' as kind, b.break_type as type, b.status, b.provider_amount_kobo as provider_minor,
           b.ledger_amount_kobo as local_minor, b.difference_kobo as difference_minor, b.first_seen_at as seen_at,
           b.closed_at, b.closing_note as note
      from public.reconciliation_breaks b
     where b.provider_reference = any (v_refs)
    union all
    select 'flag', f.flag_type, f.status, f.provider_amount_minor, f.local_amount_minor,
           f.provider_amount_minor - f.local_amount_minor, f.detected_at, f.resolved_at, f.resolved_note
      from public.payment_reconciliation_flags f
     where f.provider_reference = any (v_refs) or (v_ptx_id is not null and f.payment_transaction_id = v_ptx_id)
  ),
  ledger as (
    select je.id, je.entry_date, je.source, je.memo, je.created_at,
           (select coalesce(jsonb_agg(jsonb_build_object('account_code', l.account_code, 'account_name', a.name,
                                                         'debit_minor', l.debit_minor, 'credit_minor', l.credit_minor)
                                      order by l.debit_minor desc, l.account_code), '[]'::jsonb)
              from public.finance_journal_lines l join public.finance_accounts a on a.code = l.account_code
             where l.entry_id = je.id) as lines
      from public.finance_journal_entries je
     where je.source_ref in (p_record_id::text, coalesce(v_order_id::text, '-'), coalesce(v_ptx_id::text, '-'))
        or (je.source = 'refund' and je.source_ref in (select id::text from refunds_list))
  ),
  membership as (
    select m.id, m.tier, m.state, m.source, m.starts_at, m.ends_at, m.auto_renew, m.renewal_cancelled_at
      from public.patient_memberships m
     where v_order_id is not null and m.order_id = v_order_id
  ),
  timeline as (
    select e.occurred_at as at, case e.event_kind when 'payment' then 'Payment confirmed'
                                                  when 'refund' then 'Refund confirmed'
                                                  else 'Payment failed' end as label, 'event' as kind
    union all select w.received_at, 'Paystack event: ' || w.event_type || ' (' || w.status || ')', 'webhook' from webhooks w
    union all select r.created_at, 'Refund requested', 'refund' from refunds_list r
    union all select r.decided_at, 'Refund ' || case when r.state = 'rejected' then 'rejected' else 'approved' end
                     || coalesce(' by ' || r.decided_by_name, ''), 'refund' from refunds_list r where r.decided_at is not null
    union all select s.created_at, 'Refund step: ' || replace(s.step, '_', ' '), 'refund' from refund_steps s
    union all select r.completed_at, 'Refund completed at Paystack', 'refund' from refunds_list r where r.completed_at is not null
    union all select s.settled_at, 'Settled by Paystack' || coalesce(' (' || s.provider_settlement_id || ')', ''), 'settlement'
      from settlement s where s.settled_at is not null
    union all select x.seen_at, 'Reconciliation ' || x.kind || ': ' || replace(x.type, '_', ' '), 'reconciliation' from recon x
    union all select x.closed_at, 'Reconciliation ' || x.kind || ' ' || x.status, 'reconciliation' from recon x where x.closed_at is not null
    union all select l.created_at, 'Posted to the ledger (' || l.source || ')', 'ledger' from ledger l
  )
  select jsonb_build_object(
    'event', jsonb_build_object(
      'event_id', e.event_id, 'occurred_at', e.occurred_at, 'event_kind', e.event_kind, 'stream', e.stream,
      'payer_type', e.payer_type, 'provider', e.provider, 'amount_minor', e.amount_minor, 'fee_minor', e.fee_minor,
      'currency', e.currency, 'reference', e.reference, 'record_type', e.record_type, 'record_id', e.record_id,
      'is_renewal', e.is_renewal, 'processing_error', e.processing_error,
      'settlement_status', private.finance_settlement_status(e.event_kind, e.record_type, e.record_id, e.reference)),
    'payer', case when e.payer_type = 'employer'
                  then jsonb_build_object('label', coalesce((select o.name from public.organisations o where o.id = e.organisation_id), 'Employer'),
                                          'kind', 'employer')
                  else jsonb_build_object('label', coalesce((select nullif(trim(p.full_name), '') from public.profiles p where p.id = e.payer_profile_id), 'Member'),
                                          'kind', e.payer_type) end,
    'beneficiary', case when e.beneficiary_profile_id is null or e.beneficiary_profile_id = e.payer_profile_id then null
                        else jsonb_build_object('label', coalesce((select nullif(trim(p.full_name), '') from public.profiles p where p.id = e.beneficiary_profile_id), 'Member')) end,
    'order', (select jsonb_build_object('state', o.state, 'list_amount_minor', o.list_amount_kobo, 'amount_minor', o.amount_kobo,
                                        'fee_minor', o.fee_kobo, 'total_minor', o.total_kobo, 'discount_minor', o.discount_kobo,
                                        'sponsor_share_minor', o.sponsor_share_kobo, 'paid_at', o.paid_at, 'created_at', o.created_at,
                                        'item', ci.code, 'failure_reason', o.failure_reason)
                from public.orders o left join public.catalog_items ci on ci.id = o.catalog_item_id where o.id = v_order_id),
    'membership', (select jsonb_agg(to_jsonb(m) order by m.starts_at) from membership m),
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount_minor', r.amount_kobo, 'state', r.state, 'reason', r.reason,
                                                             'provider_reference', r.provider_reference, 'requested_at', r.created_at,
                                                             'decided_at', r.decided_at, 'decided_by', r.decided_by_name,
                                                             'completed_at', r.completed_at, 'last_error_code', r.last_error_code)
                                          order by r.created_at), '[]'::jsonb) from refunds_list r),
    -- The refund flow refunds the price, not the card fee (request_order_refund uses orders.amount_kobo), so
    -- the refundable balance is the price less every refund not rejected or failed.
    -- Confirmed refunds of this charge recorded outside the checkout refunds table (lab, pharmacy, doctor-service
    -- guarantee, Care Voucher cancellation), so a legacy payment's detail shows what was paid back.
    'other_refunds', (select coalesce(jsonb_agg(jsonb_build_object('event_id', x.event_id, 'record_type', x.record_type,
                                                                   'record_id', x.record_id, 'amount_minor', x.amount_minor,
                                                                   'occurred_at', x.occurred_at, 'stream', x.stream)
                                                order by x.occurred_at), '[]'::jsonb)
                        from private.finance_money_events x
                       where x.event_kind = 'refund' and x.record_type <> 'refund'
                         and x.refund_of_reference = any (v_refs)),
    'refundable_minor', case when v_order_id is null or e.event_kind <> 'payment' then null
                             else greatest((select o.amount_kobo from public.orders o where o.id = v_order_id)
                                           - (select coalesce(sum(r.amount_kobo), 0) from refunds_list r
                                                              where r.state in ('pending', 'approved', 'processing', 'completed')), 0) end,
    'webhooks', (select coalesce(jsonb_agg(to_jsonb(w) order by w.received_at), '[]'::jsonb) from webhooks w),
    'settlement', (select coalesce(jsonb_agg(to_jsonb(s) order by s.settled_at), '[]'::jsonb) from settlement s),
    'reconciliation', (select coalesce(jsonb_agg(to_jsonb(x) order by x.seen_at), '[]'::jsonb) from recon x),
    'ledger', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at), '[]'::jsonb) from ledger l),
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('at', t.at, 'label', t.label, 'kind', t.kind) order by t.at), '[]'::jsonb)
                   from timeline t where t.at is not null)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Who may decide a refund
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description)
values ('finance.refunds.approve', 'Approve refunds', 'Finance',
        'Approve or reject patient refund requests in the shared refunds workspace. Large refunds also need a second, different approver when finance settings say so.')
on conflict (key) do nothing;

create or replace function private.can_decide_refunds()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.mfa_requirement_met()
     and (exists (select 1 from public.profiles p
                   where p.id = (select auth.uid()) and p.is_active and p.role in ('admin', 'finance'))
          or private.has_permission('finance.refunds.approve'));
$$;
revoke all on function private.can_decide_refunds() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Second approver
-- ---------------------------------------------------------------------------
create table if not exists public.finance_refund_settings (
  currency public.currency primary key,
  second_approval_threshold_minor bigint not null check (second_approval_threshold_minor > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict
);
alter table public.finance_refund_settings enable row level security;
revoke all on public.finance_refund_settings from public, anon, authenticated;
-- No policies: read and written only through the functions below.

alter table public.refunds
  add column if not exists first_approved_by uuid references public.profiles (id) on delete restrict,
  add column if not exists first_approved_at timestamptz,
  add column if not exists first_approval_note text;

alter table public.refunds drop constraint if exists refunds_first_approval_shape;
alter table public.refunds add constraint refunds_first_approval_shape
  check ((first_approved_by is null) = (first_approved_at is null));
alter table public.refunds drop constraint if exists refunds_two_different_approvers;
alter table public.refunds add constraint refunds_two_different_approvers
  check (first_approved_by is null or decided_by is null or state = 'rejected' or first_approved_by <> decided_by);

create or replace function private.refund_second_approval_threshold(p_currency text default 'NGN')
returns bigint
language sql
stable
security definer
set search_path to ''
as $$
  select s.second_approval_threshold_minor from public.finance_refund_settings s where s.currency::text = p_currency;
$$;
revoke all on function private.refund_second_approval_threshold(text) from public, anon, authenticated;

create or replace function public.finance_refund_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not (private.is_finance() or private.is_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'currency', 'NGN',
    'second_approval_threshold_minor', private.refund_second_approval_threshold('NGN'),
    'updated_at', (select s.updated_at from public.finance_refund_settings s where s.currency = 'NGN'),
    'updated_by', (select p.full_name from public.finance_refund_settings s join public.profiles p on p.id = s.updated_by where s.currency = 'NGN'));
end $$;
revoke all on function public.finance_refund_settings_get() from public, anon;
grant execute on function public.finance_refund_settings_get() to authenticated;

-- Set (positive amount) or clear (null) the second-approval threshold. Needs finance.approvals.manage.
create or replace function public.finance_set_refund_second_approval_threshold(p_threshold_minor bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_old bigint := private.refund_second_approval_threshold('NGN');
begin
  if not (private.mfa_requirement_met() and private.finance_can('finance.approvals.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'say why the threshold is changing (at least 10 characters)' using errcode = '22023';
  end if;
  if p_threshold_minor is null then
    delete from public.finance_refund_settings where currency = 'NGN';
  elsif p_threshold_minor <= 0 or p_threshold_minor > 100000000000 then
    raise exception 'the threshold must be a positive amount' using errcode = '22023';
  else
    insert into public.finance_refund_settings (currency, second_approval_threshold_minor, updated_at, updated_by)
    values ('NGN', p_threshold_minor, now(), (select auth.uid()))
    on conflict (currency) do update set second_approval_threshold_minor = excluded.second_approval_threshold_minor,
      updated_at = now(), updated_by = (select auth.uid());
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, reason)
  values (private.caller_org(), (select auth.uid()), 'finance.refund_threshold.set', 'finance_refund_settings',
          jsonb_build_object('currency', 'NGN', 'from_minor', v_old, 'to_minor', p_threshold_minor), btrim(p_reason));
  return public.finance_refund_settings_get();
end $$;
revoke all on function public.finance_set_refund_second_approval_threshold(bigint, text) from public, anon;
grant execute on function public.finance_set_refund_second_approval_threshold(bigint, text) to authenticated;

-- decide_order_refund, from its live body. Changes: the caller check; no deciding a refund you requested;
-- the second-approval branch; audit rows. The approval effects below the branch are the live code unchanged.
create or replace function public.decide_order_refund(p_refund uuid, p_approved boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  r public.refunds%rowtype;
  o public.orders%rowtype;
  e public.entitlements%rowtype;
  m record;
  v_ended boolean := false;
  v_threshold bigint;
begin
  if not private.can_decide_refunds() then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'pending' then return jsonb_build_object('result', 'already_decided', 'state', r.state); end if;
  if r.requested_by = v_uid then return jsonb_build_object('result', 'own_request'); end if;
  if not p_approved then
    if char_length(btrim(coalesce(p_note, ''))) < 5 then return jsonb_build_object('result', 'reason_needed'); end if;
    update public.refunds set state = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = btrim(p_note)
     where id = p_refund and state = 'pending';
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason)
    values (r.organisation_id, v_uid, 'refund.rejected', 'refund', r.id, jsonb_build_object('amount_kobo', r.amount_kobo), btrim(p_note));
    return jsonb_build_object('result', 'rejected', 'refund_id', p_refund);
  end if;

  -- FIN-V2-3: at or above the threshold, two different people approve. No threshold set: one approval, as before.
  v_threshold := private.refund_second_approval_threshold('NGN');
  if v_threshold is not null and r.amount_kobo >= v_threshold then
    if r.first_approved_by is null then
      update public.refunds set first_approved_by = v_uid, first_approved_at = now(), first_approval_note = nullif(btrim(coalesce(p_note, '')), '')
       where id = p_refund and state = 'pending';
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason)
      values (r.organisation_id, v_uid, 'refund.first_approval', 'refund', r.id,
              jsonb_build_object('amount_kobo', r.amount_kobo, 'threshold_kobo', v_threshold), nullif(btrim(coalesce(p_note, '')), ''));
      return jsonb_build_object('result', 'awaiting_second_approval', 'refund_id', p_refund, 'threshold_kobo', v_threshold);
    end if;
    if r.first_approved_by = v_uid then
      return jsonb_build_object('result', 'same_approver');
    end if;
  end if;

  update public.refunds set state = 'approved', decided_by = v_uid, decided_at = now(), decision_note = p_note
   where id = p_refund and state = 'pending';
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason)
  values (r.organisation_id, v_uid, 'refund.approved', 'refund', r.id,
          jsonb_build_object('amount_kobo', r.amount_kobo, 'first_approved_by', r.first_approved_by), nullif(btrim(coalesce(p_note, '')), ''));
  select * into o from public.orders where id = r.order_id;
  select * into e from public.entitlements where order_id = r.order_id and state = 'active';
  if exists (select 1 from public.catalog_items ci where ci.id = o.catalog_item_id and ci.code = 'membership_upgrade_plus') then
    update public.patient_memberships set tier = 'evergreen'
     where id = o.upgraded_membership_id and state = 'active' and tier = 'plus';
  end if;
  if e.id is not null then
    update public.entitlements set state = 'revoked' where id = e.id;
  end if;
  if o.state = 'paid' then
    update public.orders set state = 'refunded' where id = o.id;
  end if;
  -- a year that is still queued (not started) is cancelled on its own, whether or not an entitlement is still active: the running
  -- membership belongs to another order and is not touched, and a refunded order must never start a year later
  update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Queued Membership year refunded (refund ' || p_refund || ')'
   where order_id = o.id and state = 'scheduled';
  if e.id is not null and not found then
    for m in select id from public.patient_memberships
              where patient_id = o.beneficiary_patient_id and state = 'active' and source in ('purchase', 'voucher') loop
      v_ended := private.end_membership_now(m.id, v_uid, 'Membership refunded (refund ' || p_refund || ')') or v_ended;
    end loop;
  end if;
  return jsonb_build_object('result', 'approved', 'refund_id', p_refund, 'order_id', o.id,
                            'entitlement_revoked', e.id is not null, 'membership_ended', v_ended, 'amount_kobo', r.amount_kobo,
                            'paystack_reference', o.paystack_reference);
end $function$;

-- ---------------------------------------------------------------------------
-- 5. The shared queue
-- ---------------------------------------------------------------------------
create or replace function public.finance_refund_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_threshold bigint := private.refund_second_approval_threshold('NGN');
begin
  if not (private.is_finance() or private.is_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'caller_id', v_uid,
    'can_decide', private.can_decide_refunds(),
    'second_approval_threshold_minor', v_threshold,
    'refunds', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id,
               'order_id', r.order_id,
               'amount_minor', r.amount_kobo,
               'state', r.state,
               'reason', r.reason,
               'requested_at', r.created_at,
               'requested_by', rp.full_name,
               'requested_by_staff', coalesce(rp.role::text <> 'patient', false),
               'requested_by_me', r.requested_by = v_uid,
               'needs_second_approval', v_threshold is not null and r.amount_kobo >= v_threshold,
               'first_approved_by', fp.full_name,
               'first_approved_by_me', r.first_approved_by = v_uid,
               'first_approved_at', r.first_approved_at,
               'first_approval_note', r.first_approval_note,
               'decided_by', dp.full_name,
               'decided_at', r.decided_at,
               'decision_note', r.decision_note,
               'completed_at', r.completed_at,
               'attempts', r.attempts,
               'last_error_code', r.last_error_code,
               'provider_status', r.provider_status,
               'payer', bp.full_name,
               'beneficiary', case when o.beneficiary_patient_id is distinct from o.buyer_profile_id then ben.full_name end,
               'item', ci.code,
               'paystack_reference', o.paystack_reference,
               'order_paid_at', o.paid_at,
               'order_price_minor', o.amount_kobo)
             order by case r.state when 'pending' then 0 when 'failed' then 1 when 'approved' then 2 when 'processing' then 3 else 4 end,
                      r.created_at desc), '[]'::jsonb)
        from public.refunds r
        join public.orders o on o.id = r.order_id
        left join public.catalog_items ci on ci.id = o.catalog_item_id
        left join public.profiles rp on rp.id = r.requested_by
        left join public.profiles fp on fp.id = r.first_approved_by
        left join public.profiles dp on dp.id = r.decided_by
        left join public.profiles bp on bp.id = o.buyer_profile_id
        left join public.profiles ben on ben.id = o.beneficiary_patient_id
       where not r.is_test and not o.is_test
         and (r.state in ('pending', 'approved', 'processing', 'failed')
              or coalesce(r.completed_at, r.decided_at, r.updated_at) > now() - interval '30 days'))
  );
end $$;
revoke all on function public.finance_refund_queue() from public, anon;
grant execute on function public.finance_refund_queue() to authenticated;

comment on function public.finance_refund_queue() is
  'Finance v2 shared refunds workspace: open, in-flight, failed and recent checkout refunds with requester, approvers and the payer/beneficiary names. Finance or admin only.';
comment on table public.finance_refund_settings is
  'FIN-V2-3: per currency, the refund amount at or above which two different people must approve. No row means one approval, as before.';

-- ---------------------------------------------------------------------------
-- Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.decide_order_refund(uuid, boolean, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finance_refund_queue()', 'EXECUTE')
     or has_function_privilege('anon', 'public.finance_refund_settings_get()', 'EXECUTE')
     or has_function_privilege('anon', 'public.finance_set_refund_second_approval_threshold(bigint, text)', 'EXECUTE') then
    raise exception 'anon must not execute the refund functions';
  end if;
  if has_function_privilege('authenticated', 'private.can_decide_refunds()', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.finance_refund_settings', 'SELECT') then
    raise exception 'refund helpers and settings must not be reachable directly';
  end if;
  if exists (select 1 from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_class c on c.oid = d.refobjid
              where rw.ev_class = 'private.finance_money_events'::regclass and c.relnamespace = 'analytics_clean'::regnamespace) then
    raise exception 'private.finance_money_events must not depend on an analytics_clean view';
  end if;
  if has_table_privilege('authenticated', 'private.finance_money_events', 'SELECT') then
    raise exception 'finance_money_events must not be readable by authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Sidebar badge: refunds waiting for a decision (redefines the Phase A counts with one more key).
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
    'approvals', (select count(*) from public.finance_approval_requests r where r.status = 'pending'),
    'refunds', (select count(*) from public.refunds r where r.state = 'pending' and not r.is_test)
  );
end;
$$;
