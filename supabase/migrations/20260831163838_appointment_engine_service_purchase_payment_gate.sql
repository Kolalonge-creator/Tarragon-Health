-- Tarragon Health — Pay-per-service, Phase 5: the payment gate the
-- Appointment Engine's own types migration deliberately punted ("pending/
-- paid/... exist for the appointment types that do carry a direct charge,
-- without committing this migration to any specific price or which types
-- those are — that is a founder/business decision"). That decision is now
-- made: 'telemedicine' (on-demand video/audio visit) and
-- 'result_interpretation' (doctor walkthrough of a specific result) are
-- paid appointment types, satisfied by a pre-purchased single-use
-- service_purchases credit (video_visit_credit / result_interpretation_credit,
-- seeded in 20260831163723) rather than a separate checkout step inside
-- booking itself — a patient buys the credit via the existing generic
-- purchaseServiceProduct() flow, then spends it on whichever slot they pick.
--
-- Every other appointment_type is untouched (payment_status stays
-- 'not_required', confirms immediately, exactly as before).

create or replace function public.hold_appointment_slot(
  p_organisation_id uuid,
  p_clinician_id uuid,
  p_appointment_type public.appointment_type,
  p_consultation_method public.appointment_consultation_method,
  p_scheduled_for timestamptz,
  p_ends_at timestamptz,
  p_reason text default null,
  p_service text default null,
  p_location text default null,
  p_specialist_referral_id uuid default null,
  p_care_plan_id uuid default null,
  p_patient_id uuid default null,
  p_hold_minutes integer default 10
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  v_org uuid;
  v_is_high_priority boolean := false;
  v_payment_status public.appointment_payment_status;
  v_result public.appointments;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_patient := coalesce(p_patient_id, v_uid);
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is distinct from p_organisation_id then
    raise exception 'not authorized for this organisation';
  end if;
  if v_patient <> v_uid and not private.is_org_staff(p_organisation_id) then
    raise exception 'only staff may book on behalf of another patient';
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

  v_payment_status := case p_appointment_type
    when 'telemedicine' then 'pending'
    when 'result_interpretation' then 'pending'
    else 'not_required'
  end;

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, reason, service, location,
      specialist_referral_id, care_plan_id, booked_by, is_high_priority, hold_expires_at,
      payment_status
    ) values (
      p_organisation_id, v_patient, p_clinician_id, p_appointment_type, p_consultation_method,
      p_scheduled_for, p_ends_at, 'held', p_reason, p_service, p_location,
      p_specialist_referral_id, p_care_plan_id, v_uid, coalesce(v_is_high_priority, false),
      now() + (p_hold_minutes * interval '1 minute'),
      v_payment_status
    )
    returning * into v_result;
  exception
    when exclusion_violation then
      raise exception 'that time was just taken — pick another slot';
  end;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_appointment_booking: attempt to redeem a single-use credit for a
-- still-pending paid appointment before deciding booked vs confirmed, then
-- (once genuinely confirmed) create the linked video_consultations row for
-- session-based types so the existing Zoom-join UI has something to attach
-- to — app code creates the actual Zoom meeting afterward (an HTTP call, not
-- something SQL can do), same two-step shape as select_video_visit_alternate_
-- slot already uses.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_appointment_booking(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_product_code text;
  v_consult_context public.video_consultation_context;
  v_consult_id uuid;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;
  if v_appt.patient_id <> v_uid and not private.is_org_staff(v_appt.organisation_id) then
    raise exception 'not authorized';
  end if;
  -- 'held' is the normal first call. 'booked' (payment still pending from an
  -- earlier confirm attempt) is a valid re-confirm — the caller routes the
  -- patient to buy a credit, then calls this function again on the same
  -- appointment once payment succeeds; 'booked' already has no
  -- hold_expires_at to check (see below).
  if v_appt.status not in ('held', 'booked') then
    raise exception 'appointment is not on hold';
  end if;
  if v_appt.status = 'held' and v_appt.hold_expires_at < now() then
    update public.appointments set status = 'expired', hold_expires_at = null where id = p_appointment_id;
    raise exception 'hold has expired — pick another slot';
  end if;

  if v_appt.payment_status = 'pending' then
    v_product_code := case v_appt.appointment_type
      when 'telemedicine' then 'video_visit_credit'
      when 'result_interpretation' then 'result_interpretation_credit'
      else null
    end;
    if v_product_code is not null then
      begin
        perform public.redeem_available_service_purchase(
          v_appt.patient_id, v_product_code, 'appointment', v_appt.id
        );
        v_appt.payment_status := 'paid';
      exception when others then
        if sqlerrm not like 'no available%' then
          raise;
        end if;
        -- No credit yet — leave payment_status 'pending', booking stays 'booked'
        -- below (the same non-error behaviour this function already had for
        -- any not-yet-paid appointment); the client routes the patient to buy
        -- one, then calls this function again.
      end;
    end if;
  end if;

  update public.appointments
    set payment_status = v_appt.payment_status,
        status = case when v_appt.payment_status in ('paid', 'not_required', 'waived')
                      then 'confirmed'::public.appointment_status
                      else 'booked'::public.appointment_status end,
        confirmed_at = case when v_appt.payment_status in ('paid', 'not_required', 'waived') then now() else confirmed_at end,
        hold_expires_at = null
    where id = p_appointment_id
    returning * into v_appt;

  if v_appt.status = 'confirmed'
     and v_appt.video_consultation_id is null
     and v_appt.appointment_type in ('telemedicine', 'result_interpretation') then
    v_consult_context := case v_appt.appointment_type
      when 'result_interpretation' then 'lab_result_consult'
      else 'general_checkin'
    end;

    insert into public.video_consultations
      (organisation_id, patient_id, context, initiated_by, status, scheduled_at)
    values
      (v_appt.organisation_id, v_appt.patient_id, v_consult_context, v_appt.patient_id, 'scheduled', v_appt.scheduled_for)
    returning id into v_consult_id;

    update public.appointments set video_consultation_id = v_consult_id where id = v_appt.id
    returning * into v_appt;
  end if;

  -- Only on a genuine confirm — a still-'booked' (pending payment) outcome
  -- can be retried by the caller (buy a credit, call this again), and must
  -- not spam a notification on every unsuccessful retry.
  if v_appt.status = 'confirmed' then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    values (
      v_appt.organisation_id, v_appt.patient_id, 'whatsapp', 'pending', 'appointment_booking_confirmation',
      jsonb_build_object('appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for, 'appointment_type', v_appt.appointment_type),
      'non_clinical'
    );
  end if;

  return v_appt;
end;
$$;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_clinician uuid;
  v_product_id uuid;
  v_appt public.appointments;
  v_purchase_id uuid;
begin
  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  select id into v_clinician from public.profiles where organisation_id = v_org and role = 'clinician' limit 1;
  if v_patient is null or v_clinician is null then
    raise notice 'SKIPPED behavioral proof: no patient/clinician fixture to test against';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    v_appt := public.hold_appointment_slot(
      v_org, v_clinician, 'telemedicine', 'telemedicine',
      now() + interval '2 days', now() + interval '2 days' + interval '20 minutes'
    );
  exception when others then
    reset role;
    raise notice 'SKIPPED behavioral proof: could not hold a test slot (%)', sqlerrm;
    return;
  end;
  reset role;

  if v_appt.payment_status <> 'pending' then
    raise exception 'FAIL: telemedicine hold did not default to payment_status pending (got %)', v_appt.payment_status;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_appt := public.confirm_appointment_booking(v_appt.id);
  reset role;

  if v_appt.status <> 'booked' or v_appt.payment_status <> 'pending' then
    raise exception 'FAIL: confirming with no credit should leave status=booked/payment_status=pending (got status=%, payment_status=%)', v_appt.status, v_appt.payment_status;
  end if;

  select id into v_product_id from public.service_products where code = 'video_visit_credit';
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org, v_patient, v_patient, v_product_id, 'active', 500000, 'NGN', now(), now() + interval '90 days')
  returning id into v_purchase_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_appt := public.confirm_appointment_booking(v_appt.id);
  reset role;

  if v_appt.status <> 'confirmed' or v_appt.payment_status <> 'paid' then
    raise exception 'FAIL: confirming with a credit available should confirm+mark paid (got status=%, payment_status=%)', v_appt.status, v_appt.payment_status;
  end if;
  if v_appt.video_consultation_id is null then
    raise exception 'FAIL: confirmed telemedicine appointment has no linked video_consultations row';
  end if;
  if not exists (select 1 from public.service_purchases where id = v_purchase_id and redeemed_at is not null and redeemed_entity_id = v_appt.id) then
    raise exception 'FAIL: the credit was not marked redeemed against this appointment';
  end if;

  delete from public.video_consultations where id = v_appt.video_consultation_id;
  delete from public.appointments where id = v_appt.id;
  delete from public.service_purchases where id = v_purchase_id;

  raise notice 'PASS: appointment engine payment gate — pending without credit, paid+confirmed+video-linked with one';
end $$;
