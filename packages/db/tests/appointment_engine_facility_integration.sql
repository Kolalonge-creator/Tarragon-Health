-- Appointment Engine, Phase 7 — Physical Consultation & Facility Appointment
-- Orchestration: facility-aware booking (69.5), preparation fields (69.6),
-- queue management incl. 'called' + is_late_arrival (69.8/69.9), facility-
-- filtered slot search, and the referral episode-linkage trigger (69.16).
--
-- Rolled back. Fixtures resolved at runtime, same shape as
-- appointment_engine_core.sql.
begin;

do $$
declare
  v_org            uuid;
  v_clinician      uuid;
  v_patient1       uuid;
  v_patient2       uuid;
  v_start          timestamptz := date_trunc('hour', now()) + interval '11 days' + interval '9 hours';
  v_facility_a     uuid;
  v_facility_b     uuid;
  v_appt           uuid;
  v_row            public.appointments;
  v_referral       uuid;
  v_referral_row   public.specialist_referrals;
  v_slot_count     integer;
begin
  select p.organisation_id into v_org
  from public.profiles p
  group by p.organisation_id
  having count(*) filter (where p.role = 'clinician') >= 1
     and count(*) filter (where p.role = 'patient') >= 2
  order by count(*) filter (where p.role = 'patient') desc
  limit 1;

  if v_org is null then
    raise exception 'need an organisation with a clinician and 2+ patients to run this test';
  end if;

  select id into v_clinician from public.profiles where organisation_id = v_org and role = 'clinician' limit 1;
  select id into v_patient1 from public.profiles where organisation_id = v_org and role = 'patient' order by id limit 1;
  select id into v_patient2 from public.profiles where organisation_id = v_org and role = 'patient' and id <> v_patient1 order by id limit 1;

  insert into public.facilities (name, type, state, city, is_active)
  values ('Test Facility Integration Clinic A', 'clinic', 'Lagos', 'Ikeja', true)
  returning id into v_facility_a;
  insert into public.facilities (name, type, state, city, is_active)
  values ('Test Facility Integration Clinic B', 'clinic', 'Lagos', 'Ikeja', true)
  returning id into v_facility_b;

  insert into public.facility_clinicians (organisation_id, facility_id, clinician_id)
  values (v_org, v_facility_a, v_clinician);

  ---------------------------------------------------------------- 1. hold_appointment_slot carries facility_id + 69.6 prep fields
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select (public.hold_appointment_slot(
    v_org, v_clinician, 'physical_clinic', 'in_person', v_start, v_start + interval '30 minutes',
    p_facility_id => v_facility_a,
    p_preparation_instructions => 'Fast for 8 hours before your visit',
    p_documents_required => array['Photo ID', 'Referral letter'],
    p_investigations_required => array['Fasting lipid panel']
  )).id into v_appt;
  -- Backward-compat smoke test: a caller that never mentions facility/prep at
  -- all (the pre-Phase-7 call shape) must still work unchanged.
  perform public.hold_appointment_slot(
    v_org, v_clinician, 'physical_clinic', 'in_person', v_start + interval '1 hour', v_start + interval '1 hour 30 minutes'
  );
  perform set_config('role', 'postgres', true);

  select * into v_row from public.appointments where id = v_appt;
  if v_row.facility_id <> v_facility_a then
    raise exception 'FAIL 1: appointment.facility_id is %, expected %', v_row.facility_id, v_facility_a;
  end if;
  if v_row.preparation_instructions is distinct from 'Fast for 8 hours before your visit' then
    raise exception 'FAIL 1: preparation_instructions was not persisted';
  end if;
  if v_row.documents_required <> array['Photo ID', 'Referral letter'] then
    raise exception 'FAIL 1: documents_required was not persisted correctly, got %', v_row.documents_required;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.confirm_appointment_booking(v_appt);
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 2. get_available_appointment_slots filters by facility
  insert into public.provider_availability_rules
    (organisation_id, clinician_id, day_of_week, start_time, end_time, consultation_method, appointment_types, slot_duration_minutes, buffer_minutes, facility_id)
  values
    (v_org, v_clinician, extract(dow from v_start + interval '21 days')::smallint, '09:00', '12:00', 'in_person', array['physical_clinic']::public.appointment_type[], 30, 0, v_facility_a);

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_slot_count
  from public.get_available_appointment_slots(v_org, 'physical_clinic', 'in_person', v_clinician, (v_start + interval '21 days')::date, (v_start + interval '21 days')::date, v_facility_a);
  if v_slot_count = 0 then
    raise exception 'FAIL 2: get_available_appointment_slots returned no slots when filtered to the rule''s own facility';
  end if;

  select count(*) into v_slot_count
  from public.get_available_appointment_slots(v_org, 'physical_clinic', 'in_person', v_clinician, (v_start + interval '21 days')::date, (v_start + interval '21 days')::date, v_facility_b);
  if v_slot_count <> 0 then
    raise exception 'FAIL 2: get_available_appointment_slots returned % slot(s) for a facility the rule is not published at', v_slot_count;
  end if;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 3. 69.8/69.9 queue: checked_in (late) -> called -> in_progress -> completed
  update public.appointments set scheduled_for = now() - interval '1 hour' where id = v_appt;

  perform set_config('request.jwt.claims', json_build_object('sub', v_clinician, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.advance_appointment_status(v_appt, 'checked_in');
  perform set_config('role', 'postgres', true);

  select * into v_row from public.appointments where id = v_appt;
  if not v_row.is_late_arrival then
    raise exception 'FAIL 3: appointment checked in 1 hour after scheduled_for was not flagged is_late_arrival';
  end if;

  if not exists (
    select 1 from public.get_facility_queue_today(v_facility_a) q where q.appointment_id = v_appt and q.status = 'checked_in'
  ) then
    raise exception 'FAIL 3: get_facility_queue_today did not surface the checked-in appointment';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_clinician, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.advance_appointment_status(v_appt, 'called');
  perform set_config('role', 'postgres', true);

  select * into v_row from public.appointments where id = v_appt;
  if v_row.status <> 'called' or v_row.called_at is null then
    raise exception 'FAIL 3: advance_appointment_status(''called'') did not set status/called_at';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_clinician, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.advance_appointment_status(v_appt, 'in_progress');
  perform public.advance_appointment_status(v_appt, 'completed');
  perform set_config('role', 'postgres', true);

  if exists (select 1 from public.get_facility_queue_today(v_facility_a) q where q.appointment_id = v_appt) then
    raise exception 'FAIL 3: a completed appointment is still showing in the facility queue';
  end if;

  ---------------------------------------------------------------- 4. 69.16 referral episode linkage — only ever moves a 'pending' referral
  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, status)
  values (v_org, v_patient2, 'cardiology', 'pending')
  returning id into v_referral;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select (public.hold_appointment_slot(
    v_org, v_clinician, 'specialist', 'in_person', v_start + interval '2 hours', v_start + interval '2 hours 30 minutes',
    p_specialist_referral_id => v_referral
  )).id into v_appt;
  perform public.confirm_appointment_booking(v_appt);
  perform set_config('role', 'postgres', true);

  select * into v_referral_row from public.specialist_referrals where id = v_referral;
  if v_referral_row.status <> 'booked' or v_referral_row.appointment_date is null then
    raise exception 'FAIL 4: booking a physical appointment against a pending referral did not sync appointment_date/status, got status=%', v_referral_row.status;
  end if;

  -- Control: a referral no longer 'pending' is never overwritten by a later appointment.
  select (public.hold_appointment_slot(
    v_org, v_clinician, 'specialist', 'in_person', v_start + interval '3 hours', v_start + interval '3 hours 30 minutes',
    p_specialist_referral_id => v_referral
  )).id into v_appt;
  update public.appointments set status = 'confirmed' where id = v_appt;

  select * into v_referral_row from public.specialist_referrals where id = v_referral;
  if v_referral_row.appointment_date = (select scheduled_for from public.appointments where id = v_appt) then
    raise exception 'FAIL 4: a second appointment overwrote an already-booked referral''s appointment_date';
  end if;

  raise notice 'PASS: facility-aware booking (facility_id + 69.6 prep fields), facility-filtered slot search, 69.8/69.9 queue (checked_in late-arrival flag, called, in_progress, completed dropping out of the facility queue), and 69.16 referral<->appointment episode linkage (idempotent, never clobbers an already-booked referral) all behave as expected';
end $$;

rollback;
