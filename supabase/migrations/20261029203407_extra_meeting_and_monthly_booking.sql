-- Extra online meeting (5,000 naira, paid members only) and the coordinator booking a Member's monthly meeting.
--
-- Founder decision 2026-10-29: Membership includes one online meeting a month. A Member can ask for an extra meeting any time in the app
-- and pays 5,000 naira for it. The patient must be a paid Member. This partly reverses the 2026-10-12 two-tier rule that no doctor-time
-- product is for sale: video_visit_credit is switched back on, at 500,000 kobo, and is Members-only exactly as the second opinion is.
--
-- 1. service_products_doctor_time_not_sellable allows video_visit_credit (added to the same exception list as the second opinion), and
--    the product is switched on, repriced from 1,000,000 to 500,000 kobo and named for what it is. LIVE COUNTS BEFORE (local replay of
--    main-dev, same as live): video_visit_credit is_active = false, no pending purchases; credits already held stay redeemable.
-- 2. Members only. A BEFORE INSERT trigger on service_purchases refuses a pending_payment purchase of it for a patient who is not a
--    Member (fail closed), the same shape as service_purchases_second_opinion_members_only. It fires only on pending_payment (a purchase
--    being sold), so a credit granted by hand or one that already exists is untouched. record_service_purchase_intent is not redefined:
--    it inserts the pending purchase, which the trigger refuses with the Membership message.
-- 3. public_price_list hides it, like the second opinion: it is not on sale to the public.
-- 4. hold_appointment_slot (redefined from its LIVE body): the Membership requirement for a paid appointment now applies to the patient
--    booking for themselves, someone acting for them, a coordinator and staff. It was coordinator-only in the first phone booking release.
--    A patient with an unspent credit for the item is let through.
-- 5. The included monthly meeting is booked from times the doctor has offered. pick_followup_slot and my_followups (both redefined from
--    their LIVE bodies) now also admit a care coordinator of the patient's own organisation, through private.is_care_coordinator_for.
--    Everything else those functions check (Member, entitlement, hold, confirm, waived payment) is unchanged. A read of someone else's
--    monthly meeting through my_followups now leaves a care-access line (one per hour, best effort).
-- 6. Two other routes read the same product and must not become a way round the rule (found in review): the older video-visit request
--    path (private.pin_video_visit_amount, a BEFORE INSERT trigger on video_visit_requests, takes its price from the product and used to
--    refuse because the product was off) now also refuses a non-Member; and create_sponsored_service_reservation, where a sponsor names
--    the recipient by phone number so Membership cannot be checked, refuses this product outright.

alter table public.service_products drop constraint if exists service_products_doctor_time_not_sellable;
alter table public.service_products add constraint service_products_doctor_time_not_sellable
  check (code !~ '(_credit$|^verified_document|^chronic_doctor_supported_pack$|^written_result_interpretation$|^preventive_health_check_review$|^ai_coach_daily_pass_30d$|^continuous_monitoring_)' or not is_active
         or code = any (array['second_opinion_credit', 'dietitian_consult_credit', 'pharmacist_consult_credit', 'video_visit_credit']));

update public.service_products
   set is_active = true, price_kobo = 500000, name = 'Extra online meeting'
 where code = 'video_visit_credit';

create or replace function private.extra_meeting_members_only()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_code text; v_member boolean;
begin
  select p.code into v_code from public.service_products p where p.id = new.service_product_id;
  if v_code is distinct from 'video_visit_credit' then return new; end if;
  begin
    v_member := coalesce(private.patient_is_member(new.patient_id), false);
  exception when others then
    v_member := false;   -- fail closed
  end;
  if not v_member then
    raise exception 'An extra online meeting is part of Membership. Join to add one.' using errcode = 'P0001', detail = 'MEMBERSHIP_REQUIRED';
  end if;
  return new;
end $function$;
revoke all on function private.extra_meeting_members_only() from public;

drop trigger if exists service_purchases_extra_meeting_members_only on public.service_purchases;
create trigger service_purchases_extra_meeting_members_only
  before insert on public.service_purchases
  for each row when (new.status = 'pending_payment')
  execute function private.extra_meeting_members_only();

create or replace function private.is_care_coordinator_for(p_patient uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select exists (
    select 1
      from public.profiles c
      join public.profiles p on p.organisation_id = c.organisation_id
     where c.id = (select auth.uid())
       and c.role = 'care_coordinator'
       and c.is_active
       and p.id = p_patient
       and p.role = 'patient'
  );
$function$;
revoke all on function private.is_care_coordinator_for(uuid) from public;

CREATE OR REPLACE FUNCTION public.public_price_list()
 RETURNS TABLE(code text, currency currency, access_duration_days integer, price_minor bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.code, p.currency, p.access_duration_days, p.price_kobo
  from public.service_products p
  where p.is_active and p.code not in ('second_opinion_credit', 'video_visit_credit');
$function$;

CREATE OR REPLACE FUNCTION public.hold_appointment_slot(p_organisation_id uuid, p_clinician_id uuid, p_appointment_type appointment_type, p_consultation_method appointment_consultation_method, p_scheduled_for timestamp with time zone, p_ends_at timestamp with time zone, p_reason text DEFAULT NULL::text, p_service text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_specialist_referral_id uuid DEFAULT NULL::uuid, p_care_plan_id uuid DEFAULT NULL::uuid, p_patient_id uuid DEFAULT NULL::uuid, p_hold_minutes integer DEFAULT 10)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  v_org uuid;
  v_is_high_priority boolean := false;
  v_payment_status public.appointment_payment_status;
  v_result public.appointments;
  v_caller_role public.user_role;
  v_via text;
  v_hold_minutes integer := p_hold_minutes;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_patient := coalesce(p_patient_id, v_uid);
  select organisation_id, role into v_org, v_caller_role from public.profiles where id = v_uid;
  if v_org is distinct from p_organisation_id then
    raise exception 'not authorized for this organisation';
  end if;
  if v_patient <> v_uid
     and not private.is_org_staff(p_organisation_id)
     and not private.can_act_for(v_patient, 'book_appointments'::public.caregiver_permission) then
    raise exception 'only staff, or someone with permission to book appointments for this person, may book on their behalf';
  end if;

  v_via := case
    when v_patient = v_uid then 'self'
    when v_caller_role = 'care_coordinator' then 'coordinator_phone'
    when private.is_org_staff(p_organisation_id) then 'staff'
    else 'caregiver'
  end;

  v_payment_status := case p_appointment_type
    when 'telemedicine' then 'pending'
    when 'result_interpretation' then 'pending'
    when 'dietitian' then 'pending'      -- S64
    when 'pharmacist' then 'pending'     -- S64
    else 'not_required'
  end;

  -- Coordinator phone booking: the patient must be a patient of this organisation, and an item that has to be paid for
  -- is for members only (founder decision 2026-10-29: a Free patient upgrades first). Checked before the slot rules so
  -- the refusal does not depend on what is open.
  if v_via = 'coordinator_phone' then
    if not exists (select 1 from public.profiles
                    where id = v_patient and role = 'patient' and organisation_id = p_organisation_id) then
      raise exception 'that person is not a patient of this organisation' using errcode = 'P0001';
    end if;
    -- a phone call takes longer than a screen
    v_hold_minutes := greatest(p_hold_minutes, 30);
  end if;

  -- S37 (INV-14): consultations stay closed until the clinical_operations_enabled guard is on (a test patient with a test clinician passes).
  -- A consultation is any remote clinician appointment: the two consultation types, or any type booked with the telemedicine method.
  if (p_appointment_type in ('telemedicine', 'result_interpretation') or p_consultation_method = 'telemedicine')
     and not private.go_live_open('clinical_operations_enabled', v_patient, p_clinician_id) then
    raise exception 'consultations are not open yet' using errcode = 'P0001', hint = 'go_live_guard:clinical_operations_enabled';
  end if;

  -- S21 (OQ-129): a remote consultation is for adults only; fail closed when the age is unknown
  if p_consultation_method = 'telemedicine' then
    perform private.assert_adult_for_consultation(v_patient);
  end if;

  -- An extra meeting is for paid members (founder decision 2026-10-29), for whoever is booking it: the patient, someone acting for them,
  -- a coordinator on a call, or staff. A patient who already holds an unspent credit for the item needs no new purchase and is let through.
  -- Staff are held to it too: a staff booking for a Free patient could never be paid and nothing would release it. Checked before the slot
  -- rules so the refusal does not depend on what is open. After the go-live guard and the adult check: while consultations are closed,
  -- or for a minor, that is what everyone is told.
  if v_payment_status = 'pending'
     and private.patient_membership_tier(v_patient) is null
     and not private.has_available_service_credit(v_patient, private.booking_product_code(p_appointment_type::text)) then
    raise exception '%', case when v_patient = v_uid
                              then 'You need to join Membership before an extra meeting can be booked'
                              else 'This patient needs to join Membership before an extra meeting can be booked' end
      using errcode = 'P0001', hint = 'upgrade_first';
  end if;

  -- S64 (Q23): a dietitian or pharmacist visit is a remote consultation priced per item. It is closed while its product is inactive or
  -- unpriced, and it is booked only with a clinician of that role (and a doctor visit only with a doctor).
  if p_appointment_type in ('dietitian', 'pharmacist') then
    if p_consultation_method <> 'telemedicine' then
      raise exception 'that visit is booked as a remote consultation' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.service_products sp
                    where sp.code = private.booking_product_code(p_appointment_type::text) and sp.is_active and sp.price_kobo > 0) then
      raise exception 'that visit cannot be booked yet' using errcode = 'P0001', hint = 'product_not_priced';
    end if;
  end if;
  if p_appointment_type in ('telemedicine', 'dietitian', 'pharmacist')
     and not private.clinician_matches_booking_type(p_clinician_id, p_appointment_type::text) then
    raise exception 'that clinician is not available for this kind of visit' using errcode = 'P0001';
  end if;

  -- S21 (OQ-124): a consultation is booked only from time the clinician has declared and the rota has confirmed
  -- (S64: the same single source of open time serves the dietitian and pharmacist visits)
  if p_appointment_type in ('telemedicine', 'dietitian', 'pharmacist') and not private.slot_is_open(p_clinician_id, v_patient, p_scheduled_for, p_ends_at) then
    raise exception 'that time is not open for consultations: pick another slot' using errcode = 'P0001';
  end if;

  if p_scheduled_for <= now() then
    raise exception 'that time has passed — pick another slot';
  end if;
  if p_ends_at <= p_scheduled_for then
    raise exception 'invalid time range';
  end if;

  if p_specialist_referral_id is not null then
    select (urgency in ('urgent', 'priority')) into v_is_high_priority
    from public.specialist_referrals
    where id = p_specialist_referral_id and organisation_id = p_organisation_id;
  end if;

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, reason, service, location,
      specialist_referral_id, care_plan_id, booked_by, is_high_priority, hold_expires_at,
      payment_status, booked_via
    ) values (
      p_organisation_id, v_patient, p_clinician_id, p_appointment_type, p_consultation_method,
      p_scheduled_for, p_ends_at, 'held', p_reason, p_service, p_location,
      p_specialist_referral_id, p_care_plan_id, v_uid, coalesce(v_is_high_priority, false),
      now() + (v_hold_minutes * interval '1 minute'),
      v_payment_status, v_via
    )
    returning * into v_result;
  exception
    when exclusion_violation then
      raise exception 'that time was just taken — pick another slot';
  end;

  if v_patient <> v_uid then
    perform private.log_care_access(v_patient, 'acted_for', 'booking',
      jsonb_build_object('appointment_id', v_result.id, 'stage', 'held', 'booked_via', v_via));
  end if;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pick_followup_slot(p_slot uuid, p_ask_longer boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  sl public.followup_offer_slots;
  o public.followup_offers;
  en public.member_followup_entitlements;
  cfg jsonb := private.followup_setting('offers');
  v_appt public.appointments;
  v_msg text;
  v_state text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into sl from public.followup_offer_slots where id = p_slot;
  if sl.id is null then raise exception 'time not found' using errcode = '42501'; end if;
  select * into o from public.followup_offers where id = sl.offer_id for update;
  if not (o.patient_id = v_uid or private.can_act_for(o.patient_id, 'book_appointments'::public.caregiver_permission)
          or private.is_care_coordinator_for(o.patient_id)) then
    raise exception 'time not found' using errcode = '42501';
  end if;
  -- re-read the slot under the offer lock
  select * into sl from public.followup_offer_slots where id = p_slot for update;

  if o.status = 'open' and o.expires_at <= now() then
    update public.followup_offers set status = 'expired', closed_at = now(), closed_reason = 'expired' where id = o.id;
    update public.followup_offer_slots set state = 'expired' where offer_id = o.id and state = 'offered';
    return jsonb_build_object('status', 'expired');
  end if;
  if o.status <> 'open' then return jsonb_build_object('status', o.status); end if;
  if sl.state <> 'offered' then return jsonb_build_object('status', 'unavailable'); end if;
  if not private.patient_is_member(o.patient_id) then
    raise exception 'monthly check-ins are part of Membership' using errcode = 'P0001';
  end if;
  select * into en from public.member_followup_entitlements where id = o.entitlement_id for update;
  if en.state <> 'available' then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- the live hold: 10 minutes, the grid, the age gate, the go-live guard and the no-overlap constraint all apply
  begin
    v_appt := public.hold_appointment_slot(
      o.organisation_id, o.clinician_id, 'telemedicine'::public.appointment_type, 'telemedicine'::public.appointment_consultation_method,
      sl.starts_at, sl.ends_at, 'Monthly check-in', null, null, null, null, o.patient_id,
      coalesce((cfg ->> 'holdMinutes')::integer, 10));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    if v_msg like '%just taken%' or v_msg like '%not open for consultations%' or v_msg like '%has passed%' then
      update public.followup_offer_slots set state = 'taken' where id = sl.id;
      return jsonb_build_object('status', 'unavailable');
    end if;
    raise;
  end;

  update public.followup_offers
     set status = 'picked', picked_slot_id = sl.id, appointment_id = v_appt.id, closed_at = now(), closed_reason = 'picked',
         longer_requested = longer_requested or coalesce(p_ask_longer, false)
   where id = o.id;
  update public.followup_offer_slots set state = 'picked' where id = sl.id;
  update public.followup_offer_slots set state = 'released' where offer_id = o.id and id <> sl.id and state = 'offered';
  -- covered by the monthly entitlement: no paid consultation credit is spent
  update public.appointments set payment_status = 'waived' where id = v_appt.id;
  -- confirm (the live function): creates the encounter and room, stamps the call length (trigger), queues the booking confirmation
  v_appt := public.confirm_appointment_booking(v_appt.id);
  update public.member_followup_entitlements set state = 'booked', appointment_id = v_appt.id, updated_at = now() where id = en.id;

  -- the doctor's other offers that held this same time no longer have it
  update public.followup_offer_slots s set state = 'taken'
   where s.clinician_id = o.clinician_id and s.state = 'offered' and s.offer_id <> o.id
     and tstzrange(s.starts_at, s.ends_at, '[)') && tstzrange(sl.starts_at, sl.ends_at, '[)');
  update public.followup_offers x set status = 'expired', closed_at = now(), closed_reason = 'times_taken'
   where x.clinician_id = o.clinician_id and x.status = 'open'
     and not exists (select 1 from public.followup_offer_slots s2 where s2.offer_id = x.id and s2.state = 'offered');

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (o.organisation_id, o.clinician_id, 'in_app', 'pending', 'followup_slot_picked', jsonb_build_object('offer_id', o.id), 'non_clinical');

  return jsonb_build_object('status', 'booked', 'appointment_id', v_appt.id, 'starts_at', v_appt.scheduled_for, 'ends_at', v_appt.ends_at,
                            'minutes', o.call_minutes,
                            'encounter_id', (select e.id from public.encounters e where e.appointment_id = v_appt.id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.my_followups(p_patient uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid;
  v_ent jsonb;
  v_offers jsonb;
begin
  if v_uid is null then return jsonb_build_object('entitlement', null, 'offers', '[]'::jsonb); end if;
  v_subject := coalesce(p_patient, v_uid);
  if v_subject <> v_uid and not private.can_act_for(v_subject, 'book_appointments'::public.caregiver_permission)
     and not private.is_care_coordinator_for(v_subject) then
    return jsonb_build_object('entitlement', null, 'offers', '[]'::jsonb);
  end if;

  if v_subject <> v_uid then
    perform private.log_care_access(v_subject, 'record_viewed', 'booking', jsonb_build_object('stage', 'monthly_offers'));
  end if;

  select jsonb_build_object(
           'current', (select jsonb_build_object('month_index', e.month_index, 'state', e.state, 'period_end', e.period_end,
                                                   'appointment_id', e.appointment_id,
                                                   'encounter_id', (select en.id from public.encounters en where en.appointment_id = e.appointment_id))
                         from public.member_followup_entitlements e
                        where e.patient_id = v_subject and e.period_start <= now() and e.period_end > now() and e.state <> 'voided'
                        order by e.period_start desc limit 1),
           'consumed', (select count(*) from public.member_followup_entitlements e where e.patient_id = v_subject and e.state = 'consumed'),
           'lapsed', (select count(*) from public.member_followup_entitlements e where e.patient_id = v_subject and e.state = 'lapsed'),
           'remaining', (select count(*) from public.member_followup_entitlements e
                          where e.patient_id = v_subject and e.state in ('available', 'booked') and e.period_end > now()))
    into v_ent;

  select coalesce(jsonb_agg(jsonb_build_object(
           'offer_id', o.id, 'expires_at', o.expires_at, 'call_minutes', o.call_minutes, 'kind', o.kind,
           'longer_requested', o.longer_requested,
           'slots', (select coalesce(jsonb_agg(jsonb_build_object('slot_id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at) order by s.starts_at), '[]'::jsonb)
                       from public.followup_offer_slots s
                      where s.offer_id = o.id and s.state = 'offered'
                        and s.starts_at > now()
                        and private.slot_is_open(s.clinician_id, s.patient_id, s.starts_at, s.ends_at)
                        and not private.followup_slot_clash(s.clinician_id, s.starts_at, s.ends_at))
         ) order by o.created_at), '[]'::jsonb)
    into v_offers
    from public.followup_offers o
   where o.patient_id = v_subject and o.status = 'open' and o.expires_at > now();

  return jsonb_build_object('entitlement', v_ent, 'offers', v_offers);
end;
$function$;

CREATE OR REPLACE FUNCTION private.pin_video_visit_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_price record;
begin
  select p.amount_minor, p.currency, p.is_enabled into v_price
  from (
    select amount_minor, currency, is_enabled, 0 as pri
    from public.video_visit_prices where organisation_id = new.organisation_id
    union all
    select price_kobo as amount_minor, currency::text as currency, is_active as is_enabled, 1
    from public.service_products where code = 'video_visit_credit'
    union all
    select amount_minor, currency, is_enabled, 2
    from public.video_visit_prices where organisation_id is null
  ) p
  order by p.pri
  limit 1;

  if v_price.amount_minor is null or not v_price.is_enabled then
    raise exception 'video visits are not available right now';
  end if;
  -- An extra online meeting is for paid Members (decision 2026-10-29), by whichever route it is asked for.
  if not coalesce(private.patient_is_member(new.patient_id), false) then
    raise exception 'An extra online meeting is part of Membership. Join to add one.' using errcode = 'P0001', detail = 'MEMBERSHIP_REQUIRED';
  end if;
  new.amount_minor := v_price.amount_minor;
  new.currency := v_price.currency;
  new.status := 'requested';
  new.origin := 'patient_initiated';
  new.payment_provider := null;
  new.payment_provider_ref := null;
  new.pending_payment_provider_ref := null;
  new.refund_status := null;
  new.refund_ref := null;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_sponsored_service_reservation(p_service_product_id uuid, p_recipient_phone text, p_recipient_first_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := (select auth.uid());
  v_org uuid;
  v_product record;
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select organisation_id into v_org from public.profiles where id = v_caller;
  if v_org is null then
    raise exception 'sponsor has no organisation' using errcode = '23514';
  end if;

  select id, code, currency, price_kobo, is_active
    into v_product
    from public.service_products
   where id = p_service_product_id;

  if v_product.id is null or not v_product.is_active then
    raise exception 'that service is not available' using errcode = '23514';
  end if;
  if v_product.code = 'video_visit_credit' then
    raise exception 'an extra online meeting can only be bought by a Member for themselves' using errcode = '23514';
  end if;
  if v_product.currency <> 'NGN' then
    raise exception 'reservations only support naira-priced services' using errcode = '23514';
  end if;

  if p_recipient_phone !~ '^\+[1-9]\d{7,14}$' then
    raise exception 'recipient phone must be E.164, e.g. +2348012345678' using errcode = '23514';
  end if;
  if length(trim(p_recipient_first_name)) = 0 then
    raise exception 'recipient first name is required' using errcode = '23514';
  end if;

  insert into public.sponsored_service_reservations (
    organisation_id, service_product_id, sponsor_profile_id,
    recipient_phone, recipient_first_name, amount_kobo, currency
  ) values (
    v_org, p_service_product_id, v_caller,
    p_recipient_phone, trim(p_recipient_first_name), v_product.price_kobo, v_product.currency
  ) returning id into v_id;

  perform private.log_audit(
    'sponsored_service_reservation.created', 'sponsored_service_reservation', v_id,
    jsonb_build_object('service_product_id', p_service_product_id, 'amount_kobo', v_product.price_kobo)
  );

  return v_id;
end;
$function$;

do $$
begin
  if pg_get_functiondef('private.pin_video_visit_amount()'::regprocedure) not like '%MEMBERSHIP_REQUIRED%'
     or pg_get_functiondef('public.create_sponsored_service_reservation(uuid,text,text)'::regprocedure) not like '%video_visit_credit%' then
    raise exception 'the video-visit request path or the sponsor reservation was not updated';
  end if;
  if pg_get_functiondef('public.my_followups(uuid)'::regprocedure) not like '%monthly_offers%' then
    raise exception 'my_followups does not audit a read of someone else''s monthly meeting';
  end if;
  if not exists (select 1 from public.service_products where code = 'video_visit_credit' and is_active and price_kobo = 500000) then
    raise exception 'video_visit_credit is not on sale at 500000 kobo';
  end if;
  if pg_get_functiondef('public.hold_appointment_slot(uuid,uuid,appointment_type,appointment_consultation_method,timestamptz,timestamptz,text,text,text,uuid,uuid,uuid,integer)'::regprocedure) not like '%upgrade_first%' then
    raise exception 'hold_appointment_slot was not updated';
  end if;
  if pg_get_functiondef('public.pick_followup_slot(uuid,boolean)'::regprocedure) not like '%is_care_coordinator_for%'
     or pg_get_functiondef('public.my_followups(uuid)'::regprocedure) not like '%is_care_coordinator_for%' then
    raise exception 'the monthly meeting functions were not updated';
  end if;
  if exists (select 1 from public.public_price_list() where code in ('video_visit_credit', 'second_opinion_credit')) then
    raise exception 'a members-only product is on the public price list';
  end if;
  if has_function_privilege('anon', 'private.is_care_coordinator_for(uuid)', 'EXECUTE') then
    raise exception 'is_care_coordinator_for must not be executable by anon';
  end if;
end $$;
