-- Appointment Engine — core invariants: double-booking prevention (10.6),
-- the RLS boundary (a patient only ever acts through the SECURITY DEFINER
-- RPCs, never a direct write), the hold -> confirm lifecycle, cancellation
-- triggering a waiting-list offer (10.17), provider leave cascading into a
-- cancel + notify + waitlist (10.10), and slot generation (10.4/10.5).
--
-- Rolled back. Fixtures resolved at runtime (an org with a clinician and at
-- least 3 patients) so it runs anywhere, per this repo's test convention —
-- see packages/db/tests/sponsor_pay_booking_order.sql for the same shape.
begin;

do $$
declare
  v_org          uuid;
  v_clinician    uuid;
  v_patient1     uuid;
  v_patient2     uuid;
  v_patient3     uuid;
  v_start        timestamptz := date_trunc('hour', now()) + interval '10 days' + interval '9 hours';
  v_appt1        uuid;
  v_appt2        uuid;
  v_status       public.appointment_status;
  v_wl_id        uuid;
  v_wl_status    public.appointment_waiting_list_status;
  v_offered_appt uuid;
  v_notif_count  integer;
begin
  select p.organisation_id into v_org
  from public.profiles p
  group by p.organisation_id
  having count(*) filter (where p.role = 'clinician') >= 1
     and count(*) filter (where p.role = 'patient') >= 3
  order by count(*) filter (where p.role = 'patient') desc
  limit 1;

  if v_org is null then
    raise exception 'need an organisation with a clinician and 3+ patients to run this test';
  end if;

  select id into v_clinician from public.profiles where organisation_id = v_org and role = 'clinician' limit 1;
  select id into v_patient1 from public.profiles where organisation_id = v_org and role = 'patient' order by id limit 1;
  select id into v_patient2 from public.profiles where organisation_id = v_org and role = 'patient' and id <> v_patient1 order by id limit 1;
  select id into v_patient3 from public.profiles where organisation_id = v_org and role = 'patient' and id not in (v_patient1, v_patient2) order by id limit 1;

  ---------------------------------------------------------------- 1. EXCLUDE constraint (direct DDL-level proof)
  insert into public.appointments (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status)
  values (v_org, v_patient1, v_clinician, 'gp', 'telemedicine', v_start, v_start + interval '30 minutes', 'booked')
  returning id into v_appt1;

  begin
    insert into public.appointments (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status)
    values (v_org, v_patient2, v_clinician, 'gp', 'telemedicine', v_start + interval '10 minutes', v_start + interval '40 minutes', 'booked');
    raise exception 'FAIL 1: an overlapping appointment for the same clinician was allowed';
  exception when exclusion_violation then null;
  end;

  -- Control: a non-overlapping appointment for the same clinician succeeds.
  insert into public.appointments (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status)
  values (v_org, v_patient2, v_clinician, 'gp', 'telemedicine', v_start + interval '30 minutes', v_start + interval '60 minutes', 'booked');

  ---------------------------------------------------------------- 2. hold_appointment_slot honours the same constraint
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient3, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.hold_appointment_slot(v_org, v_clinician, 'gp', 'telemedicine', v_start, v_start + interval '30 minutes');
    raise exception 'FAIL 2: hold_appointment_slot allowed a hold overlapping an existing booked appointment';
  exception when others then
    if sqlerrm not ilike '%just taken%' then raise; end if;
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 3. RLS: a patient cannot insert appointments directly
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.appointments (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status)
    values (v_org, v_patient1, v_clinician, 'gp', 'telemedicine', v_start + interval '2 days', v_start + interval '2 days 30 minutes', 'booked');
    raise exception 'FAIL 3: a patient inserted an appointment row directly';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  -- Control: staff (clinician role passes is_org_staff) can insert directly.
  perform set_config('request.jwt.claims', json_build_object('sub', v_clinician, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.appointments (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status)
  values (v_org, v_patient1, v_clinician, 'gp', 'telemedicine', v_start + interval '3 days', v_start + interval '3 days 30 minutes', 'booked');
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 4. hold -> confirm lifecycle
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select (public.hold_appointment_slot(v_org, v_clinician, 'gp', 'telemedicine', v_start + interval '4 days', v_start + interval '4 days 30 minutes')).id into v_appt2;
  select (public.confirm_appointment_booking(v_appt2)).status into v_status;
  perform set_config('role', 'postgres', true);

  if v_status <> 'confirmed' then
    raise exception 'FAIL 4: confirming a hold with payment_status=not_required ended up %, expected confirmed', v_status;
  end if;

  ---------------------------------------------------------------- 5. cancellation offers the freed slot to the waiting list
  insert into public.appointment_waiting_list (organisation_id, patient_id, appointment_type, preferred_from, preferred_until)
  values (v_org, v_patient3, 'gp', now(), v_start + interval '4 days 1 hour')
  returning id into v_wl_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.cancel_appointment(v_appt2, 'test cancellation');
  perform set_config('role', 'postgres', true);

  select status into v_status from public.appointments where id = v_appt2;
  if v_status <> 'patient_cancelled' then
    raise exception 'FAIL 5: cancelled appointment status is %, expected patient_cancelled', v_status;
  end if;

  select status, offered_appointment_id into v_wl_status, v_offered_appt from public.appointment_waiting_list where id = v_wl_id;
  if v_wl_status <> 'offered' or v_offered_appt is null then
    raise exception 'FAIL 5: waiting list entry was not offered the freed slot (status=%)', v_wl_status;
  end if;

  select status into v_status from public.appointments where id = v_offered_appt;
  if v_status <> 'held' then
    raise exception 'FAIL 5: offered appointment is %, expected held', v_status;
  end if;

  ---------------------------------------------------------------- 6. provider leave cascades: cancel + notify + waitlist
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select (public.hold_appointment_slot(v_org, v_clinician, 'gp', 'telemedicine', v_start + interval '5 days', v_start + interval '5 days 30 minutes')).id into v_appt1;
  perform public.confirm_appointment_booking(v_appt1);
  perform set_config('role', 'postgres', true);

  select count(*) into v_notif_count from public.notifications where recipient_id = v_patient1 and template = 'appointment_provider_cancelled';

  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (v_org, v_clinician, 'leave', v_start + interval '5 days' - interval '1 hour', v_start + interval '5 days' + interval '1 hour', 'test leave');

  select status into v_status from public.appointments where id = v_appt1;
  if v_status <> 'provider_cancelled' then
    raise exception 'FAIL 6: appointment overlapping newly-entered provider leave is %, expected provider_cancelled', v_status;
  end if;

  if (select count(*) from public.notifications where recipient_id = v_patient1 and template = 'appointment_provider_cancelled') <= v_notif_count then
    raise exception 'FAIL 6: no notification was queued for the leave-cancelled appointment';
  end if;

  if not exists (
    select 1 from public.appointment_waiting_list
    where patient_id = v_patient1 and source_appointment_id = v_appt1
  ) then
    raise exception 'FAIL 6: patient was not placed on the waiting list after their appointment was leave-cancelled';
  end if;

  ---------------------------------------------------------------- 7. slot generation reflects a freshly defined rule
  insert into public.provider_availability_rules
    (organisation_id, clinician_id, day_of_week, start_time, end_time, consultation_method, appointment_types, slot_duration_minutes, buffer_minutes)
  values
    (v_org, v_clinician, extract(dow from v_start + interval '20 days')::smallint, '09:00', '12:00', 'telemedicine', array['gp']::public.appointment_type[], 30, 0);

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if not exists (
    select 1 from public.get_available_appointment_slots(v_org, 'gp', 'telemedicine', v_clinician, (v_start + interval '20 days')::date, (v_start + interval '20 days')::date)
  ) then
    raise exception 'FAIL 7: get_available_appointment_slots returned no slots for a freshly defined rule';
  end if;
  perform set_config('role', 'postgres', true);

  raise notice 'PASS: EXCLUDE constraint blocks overlap (direct insert and via hold_appointment_slot), RLS blocks a direct patient write while the staff control succeeds, hold->confirm reaches confirmed, cancellation offers the freed slot to the waiting list, provider leave cascades into cancel+notify+waitlist, and slot generation returns a bookable slot from a fresh rule';
end $$;

rollback;
