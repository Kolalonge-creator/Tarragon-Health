-- Tarragon Health — fix confirm_appointment_booking() enum-cast bug
--
-- Found by packages/db/tests/appointment_engine_core.sql: with both CASE
-- branches as bare string literals ('confirmed'/'booked'), Postgres has no
-- typed operand to resolve the unknown-literal type against and falls back
-- to text, so `status = case ... end` failed with "column status is of type
-- appointment_status but expression is of type text". Explicit casts on
-- both branches fix it; behaviour is otherwise unchanged.

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
  if v_appt.patient_id <> v_uid and not private.is_org_staff(v_appt.organisation_id) then
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

  return v_appt;
end;
$$;

revoke execute on function public.confirm_appointment_booking(uuid) from public, anon;
grant execute on function public.confirm_appointment_booking(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.confirm_appointment_booking(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute confirm_appointment_booking';
  end if;
  raise notice 'PASS: confirm_appointment_booking enum-cast bug fixed';
end $$;
