-- S74 fix, found by the missing clinic-contract proof (packages/db/tests/s74_clinic_slot_contract.sql, D20): patient_confirm_clinic_reservation did not look at the
-- slot's own state. A patient who held a place (ten-minute hold) before the clinic closed the slot could still confirm it, ending with a confirmed place in a slot the
-- clinic had withdrawn and that shows on the clinic's roster. Holding already refused a closed slot (slot_not_available); confirming now does the same.
-- Live counts before this migration: clinic_slot_reservations 0 (module 28 is dormant), so no stored row is affected.
create or replace function public.patient_confirm_clinic_reservation(p_reservation uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); r public.clinic_slot_reservations%rowtype; s public.clinic_booking_slots%rowtype;
begin
  select * into r from public.clinic_slot_reservations where id = p_reservation and patient_id = v_uid for update;
  if not found then raise exception 'Reservation not found' using errcode = '42501'; end if;
  select * into s from public.clinic_booking_slots where id = r.slot_id for update;
  if r.state <> 'held' or r.hold_expires_at <= now() then raise exception 'hold_expired' using errcode = '22023'; end if;
  if s.state <> 'open' or s.starts_at <= now() then raise exception 'slot_not_available' using errcode = '22023'; end if;
  if not private.clinic_bookable(s.clinic_partner_id) then raise exception 'clinic_not_bookable' using errcode = '55000'; end if;
  update public.clinic_slot_reservations set state = 'confirmed', confirmed_at = now(), hold_expires_at = null where id = r.id;
  perform private.rx_notify(v_uid, r.organisation_id, 'clinic_booking_confirmed');
  perform private.log_audit('clinic.reservation_confirmed', 'clinic_slot_reservations', r.id, '{}'::jsonb);
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.patient_confirm_clinic_reservation(uuid)', 'EXECUTE') then raise exception 'anon can confirm a clinic reservation'; end if;
  if not has_function_privilege('authenticated', 'public.patient_confirm_clinic_reservation(uuid)', 'EXECUTE') then raise exception 'authenticated lost execute on confirm'; end if;
end $$;
