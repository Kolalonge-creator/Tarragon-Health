-- Caregiver Proxy Access, part 8: cancel_appointment's notification must not
-- tell the patient they did something their caregiver did.
--
-- 20260829034500 correctly bucketed a caregiver's cancellation as
-- 'patient_cancelled' rather than 'provider_cancelled' — the decision to
-- cancel is the patient's side of the relationship either way, not a
-- provider one, and that classification is right on its own terms. But the
-- same v_is_patient boolean was then reused, unexamined, for the
-- notifications row's cancelled_by_patient payload field. That field has no
-- rendering template yet (grep across supabase/functions and apps/web for
-- "appointment_cancelled" and "cancelled_by_patient" finds nothing — this
-- payload key is written but never read anywhere in this codebase today),
-- so nothing is factually wrong on screen *yet*. But whoever eventually
-- builds that template will read cancelled_by_patient and reasonably write
-- "You cancelled this appointment" from it — and for a caregiver's
-- cancellation, sent to the PATIENT, that would be false: they did not
-- cancel it, someone acting for them did. Exactly the trap
-- private.stamp_acting_supporter and the whole acting-for design (see
-- 20260801110000: "every action they take is stamped with their own name
-- and shown to that person... a record that cannot distinguish 'I did
-- this' from 'someone did this for me' is worse than one nobody can write
-- to") exists to prevent, just not yet tripped because nothing reads the
-- field.
--
-- The two questions are different and get two variables: v_is_patient_side
-- decides the status bucket (whose side of the relationship is this a
-- decision on), v_actor_is_patient decides what the patient is told
-- happened (did they literally do it, or did someone acting for them).
-- Otherwise byte-identical to 20260829034500's version.

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
  v_actor_is_patient boolean;
  v_is_patient_side boolean;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;

  -- Who literally clicked cancel, never reassigned — this is the fact a
  -- notification to the patient must be built from.
  v_actor_is_patient := v_appt.patient_id = v_uid;
  -- Whose SIDE the decision is on, for the status bucket only. A caregiver
  -- acting under book_appointments cancels on the patient's behalf, so this
  -- starts as v_actor_is_patient and then may be widened to true — but never
  -- narrowed, and never used for anything other than picking the status.
  v_is_patient_side := v_actor_is_patient;

  if not (v_is_patient_side or private.is_org_staff(v_appt.organisation_id)) then
    if private.can_act_for(v_appt.patient_id, 'book_appointments'::public.caregiver_permission) then
      v_is_patient_side := true;
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
      when v_is_patient_side then 'patient_cancelled'::public.appointment_status
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
    jsonb_build_object(
      'appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for,
      -- The literal fact, not the status bucket: whether the RECIPIENT of
      -- this notification (the patient) is the one who cancelled it.
      'cancelled_by_patient', v_actor_is_patient,
      -- For the eventual template's third case: "your caregiver cancelled
      -- this for you", distinct from both "you cancelled it" and "the
      -- clinic cancelled it". Never true when cancelled_by_patient is true.
      'cancelled_by_caregiver', (not v_actor_is_patient) and v_is_patient_side
    ),
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

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.cancel_appointment(uuid,text)'::regprocedure);
  if v_def not like '%cancelled_by_caregiver%' then
    raise exception 'cancel_appointment does not distinguish a caregiver cancellation from the patient''s own';
  end if;
  -- The specific bug this migration fixes: cancelled_by_patient must no
  -- longer be written from the widened v_is_patient_side (which a caregiver
  -- branch can set true), only from the un-widened actor check.
  if v_def like '%''cancelled_by_patient'', v_is_patient_side%' then
    raise exception 'cancelled_by_patient is still built from the widened status-bucket variable, not the real actor';
  end if;

  if has_function_privilege('anon', 'public.cancel_appointment(uuid, text)', 'EXECUTE') then
    raise exception 'anon must not be able to cancel an appointment';
  end if;
end $$;
