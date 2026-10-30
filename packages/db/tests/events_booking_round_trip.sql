-- Tarragon Health: E6, a booking makes the full round trip (2026-10-30)
--
-- appointment_engine_core.sql proves the engine's invariants (overlap, holds, waitlist, leave).
-- This proof follows one booking across the people who touch it, reading each step through
-- RLS as that person, the way their screen does:
--
--   1  offered       a clinician's availability rule produces a bookable slot for a patient
--   2  booked        hold + confirm gives a confirmed appointment and an in-app confirmation to
--                    the patient; the booked slot is no longer offered and a second patient is
--                    refused it
--   3  seen          the clinician reads the appointment (status, time) through RLS; another
--                    patient and a clinician in another organisation read nothing
--   4  reminded      an appointment inside the 24 hour window gets exactly one reminder with
--                    its reply options; running the sweep again sends none; one 30 days away
--                    gets none
--   5  cancelled     the patient cancels: status patient_cancelled, patient notified, the slot
--                    is offered again, and the clinician's read shows the cancellation
--
-- Not asserted, reported instead: the clinician receives no notification of a new booking or a
-- patient cancellation (only the patient does). The clinician sees both on the appointments
-- screen; whether they should also be told is a product decision.
--
-- Fixtures built here (test accounts, since remote consultations are refused for real people
-- while the clinical-operations guard is off); BEGIN/ROLLBACK; raises on failure.
-- Run: psql "$DATABASE_URL" -f packages/db/tests/events_booking_round_trip.sql

begin;

create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table fxt (k text primary key, v timestamptz) on commit drop;
grant all on fxt to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.t(p text) returns timestamptz language sql as $$ select v from fxt where k = p $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
grant execute on function pg_temp.f(text), pg_temp.t(text), pg_temp.act(uuid), pg_temp.back() to public;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_odoc uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_day date := (current_date + 14);
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists, the core migrations did not run'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'EV6 Other Org', 'direct_consumer');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_doc, 'ev6-doc@example.invalid', 'x', now(), '{}', '{}'),
    (v_odoc, 'ev6-odoc@example.invalid', 'x', now(), '{}', '{}'),
    (v_pat, 'ev6-pat@example.invalid', 'x', now(), '{}', '{}'),
    (v_pat2, 'ev6-pat2@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values
    (v_doc, v_org, 'clinician', 'EV6 Doctor', null, true),
    (v_odoc, v_org2, 'clinician', 'EV6 Doctor Elsewhere', null, true),
    (v_pat, v_org, 'patient', 'EV6 Patient', date '1980-01-01', true),
    (v_pat2, v_org, 'patient', 'EV6 Patient Two', date '1982-02-02', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name, date_of_birth = excluded.date_of_birth, is_test = excluded.is_test;

  -- is_test: the primary-source (MDCN) verification gate on offering availability exempts test staff.
  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, active, employment_type, license_verified_at, is_test)
  values (v_org, v_doc, 'EV6 Doctor', 'senior_medical_officer', true, 'employed', now(), true);

  -- a full working day, so a slot exists whatever time zone the generator uses
  insert into public.provider_availability_rules
    (organisation_id, clinician_id, day_of_week, start_time, end_time, consultation_method, appointment_types, slot_duration_minutes, buffer_minutes)
  values (v_org, v_doc, extract(dow from v_day)::smallint, '06:00', '20:00', 'telemedicine', array['gp']::public.appointment_type[], 30, 0);

  insert into fx values ('org', v_org), ('doc', v_doc), ('odoc', v_odoc), ('pat', v_pat), ('pat2', v_pat2);
  insert into fxt values ('day', v_day::timestamptz);
end $$;

-- ================================================================ 1 offered
create function pg_temp.pick_slot() returns void language plpgsql as
$f$
declare s record; v_n integer; v_day date := pg_temp.t('day')::date;
begin
  perform pg_temp.act(pg_temp.f('pat'));
  select count(*) into v_n from public.get_available_appointment_slots(pg_temp.f('org'), 'gp', 'telemedicine', pg_temp.f('doc'), v_day, v_day);
  select * into s from public.get_available_appointment_slots(pg_temp.f('org'), 'gp', 'telemedicine', pg_temp.f('doc'), v_day, v_day)
   order by slot_start limit 1;
  perform pg_temp.back();
  if v_n = 0 then raise exception 'FAIL 1: no slot is offered for a clinician with a working-day rule'; end if;
  if s.clinician_id <> pg_temp.f('doc') then raise exception 'FAIL 1: the slot belongs to another clinician'; end if;
  insert into fxt values ('slot_start', s.slot_start), ('slot_end', s.slot_end);
end $f$;
select pg_temp.pick_slot();

-- ================================================================ 2 booked
create function pg_temp.book() returns void language plpgsql as
$f$
declare v_appt uuid; v_status text; v_after integer; v_day date := pg_temp.t('day')::date;
begin
  perform pg_temp.act(pg_temp.f('pat'));
  select (public.hold_appointment_slot(pg_temp.f('org'), pg_temp.f('doc'), 'gp', 'telemedicine',
            pg_temp.t('slot_start'), pg_temp.t('slot_end'))).id into v_appt;
  select (public.confirm_appointment_booking(v_appt)).status::text into v_status;
  perform pg_temp.back();
  insert into fx values ('appt', v_appt);
  if v_status <> 'confirmed' then raise exception 'FAIL 2: the booking ended %, expected confirmed', v_status; end if;

  -- the slot is gone from the offer
  perform pg_temp.act(pg_temp.f('pat2'));
  select count(*) into v_after from public.get_available_appointment_slots(pg_temp.f('org'), 'gp', 'telemedicine', pg_temp.f('doc'), v_day, v_day)
   where slot_start = pg_temp.t('slot_start');
  perform pg_temp.back();
  if v_after <> 0 then raise exception 'FAIL 2: the booked slot is still offered to other patients'; end if;
end $f$;
select pg_temp.book();

create function pg_temp.second_patient_refused() returns void language plpgsql as
$f$
declare v_refused boolean := false;
begin
  perform pg_temp.act(pg_temp.f('pat2'));
  begin
    perform public.hold_appointment_slot(pg_temp.f('org'), pg_temp.f('doc'), 'gp', 'telemedicine',
              pg_temp.t('slot_start'), pg_temp.t('slot_end'));
  exception when others then v_refused := true;
  end;
  perform pg_temp.back();
  if not v_refused then raise exception 'FAIL 2: a second patient was allowed to hold an already booked slot'; end if;
end $f$;
select pg_temp.second_patient_refused();

do $$
declare n record;
begin
  select count(*) as c, min(channel::text) as ch into n from public.notifications
   where recipient_id = pg_temp.f('pat') and template = 'appointment_booking_confirmation'
     and payload::text like '%' || pg_temp.f('appt')::text || '%';
  if n.c <> 1 then raise exception 'FAIL 2: the patient got % booking confirmations, expected 1', n.c; end if;
  if n.ch <> 'in_app' then raise exception 'FAIL 2: the confirmation went by %, the in-app channel is the one that cannot fail', n.ch; end if;
end $$;

-- ================================================================ 3 seen
create function pg_temp.who_sees() returns void language plpgsql as
$f$
declare v_doc integer; v_status text; v_pat2 integer; v_other integer; v_when timestamptz;
begin
  perform pg_temp.act(pg_temp.f('doc'));
  select count(*), min(status::text), min(scheduled_for) into v_doc, v_status, v_when from public.appointments where id = pg_temp.f('appt');
  perform pg_temp.back();
  perform pg_temp.act(pg_temp.f('pat2'));
  select count(*) into v_pat2 from public.appointments where id = pg_temp.f('appt');
  perform pg_temp.back();
  perform pg_temp.act(pg_temp.f('odoc'));
  select count(*) into v_other from public.appointments where id = pg_temp.f('appt');
  perform pg_temp.back();
  if v_doc <> 1 then raise exception 'FAIL 3: the clinician cannot see their own booking'; end if;
  if v_status <> 'confirmed' or v_when <> pg_temp.t('slot_start') then
    raise exception 'FAIL 3: the clinician sees status % at %, expected confirmed at the booked time', v_status, v_when;
  end if;
  if v_pat2 <> 0 then raise exception 'FAIL 3: another patient can read this appointment'; end if;
  if v_other <> 0 then raise exception 'FAIL 3: a clinician in another organisation can read this appointment'; end if;
end $f$;
select pg_temp.who_sees();

-- ================================================================ 4 reminded
do $$
declare v_n integer; v_far uuid; v_far_n integer; v_opts jsonb;
begin
  -- move the booking inside the 24 hour window
  update public.appointments
     set scheduled_for = now() + interval '23 hours', ends_at = now() + interval '23 hours 30 minutes'
   where id = pg_temp.f('appt');

  -- a control 30 days out, same patient, same doctor, different time
  insert into public.appointments (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status)
  values (pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('doc'), 'gp', 'telemedicine',
          now() + interval '30 days', now() + interval '30 days 30 minutes', 'confirmed')
  returning id into v_far;

  perform private.queue_appointment_reminders();

  select count(*) into v_n from public.notifications
   where recipient_id = pg_temp.f('pat') and template = 'appointment_reminder'
     and payload->>'appointment_id' = pg_temp.f('appt')::text and payload->>'milestone' = '24h';
  if v_n <> 1 then raise exception 'FAIL 4: % 24 hour reminders for the booking, expected 1', v_n; end if;

  select response_options into v_opts from public.notifications
   where recipient_id = pg_temp.f('pat') and template = 'appointment_reminder' and payload->>'milestone' = '24h'
     and payload->>'appointment_id' = pg_temp.f('appt')::text;
  if v_opts is null or jsonb_array_length(v_opts) < 3 then
    raise exception 'FAIL 4: the reminder carries no reply options, the patient cannot confirm or reschedule from it';
  end if;

  perform private.queue_appointment_reminders();
  perform private.queue_appointment_reminders();
  select count(*) into v_n from public.notifications
   where recipient_id = pg_temp.f('pat') and template = 'appointment_reminder'
     and payload->>'appointment_id' = pg_temp.f('appt')::text and payload->>'milestone' = '24h';
  if v_n <> 1 then raise exception 'FAIL 4: re-running the sweep sent % reminders in total, expected 1', v_n; end if;

  select count(*) into v_far_n from public.notifications
   where template = 'appointment_reminder' and payload->>'appointment_id' = v_far::text;
  if v_far_n <> 0 then raise exception 'FAIL 4: an appointment 30 days away was reminded % times', v_far_n; end if;

  delete from public.appointments where id = v_far;
  update public.appointments
     set scheduled_for = pg_temp.t('slot_start'), ends_at = pg_temp.t('slot_end')
   where id = pg_temp.f('appt');
end $$;

-- ================================================================ 5 cancelled
create function pg_temp.cancel_flow() returns void language plpgsql as
$f$
declare v_status text; v_offered integer; v_clin_status text; v_day date := pg_temp.t('day')::date;
begin
  perform pg_temp.act(pg_temp.f('pat'));
  perform public.cancel_appointment(pg_temp.f('appt'), 'EV6 cancel');
  perform pg_temp.back();

  select status::text into v_status from public.appointments where id = pg_temp.f('appt');
  if v_status <> 'patient_cancelled' then raise exception 'FAIL 5: cancelled booking is %, expected patient_cancelled', v_status; end if;

  if not exists (select 1 from public.notifications
                  where recipient_id = pg_temp.f('pat') and template = 'appointment_cancelled'
                    and payload::text like '%' || pg_temp.f('appt')::text || '%') then
    raise exception 'FAIL 5: the patient was not told the cancellation went through';
  end if;

  perform pg_temp.act(pg_temp.f('pat2'));
  select count(*) into v_offered from public.get_available_appointment_slots(pg_temp.f('org'), 'gp', 'telemedicine', pg_temp.f('doc'), v_day, v_day)
   where slot_start = pg_temp.t('slot_start');
  perform pg_temp.back();
  if v_offered <> 1 then raise exception 'FAIL 5: the cancelled slot is offered % times, expected once', v_offered; end if;

  perform pg_temp.act(pg_temp.f('doc'));
  select status::text into v_clin_status from public.appointments where id = pg_temp.f('appt');
  perform pg_temp.back();
  if v_clin_status is distinct from 'patient_cancelled' then
    raise exception 'FAIL 5: the clinician''s read shows % for the cancelled booking', v_clin_status;
  end if;
end $f$;
select pg_temp.cancel_flow();

select 'events_booking_round_trip: all checks passed' as result;

rollback;
