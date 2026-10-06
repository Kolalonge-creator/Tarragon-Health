-- S25 code-review fixes: (1) flag_order_payment_mismatch now records fee and raw evidence instead of hardcoding 0/{};
-- (2) record_order_payment gains a processor-fee cap check (customer fee must not exceed what the processor took).
-- Both functions are live from 20261006162206 with zero paid orders and zero mismatch rows (checkout is dormant), so there is no
-- data to convert. The new parameters have defaults, so a caller on the old argument list keeps working.

-- The old overloads are dropped first so a call with the old argument list resolves to the new function through its
-- defaults and is never ambiguous (an old edge function deployed before this one keeps working until it is redeployed).
drop function if exists public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb);
drop function if exists public.flag_order_payment_mismatch(text, text, bigint, bigint, text, text);

-- 1. flag_order_payment_mismatch: accept p_fee_kobo and p_raw so the mismatch row carries the actual fee and Paystack payload.
create function public.flag_order_payment_mismatch(
  p_reference text,
  p_reason text,
  p_amount_kobo bigint,
  p_total_kobo bigint,
  p_source text,
  p_event_key text default null,
  p_fee_kobo bigint default 0,
  p_raw jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare o public.orders%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into o from public.orders where paystack_reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.state in ('paid', 'refunded') then return jsonb_build_object('result', 'replay', 'order_id', o.id); end if;
  return private.record_order_mismatch(o, left(coalesce(p_reason, 'unknown'), 40), p_amount_kobo, greatest(coalesce(p_fee_kobo, 0), 0), p_total_kobo, p_source, p_event_key, coalesce(p_raw, '{}'::jsonb));
end $$;

revoke all on function public.flag_order_payment_mismatch(text, text, bigint, bigint, text, text, bigint, jsonb) from public, anon, authenticated;

-- 2. record_order_payment: add p_processor_fee_kobo; the customer fee (p_fee_kobo) must not exceed it.
create function public.record_order_payment(
  p_reference text, p_amount_kobo bigint, p_fee_kobo bigint, p_total_kobo bigint, p_currency text, p_status text,
  p_source text, p_event_key text default null, p_paid_at timestamptz default null, p_raw jsonb default '{}'::jsonb,
  p_processor_fee_kobo bigint default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
  it public.catalog_items%rowtype;
  v_reason text;
  v_ent uuid;
  v_start timestamptz := coalesce(p_paid_at, now());
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into o from public.orders where paystack_reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  if p_status is distinct from 'success' then return jsonb_build_object('result', 'not_paid', 'order_id', o.id); end if;
  if o.state in ('paid', 'refunded') and exists (select 1 from public.payments where provider = 'paystack' and provider_reference = p_reference and status = 'success') then
    return jsonb_build_object('result', 'replay', 'order_id', o.id);
  end if;

  v_reason := case
    when p_currency is distinct from 'NGN' then 'currency'
    when p_amount_kobo is distinct from o.amount_kobo then 'amount'
    when p_fee_kobo is null or p_fee_kobo < 0 or p_total_kobo is distinct from p_amount_kobo + p_fee_kobo then 'fee'
    when p_processor_fee_kobo is not null and p_fee_kobo > p_processor_fee_kobo then 'fee'
    else null end;
  if v_reason is not null then
    return private.record_order_mismatch(o, v_reason, p_amount_kobo, p_fee_kobo, p_total_kobo, p_source, p_event_key, p_raw);
  end if;

  insert into public.payments (organisation_id, order_id, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, event_key, raw, verified_at, is_test)
  values (o.organisation_id, o.id, p_reference, p_amount_kobo, p_fee_kobo, p_total_kobo, 'success', p_source, p_event_key, coalesce(p_raw, '{}'), now(), o.is_test)
  on conflict (provider, provider_reference) where status = 'success' do nothing;

  if o.state in ('created', 'failed', 'cancelled') then
    update public.orders set state = 'paid', paid_at = v_start, fee_kobo = p_fee_kobo, total_kobo = p_total_kobo, failure_reason = null where id = o.id;
    if o.state in ('failed', 'cancelled') then
      perform private.order_incident(o.organisation_id, 'order-late-payment:' || o.id, 'A payment arrived for a closed order',
        'Order ' || o.id || ' was ' || o.state || ' when a verified payment arrived. It was honoured as paid.');
    end if;
  end if;

  select * into it from public.catalog_items where id = o.catalog_item_id;
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, is_test)
  values (o.organisation_id, o.beneficiary_patient_id, o.id,
          case it.kind when 'consultation' then 'consultation_credit' else it.kind end, v_start,
          case when it.duration_days is not null then v_start + make_interval(days => it.duration_days) end,
          it.uses, o.is_test)
  on conflict (order_id) do nothing
  returning id into v_ent;

  if v_ent is not null and it.kind = 'membership' then
    update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Lapsed on its end date, closed automatically'
     where patient_id = o.beneficiary_patient_id and state = 'active' and ends_at is not null and ends_at <= now();
    if exists (select 1 from public.patient_memberships where patient_id = o.beneficiary_patient_id and state = 'active') then
      update public.patient_memberships
         set ends_at = greatest(ends_at, v_start) + make_interval(days => it.duration_days)
       where patient_id = o.beneficiary_patient_id and state = 'active' and ends_at is not null;
      perform private.order_incident(o.organisation_id, 'order-membership-overlap:' || o.id, 'A membership was paid for by someone who already had one',
        'Order ' || o.id || ' was paid while the patient already had an active membership. A dated one was extended by the paid period; check whether a refund is due.');
    else
      insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
      values (o.organisation_id, o.beneficiary_patient_id, 'purchase', v_start, v_start + make_interval(days => it.duration_days), o.is_test);
    end if;
  end if;

  if v_ent is not null and it.grants_lead and not exists (select 1 from private.lead_candidates(o.beneficiary_patient_id, '{}', true)) then
    perform private.order_incident(o.organisation_id, 'order-no-lead-slot:' || o.id, 'A paid order has no lead clinician slot',
      'Order ' || o.id || ' was paid but no lead clinician has a free slot. Arrange a lead for this patient.');
  end if;

  perform private.emit_domain_event('order.paid', o.organisation_id,
    jsonb_build_object('order_id', o.id, 'care_pack', it.grants_lead, 'kind', it.kind, 'code', it.code),
    'order:' || o.id, o.beneficiary_patient_id, 'order', o.id);

  if v_ent is not null then perform private.post_order_safely(o.id); end if;

  return jsonb_build_object('result', case when v_ent is null then 'replay' else 'paid' end, 'order_id', o.id, 'entitlement_id', v_ent);
end $$;

-- Service role only (anon's EXECUTE comes through PUBLIC, so revoke from public). Checked live in the closing block below.
revoke all on function public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint) to service_role;
grant execute on function public.flag_order_payment_mismatch(text, text, bigint, bigint, text, text, bigint, jsonb) to service_role;

do $$
begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'record_order_payment') <> 1
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'flag_order_payment_mismatch') <> 1 then
    raise exception 'S25 fix: expected exactly one overload of each payment function';
  end if;
  if has_function_privilege('anon', 'public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.flag_order_payment_mismatch(text, text, bigint, bigint, text, text, bigint, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.flag_order_payment_mismatch(text, text, bigint, bigint, text, text, bigint, jsonb)', 'EXECUTE') then
    raise exception 'S25 fix: a payment writer is executable by a non-service role';
  end if;
  if not has_function_privilege('service_role', 'public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.flag_order_payment_mismatch(text, text, bigint, bigint, text, text, bigint, jsonb)', 'EXECUTE') then
    raise exception 'S25 fix: the service role cannot execute a payment writer';
  end if;
end $$;
