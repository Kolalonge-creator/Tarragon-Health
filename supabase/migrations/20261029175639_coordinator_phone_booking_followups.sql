-- Coordinator phone booking, follow-ups (founder's review of PR #1409).
--
-- 1. A Free patient who ALREADY holds an unspent credit for the item (typically one a relative bought) can be booked for it: nothing
--    is being sold, the credit is simply spent when the booking confirms. With no such credit a Free patient is still refused
--    (upgrade first). private.has_available_service_credit mirrors redeem_available_service_purchase's own predicate exactly
--    (active, not redeemed, not expired), so the gate and the spend cannot disagree.
-- 2. The Paystack link a coordinator makes is kept with the pending purchase (pending_payment_checkout_url), so a lost link is shown
--    again instead of replaced: Paystack cannot cancel a started transaction, so a second link could take a payment that matches no
--    purchase. Written by initiateServicePurchaseCheckout; read only by the coordinator's re-show action.
--
-- hold_appointment_slot is redefined from its LIVE body (pg_get_functiondef), changing only the Free-patient gate.

alter table public.service_purchases
  add column if not exists pending_payment_checkout_url text;
comment on column public.service_purchases.pending_payment_checkout_url is
  'The Paystack authorization URL for the current pending_payment_provider_ref, so a coordinator can show the same link again.';

-- The stored link is a bearer payment URL for one pending transaction. It lives only as long as that transaction is the purchase's
-- pending one: when the reference is cleared (payment applied) or the purchase leaves pending_payment, the URL goes with it. Done in a
-- trigger so no writer (payment webhook, expiry sweep, cancellation) has to remember, and the payment function is left untouched.
create or replace function private.clear_stale_checkout_url()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if new.pending_payment_checkout_url is not null
     and (new.pending_payment_provider_ref is null or new.status <> 'pending_payment') then
    new.pending_payment_checkout_url := null;
  end if;
  return new;
end;
$function$;
revoke all on function private.clear_stale_checkout_url() from public;

drop trigger if exists clear_stale_checkout_url on public.service_purchases;
create trigger clear_stale_checkout_url
  before update on public.service_purchases
  for each row execute function private.clear_stale_checkout_url();

update public.service_purchases set pending_payment_checkout_url = null where pending_payment_checkout_url is not null;

create or replace function private.has_available_service_credit(p_patient uuid, p_code text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select exists (
    select 1
      from public.service_purchases sp
      join public.service_products prod on prod.id = sp.service_product_id
     where sp.patient_id = p_patient
       and prod.code = p_code
       and sp.status = 'active'
       and sp.redeemed_at is null
       and (sp.expires_at is null or sp.expires_at > now())
  );
$function$;
revoke all on function private.has_available_service_credit(uuid, text) from public;

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
    if v_payment_status = 'pending' and private.patient_membership_tier(v_patient) is null
       and not private.has_available_service_credit(v_patient, private.booking_product_code(p_appointment_type::text)) then
      raise exception 'this patient needs to join Membership before extra services can be booked'
        using errcode = 'P0001', hint = 'upgrade_first';
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

do $$
begin
  if pg_get_functiondef('public.hold_appointment_slot(uuid,uuid,appointment_type,appointment_consultation_method,timestamptz,timestamptz,text,text,text,uuid,uuid,uuid,integer)'::regprocedure) not like '%has_available_service_credit%' then
    raise exception 'hold_appointment_slot was not updated';
  end if;
end $$;
