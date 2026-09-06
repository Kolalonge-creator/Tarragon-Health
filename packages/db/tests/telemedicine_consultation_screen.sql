-- Tarragon Health
-- Live proof for the Telemedicine Consultation Platform gap closure
-- (68.3/68.5/68.8/68.9/68.15/68.17): ensure_appointment_video_consultation's
-- ownership gate, set_video_consultation_call_state/confirm_consultation_identity's
-- staff-only gate, advance_appointment_status's no_show_reason validation,
-- consultation_prep_bundle's new allergy/condition fields, and
-- publish_consultation_summary's "must be finalized, clinical-tier only" gate.
--
-- Every negative case is paired with a positive control on the same row/
-- action, per CLAUDE.md's own rule -- a blocked-everything bug would
-- otherwise pass a negatives-only test.
--
-- Run: npx supabase db query --linked -f packages/db/tests/telemedicine_consultation_screen.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, expected text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org           uuid := '00000000-0000-0000-0000-000000000001';
  v_pat           uuid;
  v_pat2          uuid;
  v_doc           uuid;  -- profile that will hold a Tier 2 clinical_staff row
  v_coord         uuid;  -- profile that will hold a Care Coordinator clinical_staff row
  v_appt          uuid;
  v_appt_noshow   uuid;
  v_appt_badreason uuid;
  v_consult       uuid;
  v_note          uuid;
  v_blocked       boolean;
  v_err           text;
  v_row           public.appointments%rowtype;
  v_video_row     public.video_consultations%rowtype;
  v_bundle        jsonb;
  v_count         int;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org order by created_at limit 1;
  select id into v_pat2 from public.profiles where role = 'patient' and organisation_id = v_org and id <> v_pat order by created_at limit 1;
  if v_pat is null or v_pat2 is null then
    raise exception 'need at least 2 patient profiles in org 0001 to build this fixture';
  end if;

  select id into v_doc from public.profiles
    where role::text in ('clinician', 'admin', 'doctor') and organisation_id = v_org
    order by created_at limit 1;
  select id into v_coord from public.profiles
    where role::text in ('clinician', 'admin', 'doctor', 'care_coordinator') and organisation_id = v_org and id <> v_doc
    order by created_at limit 1;
  if v_doc is null or v_coord is null then
    raise exception 'need at least 2 org-staff profiles in org 0001 to build this fixture';
  end if;

  delete from public.clinical_staff where profile_id in (v_doc, v_coord);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, is_clinical_director)
  values
    (v_org, v_doc,   'Telemedicine Test: Tier 2 Doctor', true, now(), 'tier_2', false),
    (v_org, v_coord, 'Telemedicine Test: Care Coordinator', true, now(), 'care_coordinator', false);

  ---------------------------------------------------------------------------
  -- Fixtures: two telemedicine appointments for v_pat with v_doc as
  -- clinician (one drives the call-state cases, the other stays untouched
  -- for the no-show case so its status starts clean), plus fixture allergy
  -- and problem-list rows for the prep-bundle case.
  ---------------------------------------------------------------------------
  insert into public.appointments
    (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status)
  values
    (v_org, v_pat, v_doc, 'gp', 'telemedicine', now() + interval '1 hour', now() + interval '1 hour 15 minutes', 'confirmed')
  returning id into v_appt;

  insert into public.appointments
    (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status)
  values
    (v_org, v_pat, v_doc, 'gp', 'telemedicine', now() + interval '2 hours', now() + interval '2 hours 15 minutes', 'confirmed')
  returning id into v_appt_noshow;

  insert into public.appointments
    (organisation_id, patient_id, clinician_id, appointment_type, consultation_method, scheduled_for, ends_at, status)
  values
    (v_org, v_pat, v_doc, 'gp', 'telemedicine', now() + interval '3 hours', now() + interval '3 hours 15 minutes', 'confirmed')
  returning id into v_appt_badreason;

  delete from public.patient_allergies where patient_id = v_pat and allergen = 'Telemedicine Test Allergen';
  insert into public.patient_allergies (organisation_id, patient_id, allergen, reaction, severity, source)
  values (v_org, v_pat, 'Telemedicine Test Allergen', 'Rash', 'moderate', 'clinician');

  delete from public.patient_conditions where patient_id = v_pat and condition_name = 'Telemedicine Test Condition';
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status)
  values (v_org, v_pat, 'Telemedicine Test Condition', 'active');

  ---------------------------------------------------------------------------
  -- 1. Patient ensures a video consultation on their OWN telemedicine
  --    appointment -> ALLOWED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    select * into v_video_row from public.ensure_appointment_video_consultation(v_appt);
    v_consult := v_video_row.id;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (1, 'Patient ensures a video consultation on their own appointment', 'ALLOWED',
    case when not v_blocked and v_consult is not null then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));

  select * into v_row from public.appointments where id = v_appt;
  insert into test_result values (2, 'appointments.video_consultation_id was actually linked', 'LINKED',
    case when v_row.video_consultation_id = v_consult then 'LINKED (correct)' else 'NOT LINKED (BUG)' end, '');

  ---------------------------------------------------------------------------
  -- 3. CONTROL: a DIFFERENT patient attempts the same on v_pat's
  --    appointment -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.ensure_appointment_video_consultation(v_appt);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (3, 'CONTROL a different patient cannot touch this appointment''s video consultation', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG -- cross-patient access)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 4. Idempotency: calling it again (as the same patient) returns the SAME
  --    row, not a second one
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    select * into v_video_row from public.ensure_appointment_video_consultation(v_appt);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'Calling ensure_appointment_video_consultation again is idempotent', 'SAME ROW',
    case when not v_blocked and v_video_row.id = v_consult then 'SAME ROW (correct)' else 'NEW ROW OR ERROR (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 5. Doctor starts the call -> ALLOWED, and the linked appointment moves
  --    to in_progress in the same call
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.set_video_consultation_call_state(v_consult, 'started');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (5, 'Doctor starts the call', 'ALLOWED',
    case when not v_blocked then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));

  select * into v_row from public.appointments where id = v_appt;
  insert into test_result values (6, 'Starting the call also advanced the linked appointment to in_progress', 'in_progress',
    case when v_row.status = 'in_progress' then 'in_progress (correct)' else v_row.status::text || ' (BUG)' end, '');

  ---------------------------------------------------------------------------
  -- 7. CONTROL: the PATIENT cannot change the call state themselves
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.set_video_consultation_call_state(v_consult, 'completed');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (7, 'CONTROL patient cannot set call state on their own consultation', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG -- patient can end their own call)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 8. Doctor confirms patient identity -> ALLOWED
  -- 9. CONTROL: patient cannot confirm their own identity
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.confirm_consultation_identity(v_consult);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (8, 'Doctor confirms patient identity', 'ALLOWED',
    case when not v_blocked then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));

  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.confirm_consultation_identity(v_consult);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (9, 'CONTROL patient cannot confirm identity on their own consultation', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG -- patient can self-attest identity check)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 10. Staff marks the OTHER appointment a patient no-show, with a reason
  -- 11. An invalid no_show_reason value is rejected
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.advance_appointment_status(v_appt_noshow, 'no_show', 'patient_no_show');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select * into v_row from public.appointments where id = v_appt_noshow;
  insert into test_result values (10, 'Staff marks a differentiated patient no-show', 'no_show / patient_no_show',
    case when not v_blocked and v_row.status = 'no_show' and v_row.no_show_reason = 'patient_no_show'
         then 'CORRECT' else 'BUG: ' || coalesce(v_row.status::text, 'null') || '/' || coalesce(v_row.no_show_reason, 'null') end,
    coalesce(v_err, ''));

  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.advance_appointment_status(v_appt_badreason, 'no_show', 'not_a_real_reason');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (11, 'An invalid no_show_reason value is rejected', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG -- accepted a free-text reason)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 12. consultation_prep_bundle now surfaces allergies + active conditions
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    select public.consultation_prep_bundle(v_consult) into v_bundle;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (12, 'consultation_prep_bundle includes the fixture allergy and condition', 'PRESENT',
    case when not v_blocked
          and exists (select 1 from jsonb_array_elements(v_bundle -> 'allergies') e where e ->> 'allergen' = 'Telemedicine Test Allergen')
          and exists (select 1 from jsonb_array_elements(v_bundle -> 'active_conditions') e where e ->> 'condition_name' = 'Telemedicine Test Condition')
         then 'PRESENT (correct)' else 'MISSING (BUG): ' || coalesce(v_bundle::text, coalesce(v_err, 'null')) end, '');

  ---------------------------------------------------------------------------
  -- 13. publish_consultation_summary refuses a DRAFT note
  -- 14. CONTROL: Care Coordinator cannot publish even once the note is
  --     finalized
  -- 15. Doctor publishes once the note is finalized -> ALLOWED
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.clinical_encounter_notes
    (organisation_id, patient_id, encounter_type, video_consultation_id, reason_for_encounter, plan)
  values
    (v_org, v_pat, 'video_consult', v_consult, 'Telemedicine Test fixture', 'Continue current management')
  returning id into v_note;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.publish_consultation_summary(v_note, 'We talked about your blood pressure.');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (13, 'publish_consultation_summary refuses a draft note', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG -- published from an unsigned draft)' end, coalesce(v_err, ''));

  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.clinical_encounter_notes set status = 'finalized', outcome = 'continue_monitoring' where id = v_note;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.publish_consultation_summary(v_note, 'We talked about your blood pressure.');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (14, 'CONTROL Care Coordinator cannot publish a patient summary', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG -- coordinator can author clinical summaries)' end, coalesce(v_err, ''));

  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.publish_consultation_summary(v_note, 'We talked about your blood pressure.', 'Keep taking your tablets daily.');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (15, 'Doctor publishes the summary once the note is finalized', 'ALLOWED',
    case when not v_blocked then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 16. The published summary is visible to the owning patient
  -- 17. CONTROL: a different patient cannot see it
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.consultation_patient_summaries where clinical_encounter_note_id = v_note;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (16, 'The owning patient can see their own published summary', '1 row',
    case when v_count = 1 then '1 row (correct)' else v_count::text || ' rows (BUG)' end, '');

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.consultation_patient_summaries where clinical_encounter_note_id = v_note;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (17, 'CONTROL a different patient cannot see this summary', '0 rows',
    case when v_count = 0 then '0 rows (correct)' else v_count::text || ' rows (BUG -- summary visible cross-patient)' end, '');
end $$;

select case_num, label, expected, outcome, left(detail, 160) as detail
from test_result order by case_num;

rollback;
