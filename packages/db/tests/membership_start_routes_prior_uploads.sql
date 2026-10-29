-- Tarragon Health: what a Free patient uploaded reaches a doctor when they become a Member (migration 20261029195818).
--
-- Free uses no doctor time, so a result a Free patient uploads is stored and shown to them but raises no review alert. Records are not
-- time-gated, so a doctor can read those uploads once they open the chart, but nothing asked a doctor to LOOK. This proves, as the real
-- roles, in a transaction that is always rolled back:
--   1. while Free, an upload raises no alert, the patient sees it, and a doctor with no tie to the patient does NOT see it;
--   2. a doctor who opens the patient's record through the audited path (open_patient_record) CAN see the Free upload;
--   3. when the membership starts, the earlier unreviewed uploads are gathered under exactly ONE clinician review alert and each is
--      linked to it;
--   4. a document that already has a review, and one that is not the patient's own upload, is left alone;
--   5. the alert is routed to a doctor automatically and carries a count, not a result or a test name;
--   6. nothing is duplicated: a membership that is already active, or one that is only scheduled, creates no second alert;
--   7. a patient with no earlier uploads gets no alert;
--   8. the scheduled-then-active path (a membership bought ahead of time) routes when it becomes active.
--
-- Sabotage (by hand): drop trigger patient_memberships_route_prior_uploads. Case 3 must then fail.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/membership_start_routes_prior_uploads.sql

begin;

do $$
declare
  v_org uuid;
  v_verifier uuid;
  v_free uuid := gen_random_uuid();
  v_empty uuid := gen_random_uuid();
  v_ahead uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_d1 uuid; v_d2 uuid; v_d3 uuid; v_d4 uuid; v_dA uuid;
  v_alert uuid;
  v_n integer;
  v_membership uuid;
  v_title text;
  v_detail text;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_verifier from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_free, 'cont-free@example.invalid', 'x', now(), '{}', '{}'),
         (v_empty, 'cont-empty@example.invalid', 'x', now(), '{}', '{}'),
         (v_ahead, 'cont-ahead@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Cont Free', is_test = true, sex = 'female', date_of_birth = date '1980-01-01' where id = v_free;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Cont Empty', is_test = true, sex = 'male', date_of_birth = date '1980-01-01' where id = v_empty;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Cont Ahead', is_test = true, sex = 'male', date_of_birth = date '1980-01-01' where id = v_ahead;

  -- 1. the Free patient uploads three reports (no order, no membership): no alert is raised
  perform set_config('request.jwt.claims', json_build_object('sub', v_free, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_free, v_free::text || '/a.pdf', 'a.pdf', 'application/pdf', 1000, 'patient') returning id into v_d1;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_free, v_free::text || '/b.pdf', 'b.pdf', 'application/pdf', 1000, 'patient') returning id into v_d2;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_free, v_free::text || '/c.pdf', 'c.pdf', 'application/pdf', 1000, 'patient') returning id into v_d3;
  select count(*) into v_n from public.lab_result_documents where patient_id = v_free;
  reset role;
  if v_n <> 3 then raise exception 'FAIL 1: the Free patient sees % of their 3 uploads', v_n; end if;
  if exists (select 1 from public.lab_result_documents where id in (v_d1, v_d2, v_d3) and clinician_alert_id is not null) then
    raise exception 'FAIL 1: a Free upload raised a review alert (Free uses no doctor time)';
  end if;

  -- a report a clinic supplied, and one that has already been reviewed, must be left alone later
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source, uploaded_by)
  values (v_org, v_free, 'clinic/d.pdf', 'd.pdf', 'application/pdf', 1000, 'admin', v_verifier) returning id into v_d4;
  -- v_d3 is already reviewed by a doctor
  perform set_config('request.jwt.claims', null, true);
  update public.lab_result_documents set reviewed_at = now(), reviewed_by = v_verifier where id = v_d3;

  -- the doctor: active clinician, NO tie to this patient
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_doctor, 'cont-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Cont Doctor', is_test = true where id = v_doctor;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number,
                                     indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_doctor, v_org, 'Cont Doctor', 'senior_medical_officer', true, 'MDCN', 'CONT-001', true, v_verifier, v_verifier, now());

  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lab_result_documents where id in (v_d1, v_d2);
  reset role;
  if v_n <> 0 then raise exception 'FAIL 1: a doctor with no tie and no opened record reads a Free patient''s uploads'; end if;

  -- 2. the doctor opens the record through the audited path, and then can read the Free uploads
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.open_patient_record(v_free);
  select count(*) into v_n from public.lab_result_documents where id in (v_d1, v_d2, v_d3);
  reset role;
  if v_n <> 3 then raise exception 'FAIL 2: after opening the record the doctor sees % of the 3 Free uploads', v_n; end if;
  perform set_config('request.jwt.claims', null, true);
  -- the open is on the record: it must have been written to the audit trail, with the doctor as the actor
  if not exists (select 1 from public.staff_record_opens where staff_id = v_doctor and patient_id = v_free) then
    raise exception 'FAIL 2: opening the record left no record of who opened it';
  end if;

  -- 3. the membership starts: one alert, the earlier unreviewed patient uploads linked to it
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, is_test)
  values (v_org, v_free, 'purchase', 'active', now(), true) returning id into v_membership;
  select count(*) into v_n from public.clinician_alerts where patient_id = v_free and title = 'Results uploaded before membership: review needed';
  if v_n <> 1 then raise exception 'FAIL 3: % alerts for the membership start, expected exactly 1', v_n; end if;
  select id, title, detail into v_alert, v_title, v_detail from public.clinician_alerts where patient_id = v_free and title = 'Results uploaded before membership: review needed';
  select count(*) into v_n from public.lab_result_documents where clinician_alert_id = v_alert;
  if v_n <> 2 then raise exception 'FAIL 3: % documents linked to the alert, expected the 2 unreviewed patient uploads', v_n; end if;
  if not exists (select 1 from public.lab_result_documents where id = v_d1 and clinician_alert_id = v_alert)
     or not exists (select 1 from public.lab_result_documents where id = v_d2 and clinician_alert_id = v_alert) then
    raise exception 'FAIL 3: the wrong documents were linked';
  end if;

  -- 4. the reviewed one and the clinic-supplied one are untouched
  if exists (select 1 from public.lab_result_documents where id in (v_d3, v_d4) and clinician_alert_id is not null) then
    raise exception 'FAIL 4: a reviewed document or one the patient did not upload was routed to review';
  end if;

  -- the guard still protects the link from the patient: they cannot detach their own upload from its review alert, or attach it elsewhere
  perform set_config('request.jwt.claims', json_build_object('sub', v_free, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.lab_result_documents set clinician_alert_id = null where id = v_d1;
  update public.lab_result_documents set clinician_alert_id = gen_random_uuid() where id = v_d2;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if (select count(*) from public.lab_result_documents where id in (v_d1, v_d2) and clinician_alert_id = v_alert) <> 2 then
    raise exception 'FAIL 4: a patient could change the review alert their upload is linked to';
  end if;

  -- 5. routed to a doctor, and the text carries a count, not a result or a test name
  if not exists (select 1 from public.clinician_alerts where id = v_alert and (responsible_clinician_id is not null or assigned_at is not null)) then
    raise exception 'FAIL 5: the alert was not routed to anyone';
  end if;
  if v_detail !~ 'uploaded 2 result document' or v_detail ~* '(hba1c|hiv|glucose|cholesterol|result of)' then
    raise exception 'FAIL 5: the alert text is not a plain count: %', v_detail;
  end if;

  -- 6. nothing is duplicated
  update public.patient_memberships set state = 'active' where id = v_membership;           -- already active
  update public.patient_memberships set starts_at = starts_at - interval '1 day' where id = v_membership;
  select count(*) into v_n from public.clinician_alerts where patient_id = v_free and title = 'Results uploaded before membership: review needed';
  if v_n <> 1 then raise exception 'FAIL 6: % alerts after an unrelated membership update, expected still 1', v_n; end if;
  -- the membership lapses and is re-activated (a renewal): everything was already routed, so nothing new is created
  update public.patient_memberships set state = 'lapsed' where id = v_membership;
  update public.patient_memberships set state = 'active' where id = v_membership;
  select count(*) into v_n from public.clinician_alerts where patient_id = v_free and title = 'Results uploaded before membership: review needed';
  if v_n <> 1 then raise exception 'FAIL 6: re-activating a membership created a second alert (% total)', v_n; end if;

  -- 7. a patient with no earlier uploads gets no alert
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, is_test)
  values (v_org, v_empty, 'purchase', 'active', now(), true);
  select count(*) into v_n from public.clinician_alerts where patient_id = v_empty and title = 'Results uploaded before membership: review needed';
  if v_n <> 0 then raise exception 'FAIL 7: an alert was raised for a patient with no earlier uploads'; end if;

  -- 8. bought ahead of time: nothing while scheduled, routed when it becomes active
  perform set_config('request.jwt.claims', json_build_object('sub', v_ahead, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_ahead, v_ahead::text || '/e.pdf', 'e.pdf', 'application/pdf', 1000, 'patient') returning id into v_dA;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test)
  values (v_org, v_ahead, 'purchase', 'scheduled', now() + interval '10 days', now() + interval '375 days', true) returning id into v_membership;
  select count(*) into v_n from public.clinician_alerts where patient_id = v_ahead and title = 'Results uploaded before membership: review needed';
  if v_n <> 0 then raise exception 'FAIL 8: an alert was raised while the membership was only scheduled'; end if;
  update public.patient_memberships set state = 'active', starts_at = now() - interval '1 minute' where id = v_membership;
  select count(*) into v_n from public.clinician_alerts where patient_id = v_ahead and title = 'Results uploaded before membership: review needed';
  if v_n <> 1 then raise exception 'FAIL 8: % alerts once the scheduled membership became active, expected 1', v_n; end if;
  if (select clinician_alert_id from public.lab_result_documents where id = v_dA) is null then
    raise exception 'FAIL 8: the earlier upload was not linked when the membership became active';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
