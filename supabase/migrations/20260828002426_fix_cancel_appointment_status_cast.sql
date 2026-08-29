-- Tarragon Health — fix cancel_appointment() enum-cast bug
--
-- Same root cause as 20260828002313's confirm_appointment_booking fix: the
-- status CASE had two bare string-literal branches ('patient_cancelled' /
-- 'provider_cancelled') with no typed operand to anchor unknown-literal
-- resolution, so Postgres fell back to text. Explicit casts fix it.

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
  if not (v_is_patient or private.is_org_staff(v_appt.organisation_id)) then
    raise exception 'not authorized';
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

  return v_appt;
end;
$$;

revoke execute on function public.cancel_appointment(uuid, text) from public, anon;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.cancel_appointment(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute cancel_appointment';
  end if;
  raise notice 'PASS: cancel_appointment enum-cast bug fixed';
end $$;
