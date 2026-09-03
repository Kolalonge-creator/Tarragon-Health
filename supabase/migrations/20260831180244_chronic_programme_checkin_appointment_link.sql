-- Tarragon Health — 12-week two-track chronic-care programme, Phase 2 (UI support)
--
-- The patient books a doctor-checkin the same way they book any other
-- appointment — hold_appointment_slot/confirm_appointment_booking, unchanged
-- (see apps/web/src/app/(dashboard)/patient/appointments/book-appointment.tsx)
-- — but chronic_programme_schedule_occurrences.appointment_id is only
-- writable via is_org_staff RLS, not by the patient themselves. This adds
-- the missing link: a small RPC the patient calls right after confirming,
-- plus a trigger that resolves the occurrence's own status from the linked
-- appointment's real lifecycle (completed -> completed; cancelled/no_show ->
-- back to pending so the patient can rebook) rather than treating "booked"
-- as "done".

create or replace function public.link_chronic_checkin_appointment(
  p_occurrence_id uuid,
  p_appointment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occ public.chronic_programme_schedule_occurrences%rowtype;
  v_appt public.appointments%rowtype;
begin
  select * into v_occ from public.chronic_programme_schedule_occurrences where id = p_occurrence_id;
  if v_occ.id is null then
    raise exception 'occurrence not found';
  end if;
  if v_occ.patient_id <> (select auth.uid()) and not private.is_org_staff(v_occ.organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_occ.occurrence_type <> 'doctor_checkin' then
    raise exception 'occurrence % is not a doctor_checkin' , p_occurrence_id using errcode = '23514';
  end if;

  select * into v_appt from public.appointments where id = p_appointment_id;
  if v_appt.id is null or v_appt.patient_id <> v_occ.patient_id then
    raise exception 'appointment does not belong to this patient' using errcode = '23514';
  end if;

  update public.chronic_programme_schedule_occurrences
    set appointment_id = p_appointment_id
    where id = p_occurrence_id;
end;
$$;

revoke execute on function public.link_chronic_checkin_appointment(uuid, uuid) from public, anon;
grant execute on function public.link_chronic_checkin_appointment(uuid, uuid) to authenticated;

-- Resolves the occurrence's status from the appointment's real lifecycle
-- rather than treating "booked" as "done" — completed lands the occurrence
-- completed; a cancelled/no_show appointment un-links it so the patient can
-- book again instead of being permanently stuck on a dead appointment_id.
create or replace function private.sync_chronic_checkin_occurrence_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'completed' then
    update public.chronic_programme_schedule_occurrences
      set status = 'completed', completed_at = now()
      where appointment_id = new.id and occurrence_type = 'doctor_checkin';
  elsif new.status in ('cancelled', 'patient_cancelled', 'provider_cancelled', 'no_show', 'expired', 'failed') then
    update public.chronic_programme_schedule_occurrences
      set appointment_id = null
      where appointment_id = new.id and occurrence_type = 'doctor_checkin' and status = 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_sync_chronic_checkin_occurrence on public.appointments;
create trigger appointments_sync_chronic_checkin_occurrence
  after update of status on public.appointments
  for each row execute function private.sync_chronic_checkin_occurrence_from_appointment();

do $$
begin
  if has_function_privilege('anon', 'public.link_chronic_checkin_appointment(uuid,uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute link_chronic_checkin_appointment';
  end if;
  raise notice 'PASS: chronic check-in <-> appointment linking + lifecycle sync in place';
end $$;
