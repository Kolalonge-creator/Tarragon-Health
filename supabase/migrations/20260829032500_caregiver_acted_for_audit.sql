-- Caregiver Proxy Access, part 6: 23.11's "what they changed" — actually
-- writing it down.
--
-- care_access_events has carried an 'acted_for' lifecycle kind since
-- 20260807010452 and it has never once been written: grep for it across
-- every migration turns up exactly two hits, the CREATE TYPE that defines it
-- and a query filter (my_care_graph's recent-activity feed) that reads it —
-- no caller. A caregiver booking a screening check, requesting a refill,
-- paying a bill, or redeeming somebody else's voucher today leaves no row in
-- the one log a patient has for "what did the person I trusted actually DO
-- with that trust." That is the gap this closes.
--
-- Same shape as every other write to this log: private.log_care_access is
-- exception-guarded (a failed log write must never break a real payment or
-- booking) and self-excluding (it silently no-ops when the actor is the
-- patient themselves, which is exactly right here — every RPC below is
-- reachable by the record owner acting on their own behalf as well as by a
-- caregiver acting for someone else, and only the second case belongs in a
-- DELEGATED access log). So each call below is added unconditionally, right
-- before the function returns, with no extra "was this actually a
-- caregiver" check needed — log_care_access already asks that question
-- itself.
--
-- Each function's body is otherwise byte-identical to the version
-- 20260829013000 just established (sponsor_book_care byte-identical to the
-- self-arranged-sweep version underneath that).

create or replace function public.sponsor_book_care(
  p_beneficiary uuid,
  p_bundle_code text,
  p_facility_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_org    uuid;
  v_bundle uuid;
  v_order  uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not private.can_act_for(p_beneficiary, 'book_appointments'::public.caregiver_permission) then
    raise exception 'you do not have permission to book care for this person'
      using errcode = '42501';
  end if;

  select pb.id into v_bundle
    from public.panel_bundles pb
   where pb.code = p_bundle_code and pb.self_bookable;
  if v_bundle is null then
    raise exception 'that check is not available to request directly' using errcode = '42501';
  end if;

  select organisation_id into v_org from public.profiles where id = p_beneficiary;
  if v_org is null then raise exception 'that person has no organisation on file'; end if;

  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, origin, panel_bundle_id, fulfilment)
  values
    (v_org, p_beneficiary, 'ordered', 0, 'patient_initiated', v_bundle, 'self_arranged')
  returning id into v_order;

  perform private.log_care_access(
    p_beneficiary, 'acted_for', 'booking',
    jsonb_build_object('order_type', 'lab', 'order_id', v_order)
  );

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order,
    'self_arranged', true,
    'paid', false
  );
end;
$function$;

revoke all on function public.sponsor_book_care(uuid, text, uuid) from public;
revoke all on function public.sponsor_book_care(uuid, text, uuid) from anon;
grant execute on function public.sponsor_book_care(uuid, text, uuid) to authenticated;

create or replace function public.sponsor_request_refill(
  p_beneficiary uuid,
  p_medication_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_drug text;
  v_med record;
  v_order_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not private.can_act_for(p_beneficiary, 'manage_pharmacy'::public.caregiver_permission) then
    raise exception 'you do not have permission to act for this person'
      using errcode = '42501';
  end if;

  select m.organisation_id, m.drug_name
    into v_org, v_drug
    from public.medications m
   where m.id = p_medication_id
     and m.patient_id = p_beneficiary
     and m.is_active
     and m.source in ('clinician', 'specialist');

  if v_drug is null then
    raise exception 'that is not a current prescribed medication for this person'
      using errcode = '22023';
  end if;

  select pm.id, pm.drug_name, pm.pack_size, pm.price_kobo, pm.pharmacy_partner_id
    into v_med
    from public.pharmacy_medications pm
    join public.pharmacy_partners pp on pp.id = pm.pharmacy_partner_id
   where pm.drug_name ilike v_drug
     and pm.price_kobo > 0
     and pp.is_active
   order by pm.price_kobo asc
   limit 1;

  if v_med.id is null then
    raise exception 'no pharmacy in the network lists % yet', v_drug
      using errcode = '22023';
  end if;

  select po.id into v_order_id
    from public.pharmacy_orders po
   where po.patient_id = p_beneficiary
     and po.status = 'pending_payment'
     and po.items @> jsonb_build_array(jsonb_build_object('medication_id', v_med.id))
   limit 1;

  if v_order_id is not null then
    return v_order_id;
  end if;

  insert into public.pharmacy_orders (
    organisation_id, patient_id, pharmacy_partner_id, items, total_kobo,
    status, fulfilment_method
  ) values (
    v_org, p_beneficiary, v_med.pharmacy_partner_id,
    jsonb_build_array(jsonb_build_object(
      'medication_id', v_med.id,
      'drug_name', v_med.drug_name,
      'pack_size', v_med.pack_size,
      'price_kobo', v_med.price_kobo,
      'quantity', 1
    )),
    v_med.price_kobo, 'pending_payment', 'pickup'
  ) returning id into v_order_id;

  perform private.log_care_access(
    p_beneficiary, 'acted_for', 'refill_request',
    jsonb_build_object('medication_id', p_medication_id, 'order_id', v_order_id)
  );

  return v_order_id;
end;
$$;

revoke all on function public.sponsor_request_refill(uuid, uuid) from public;
revoke all on function public.sponsor_request_refill(uuid, uuid) from anon;
grant execute on function public.sponsor_request_refill(uuid, uuid) to authenticated;

create or replace function public.sponsor_pay_booking_order(
  p_beneficiary uuid,
  p_order_type text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_wallet  uuid;
  v_total   bigint;
  v_patient uuid;
  v_status  text;
  v_entry   uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_order_type not in ('lab', 'pharmacy', 'referral') then
    raise exception 'unsupported order type %', p_order_type;
  end if;

  if not private.can_act_for(p_beneficiary, 'manage_payments'::public.caregiver_permission) then
    raise exception 'you do not have permission to pay for this person''s care'
      using errcode = '42501';
  end if;

  if p_order_type = 'lab' then
    select patient_id, status::text, total_kobo into v_patient, v_status, v_total
      from public.lab_orders where id = p_order_id for update;
  elsif p_order_type = 'pharmacy' then
    select patient_id, status::text, total_kobo into v_patient, v_status, v_total
      from public.pharmacy_orders where id = p_order_id for update;
  else
    select patient_id, status::text, referral_fee_kobo into v_patient, v_status, v_total
      from public.specialist_referrals where id = p_order_id for update;
  end if;

  if v_patient is null then raise exception 'order not found'; end if;
  if v_patient <> p_beneficiary then
    raise exception 'that order does not belong to the person named' using errcode = '42501';
  end if;
  if v_status <> 'pending_payment' then raise exception 'order is not awaiting payment'; end if;
  if v_total is null or v_total <= 0 then raise exception 'order has no payable amount'; end if;

  v_wallet := private.ensure_wallet(p_beneficiary);

  v_entry := private.wallet_apply(
    v_wallet, -v_total, 'spend', v_caller,
    null, null, null,
    p_order_type::public.commission_type, p_order_id
  );

  if p_order_type = 'lab' then
    update public.lab_orders
       set status = 'payment_confirmed', payment_provider = 'wallet',
           payment_provider_ref = v_entry::text, pending_payment_provider_ref = null
     where id = p_order_id;
  elsif p_order_type = 'pharmacy' then
    update public.pharmacy_orders
       set status = 'payment_confirmed', payment_provider = 'wallet',
           payment_provider_ref = v_entry::text, pending_payment_provider_ref = null
     where id = p_order_id;
  else
    update public.specialist_referrals
       set status = 'payment_confirmed', payment_provider = 'wallet',
           payment_provider_ref = v_entry::text, pending_payment_provider_ref = null
     where id = p_order_id;
  end if;

  perform private.log_care_access(
    p_beneficiary, 'acted_for', 'billing',
    jsonb_build_object('order_type', p_order_type, 'order_id', p_order_id, 'amount_kobo', v_total)
  );

  return jsonb_build_object(
    'ok', true,
    'balance_kobo', (select balance_kobo from public.health_wallets where id = v_wallet)
  );
end;
$$;

revoke all on function public.sponsor_pay_booking_order(uuid, text, uuid) from public;
revoke all on function public.sponsor_pay_booking_order(uuid, text, uuid) from anon;
grant execute on function public.sponsor_pay_booking_order(uuid, text, uuid) to authenticated;

-- sponsor_payable_orders is a read, not an act — 'record_viewed', not
-- 'acted_for', same distinction the care receipt already draws.
create or replace function public.sponsor_payable_orders(p_beneficiary uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller uuid := auth.uid();
  v_result jsonb;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not private.can_act_for(p_beneficiary, 'manage_payments'::public.caregiver_permission) then
    raise exception 'you do not have permission to see this person''s bills'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by (row->>'created_at') desc), '[]'::jsonb)
    into v_result
  from (
    select jsonb_build_object(
             'order_id', lo.id, 'order_type', 'lab', 'label', 'A lab test',
             'amount_kobo', lo.total_kobo, 'created_at', lo.created_at
           ) as row
      from public.lab_orders lo
     where lo.patient_id = p_beneficiary and lo.status = 'pending_payment'
       and lo.total_kobo > 0
    union all
    select jsonb_build_object(
             'order_id', po.id, 'order_type', 'pharmacy', 'label', 'Medication',
             'amount_kobo', po.total_kobo, 'created_at', po.created_at
           )
      from public.pharmacy_orders po
     where po.patient_id = p_beneficiary and po.status = 'pending_payment'
       and po.total_kobo > 0
    union all
    select jsonb_build_object(
             'order_id', sr.id, 'order_type', 'referral', 'label', 'A specialist referral',
             'amount_kobo', sr.referral_fee_kobo, 'created_at', sr.created_at
           )
      from public.specialist_referrals sr
     where sr.patient_id = p_beneficiary and sr.status = 'pending_payment'
       and sr.referral_fee_kobo > 0
    union all
    select jsonb_build_object(
             'order_id', vv.id, 'order_type', 'video_visit', 'label', 'A video visit with a doctor',
             'amount_kobo', vv.amount_minor, 'created_at', vv.created_at
           )
      from public.video_visit_requests vv
     where vv.patient_id = p_beneficiary and vv.status = 'pending_payment'
       and vv.amount_minor > 0
  ) rows;

  perform private.log_care_access(p_beneficiary, 'record_viewed', 'billing');

  return v_result;
end;
$$;

revoke all on function public.sponsor_payable_orders(uuid) from public;
revoke all on function public.sponsor_payable_orders(uuid) from anon;
grant execute on function public.sponsor_payable_orders(uuid) to authenticated;

-- redeem_care_voucher: only the third-party branch reaches log_care_access
-- in practice — a self-redeem has v_caller = beneficiary, and
-- log_care_access already no-ops whenever the actor is the patient, so no
-- extra guard is needed here to keep a patient's own redemption out of a
-- DELEGATED access log.
create or replace function public.redeem_care_voucher(
  p_voucher uuid,
  p_order_type text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_v       public.care_vouchers%rowtype;
  v_patient uuid;
  v_status  text;
  v_payable bigint;
  v_bundle  uuid;
  v_covered bigint;
  v_fully   boolean;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_order_type not in ('lab', 'pharmacy', 'referral') then
    raise exception 'unsupported order type %', p_order_type;
  end if;

  select * into v_v from public.care_vouchers where id = p_voucher for update;
  if not found then raise exception 'voucher not found'; end if;

  if v_v.beneficiary_profile_id <> v_caller
     and not private.can_act_for(v_v.beneficiary_profile_id, 'manage_payments'::public.caregiver_permission) then
    raise exception 'This voucher is not yours to use' using errcode = '42501';
  end if;

  if v_v.status = 'redeemed' then raise exception 'This voucher has already been used'; end if;
  if v_v.status = 'expired' then raise exception 'This voucher has expired'; end if;
  if v_v.status = 'cancelled' then raise exception 'This voucher was cancelled'; end if;
  if v_v.status = 'reserved' then
    raise exception 'This voucher is not paid for yet — % of % paid',
      (v_v.amount_paid_kobo / 100)::text, (v_v.face_value_kobo / 100)::text;
  end if;
  if v_v.expires_at is not null and v_v.expires_at <= now() then
    raise exception 'This voucher expired on %', to_char(v_v.expires_at, 'DD Mon YYYY');
  end if;

  if p_order_type = 'lab' then
    select patient_id, status::text, payable_kobo, panel_bundle_id
      into v_patient, v_status, v_payable, v_bundle
      from public.lab_orders where id = p_order_id for update;
  elsif p_order_type = 'pharmacy' then
    select patient_id, status::text, payable_kobo, null::uuid
      into v_patient, v_status, v_payable, v_bundle
      from public.pharmacy_orders where id = p_order_id for update;
  else
    select patient_id, status::text, payable_kobo, null::uuid
      into v_patient, v_status, v_payable, v_bundle
      from public.specialist_referrals where id = p_order_id for update;
  end if;

  if v_patient is null then raise exception 'order not found'; end if;

  if v_patient <> v_v.beneficiary_profile_id then
    raise exception 'This voucher can only be used for %s own care',
      (select coalesce(full_name, 'its beneficiary') from public.profiles where id = v_v.beneficiary_profile_id)
      using errcode = '42501';
  end if;
  if v_status <> 'pending_payment' then raise exception 'that order is not awaiting payment'; end if;
  if v_payable is null or v_payable <= 0 then raise exception 'that order has nothing left to pay'; end if;

  if v_v.kind = 'prepaid_service' then
    if p_order_type <> 'lab' then
      raise exception 'A % voucher can only be used for the service it was bought for', v_v.sku_name;
    end if;
    if v_bundle is distinct from v_v.panel_bundle_id then
      raise exception 'This voucher is for %, so it cannot pay for a different service', v_v.sku_name;
    end if;
    v_covered := v_payable;
  else
    v_covered := least(v_v.face_value_kobo, v_payable);
  end if;

  v_fully := (v_payable - v_covered) <= 0;

  if p_order_type = 'lab' then
    update public.lab_orders
       set voucher_covered_kobo = voucher_covered_kobo + v_covered,
           applied_voucher_id = v_v.id,
           status = case when v_fully then 'payment_confirmed'::public.lab_order_status else status end,
           payment_provider = case when v_fully then 'voucher'::public.payment_provider else payment_provider end,
           payment_provider_ref = case when v_fully then v_v.voucher_number else payment_provider_ref end,
           pending_payment_provider_ref = case when v_fully then null else pending_payment_provider_ref end
     where id = p_order_id;
  elsif p_order_type = 'pharmacy' then
    update public.pharmacy_orders
       set voucher_covered_kobo = voucher_covered_kobo + v_covered,
           applied_voucher_id = v_v.id,
           status = case when v_fully then 'payment_confirmed'::public.pharmacy_order_status else status end,
           payment_provider = case when v_fully then 'voucher'::public.payment_provider else payment_provider end,
           payment_provider_ref = case when v_fully then v_v.voucher_number else payment_provider_ref end,
           pending_payment_provider_ref = case when v_fully then null else pending_payment_provider_ref end
     where id = p_order_id;
  else
    update public.specialist_referrals
       set voucher_covered_kobo = voucher_covered_kobo + v_covered,
           applied_voucher_id = v_v.id,
           status = case when v_fully then 'payment_confirmed'::public.referral_status else status end,
           payment_provider = case when v_fully then 'voucher'::public.payment_provider else payment_provider end,
           payment_provider_ref = case when v_fully then v_v.voucher_number else payment_provider_ref end,
           pending_payment_provider_ref = case when v_fully then null else pending_payment_provider_ref end
     where id = p_order_id;
  end if;

  update public.care_vouchers
     set status = 'redeemed', redeemed_at = now(),
         redeemed_order_type = p_order_type::public.commission_type,
         redeemed_order_id = p_order_id
   where id = v_v.id;

  insert into public.care_voucher_events
    (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
  values
    (v_v.organisation_id, v_v.id, 'redeemed', v_caller, v_covered,
     case when v_v.kind = 'prepaid_service'
          then 'Used for ' || coalesce(v_v.sku_name, 'the service it was bought for')
          else 'Applied as a discount' end);

  perform private.log_care_access(
    v_v.beneficiary_profile_id, 'acted_for', 'billing',
    jsonb_build_object('order_type', p_order_type, 'order_id', p_order_id, 'voucher_id', v_v.id, 'covered_kobo', v_covered)
  );

  return jsonb_build_object(
    'ok', true,
    'covered_kobo', v_covered,
    'fully_covered', v_fully,
    'remaining_payable_kobo', greatest(v_payable - v_covered, 0)
  );
end;
$$;

revoke all on function public.redeem_care_voucher(uuid, text, uuid) from public;
revoke all on function public.redeem_care_voucher(uuid, text, uuid) from anon;
grant execute on function public.redeem_care_voucher(uuid, text, uuid) to authenticated;

-- start_care_thread: a supporter opening a thread is also "acting for" the
-- person they support, same log, scope 'messaging' (already in the fixed
-- vocabulary — care_receipt's own recent-activity read already expects it
-- there).
create or replace function public.start_care_thread(
  p_subject text,
  p_body text,
  p_patient_id uuid default null,
  p_escalation_id uuid default null,
  p_care_plan_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
  v_thread_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if length(coalesce(trim(p_subject), '')) = 0 then raise exception 'subject required'; end if;
  if length(coalesce(trim(p_body), '')) = 0 then raise exception 'message required'; end if;

  if p_patient_id is not null then
    select organisation_id into v_org from public.profiles where id = p_patient_id;
    v_patient := p_patient_id;
    if v_org is null
       or not (private.is_org_staff(v_org)
               or private.can_read_clinical(p_patient_id, 'communicate_with_care_team'::public.caregiver_permission)) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
  else
    select organisation_id into v_org from public.profiles where id = v_uid;
    v_patient := v_uid;
  end if;
  if v_org is null then raise exception 'no organisation'; end if;

  insert into public.care_message_threads
    (organisation_id, patient_id, subject, created_by, escalation_id, care_plan_id)
  values (v_org, v_patient, trim(p_subject), v_uid, p_escalation_id, p_care_plan_id)
  returning id into v_thread_id;

  insert into public.care_messages (thread_id, body) values (v_thread_id, trim(p_body));

  perform private.log_care_access(v_patient, 'acted_for', 'messaging', jsonb_build_object('thread_id', v_thread_id));

  return v_thread_id;
end;
$$;

revoke execute on function public.start_care_thread(text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.start_care_thread(text, text, uuid, uuid, uuid) to authenticated;

-- The migration is the test.
do $$
declare
  v_org uuid;
  v_a uuid;
  v_b uuid;
  v_bundle uuid;
  v_count int;
begin
  if pg_get_functiondef('public.sponsor_book_care(uuid,text,uuid)'::regprocedure) not like '%log_care_access%'
     or pg_get_functiondef('public.sponsor_request_refill(uuid,uuid)'::regprocedure) not like '%log_care_access%'
     or pg_get_functiondef('public.sponsor_pay_booking_order(uuid,text,uuid)'::regprocedure) not like '%log_care_access%'
     or pg_get_functiondef('public.sponsor_payable_orders(uuid)'::regprocedure) not like '%log_care_access%'
     or pg_get_functiondef('public.redeem_care_voucher(uuid,text,uuid)'::regprocedure) not like '%log_care_access%'
     or pg_get_functiondef('public.start_care_thread(text,text,uuid,uuid,uuid)'::regprocedure) not like '%log_care_access%' then
    raise exception 'a caregiver-acting RPC does not call log_care_access — 23.11 "what they changed" is not covered';
  end if;

  select id into v_org from public.organisations limit 1;
  select id into v_a from public.profiles where organisation_id = v_org limit 1;
  select id into v_b from public.profiles where organisation_id = v_org and id <> v_a limit 1;
  select id into v_bundle from public.panel_bundles where self_bookable limit 1;
  if v_org is null or v_a is null or v_b is null or v_bundle is null then
    raise warning 'skipping behavioural assertion: need an org, two profiles, and a self_bookable panel_bundle';
    return;
  end if;

  delete from public.profile_access where profile_id = v_a and grantee_user_id = v_b;
  alter table public.care_access_events disable trigger care_access_events_no_update;
  delete from public.care_access_events where patient_id = v_a;
  alter table public.care_access_events enable trigger care_access_events_no_update;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_a, v_b, 'manage', v_a);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.sponsor_book_care(v_a, (select code from public.panel_bundles where id = v_bundle));
  reset role;

  select count(*) into v_count
    from public.care_access_events
   where patient_id = v_a and subject_profile_id = v_b and kind = 'acted_for' and scope = 'booking';
  if v_count <> 1 then
    raise exception 'sponsor_book_care did not leave exactly one acted_for/booking audit row, found %', v_count;
  end if;

  alter table public.care_access_events disable trigger care_access_events_no_update;
  delete from public.care_access_events where patient_id = v_a;
  alter table public.care_access_events enable trigger care_access_events_no_update;
  delete from public.profile_access where profile_id = v_a and grantee_user_id = v_b;
end $$;
