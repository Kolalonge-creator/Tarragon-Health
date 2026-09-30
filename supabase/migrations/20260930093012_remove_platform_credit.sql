-- S01b: remove Platform Credit (founder decision F-01, 2026-09-30; spec INV-09 "no stored balance").
--
-- Platform Credit was a prepaid, non-expiring balance a patient funded via Paystack and spent on
-- service purchases (added 2026-09-17). Patients now pay per item at checkout. Care Vouchers are a
-- SEPARATE decision (OQ-07) and are NOT touched here. Service-purchase "credits"
-- (private.enforce_*_credit, public.claim_lab_result_consult_credit, redeem_available_service_purchase)
-- are a different feature that merely shares the word "credit" and are NOT touched here either.
--
-- COUNTED BEFORE CUTTING (live project koiplnmbgnqnbywhpjlf, 2026-09-30):
--   platform_credit_balances          0 rows   (0 with a non-zero paid or promo balance)
--   platform_credit_ledger_entries    0 rows
--   platform_credit_topup_intents     0 rows
--   platform_credit_config            1 row    (min/max/suggested top-up amounts; no money)
--   rows with payment_provider = 'platform_credit' across all 15 columns using that enum: 0
--   invoices with service_type = 'platform_credit_topup': 0
--   video_visit_requests: 0 rows
-- No paid-bucket money exists, so there is no refund step and no data conversion: a pure structural
-- removal. (Trial balances were already cleared by 20260923002810.)
--
-- GENERAL LEDGER (kept, read-only history, by design): 7 finance_journal_entries carry
-- source = 'platform_credit' (E2E test top-up/spend/grant/correction of 2026-09-17, period 2026-09-01,
-- still open). Posted journal entries are append-only accounting history, so they are NOT deleted and
-- the finance_journal_entries.source CHECK keeps the 'platform_credit' value so those rows stay valid.
-- Account 2600 "Promotional credit outstanding" is kept for the same reason (4 lines, nets to 0).
-- SEPARATE FINDING, not fixed here (needs a finance decision, see OQ-28): account 2100 "customer
-- funds" still nets to a 250,000 kobo credit from that same test run (top-up 1,000,000, a reversed
-- spend, its reversal and a corrected spend) while every balance row is 0, i.e. the books carry a
-- liability with nothing behind it.
--
-- ORDER: rewrite every surviving function so none references a dropped object (plpgsql resolves
-- references at execution, so a missed one would only fail at runtime), drop the trigger, tables,
-- functions and enum types, rebuild the payment_provider enum WITHOUT 'platform_credit', then assert.

-- The enum rebuild (section 4) takes ACCESS EXCLUSIVE on the payment tables (payment_transactions,
-- service_purchases, lab_orders, ...) and holds every lock until commit. Fail fast instead of queueing behind,
-- or deadlocking with, a live Paystack webhook: if a lock is not free within 10 seconds the whole migration
-- rolls back cleanly and can simply be re-run. Apply it in a quiet window.
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------------------------
-- 1. Trigger that applied a paid top-up to a balance
-- ---------------------------------------------------------------------------------------------
drop trigger if exists payment_transactions_apply_platform_credit_topup on public.payment_transactions;

-- ---------------------------------------------------------------------------------------------
-- 2. Rewrite surviving functions without the credit branch (definitions read from live 2026-09-30)
-- ---------------------------------------------------------------------------------------------
create or replace function public.accept_video_visit_request(p_request_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff uuid;
  v_req record;
  v_slot record;
  v_consult uuid;
begin
  select r.* into v_req from public.video_visit_requests r where r.id = p_request_id for update;
  if v_req.id is null then
    raise exception 'request not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_req.organisation_id
    and cs.active
    and cs.doctor_tier is not null;
  if v_staff is null then
    raise exception 'only an active doctor on this organisation''s care team can accept a video visit'
      using errcode = '42501';
  end if;

  if v_req.status <> 'payment_confirmed' then
    raise exception 'this request is not awaiting acceptance (status: %)', v_req.status;
  end if;
  if v_req.slot_id is null then
    raise exception 'this request has no slot attached — decline it with a note instead';
  end if;

  select * into v_slot from public.consult_availability_slots where id = v_req.slot_id for update;
  if v_slot.id is null or v_slot.booked_consultation_id is not null then
    raise exception 'that slot is no longer available — decline and ask the patient to pick another time';
  end if;
  if v_slot.slot_start <= now() then
    raise exception 'that time has already passed — decline so the patient is refunded';
  end if;

  -- A video visit is paid at checkout (Paystack) before it reaches this point; there is nothing
  -- further to charge on acceptance.

  insert into public.video_consultations
    (organisation_id, patient_id, context, initiated_by, status, scheduled_at, patient_confirmed_at)
  values
    (v_req.organisation_id, v_req.patient_id, 'general_checkin', v_req.patient_id, 'scheduled', v_slot.slot_start, now())
  returning id into v_consult;

  update public.consult_availability_slots
    set booked_consultation_id = v_consult
    where id = v_slot.id;

  update public.video_visit_requests
    set status = 'accepted',
        accepted_by = v_staff,
        accepted_at = now(),
        video_consultation_id = v_consult
    where id = v_req.id;

  return v_consult;
end;
$function$;

create or replace function public.select_video_visit_alternate_slot(p_request_id uuid, p_slot_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_req record;
  v_slot record;
  v_consult uuid;
begin
  select r.* into v_req
  from public.video_visit_requests r
  where r.id = p_request_id and r.patient_id = (select auth.uid())
  for update;
  if v_req.id is null then
    raise exception 'request not found' using errcode = '42501';
  end if;

  if v_req.status <> 'alternate_proposed' then
    raise exception 'this request has no offered times to pick from (status: %)', v_req.status;
  end if;
  if v_req.proposed_slot_ids is null or not (p_slot_id = any(v_req.proposed_slot_ids)) then
    raise exception 'that time was not one of the offered options';
  end if;

  select * into v_slot from public.consult_availability_slots where id = p_slot_id for update;
  if v_slot.id is null or v_slot.booked_consultation_id is not null then
    raise exception 'that time is no longer available -- ask your care team to offer another time';
  end if;
  if v_slot.slot_start <= now() then
    raise exception 'that time has already passed -- ask your care team to offer another time';
  end if;

  insert into public.video_consultations
    (organisation_id, patient_id, context, initiated_by, status, scheduled_at, patient_confirmed_at)
  values
    (v_req.organisation_id, v_req.patient_id, 'general_checkin', v_req.patient_id, 'scheduled', v_slot.slot_start, now())
  returning id into v_consult;

  update public.consult_availability_slots
    set booked_consultation_id = v_consult
    where id = v_slot.id;

  update public.video_visit_requests
    set status = 'accepted',
        slot_id = p_slot_id,
        accepted_by = v_req.proposed_by,
        accepted_at = now(),
        video_consultation_id = v_consult
    where id = v_req.id;

  return v_consult;
end;
$function$;

create or replace function public.request_purchase_guarantee_refund(p_service_purchase_id uuid, p_reason text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_purchase public.service_purchases%rowtype;
  v_first_purchase_id uuid;
  v_amount_kobo bigint;
  v_claim_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select * into v_purchase from public.service_purchases
    where id = p_service_purchase_id for update;
  if not found or v_purchase.patient_id <> v_caller then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_purchase.status not in ('active', 'expired') then
    return jsonb_build_object('ok', false, 'reason', 'not_refundable_status', 'status', v_purchase.status);
  end if;

  if v_purchase.payment_provider is null or v_purchase.payment_provider <> 'paystack' then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible_provider');
  end if;

  v_amount_kobo := coalesce(v_purchase.payable_kobo, v_purchase.amount_kobo);
  if v_amount_kobo is null or v_amount_kobo <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'nothing_paid');
  end if;

  if v_purchase.purchased_at is null or now() > v_purchase.purchased_at + interval '30 days' then
    return jsonb_build_object('ok', false, 'reason', 'window_expired');
  end if;

  -- "First-ever purchase" = the earliest activated purchase for this
  -- patient (a pending_payment row that never activated doesn't count).
  select sp.id into v_first_purchase_id
    from public.service_purchases sp
    where sp.patient_id = v_caller
      and sp.status in ('active', 'expired', 'refunded')
      and sp.purchased_at is not null
    order by sp.purchased_at asc, sp.id asc
    limit 1;

  if v_first_purchase_id is distinct from v_purchase.id then
    return jsonb_build_object('ok', false, 'reason', 'not_first_purchase');
  end if;

  if exists (select 1 from public.service_purchase_guarantee_claims where service_purchase_id = v_purchase.id) then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;

  insert into public.service_purchase_guarantee_claims
    (organisation_id, patient_id, service_purchase_id, reason)
  values (v_purchase.organisation_id, v_caller, v_purchase.id, nullif(trim(coalesce(p_reason, '')), ''))
  returning id into v_claim_id;

  perform private.log_audit('service_purchase_guarantee.requested', 'service_purchase_guarantee_claims', v_claim_id,
    jsonb_build_object('service_purchase_id', v_purchase.id, 'amount_kobo', v_amount_kobo));

  return jsonb_build_object('ok', true, 'claim_id', v_claim_id);
end;
$function$;

create or replace function public.decide_purchase_guarantee_refund(p_claim_id uuid, p_approve boolean, p_note text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_claim public.service_purchase_guarantee_claims%rowtype;
  v_purchase public.service_purchases%rowtype;
  v_amount_kobo bigint;
  v_txn_id uuid;
  v_txn_amount_minor bigint;
  v_paystack_refund_amount_kobo bigint;
  v_entry uuid;
  v_schedule record;
  v_recog record;
  v_refund_mode text;
  v_reason text;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if not private.is_admin() then
    raise exception 'not authorised to decide a guarantee refund' using errcode = '42501';
  end if;

  select * into v_claim from public.service_purchase_guarantee_claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found';
  end if;
  if v_claim.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided', 'status', v_claim.status);
  end if;

  if not p_approve then
    update public.service_purchase_guarantee_claims
      set status = 'denied', reviewed_by = v_caller, reviewed_at = now(), decision_note = p_note
      where id = p_claim_id;
    perform private.log_audit('service_purchase_guarantee.denied', 'service_purchase_guarantee_claims', p_claim_id,
      jsonb_build_object('note', p_note));
    return jsonb_build_object('ok', true, 'status', 'denied');
  end if;

  select * into v_purchase from public.service_purchases where id = v_claim.service_purchase_id for update;
  if not found then
    raise exception 'purchase not found for claim %', p_claim_id;
  end if;
  if v_purchase.status not in ('active', 'expired') then
    -- Race guard: something else (an expiry sweep, another admin) changed
    -- the purchase between request and decision.
    return jsonb_build_object('ok', false, 'reason', 'purchase_no_longer_refundable', 'status', v_purchase.status);
  end if;

  v_amount_kobo := coalesce(v_purchase.payable_kobo, v_purchase.amount_kobo);
  v_reason := 'First-purchase guarantee approved for service purchase ' || v_purchase.id::text;

  update public.service_purchases set status = 'refunded' where id = v_purchase.id;

  -- Give back any access this purchase granted. Re-derive via the same
  -- feature-access check the enrol-time trigger uses (now sees the
  -- 'refunded' status just written above) rather than hand-rolling a
  -- second "is another live purchase still granting this" query.
  if v_purchase.scoped_entity_type = 'chronic_programme_enrolments' and v_purchase.scoped_entity_id is not null then
    if not private.patient_has_feature_access(v_purchase.patient_id, 'chronic_doctor_supported_track') then
      update public.chronic_programme_enrolments
        set track = 'self_monitoring'
        where id = v_purchase.scoped_entity_id
          and status = 'enrolled'
          and track = 'doctor_supported';
    end if;
  end if;

  -- Wind down any revenue recognition schedule for this purchase: reverse
  -- every already-posted tranche, not just the original entry, and lock the
  -- schedule row first so the monthly recogniser can't post a fresh tranche
  -- underneath this decision.
  for v_schedule in
    select * from public.revenue_recognition_schedules
    where source_kind = 'service_purchase' and source_id = v_purchase.id and status = 'active'
    for update
  loop
    for v_recog in
      select id from public.finance_journal_entries
      where source = 'revenue_recognition'
        and source_ref like 'revrec:' || v_schedule.id::text || ':%'
        and is_reversed = false
    loop
      perform private.finance_reverse_entry(v_recog.id, v_reason, v_caller);
    end loop;

    update public.revenue_recognition_schedules
      set status = 'cancelled',
          cancelled_reason = 'Guarantee refund approved ' || to_char(now(), 'YYYY-MM-DD') ||
            ' for the service_purchase this schedule recognises revenue against (claim ' || p_claim_id::text || ').'
      where id = v_schedule.id;
  end loop;

  if v_purchase.payment_provider = 'paystack' then
    -- Correlate to the payment_transactions row the same way
    -- finance_post_from_payment/resolve_payment_payer do, INCLUDING their
    -- metadata.kind guard, then reverse its GL entry.
    select id, amount_minor into v_txn_id, v_txn_amount_minor from public.payment_transactions
      where (raw_payload #>> '{data,reference}' = v_purchase.payment_provider_ref
          or raw_payload #>> '{data,object,id}' = v_purchase.payment_provider_ref)
        and coalesce(raw_payload #>> '{data,metadata,kind}', raw_payload #>> '{metadata,kind}') = 'service_purchase'
      order by created_at desc limit 1;

    if v_txn_id is null then
      raise exception 'could not correlate service purchase % to its payment_transactions row via reference % — refusing to approve a refund without a grounded GL reversal',
        v_purchase.id, v_purchase.payment_provider_ref;
    end if;

    -- The real amount Paystack charged can exceed payable_kobo when this
    -- account's processor fee is passed on to the customer — refund that,
    -- not the nominal price, so the guarantee is honoured in full.
    v_paystack_refund_amount_kobo := coalesce(v_txn_amount_minor, v_amount_kobo);

    if exists (select 1 from public.finance_journal_entries where source = 'payment' and source_ref = v_txn_id::text) then
      select id into v_entry from public.finance_journal_entries
        where source = 'payment' and source_ref = v_txn_id::text and is_reversed = false;
      if v_entry is not null then
        perform private.finance_reverse_entry(v_entry, v_reason, v_caller);
      end if;
      -- v_entry null here means it was already reversed by something else:
      -- a legitimate no-op, not an error.
    else
      raise exception 'no payment journal entry was ever posted for service purchase % (transaction %) — refusing to approve a refund without a grounded GL reversal',
        v_purchase.id, v_txn_id;
    end if;

    insert into public.service_purchase_refund_queue
      (service_purchase_id, guarantee_claim_id, provider, provider_reference, amount_minor, currency)
    values
      (v_purchase.id, p_claim_id, 'paystack', v_purchase.payment_provider_ref, v_paystack_refund_amount_kobo, v_purchase.currency)
    on conflict (guarantee_claim_id) do nothing;

    v_refund_mode := 'queued';
  else
    raise exception 'service purchase % has an unexpected payment_provider % for a guarantee refund',
      v_purchase.id, v_purchase.payment_provider;
  end if;

  update public.service_purchase_guarantee_claims
    set status = 'approved', reviewed_by = v_caller, reviewed_at = now(), decision_note = p_note
    where id = p_claim_id;

  perform private.log_audit('service_purchase_guarantee.approved', 'service_purchase_guarantee_claims', p_claim_id,
    jsonb_build_object('service_purchase_id', v_purchase.id, 'amount_kobo', v_amount_kobo, 'refund_mode', v_refund_mode));

  return jsonb_build_object('ok', true, 'status', 'approved', 'refund_mode', v_refund_mode, 'amount_kobo', v_amount_kobo);
end;
$function$;

create or replace function private.payment_transaction_service_label(p_txn public.payment_transactions)
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case
    when p_txn.id is null then null
    when p_txn.booking_order_type is not null then initcap(p_txn.booking_order_type::text) || ' order'
    when p_txn.subscription_id is not null then 'Subscription'
    when p_txn.subscription_add_on_id is not null then 'Add-on'
    when coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'voucher_payment'
      then 'Care voucher payment'
    when coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'sponsored_subscription'
      then 'Sponsored subscription'
    when coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'service_purchase'
      then 'Service purchase'
    else 'Payment'
  end;
$function$;

create or replace function private.resolve_payment_payer(p_txn public.payment_transactions)
 returns uuid
 language sql
 stable security definer
 set search_path to ''
as $function$
  select coalesce(
    (select subscriber_id from public.subscriptions where id = p_txn.subscription_id),
    (select s.subscriber_id from public.subscription_add_ons a
       join public.subscriptions s on s.id = a.subscription_id
      where a.id = p_txn.subscription_add_on_id),
    (select payer_profile_id from public.care_voucher_payments
      where payment_transaction_id = p_txn.id limit 1),
    (
      select sp.patient_id
      from public.service_purchases sp
      where coalesce(p_txn.raw_payload #>> '{data,metadata,kind}', p_txn.raw_payload #>> '{metadata,kind}') = 'service_purchase'
        and (
          sp.pending_payment_provider_ref = coalesce(p_txn.raw_payload #>> '{data,reference}', p_txn.raw_payload #>> '{data,object,id}')
          or sp.payment_provider_ref = coalesce(p_txn.raw_payload #>> '{data,reference}', p_txn.raw_payload #>> '{data,object,id}')
        )
      order by sp.updated_at desc
      limit 1
    ),
    case p_txn.booking_order_type::text
      when 'lab' then (select patient_id from public.lab_orders where id = p_txn.booking_order_id)
      when 'pharmacy' then (select patient_id from public.pharmacy_orders where id = p_txn.booking_order_id)
      when 'referral' then (select patient_id from public.specialist_referrals where id = p_txn.booking_order_id)
      else null
    end
  );
$function$;

-- finance_unified_ledger: historical source = 'platform_credit' journal entries (the 7 E2E rows) stay
-- visible, labelled as retired, with their amount read from the entry's own lines (the ledger table
-- that used to supply it is gone). Every other source behaves exactly as before.
create or replace function public.finance_unified_ledger(p_profile_id uuid default null::uuid, p_organisation_id uuid default null::uuid, p_from date default null::date, p_to date default null::date, p_limit integer default 50, p_offset integer default 0)
 returns table(entry_id uuid, payment_transaction_id uuid, entry_date date, posted_at timestamp with time zone, source text, service_label text, payer_profile_id uuid, payer_label text, recipient_label text, direction text, amount_minor bigint, currency currency, status text, method text, memo text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if p_profile_id is null and p_organisation_id is null then
    raise exception 'finance_unified_ledger requires p_profile_id or p_organisation_id'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_profile_id is not null
     and p_profile_id is distinct from (select auth.uid())
     and not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_organisation_id is not null and not private.is_finance() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
  with rows as (
    select
      je.id as entry_id,
      pt.id as payment_transaction_id,
      je.entry_date,
      je.created_at as posted_at,
      je.source,
      coalesce(
        private.payment_transaction_service_label(pt),
        case when je.source = 'platform_credit' then 'Platform credit (retired feature)'
             else initcap(je.source) end
      ) as service_label,
      private.resolve_payment_payer(pt) as payer_profile_id,
      (case when je.source = 'refund' then 'money_out' else 'money_in' end) as direction,
      coalesce(
        pt.amount_minor,
        case when je.source = 'platform_credit'
             then (select coalesce(sum(l.credit_minor), 0)::bigint from public.finance_journal_lines l where l.entry_id = je.id)
             else null end,
        0
      ) as amount_minor,
      je.currency,
      'completed'::text as status,
      coalesce(pt.provider::text, case when je.source = 'platform_credit' then 'platform_credit' end) as method,
      je.memo,
      coalesce(pt.organisation_id,
        (select l.organisation_id from public.finance_journal_lines l
          where l.entry_id = je.id and l.organisation_id is not null limit 1)) as organisation_id
    from public.finance_journal_entries je
    left join public.payment_transactions pt on pt.id::text = je.source_ref
    where je.entry_date >= coalesce(p_from, '1900-01-01'::date)
      and je.entry_date <= coalesce(p_to, '9999-12-31'::date)

    union all

    select
      null::uuid as entry_id,
      pt.id as payment_transaction_id,
      pt.created_at::date as entry_date,
      pt.created_at as posted_at,
      'payment'::text as source,
      coalesce(private.payment_transaction_service_label(pt), 'Payment attempt') as service_label,
      private.resolve_payment_payer(pt) as payer_profile_id,
      'money_in'::text as direction,
      coalesce(pt.amount_minor, 0) as amount_minor,
      pt.currency,
      'failed'::text as status,
      pt.provider::text as method,
      pt.error as memo,
      pt.organisation_id
    from public.payment_transactions pt
    where pt.error is not null
      and not exists (select 1 from public.finance_journal_entries je2 where je2.source_ref = pt.id::text)
      and pt.created_at::date >= coalesce(p_from, '1900-01-01'::date)
      and pt.created_at::date <= coalesce(p_to, '9999-12-31'::date)
  )
  select
    r.entry_id, r.payment_transaction_id, r.entry_date, r.posted_at, r.source,
    r.service_label, r.payer_profile_id,
    case when r.direction = 'money_in'
      then coalesce(nullif(trim(pr.full_name), ''), 'Patient')
      else 'Tarragon Health' end as payer_label,
    case when r.direction = 'money_in'
      then 'Tarragon Health'
      else coalesce(nullif(trim(pr.full_name), ''), 'Patient') end as recipient_label,
    r.direction, r.amount_minor, r.currency, r.status, r.method, r.memo
  from rows r
  left join public.profiles pr on pr.id = r.payer_profile_id
  where (p_profile_id is null or r.payer_profile_id = p_profile_id)
    and (p_organisation_id is null or r.organisation_id = p_organisation_id)
  order by r.posted_at desc
  limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$function$;

create or replace function public.patient_receipts()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
$function$;

-- ---------------------------------------------------------------------------------------------
-- 3. Drop the feature: tables (children first), functions, enum types, module flag
-- ---------------------------------------------------------------------------------------------
drop table public.platform_credit_ledger_entries;
drop table public.platform_credit_topup_intents;
drop table public.platform_credit_balances;
drop table public.platform_credit_config;

do $$
declare
  r record;
begin
  -- Every remaining function whose NAME marks it as Platform Credit machinery. Resolved by name so
  -- a signature drifted by a later migration is still caught; the closing assertion proves none is left.
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.proname in (
        'apply_platform_credit_topup_payment', 'finance_post_platform_credit_ledger_entry',
        'parse_platform_credit_source_ref', 'pay_video_visit_request_on_platform_credit',
        'platform_credit_apply', 'cancel_platform_credit_topup_intent',
        'check_platform_credit_covers_video_visit', 'confirm_video_visit_request_on_platform_credit',
        'correct_platform_credit', 'grant_platform_credit', 'pay_pharmacy_order_on_platform_credit',
        'pay_service_purchase_on_platform_credit', 'pay_specialist_referral_on_platform_credit',
        'record_platform_credit_topup_intent'
      )
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

drop type public.platform_credit_bucket;
drop type public.platform_credit_entry_type;
drop type public.platform_credit_topup_status;

delete from public.platform_modules where key = 'platform_credit_topups';

-- invoices.service_type no longer allows a top-up (0 rows used it).
alter table public.invoices drop constraint invoices_service_type_check;
alter table public.invoices add constraint invoices_service_type_check
  check (service_type = any (array['membership', 'laboratory', 'pharmacy', 'referral', 'consultation', 'care_voucher']));

-- ---------------------------------------------------------------------------------------------
-- 4. Delete the enum VALUE: rebuild payment_provider without 'platform_credit'
--    (Postgres cannot drop a single enum label). 0 rows used it, so the USING cast never fails.
-- ---------------------------------------------------------------------------------------------
drop function public.record_screening_day_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text);
drop function public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text);
drop function public.payments_with_payer_for_fraud_sweep(timestamp with time zone, timestamp with time zone);

alter type public.payment_provider rename to payment_provider_old;
create type public.payment_provider as enum ('paystack', 'stripe', 'wallet', 'voucher', 'employer');

do $$
declare
  r record;
begin
  for r in
    select c.table_name, c.column_name, c.column_default
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.udt_name = 'payment_provider_old'
  loop
    if r.column_default is not null then
      execute format('alter table public.%I alter column %I drop default', r.table_name, r.column_name);
    end if;
    execute format(
      'alter table public.%I alter column %I type public.payment_provider using %I::text::public.payment_provider',
      r.table_name, r.column_name, r.column_name
    );
    if r.column_default is not null then
      execute format(
        'alter table public.%I alter column %I set default %s',
        r.table_name, r.column_name, replace(r.column_default, 'payment_provider_old', 'payment_provider')
      );
    end if;
  end loop;
end $$;

drop type public.payment_provider_old;

create or replace function public.record_screening_day_payment_intent(p_screening_day uuid, p_amount_minor bigint, p_currency text, p_credit_kobo bigint, p_provider public.payment_provider, p_reference text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_day public.screening_days%rowtype;
  v_outstanding bigint;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_day from public.screening_days where id = p_screening_day for update;
  if not found then raise exception 'screening day not found'; end if;
  if v_day.status <> 'confirmed' then
    raise exception 'this screening day is not ready for payment';
  end if;
  if v_day.payer_profile_id <> v_caller and not private.is_org_staff(v_day.organisation_id) then
    raise exception 'only the named payer can pay for this screening day' using errcode = '42501';
  end if;

  v_outstanding := v_day.total_kobo - v_day.amount_paid_kobo
                   - coalesce((select sum(credit_kobo) from public.screening_day_payments
                               where screening_day_id = p_screening_day and status = 'pending'), 0);

  if p_credit_kobo <= 0 then raise exception 'amount must be positive'; end if;
  if p_credit_kobo > v_outstanding then
    raise exception 'that is more than is outstanding for this screening day';
  end if;

  insert into public.screening_day_payments (
    organisation_id, screening_day_id, payer_profile_id,
    amount_minor, currency, credit_kobo, provider, pending_provider_ref, status
  ) values (
    v_day.organisation_id, p_screening_day, v_caller,
    p_amount_minor, p_currency, p_credit_kobo, p_provider, p_reference, 'pending'
  )
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.record_voucher_payment_intent(p_voucher uuid, p_amount_minor bigint, p_currency text, p_instalment_kobo bigint, p_provider public.payment_provider, p_reference text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_voucher public.care_vouchers%rowtype;
  v_outstanding bigint;
  v_min bigint;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_voucher from public.care_vouchers where id = p_voucher for update;
  if not found then raise exception 'voucher not found'; end if;
  if v_voucher.kind <> 'prepaid_service' then
    raise exception 'reward vouchers are not paid for';
  end if;
  if v_voucher.status <> 'reserved' then
    raise exception 'this voucher is not awaiting payment';
  end if;
  if not private.can_purchase_voucher_for(v_voucher.beneficiary_profile_id, v_caller) then
    raise exception 'You are not authorised to pay toward this voucher' using errcode = '42501';
  end if;

  select min_instalment_kobo into v_min from public.care_voucher_config where id = true;
  v_outstanding := v_voucher.face_value_kobo - v_voucher.amount_paid_kobo
                   - coalesce((select sum(instalment_kobo) from public.care_voucher_payments
                               where voucher_id = p_voucher and status = 'pending'), 0);

  if p_instalment_kobo <= 0 then raise exception 'instalment must be positive'; end if;
  if p_instalment_kobo > v_outstanding then
    raise exception 'that is more than is outstanding on this voucher';
  end if;
  if p_instalment_kobo < v_min and p_instalment_kobo <> v_outstanding then
    raise exception 'the smallest instalment is %', (v_min / 100)::text;
  end if;

  insert into public.care_voucher_payments (
    organisation_id, voucher_id, payer_profile_id,
    amount_minor, currency, instalment_kobo, provider, pending_provider_ref, status
  ) values (
    v_voucher.organisation_id, p_voucher, v_caller,
    p_amount_minor, p_currency, p_instalment_kobo, p_provider, p_reference, 'pending'
  )
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.payments_with_payer_for_fraud_sweep(p_from timestamp with time zone, p_to timestamp with time zone)
 returns table(id uuid, payer_profile_id uuid, organisation_id uuid, amount_minor bigint, currency currency, provider payment_provider, event_type text, processed_at timestamp with time zone, error text, created_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select pt.id, private.resolve_payment_payer(pt), pt.organisation_id, pt.amount_minor, pt.currency,
         pt.provider, pt.event_type::text, pt.processed_at, pt.error, pt.created_at
  from public.payment_transactions pt
  where pt.created_at >= p_from and pt.created_at <= p_to;
$function$;

-- Same ACL as before (postgres, service_role, authenticated; never PUBLIC or anon). A recreated function
-- otherwise inherits Supabase's default grants, which is the recurring anon-EXECUTE gap.
revoke all on function public.record_screening_day_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) from public, anon;
grant execute on function public.record_screening_day_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) to authenticated, service_role;
revoke all on function public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) from public, anon;
grant execute on function public.record_voucher_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) to authenticated, service_role;
-- payments_with_payer_for_fraud_sweep was service_role only (no authenticated, no anon).
revoke all on function public.payments_with_payer_for_fraud_sweep(timestamp with time zone, timestamp with time zone) from public, anon, authenticated;
grant execute on function public.payments_with_payer_for_fraud_sweep(timestamp with time zone, timestamp with time zone) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. Prove removal
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  select count(*) into v_n from pg_class where relnamespace = 'public'::regnamespace and relname like 'platform_credit%';
  if v_n <> 0 then raise exception 'platform_credit relations remain: %', v_n; end if;

  select count(*) into v_n from pg_type where typnamespace = 'public'::regnamespace and typname like 'platform_credit%';
  if v_n <> 0 then raise exception 'platform_credit types remain: %', v_n; end if;

  if exists (select 1 from pg_enum where enumtypid = 'public.payment_provider'::regtype and enumlabel = 'platform_credit') then
    raise exception 'payment_provider still has the platform_credit label';
  end if;
  if not exists (select 1 from pg_enum where enumtypid = 'public.payment_provider'::regtype and enumlabel = 'paystack') then
    raise exception 'payment_provider lost its paystack label';
  end if;
  if exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'payment_provider_old') then
    raise exception 'payment_provider_old was not dropped';
  end if;

  -- No surviving function may still mention Platform Credit, except finance_unified_ledger, which keeps the
  -- literal journal source string 'platform_credit' on purpose to label the 7 retained history rows.
  -- (plpgsql resolves references at execution, so this scan is what catches a missed caller.)
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private', 'analytics')
    and (p.prosrc ilike '%platform_credit%' or p.proname ilike '%platform_credit%')
    and not (n.nspname = 'public' and p.proname in ('finance_unified_ledger', 'finance_revenue_by_funding_source'));
  if v_n <> 0 then raise exception '% function(s) still reference platform_credit', v_n; end if;

  if exists (select 1 from public.platform_modules where key = 'platform_credit_topups') then
    raise exception 'platform_credit_topups module row remains';
  end if;

  if has_function_privilege('anon', 'public.record_voucher_payment_intent(uuid,bigint,text,bigint,public.payment_provider,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_screening_day_payment_intent(uuid,bigint,text,bigint,public.payment_provider,text)', 'EXECUTE') then
    raise exception 'anon can EXECUTE a recreated payment-intent function';
  end if;

  if has_function_privilege('anon', 'public.payments_with_payer_for_fraud_sweep(timestamptz,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.payments_with_payer_for_fraud_sweep(timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'anon or authenticated can EXECUTE the fraud-sweep payments function (service_role only)';
  end if;

  -- History must stay valid: the source CHECK still allows 'platform_credit' (live holds 7 such journal
  -- entries; a fresh local replay holds none, so assert the constraint, not a row count).
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.finance_journal_entries'::regclass
      and conname = 'finance_journal_entries_source_check'
      and pg_get_constraintdef(oid) ilike '%platform_credit%'
  ) then
    raise exception 'finance_journal_entries.source CHECK no longer allows platform_credit history';
  end if;
end $$;
