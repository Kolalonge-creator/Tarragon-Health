-- Care Coordinator phone booking.
--
-- Some patients (elderly, low literacy) cannot book on the platform. A Care Coordinator calls the number on file,
-- finds the patient, and books a doctor appointment on their behalf. The booking is a normal appointment row and
-- appears on the patient's dashboard and appointment list with no sync.
--
-- Founder decisions 2026-10-29:
--   * the coordinator sees name, state and phone only (coordinator_find_patient), and every search hit is audited;
--   * a booking the tier covers confirms at once (confirm_appointment_booking already redeems an available credit);
--   * an item the tier does not cover is bookable only by a Member or Membership Plus patient; a Free patient must upgrade first;
--   * such a booking is held for 24 hours awaiting payment (Paystack link or a sponsor Care Voucher) and is released if unpaid;
--   * the coordinator never handles card details or cash.
--
-- hold_appointment_slot and confirm_appointment_booking are redefined from their LIVE bodies (pg_get_functiondef,
-- 2026-10-29), not from the older migration files. Live rows at the time of writing: no appointment has booked_via.

-- 1. who booked it, and how ---------------------------------------------------------------------------------------------
alter table public.appointments
  add column if not exists booked_via text not null default 'self',
  add column if not exists payment_confirm_error text;

alter table public.appointments
  drop constraint if exists appointments_booked_via_check;
alter table public.appointments
  add constraint appointments_booked_via_check
  check (booked_via in ('self', 'caregiver', 'staff', 'coordinator_phone'));

comment on column public.appointments.booked_via is
  'How the booking was made: self, caregiver (acting for), staff (a clinician or admin), coordinator_phone (a Care Coordinator on a call). Set by hold_appointment_slot, never by the client.';
comment on column public.appointments.payment_confirm_error is
  'Set when a payment landed but the automatic confirmation of a coordinator phone booking failed. A non-null value means a person must confirm it.';

-- 2. hold ---------------------------------------------------------------------------------------------------------------
create or replace function public.hold_appointment_slot(
  p_organisation_id uuid,
  p_clinician_id uuid,
  p_appointment_type appointment_type,
  p_consultation_method appointment_consultation_method,
  p_scheduled_for timestamp with time zone,
  p_ends_at timestamp with time zone,
  p_reason text DEFAULT NULL::text,
  p_service text DEFAULT NULL::text,
  p_location text DEFAULT NULL::text,
  p_specialist_referral_id uuid DEFAULT NULL::uuid,
  p_care_plan_id uuid DEFAULT NULL::uuid,
  p_patient_id uuid DEFAULT NULL::uuid,
  p_hold_minutes integer DEFAULT 10)
 returns appointments
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
    if v_payment_status = 'pending' and private.patient_membership_tier(v_patient) is null then
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

-- 3. confirm: an unpaid phone booking is held for 24 hours, then released -------------------------------------------------
create or replace function public.confirm_appointment_booking(p_appointment_id uuid)
 returns appointments
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  if v_appt.patient_id <> v_uid
     and not private.is_org_staff(v_appt.organisation_id)
     and not private.can_act_for(v_appt.patient_id, 'book_appointments'::public.caregiver_permission) then
    raise exception 'not authorized';
  end if;
  if v_appt.status not in ('held', 'booked') then
    raise exception 'appointment is not on hold';
  end if;
  if v_appt.status = 'held' and v_appt.hold_expires_at < now() then
    update public.appointments set status = 'expired', hold_expires_at = null where id = p_appointment_id;
    raise exception 'hold has expired — pick another slot';
  end if;

  -- S37 (INV-14): a hold made before the guard was switched off is not confirmed, and no credit is spent
  if (v_appt.appointment_type in ('telemedicine', 'result_interpretation') or v_appt.consultation_method = 'telemedicine')
     and not private.go_live_open('clinical_operations_enabled', v_appt.patient_id, v_appt.clinician_id) then
    raise exception 'consultations are not open yet' using errcode = 'P0001', hint = 'go_live_guard:clinical_operations_enabled';
  end if;

  -- S21: the time must still be open at the moment the credit is spent (the clinician may have cancelled the block, or gone on leave,
  -- since the hold was made). The hold itself is kept, so nothing is spent and the patient can choose again. (S64: same for the new types.)
  if v_appt.appointment_type in ('telemedicine', 'dietitian', 'pharmacist') and not private.slot_is_open(v_appt.clinician_id, v_appt.patient_id, v_appt.scheduled_for, v_appt.ends_at, true) then
    raise exception 'that time is no longer open for consultations: pick another slot' using errcode = 'P0001';
  end if;

  if v_appt.payment_status = 'pending' then
    -- S64: the product map is private.booking_product_code (telemedicine, result_interpretation, dietitian, pharmacist)
    v_product_code := private.booking_product_code(v_appt.appointment_type::text);
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
      end;
    end if;
  end if;

  update public.appointments
    set payment_status = v_appt.payment_status,
        status = case when v_appt.payment_status in ('paid', 'not_required', 'waived')
                      then 'confirmed'::public.appointment_status
                      else 'booked'::public.appointment_status end,
        confirmed_at = case when v_appt.payment_status in ('paid', 'not_required', 'waived') then now() else confirmed_at end,
        -- A phone booking still awaiting payment keeps its slot for 24 hours from the first confirm attempt (never past its own start
        -- time), then the sweeper releases it. Every other booking behaves exactly as before.
        hold_expires_at = case
          when v_appt.payment_status in ('paid', 'not_required', 'waived') then null
          when v_appt.booked_via = 'coordinator_phone' and v_appt.status = 'held' then least(now() + interval '24 hours', v_appt.scheduled_for)
          when v_appt.booked_via = 'coordinator_phone' then v_appt.hold_expires_at
          else null end,
        payment_confirm_error = null
    where id = p_appointment_id
    returning * into v_appt;

  if v_appt.status = 'confirmed'
     and v_appt.video_consultation_id is null
     and v_appt.appointment_type in ('telemedicine', 'result_interpretation', 'dietitian', 'pharmacist') then
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

  -- S21: the authoritative encounter and its room stub
  if v_appt.status = 'confirmed' then
    perform private.ensure_encounter_for_appointment(v_appt.id);
  end if;

  if v_appt.status = 'confirmed' then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    values (
      v_appt.organisation_id, v_appt.patient_id, private.patient_reminder_channel(v_appt.patient_id), 'pending', 'appointment_booking_confirmation',
      jsonb_build_object('appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for, 'appointment_type', v_appt.appointment_type),
      'non_clinical'
    );
  end if;

  if v_appt.patient_id <> v_uid then
    perform private.log_care_access(v_appt.patient_id, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_appt.id, 'stage', v_appt.status::text));
  end if;

  return v_appt;
end;
$function$;

-- 4. release an unpaid phone booking after 24 hours ---------------------------------------------------------------------------
create or replace function private.expire_stale_appointment_holds()
 returns void
 language sql
 security definer
 set search_path to ''
as $function$
  update public.appointments
    set status = 'expired', hold_expires_at = null
    where hold_expires_at < now()
      and (status = 'held'
           or (status = 'booked' and booked_via = 'coordinator_phone' and payment_status = 'pending'));
$function$;

-- 5. confirm the booking when the payment lands -------------------------------------------------------------------------------
-- The payment webhook activates the service purchase (private.apply_service_purchase_payment) and nothing else, and it runs with no
-- user session. Confirmation needs one (confirm_appointment_booking checks the caller), so the booking coordinator's id is put in
-- the transaction's claim for the one call and the previous value restored. A failure is recorded on the appointment, never swallowed:
-- payment_confirm_error is shown to the coordinator as "payment received, confirm by hand".
create or replace function private.confirm_phone_bookings_after_payment()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
  v_code text;
  v_prev text;
begin
  -- A purchase becomes usable either by an UPDATE to 'active' (a Paystack payment, a voucher applied to a pending purchase) or by being
  -- INSERTed active (a free product, a credit a sponsor bought for the patient). Both must confirm a waiting phone booking.
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;
  select code into v_code from public.service_products where id = new.service_product_id;

  for r in
    select a.id, a.booked_by
      from public.appointments a
     where a.patient_id = new.patient_id
       and a.status = 'booked'
       and a.booked_via = 'coordinator_phone'
       and a.payment_status = 'pending'
       and a.booked_by is not null
       and private.booking_product_code(a.appointment_type::text) = v_code
     order by a.scheduled_for
  loop
    v_prev := current_setting('request.jwt.claim.sub', true);
    begin
      perform set_config('request.jwt.claim.sub', r.booked_by::text, true);
      perform public.confirm_appointment_booking(r.id);
    exception when others then
      update public.appointments set payment_confirm_error = left(sqlerrm, 300) where id = r.id;
    end;
    perform set_config('request.jwt.claim.sub', coalesce(v_prev, ''), true);
  end loop;
  return new;
end;
$function$;

revoke all on function private.confirm_phone_bookings_after_payment() from public;

drop trigger if exists confirm_phone_bookings_after_payment on public.service_purchases;
create trigger confirm_phone_bookings_after_payment
  after update of status on public.service_purchases
  for each row execute function private.confirm_phone_bookings_after_payment();

drop trigger if exists confirm_phone_bookings_after_credit_insert on public.service_purchases;
create trigger confirm_phone_bookings_after_credit_insert
  after insert on public.service_purchases
  for each row when (new.status = 'active')
  execute function private.confirm_phone_bookings_after_payment();

-- 6. the coordinator's patient search: name, state, phone and tier only ----------------------------------------------------------
create or replace function public.coordinator_find_patient(p_query text)
 returns table (patient_id uuid, full_name text, state text, phone text, membership_tier text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_q text := btrim(coalesce(p_query, ''));
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  v_like text;
  r record;
begin
  select organisation_id into v_org
    from public.profiles
   where id = v_uid and role = 'care_coordinator' and is_active;
  if v_org is null then
    raise exception 'only a care coordinator can look up a patient to book for them' using errcode = '42501';
  end if;
  if length(v_q) < 3 then
    raise exception 'type at least 3 characters of a name or phone number' using errcode = 'P0001';
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  for r in
    select p.id, p.full_name, p.state, p.phone
      from public.profiles p
     where p.role = 'patient'
       and p.organisation_id = v_org
       and p.is_active
       and coalesce(p.receives_care, true)
       and (p.full_name ilike v_like
            or (length(v_digits) >= 6
                and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), least(length(v_digits), 10))
                    = right(v_digits, least(length(v_digits), 10))))
     order by p.full_name
     limit 10
  loop
    -- scope must be one of the closed list in care_access_events_scope_known, and log_care_access swallows a violation with only a
    -- warning, so a wrong scope here would lose the audit line silently (the proof checks the row exists). 'booking' is what this is for.
    perform private.log_care_access(r.id, 'record_viewed', 'booking',
      jsonb_build_object('stage', 'lookup', 'fields', jsonb_build_array('full_name', 'state', 'phone')));
    -- Fail closed: log_care_access never raises, so check the line is really there before handing over the details.
    if not exists (select 1 from public.care_access_events e
                    where e.patient_id = r.id and e.actor_profile_id = v_uid and e.kind = 'record_viewed' and e.scope = 'booking'
                      and e.occurred_at > now() - interval '1 hour') then
      raise exception 'the lookup could not be recorded, so nothing was shown' using errcode = 'P0001';
    end if;
    patient_id := r.id;
    full_name := r.full_name;
    state := r.state;
    phone := r.phone;
    membership_tier := private.patient_membership_tier(r.id);
    return next;
  end loop;
end;
$function$;

revoke all on function public.coordinator_find_patient(text) from public;
revoke all on function public.coordinator_find_patient(text) from anon;
grant execute on function public.coordinator_find_patient(text) to authenticated;

-- 7. self-check ---------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.coordinator_find_patient(text)', 'EXECUTE') then
    raise exception 'coordinator_find_patient must not be executable by anon';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'appointments' and column_name = 'booked_via') then
    raise exception 'appointments.booked_via missing';
  end if;
end $$;
