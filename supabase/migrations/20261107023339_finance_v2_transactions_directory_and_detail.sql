-- ===========================================================================
-- Finance dashboard v2, Phase B: the transaction directory and transaction detail.
-- Design: docs/design/FINANCE-DASHBOARD-V2.md. Builds on 20261107015736
-- (private.finance_money_events).
--
-- public.finance_transactions_list   paged, filtered, sorted rows from the money-events
--                                    view, each with a settlement status and the amount
--                                    refunded against it. With p_for_export = true the
--                                    caller must also hold finance.export (or be finance /
--                                    admin), and the export is written to audit_log.
-- public.finance_transaction_detail  one payment, failed payment or refund with everything
--                                    finance needs to explain it: payer and beneficiary (names
--                                    only), the Membership it bought, refunds, Paystack webhook
--                                    events (status only, never the raw body), settlement lines,
--                                    reconciliation breaks and flags, ledger postings, and one
--                                    merged timeline. Every read writes an audit_log row
--                                    (finance.transaction.viewed), because the record names a person.
--
-- SETTLEMENT STATUS (list and detail):
--   settled              a Paystack settlement line, or a manual settlement match, covers it
--   exception            an open reconciliation break or flag names its reference
--   awaiting_settlement  a card payment with neither yet
--   not_applicable       failed payments, refunds and employer invoices (paid outside Paystack)
--
-- Nothing here changes a payment, order, refund, Membership or ledger row. No clinical data:
-- names, references, amounts and states only.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Settlement status for one event. Private; callers check is_finance().
-- ---------------------------------------------------------------------------
create or replace function private.finance_settlement_status(p_event_kind text, p_record_type text, p_record_id uuid, p_reference text)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when p_event_kind <> 'payment' or p_record_type = 'employer_invoice' then 'not_applicable'
    when (p_reference is not null and exists (select 1 from public.reconciliation_breaks b
                                                where b.provider_reference = p_reference and b.status = 'open'))
      or exists (select 1 from public.payment_reconciliation_flags f
                  where f.status = 'open'
                    and ((p_reference is not null and f.provider_reference = p_reference)
                         or (p_record_type = 'payment_transaction' and f.payment_transaction_id = p_record_id)))
      then 'exception'
    when (p_reference is not null and exists (select 1 from public.settlement_lines l where l.provider_reference = p_reference))
      or (p_record_type = 'payment_transaction'
          and exists (select 1 from public.finance_settlement_matches m where m.payment_transaction_id = p_record_id))
      then 'settled'
    else 'awaiting_settlement'
  end;
$$;

revoke all on function private.finance_settlement_status(text, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The directory.
-- ---------------------------------------------------------------------------
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

  with ev as (
    select e.*,
           private.finance_settlement_status(e.event_kind, e.record_type, e.record_id, e.reference) as settlement_status
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
                else coalesce(nullif(trim(bp.full_name), ''), 'Member') end as beneficiary_label,
           case when ev.event_kind = 'payment' and ev.record_type = 'order'
                then (select coalesce(sum(r.amount_kobo), 0) from public.refunds r
                       where r.order_id = ev.record_id and r.state = 'completed' and not r.is_test)
                else 0 end::bigint as refunded_minor
      from ev
      left join public.profiles pp on pp.id = ev.payer_profile_id
      left join public.profiles bp on bp.id = ev.beneficiary_profile_id
  ),
  filtered as (
    select * from labelled l
     where (p_settlement is null or l.settlement_status = any (p_settlement))
       and (v_search is null
            or l.reference ilike '%' || v_search || '%'
            or l.payer_label ilike '%' || v_search || '%'
            or coalesce(l.beneficiary_label, '') ilike '%' || v_search || '%'
            or l.record_id::text = lower(v_search))
  ),
  page as (
    select * from filtered f
     order by
       case when p_sort = 'amount' and not v_desc then f.amount_minor end asc nulls last,
       case when p_sort = 'amount' and v_desc then f.amount_minor end desc nulls last,
       case when coalesce(p_sort, 'occurred_at') = 'occurred_at' and not v_desc then f.occurred_at end asc nulls last,
       f.occurred_at desc nulls last,
       f.event_id
     limit v_limit offset v_offset
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
               'settlement_status', p.settlement_status,
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

  if p_for_export then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, event)
    values (private.caller_org(), (select auth.uid()), 'finance.transactions.exported', 'finance_transactions',
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

revoke all on function public.finance_transactions_list(date, date, text[], text[], text[], text[], text[], bigint, bigint, text, text, text, integer, integer, boolean) from public, anon;
grant execute on function public.finance_transactions_list(date, date, text[], text[], text[], text[], text[], bigint, bigint, text, text, text, integer, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The detail.
-- ---------------------------------------------------------------------------
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
    'refundable_minor', case when v_order_id is null or e.event_kind <> 'payment' then null
                             else greatest(e.amount_minor - (select coalesce(sum(r.amount_kobo), 0) from refunds_list r
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

revoke all on function public.finance_transaction_detail(text, uuid) from public, anon;
grant execute on function public.finance_transaction_detail(text, uuid) to authenticated;

comment on function public.finance_transactions_list(date, date, text[], text[], text[], text[], text[], bigint, bigint, text, text, text, integer, integer, boolean) is
  'Finance v2 transaction directory over private.finance_money_events, with settlement status and refunded amount. Export mode needs finance.export and is audited. Raises 42501 for non-finance callers.';
comment on function public.finance_transaction_detail(text, uuid) is
  'Finance v2 transaction detail: event, payer/beneficiary names, order, Membership, refunds, Paystack events (no raw bodies), settlement, reconciliation, ledger, timeline. Each read is audited. Raises 42501 for non-finance callers.';

do $$
begin
  if has_function_privilege('anon', 'public.finance_transactions_list(date, date, text[], text[], text[], text[], text[], bigint, bigint, text, text, text, integer, integer, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finance_transaction_detail(text, uuid)', 'EXECUTE') then
    raise exception 'anon must not execute the finance transaction RPCs';
  end if;
  if has_function_privilege('authenticated', 'private.finance_settlement_status(text, text, uuid, text)', 'EXECUTE') then
    raise exception 'private.finance_settlement_status must not be executable by authenticated';
  end if;
end $$;
