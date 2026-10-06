-- S29b: a gifted care pack waits for the patient's acceptance before any lead clinician is assigned (OQ-191, founder decision
-- 2026-10-06: "yes").
--
-- Pay for a loved one lets a supporter holding pay_for_care buy a care pack or the Membership for a patient. Both grant a lead
-- clinician (order.paid carries care_pack = true), so before this change a gift would have started a lead assignment for someone
-- who had never said yes to it. Now, when the buyer is not the beneficiary and the item grants a lead:
--   * the entitlement is created with acceptance = 'pending' and order.paid carries care_pack = false and gift_pending = true,
--     so the S18 lead handler ignores it;
--   * the patient is told once, neutrally ("someone has paid for a care pack for you, open the app to accept it");
--   * accepting (respond_to_gifted_pack) emits order.paid again under its own idempotency key with care_pack = true, which is
--     what starts the lead assignment, and checks lead capacity then (an incident if there is none);
--   * declining closes the entitlement and opens a finance incident to refund the PAYER (S26 builds refunds). The payer is told
--     nothing: a "they said no" message can cause conflict at home;
--   * a gift nobody answers for gift_decide_days (30, PROPOSED) is treated as declined by an hourly sweep, never left pending
--     for ever.
-- Nothing changes for a patient buying for themselves, or for a gift that does not grant a lead.

alter table public.entitlements
  add column acceptance text not null default 'not_needed' check (acceptance in ('not_needed', 'pending', 'accepted', 'declined')),
  add column decided_at timestamptz;
create index entitlements_gift_pending_idx on public.entitlements (patient_id) where acceptance = 'pending';

-- the whole of record_order_payment, with the three changes marked S29b
create or replace function public.record_order_payment(p_reference text, p_amount_kobo bigint, p_fee_kobo bigint, p_total_kobo bigint, p_currency text, p_status text, p_source text, p_event_key text DEFAULT NULL::text, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_raw jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- S29b (OQ-191): a care pack or membership that someone else paid for waits for the patient's yes before any lead clinician is assigned
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, is_test, acceptance)
  values (o.organisation_id, o.beneficiary_patient_id, o.id,
          case it.kind when 'consultation' then 'consultation_credit' else it.kind end, v_start,
          case when it.duration_days is not null then v_start + make_interval(days => it.duration_days) end,
          it.uses, o.is_test, case when (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead) then 'pending' else 'not_needed' end)
  on conflict (order_id) do nothing
  returning id into v_ent;

  -- S29b: a gifted Membership starts when the patient accepts it, not when it is paid (respond_to_gifted_pack)
  if v_ent is not null and it.kind = 'membership' and not (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead) then
    update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Lapsed on its end date, closed automatically'
     where patient_id = o.beneficiary_patient_id and state = 'active' and ends_at is not null and ends_at <= now();
    if exists (select 1 from public.patient_memberships where patient_id = o.beneficiary_patient_id and state = 'active') then
      -- Already a Member (two orders paid, or a grant landed after this order was made): the payment is honoured, never rolled back.
      -- A dated membership is extended by the paid period; an undated one is left alone. A person is told either way.
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

  -- Capacity is checked when the order is made, not reserved, so a rush can sell more than the free slots. Say so to a person.
  if v_ent is not null and it.grants_lead and not (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead) and not exists (select 1 from private.lead_candidates(o.beneficiary_patient_id, '{}', true)) then
    perform private.order_incident(o.organisation_id, 'order-no-lead-slot:' || o.id, 'A paid order has no lead clinician slot',
      'Order ' || o.id || ' was paid but no lead clinician has a free slot. Arrange a lead for this patient.');
  end if;

  perform private.emit_domain_event('order.paid', o.organisation_id,
    jsonb_build_object('order_id', o.id, 'care_pack', it.grants_lead and not (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead), 'gift_pending', (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead), 'kind', it.kind, 'code', it.code),
    'order:' || o.id, o.beneficiary_patient_id, 'order', o.id);

  if v_ent is not null then perform private.post_order_safely(o.id); end if;

  return jsonb_build_object('result', case when v_ent is null then 'replay' else 'paid' end, 'order_id', o.id, 'entitlement_id', v_ent);
end $function$;

-- The patient is told when someone else's payment lands: a plain notice, or, for a pack that needs a yes, a request to accept it.
create or replace function private.notify_paid_for_you() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_gift boolean;
begin
  if new.state = 'paid' and old.state is distinct from 'paid' and new.buyer_profile_id <> new.beneficiary_patient_id then
    select i.grants_lead into v_gift from public.catalog_items i where i.id = new.catalog_item_id;
    perform private.circle_notify(new.beneficiary_patient_id, new.organisation_id,
                                  case when coalesce(v_gift, false) then 'circle_gift_waiting' else 'circle_paid_for_you' end,
                                  'orders', new.id, array['in_app'], 'routine', new.is_test);
  end if;
  return new;
end $$;

create function public.my_pending_gifts() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('entitlement_id', e.id, 'name_key', i.name_key, 'paid_at', o.paid_at,
           'decide_by', e.created_at + make_interval(days => (private.circle_rules() ->> 'gift_decide_days')::integer)) order by e.created_at), '[]'::jsonb)
    from public.entitlements e
    join public.orders o on o.id = e.order_id
    join public.catalog_items i on i.id = o.catalog_item_id
   where e.patient_id = (select auth.uid()) and e.acceptance = 'pending' and e.state = 'active'
$$;

-- The patient says yes or no to a gift. Only the patient can; replaying a decision changes nothing.
create function public.respond_to_gifted_pack(p_entitlement uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare e public.entitlements%rowtype; o public.orders%rowtype; it public.catalog_items%rowtype;
begin
  select * into e from public.entitlements where id = p_entitlement and patient_id = (select auth.uid()) for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if e.acceptance <> 'pending' or e.state <> 'active' then return jsonb_build_object('result', e.acceptance); end if;
  select * into o from public.orders where id = e.order_id;
  select * into it from public.catalog_items where id = o.catalog_item_id;

  if p_accept then
    -- the pack runs from the day the patient says yes, not the day it was paid
    update public.entitlements set acceptance = 'accepted', decided_at = now(), starts_at = now(),
           ends_at = case when it.duration_days is not null then now() + make_interval(days => it.duration_days) end
     where id = e.id;
    if it.kind = 'membership' then
      update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Lapsed on its end date, closed automatically'
       where patient_id = e.patient_id and state = 'active' and ends_at is not null and ends_at <= now();
      if exists (select 1 from public.patient_memberships where patient_id = e.patient_id and state = 'active') then
        update public.patient_memberships set ends_at = greatest(ends_at, now()) + make_interval(days => it.duration_days)
         where patient_id = e.patient_id and state = 'active' and ends_at is not null;
        perform private.order_incident(o.organisation_id, 'order-membership-overlap:' || o.id, 'A membership was paid for by someone who already had one',
          'Order ' || o.id || ' was accepted while the patient already had an active membership. A dated one was extended by the paid period; check whether a refund is due.');
      else
        insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
        values (o.organisation_id, e.patient_id, 'purchase', now(), now() + make_interval(days => it.duration_days), o.is_test);
      end if;
    end if;
    -- capacity is checked now, when the lead is actually wanted; a person is told if there is no slot
    if not exists (select 1 from private.lead_candidates(e.patient_id, '{}', true)) then
      perform private.order_incident(o.organisation_id, 'order-no-lead-slot:' || o.id, 'A paid order has no lead clinician slot',
        'Order ' || o.id || ' was accepted by the patient but no lead clinician has a free slot. Arrange a lead for this patient.');
    end if;
    perform private.emit_domain_event('order.paid', o.organisation_id,
      jsonb_build_object('order_id', o.id, 'care_pack', it.grants_lead, 'gift_accepted', true, 'kind', it.kind, 'code', it.code),
      'order-accepted:' || o.id, e.patient_id, 'order', o.id);
    return jsonb_build_object('result', 'accepted');
  end if;

  update public.entitlements set acceptance = 'declined', state = 'revoked', decided_at = now() where id = e.id;
  perform private.order_incident(o.organisation_id, 'order-gift-declined:' || o.id, 'A gifted order was declined by the patient',
    'Order ' || o.id || ' was paid for by someone else and the patient declined it. Refund the payer (nothing else was started).');
  return jsonb_build_object('result', 'declined');
end $$;

-- A gift nobody answers is treated as declined after gift_decide_days, never left pending for ever.
create function private.expire_pending_gifts() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select e.id, e.order_id, o.organisation_id from public.entitlements e join public.orders o on o.id = e.order_id
            where e.acceptance = 'pending' and e.state = 'active'
              and e.created_at < now() - make_interval(days => (private.circle_rules() ->> 'gift_decide_days')::integer) loop
    update public.entitlements set acceptance = 'declined', state = 'revoked', decided_at = now() where id = r.id;
    perform private.order_incident(r.organisation_id, 'order-gift-declined:' || r.order_id, 'A gifted order was not answered in time',
      'Order ' || r.order_id || ' was paid for by someone else and the patient did not answer in time. Refund the payer (nothing else was started).');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.expire_pending_gifts() from public, anon, authenticated;
select cron.schedule('care-circle-gift-expiry', '23 * * * *', $$ select private.expire_pending_gifts(); $$);

revoke all on function public.my_pending_gifts() from public, anon;
revoke all on function public.respond_to_gifted_pack(uuid, boolean) from public, anon;
grant execute on function public.my_pending_gifts() to authenticated;
grant execute on function public.respond_to_gifted_pack(uuid, boolean) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.respond_to_gifted_pack(uuid, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_pending_gifts()', 'EXECUTE') then
    raise exception 'anon can execute a gift function';
  end if;
  -- create or replace keeps the old grants, but say so: record_order_payment is for the service role only
  if has_function_privilege('authenticated', 'public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb)', 'EXECUTE') then
    raise exception 'authenticated can record a payment';
  end if;
end $$;
