-- S74 clinic calendar hardening (three gaps found while proving the contract).
-- Live counts before this migration (2026-10-23): clinic_booking_slots 0 (so 0 duplicates), clinic_slot_reservations 0. Postgres 17.6, so NULLS NOT DISTINCT is available.
--
-- 1. A slot with no location could be published twice: unique (clinic, location, starts_at) treats two NULL locations as different. Make them equal.
-- 2. Closing a slot left held and confirmed places standing, and the patients unaware. Closing now cancels them and tells each patient once, in the app.
-- 3. A confirmed place could be cancelled after the slot had started, erasing the record of a missed visit. Refused after the start; the clinic's attended /
--    no-show marking (states already in the table) is the record of what happened after that.

-- 1 ----------------------------------------------------------------------------------------------------------------------
do $$
declare v_dupes integer;
begin
  select count(*) into v_dupes from (select 1 from public.clinic_booking_slots group by clinic_partner_id, location_id, starts_at having count(*) > 1) x;
  if v_dupes > 0 then
    raise exception 'S74 hardening aborted: % group(s) of duplicate clinic slots (same clinic, location and start) exist; resolve them by hand before this unique rule can be added', v_dupes;
  end if;
end $$;
alter table public.clinic_booking_slots drop constraint clinic_booking_slots_clinic_partner_id_location_id_starts_a_key;
alter table public.clinic_booking_slots add constraint clinic_booking_slots_one_per_start unique nulls not distinct (clinic_partner_id, location_id, starts_at);

-- 2 ----------------------------------------------------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('clinic_booking_cancelled_by_clinic', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'S74: the clinic withdrew a time you had booked. Names no clinic reason (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('clinic_booking_cancelled_by_clinic', 'en', 'in_app', 'Your clinic visit time has changed', 'The clinic can no longer offer the time you booked. Open the app to choose another.')
on conflict (template_key, locale, channel) do nothing;

create or replace function public.clinic_close_slot(p_slot uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.clinic_booking_slots%rowtype; r record; v_n integer := 0;
begin
  select * into s from public.clinic_booking_slots where id = p_slot for update;
  if not found or not private.clinic_calendar_staff(s.clinic_partner_id) then raise exception 'Slot not found' using errcode = '42501'; end if;
  if s.state = 'closed' then return; end if;          -- closing twice does nothing, so no patient is told twice
  update public.clinic_booking_slots set state = 'closed' where id = p_slot;
  for r in select id, patient_id, organisation_id from public.clinic_slot_reservations where slot_id = p_slot and state in ('held', 'confirmed') for update loop
    update public.clinic_slot_reservations set state = 'cancelled', cancelled_at = now(), hold_expires_at = null where id = r.id;
    v_n := v_n + 1;
    begin
      perform private.rx_notify(r.patient_id, r.organisation_id, 'clinic_booking_cancelled_by_clinic');
    exception when others then null;                  -- a notice that cannot be written never blocks the closing
    end;
  end loop;
  perform private.log_audit('clinic.slot_closed', 'clinic_booking_slots', p_slot, jsonb_build_object('reservations_cancelled', v_n));
end $$;

-- 3 ----------------------------------------------------------------------------------------------------------------------
create or replace function public.patient_cancel_clinic_reservation(p_reservation uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.clinic_slot_reservations%rowtype; s public.clinic_booking_slots%rowtype;
begin
  select * into r from public.clinic_slot_reservations where id = p_reservation and patient_id = (select auth.uid()) and state in ('held', 'confirmed') for update;
  if not found then raise exception 'Reservation not found' using errcode = '42501'; end if;
  select * into s from public.clinic_booking_slots where id = r.slot_id;
  if r.state = 'confirmed' and s.starts_at <= now() then raise exception 'slot_already_started' using errcode = '22023'; end if;
  update public.clinic_slot_reservations set state = 'cancelled', cancelled_at = now(), hold_expires_at = null where id = r.id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.clinic_close_slot(uuid)', 'public.patient_cancel_clinic_reservation(uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated lost execute on %', f; end if;
  end loop;
end $$;
