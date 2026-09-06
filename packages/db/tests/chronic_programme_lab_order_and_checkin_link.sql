-- Comprehensive order packages (§4.1) + the check-in <-> appointment link:
-- generate_chronic_programme_lab_order is staff-only, refuses a non-
-- lab_panel occurrence and a second order on an already-fulfilled one,
-- requires a real assigned clinician to attribute the order to (never the
-- calling Coordinator), and links back to the occurrence on success;
-- link_chronic_checkin_appointment is patient-or-staff-only and refuses an
-- appointment belonging to someone else; and the appointment lifecycle sync
-- resolves the occurrence's own status from the real appointment outcome
-- (completed -> completed; cancelled -> unlinked and rebookable) rather
-- than treating "booked" as "done".
--
-- Rolled back. Fixtures resolved at runtime, per this repo's test
-- convention.
begin;

do $$
declare
  v_org             uuid;
  v_patient         uuid;
  v_other_patient   uuid;
  v_staff_profile   uuid;
  v_programme       uuid;
  v_enrolment       uuid;
  v_occ_lab         uuid;
  v_occ_checkin     uuid;
  v_order_id        uuid;
  v_appt            uuid;
  v_other_appt      uuid;
  v_status          public.chronic_schedule_occurrence_status;
begin
  select id into v_programme from public.chronic_condition_programmes where code = 'hypertension';

  select p.organisation_id into v_org
  from public.profiles p
  where p.role = 'patient'
    and not exists (
      select 1 from public.chronic_programme_enrolments e
      where e.patient_id = p.id and e.programme_id = v_programme and e.status = 'enrolled'
    )
  limit 1;
  select id into v_patient from public.profiles where organisation_id = v_org and role = 'patient'
    and not exists (
      select 1 from public.chronic_programme_enrolments e
      where e.patient_id = profiles.id and e.programme_id = v_programme and e.status = 'enrolled'
    )
  limit 1;
  select id into v_other_patient from public.profiles where organisation_id = v_org and role = 'patient' and id <> v_patient limit 1;
  select profile_id into v_staff_profile from public.clinical_staff
    where organisation_id = v_org and active and doctor_tier is not null and doctor_tier <> 'care_coordinator'
  limit 1;

  if v_patient is null or v_other_patient is null or v_staff_profile is null then
    raise exception 'need 2 patients and an active real-doctor clinical_staff row in one organisation to run this test';
  end if;

  insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status)
  values (v_org, v_patient, v_programme, 'enrolled')
  returning id into v_enrolment;

  select id into v_occ_lab from public.chronic_programme_schedule_occurrences
    where enrolment_id = v_enrolment and week_number = 1 and occurrence_type = 'lab_panel';

  ---------------------------------------------------------------- 1. patient cannot generate the order themselves
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.generate_chronic_programme_lab_order(v_occ_lab);
    raise exception 'FAIL 1: the patient generated their own lab order directly';
  exception when others then
    if sqlerrm not ilike '%not authorised%' then raise; end if;
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 2. staff call fails with no assigned clinician
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.generate_chronic_programme_lab_order(v_occ_lab);
    raise exception 'FAIL 2: an order was generated with no care_team_assignment for this patient';
  exception when others then
    if sqlerrm not ilike '%no assigned clinician%' then raise; end if;
  end;
  perform set_config('role', 'postgres', true);

  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id)
  values (v_org, v_patient, v_staff_profile);

  ---------------------------------------------------------------- 3. success: order generated, linked back, attributed correctly
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_order_id := public.generate_chronic_programme_lab_order(v_occ_lab);
  perform set_config('role', 'postgres', true);

  if v_order_id is null then
    raise exception 'FAIL 3: generate_chronic_programme_lab_order returned no order id';
  end if;
  if (select chronic_programme_occurrence_id from public.lab_orders where id = v_order_id) <> v_occ_lab then
    raise exception 'FAIL 3: the lab order was not linked back to the occurrence';
  end if;
  if (select lab_order_id from public.chronic_programme_schedule_occurrences where id = v_occ_lab) <> v_order_id then
    raise exception 'FAIL 3: the occurrence was not linked to the generated order';
  end if;
  if (select ordered_by from public.lab_orders where id = v_order_id) is distinct from (select id from public.clinical_staff where profile_id = v_staff_profile) then
    raise exception 'FAIL 3: the order was not attributed to the patient''s assigned clinician';
  end if;

  ---------------------------------------------------------------- 4. a second attempt on the same occurrence is refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.generate_chronic_programme_lab_order(v_occ_lab);
    raise exception 'FAIL 4: a second lab order was generated for an occurrence that already has one';
  exception when others then
    if sqlerrm not ilike '%already exists%' then raise; end if;
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 5. a non-lab_panel occurrence is refused
  select id into v_occ_checkin from public.chronic_programme_schedule_occurrences
    where enrolment_id = v_enrolment and week_number = 12 and occurrence_type = 'programme_end_review';
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.generate_chronic_programme_lab_order(v_occ_checkin);
    raise exception 'FAIL 5: an order was generated for a non-lab_panel occurrence';
  exception when others then
    if sqlerrm not ilike '%not a lab_panel%' then raise; end if;
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 6. link_chronic_checkin_appointment refuses someone else's appointment
  -- Repoint the enrolment to doctor_supported isn't needed for this RPC —
  -- it only checks occurrence_type, so reuse a manufactured doctor_checkin
  -- occurrence id shape is unnecessary; insert two appointments instead,
  -- one per patient, and confirm cross-patient linking is refused.
  insert into public.chronic_programme_schedule_occurrences
    (organisation_id, patient_id, enrolment_id, occurrence_type, week_number, due_date, status)
  values (v_org, v_patient, v_enrolment, 'doctor_checkin', 4, current_date + 21, 'pending')
  on conflict (enrolment_id, week_number, occurrence_type) do update set status = excluded.status
  returning id into v_occ_checkin;

  insert into public.appointments (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status)
  values (v_org, v_patient, v_staff_profile, 'follow_up', 'telemedicine', now() + interval '3 days', now() + interval '3 days 30 minutes', 'confirmed')
  returning id into v_appt;
  insert into public.appointments (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status)
  values (v_org, v_other_patient, v_staff_profile, 'follow_up', 'telemedicine', now() + interval '4 days', now() + interval '4 days 30 minutes', 'confirmed')
  returning id into v_other_appt;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.link_chronic_checkin_appointment(v_occ_checkin, v_other_appt);
    raise exception 'FAIL 6: linked an appointment belonging to a different patient';
  exception when others then
    if sqlerrm not ilike '%does not belong to this patient%' then raise; end if;
  end;

  ---------------------------------------------------------------- 7. the patient CAN link their own appointment
  perform public.link_chronic_checkin_appointment(v_occ_checkin, v_appt);
  perform set_config('role', 'postgres', true);
  if (select appointment_id from public.chronic_programme_schedule_occurrences where id = v_occ_checkin) <> v_appt then
    raise exception 'FAIL 7: the patient''s own appointment was not linked';
  end if;

  ---------------------------------------------------------------- 8. completing the appointment resolves the occurrence to completed
  update public.appointments set status = 'completed', completed_at = now() where id = v_appt;
  select status into v_status from public.chronic_programme_schedule_occurrences where id = v_occ_checkin;
  if v_status <> 'completed' then
    raise exception 'FAIL 8: completing the linked appointment did not mark the occurrence completed (status=%)', v_status;
  end if;

  ---------------------------------------------------------------- 9. a cancelled appointment un-links a still-pending occurrence
  insert into public.chronic_programme_schedule_occurrences
    (organisation_id, patient_id, enrolment_id, occurrence_type, week_number, due_date, status, appointment_id)
  values (v_org, v_patient, v_enrolment, 'doctor_checkin', 8, current_date + 49, 'pending', v_other_appt)
  returning id into v_occ_checkin;
  update public.appointments set status = 'patient_cancelled', cancelled_at = now() where id = v_other_appt;
  if (select appointment_id from public.chronic_programme_schedule_occurrences where id = v_occ_checkin) is not null then
    raise exception 'FAIL 9: a cancelled appointment left the occurrence still linked (should be un-linked and rebookable)';
  end if;

  raise notice 'PASS: generate_chronic_programme_lab_order is staff-only, occurrence-type-checked, duplicate-safe, and correctly attributed; link_chronic_checkin_appointment is patient-or-staff-only and ownership-checked; the appointment lifecycle sync resolves completed/cancelled correctly';
end $$;

rollback;
