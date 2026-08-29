-- Caregiver Proxy Access, part 7: book_appointments and view_appointments,
-- for a real appointment.
--
-- book_appointments has been wired since 20260829013000, but wired onto
-- sponsor_book_care — a self-arranged LAB PANEL request, not an appointment.
-- The Appointment Engine (public.appointments, built the same week as this
-- feature, 20260828) has never had any profile_access awareness at all: its
-- four lifecycle RPCs (hold/confirm/cancel/reschedule) admit only the
-- patient themselves or org staff, and appointments_select — still the
-- three-clause policy the 20260705211129 dynamic-policy loop generated,
-- untouched by anything since — admits only the patient or staff too. A
-- caregiver holding even a full, unrestricted 'manage' grant could not see
-- or book a real appointment for the person they support; the checkbox and
-- the RPC it claimed to gate were never the same appointment.
--
-- This adds private.can_act_for(patient, 'book_appointments') as a third
-- admitted party alongside "is the patient" and "is org staff", on exactly
-- the four booking-lifecycle RPCs (hold, confirm, cancel, reschedule) —
-- deliberately not advance_appointment_status, which is the day-of clinical
-- encounter state machine (checked-in/in-progress/completed/no-show), a
-- different action from booking one. And it adds
-- private.can_read_clinical(patient, 'view_appointments') to
-- appointments_select, so seeing a caregiver's supported person's
-- appointments is gated the same way seeing their medications or results
-- already is.

drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'view_appointments'::public.caregiver_permission)
  );

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
  if v_patient <> v_uid
     and not private.is_org_staff(p_organisation_id)
     and not private.can_act_for(v_patient, 'book_appointments'::public.caregiver_permission) then
    raise exception 'only staff, or someone with permission to book appointments for this person, may book on their behalf';
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
      specialist_referral_id, care_plan_id, booked_by, is_high_priority, hold_expires_at
    ) values (
      p_organisation_id, v_patient, p_clinician_id, p_appointment_type, p_consultation_method,
      p_scheduled_for, p_ends_at, 'held', p_reason, p_service, p_location,
      p_specialist_referral_id, p_care_plan_id, v_uid, coalesce(v_is_high_priority, false),
      now() + (p_hold_minutes * interval '1 minute')
    )
    returning * into v_result;
  exception
    when exclusion_violation then
      raise exception 'that time was just taken — pick another slot';
  end;

  if v_patient <> v_uid then
    perform private.log_care_access(v_patient, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_result.id, 'stage', 'held'));
  end if;

  return v_result;
end;
$$;

revoke execute on function public.hold_appointment_slot(uuid, uuid, public.appointment_type, public.appointment_consultation_method, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.hold_appointment_slot(uuid, uuid, public.appointment_type, public.appointment_consultation_method, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer) to authenticated;

create or replace function public.confirm_appointment_booking(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
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
  if v_appt.status <> 'held' then
    raise exception 'appointment is not on hold';
  end if;
  if v_appt.hold_expires_at < now() then
    update public.appointments set status = 'expired', hold_expires_at = null where id = p_appointment_id;
    raise exception 'hold has expired — pick another slot';
  end if;

  update public.appointments
    set status = case
          when payment_status in ('paid', 'not_required', 'waived') then 'confirmed'::public.appointment_status
          else 'booked'::public.appointment_status
        end,
        confirmed_at = case when payment_status in ('paid', 'not_required', 'waived') then now() else confirmed_at end,
        hold_expires_at = null
    where id = p_appointment_id
    returning * into v_appt;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    v_appt.organisation_id, v_appt.patient_id, 'whatsapp', 'pending', 'appointment_booking_confirmation',
    jsonb_build_object('appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for, 'appointment_type', v_appt.appointment_type),
    'non_clinical'
  );

  if v_appt.patient_id <> v_uid then
    perform private.log_care_access(v_appt.patient_id, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_appt.id, 'stage', v_appt.status::text));
  end if;

  return v_appt;
end;
$$;

revoke execute on function public.confirm_appointment_booking(uuid) from public, anon;
grant execute on function public.confirm_appointment_booking(uuid) to authenticated;

create or replace function public.cancel_appointment(p_appointment_id uuid, p_reason text default null)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_policy public.appointment_cancellation_policies;
  v_hours_until numeric;
  v_is_patient boolean;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;

  v_is_patient := v_appt.patient_id = v_uid;
  -- A caregiver acting under book_appointments is neither the patient nor
  -- staff, but this cancellation is still on the patient's own behalf, not
  -- a provider decision — so it is bucketed with v_is_patient rather than
  -- given a third status branch, keeping 'patient_cancelled' vs
  -- 'provider_cancelled' meaning "whose decision was this" (patient-side vs
  -- clinic-side), not "whose login was this."
  if not (v_is_patient or private.is_org_staff(v_appt.organisation_id)) then
    if private.can_act_for(v_appt.patient_id, 'book_appointments'::public.caregiver_permission) then
      v_is_patient := true;
    else
      raise exception 'not authorized';
    end if;
  end if;
  if v_appt.status in ('completed', 'cancelled', 'patient_cancelled', 'provider_cancelled', 'no_show', 'expired', 'failed', 'rescheduled') then
    raise exception 'appointment is already %', v_appt.status;
  end if;

  v_policy := private.resolve_cancellation_policy(v_appt.organisation_id, v_appt.appointment_type);
  v_hours_until := extract(epoch from (v_appt.scheduled_for - now())) / 3600.0;

  update public.appointments set
    status = case
      when v_is_patient then 'patient_cancelled'::public.appointment_status
      else 'provider_cancelled'::public.appointment_status
    end,
    cancelled_at = now(),
    cancelled_by = v_uid,
    cancellation_reason = p_reason,
    hold_expires_at = null,
    payment_status = case
      when payment_status = 'paid'
        and v_policy.id is not null
        and v_policy.refund_pct_within_window > 0
        and v_hours_until >= v_policy.cancellation_window_hours
      then 'refund_due'
      else payment_status
    end
  where id = p_appointment_id
  returning * into v_appt;

  perform private.offer_next_waiting_list_candidate(
    v_appt.organisation_id, v_appt.clinician_id, v_appt.appointment_type,
    v_appt.consultation_method, v_appt.location, v_appt.scheduled_for, v_appt.ends_at
  );

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    v_appt.organisation_id, v_appt.patient_id, 'whatsapp', 'pending', 'appointment_cancelled',
    jsonb_build_object('appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for, 'cancelled_by_patient', v_is_patient),
    'non_clinical'
  );

  if v_appt.patient_id <> v_uid then
    perform private.log_care_access(v_appt.patient_id, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_appt.id, 'stage', 'cancelled'));
  end if;

  return v_appt;
end;
$$;

revoke execute on function public.cancel_appointment(uuid, text) from public, anon;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_scheduled_for timestamptz,
  p_new_ends_at timestamptz
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.appointments;
  v_new public.appointments;
begin
  select * into v_old from public.appointments where id = p_appointment_id for update;
  if v_old.id is null then
    raise exception 'appointment not found';
  end if;
  if v_old.patient_id <> v_uid
     and not private.is_org_staff(v_old.organisation_id)
     and not private.can_act_for(v_old.patient_id, 'book_appointments'::public.caregiver_permission) then
    raise exception 'not authorized';
  end if;
  if v_old.status not in ('held', 'booked', 'confirmed') then
    raise exception 'cannot reschedule an appointment that is %', v_old.status;
  end if;
  if p_new_ends_at <= p_new_scheduled_for or p_new_scheduled_for <= now() then
    raise exception 'invalid new time';
  end if;

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, reason, service, location, payment_status,
      specialist_referral_id, care_plan_id, booked_by, is_high_priority, rescheduled_from_id
    )
    select
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      p_new_scheduled_for, p_new_ends_at, 'booked', reason, service, location, payment_status,
      specialist_referral_id, care_plan_id, v_uid, is_high_priority, id
    from public.appointments where id = p_appointment_id
    returning * into v_new;
  exception
    when exclusion_violation then
      raise exception 'that new time was just taken — pick another slot';
  end;

  update public.appointments set status = 'rescheduled' where id = p_appointment_id;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    v_new.organisation_id, v_new.patient_id, 'whatsapp', 'pending', 'appointment_rescheduled',
    jsonb_build_object('old_appointment_id', v_old.id, 'new_appointment_id', v_new.id, 'scheduled_for', v_new.scheduled_for),
    'non_clinical'
  );

  if v_new.patient_id <> v_uid then
    perform private.log_care_access(v_new.patient_id, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_new.id, 'stage', 'rescheduled'));
  end if;

  return v_new;
end;
$$;

revoke execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'appointments' and cmd = 'SELECT'
       and qual not like '%view_appointments%'
  ) then
    raise exception 'appointments_select was not narrowed to view_appointments';
  end if;

  if pg_get_functiondef('public.hold_appointment_slot(uuid,uuid,public.appointment_type,public.appointment_consultation_method,timestamptz,timestamptz,text,text,text,uuid,uuid,uuid,integer)'::regprocedure) not like '%can_act_for%'
     or pg_get_functiondef('public.confirm_appointment_booking(uuid)'::regprocedure) not like '%can_act_for%'
     or pg_get_functiondef('public.cancel_appointment(uuid,text)'::regprocedure) not like '%can_act_for%'
     or pg_get_functiondef('public.reschedule_appointment(uuid,timestamptz,timestamptz)'::regprocedure) not like '%can_act_for%' then
    raise exception 'a booking-lifecycle RPC was not extended with can_act_for';
  end if;

  if has_function_privilege('anon', 'public.hold_appointment_slot(uuid, uuid, public.appointment_type, public.appointment_consultation_method, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_appointment(uuid, text)', 'EXECUTE') then
    raise exception 'anon must not reach a booking-lifecycle RPC';
  end if;
end $$;
