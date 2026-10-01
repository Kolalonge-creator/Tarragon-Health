-- ===========================================================================
-- Proof: 20261001*_s05_*.sql (v5 S05 health record data model; OQ-02, OQ-03, OQ-11, OQ-23).
--
-- Proves, against the real migrated schema, with simulated sessions per role (patient, an unrelated patient standing in for a
-- supporter with no grant, a tied prescriber clinician, an untied clinician, an admin, two pharmacists of different partners):
--   1. Idempotency: a repeated client_id is rejected (symptoms, medication_logs, and the existing vitals key); a different key and
--      a missing key still insert; another patient may reuse the same key.
--   2. Observations / dose_events views: the patient sees her own rows in v5 shape, another patient sees none.
--   3. The existing red-flag triggers still fire (a hypertensive-crisis BP, a low SpO2 and a dangerous pulse each raise an
--      emergency event) and the manual-vitals timestamp rule is untouched.
--   4. Prescriptions (INV-02): a draft is invisible to the patient; moving out of draft stamps the prescriber as herself; an
--      unsigned prescription cannot be sent (CHECK); an untied or unqualified clinician cannot create or sign; signed items are
--      frozen; the state machine only moves forward; only the partner a prescription was sent to can see and dispense it; staff
--      have no direct read (admin, an untied clinician).
--   5. Referrals (INV-02): leaving draft stamps the signer; an unsigned non-draft referral is refused by the CHECK.
--   6. Notes (INV-11): a draft (AI-drafted or not) is invisible to the patient; a finalized note is visible to her alone; the notes
--      view reports draft / signed / amended; an amendment of a draft or of another patient's note is refused.
--   7. Audited reads (INV-10, INV-12): the tied clinician reads the chart and the read is audited with its sections; an untied
--      clinician, an admin and an unrelated patient get nothing, and the refusal is audited (a patient caller raises and writes
--      nothing); a reason under 10 characters and an unknown section raise; break-glass admits the untied clinician for that
--      category; anon cannot execute; opening a document is audited and gated the same way.
--   8. Direct staff reads of patient_documents and family_history are closed (the patient and the uploader still read).
--   9. SABOTAGE, one per area, each proving its check can fail: drop the prescription signature CHECK and trigger; restore the old
--      org-staff read of patient_documents; make the INV-12 stub return true; relax the signed-notes-only patient policy.
--
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- Run:  psql -f packages/db/tests/s05_health_record_data_model.sql  (CI: scripts/run-db-proofs.sh)
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_tied uuid := gen_random_uuid();       -- senior medical officer, on the patient's care team
  v_untied uuid := gen_random_uuid();     -- medical officer, no tie to the patient
  v_admin uuid := gen_random_uuid();
  v_ph uuid := gen_random_uuid();         -- pharmacist of partner A
  v_ph2 uuid := gen_random_uuid();        -- pharmacist of partner B
  v_sup uuid := gen_random_uuid();        -- supporter granted the medications category
  v_sup2 uuid := gen_random_uuid();       -- supporter granted a different category
  v_pa uuid;
  v_pp uuid;
  v_pp2 uuid;
  v_med uuid;
  v_rx uuid;
  v_rx2 uuid;
  v_ref uuid;
  v_note uuid;
  v_note2 uuid;
  v_note_ai uuid;
  v_doc uuid;
  v_doc_staff uuid;
  v_bp uuid;
  v_n integer;
  v_failed boolean;
  v_sqlstate text;
  v_state text;
  v_signed_by uuid;
  v_json jsonb;
  v_path text;
  v_audits_before integer;
  c_other_sections text[] := array['vitals','medications','notes'];
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,    's05-pat@example.invalid',    'x', now(), '{}', '{}'),
    (v_pat2,   's05-pat2@example.invalid',   'x', now(), '{}', '{}'),
    (v_tied,   's05-tied@example.invalid',   'x', now(), '{}', '{}'),
    (v_untied, 's05-untied@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin,  's05-admin@example.invalid',  'x', now(), '{}', '{}'),
    (v_ph,     's05-ph@example.invalid',     'x', now(), '{}', '{}'),
    (v_ph2,    's05-ph2@example.invalid',    'x', now(), '{}', '{}'),
    (v_sup,    's05-sup@example.invalid',    'x', now(), '{}', '{}'),
    (v_sup2,   's05-sup2@example.invalid',   'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org, 'patient',    'S05 Patient One',  '+2348051110001'),
    (v_pat2,   v_org, 'patient',    'S05 Patient Two',  '+2348051110002'),
    (v_tied,   v_org, 'clinician',  'S05 Tied Doctor',  '+2348051110003'),
    (v_untied, v_org, 'clinician',  'S05 Untied Doctor','+2348051110004'),
    (v_admin,  v_org, 'admin',      'S05 Admin',        '+2348051110005'),
    (v_ph,     v_org, 'pharmacist', 'S05 Pharmacist A', '+2348051110006'),
    (v_ph2,    v_org, 'pharmacist', 'S05 Pharmacist B', '+2348051110007'),
    (v_sup,    v_org, 'patient',    'S05 Supporter',    '+2348051110008'),
    (v_sup2,   v_org, 'patient',    'S05 Supporter Two','+2348051110009')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_tied,   'S05 Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org, v_untied, 'S05 Untied Doctor', true, now(), 'medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now())
  on conflict (patient_id) do update set clinician_id = v_tied;

  insert into public.pharmacy_partners (name, is_active) values ('S05 Pharmacy A', false) returning id into v_pp;
  insert into public.pharmacy_partners (name, is_active) values ('S05 Pharmacy B', false) returning id into v_pp2;
  update public.profiles set pharmacy_partner_id = v_pp  where id = v_ph;
  update public.profiles set pharmacy_partner_id = v_pp2 where id = v_ph2;

  -- =========================================================================
  -- 1. Idempotency
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, client_id)
  values (v_org, v_pat, 'dizziness', 3, 'aaaaaaaa-0000-0000-0000-000000000001');
  v_failed := false; v_sqlstate := null;
  begin
    insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, client_id)
    values (v_org, v_pat, 'dizziness', 3, 'aaaaaaaa-0000-0000-0000-000000000001');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '23505' then
    raise exception 'FAIL 1a: a repeated symptom client_id was accepted (failed=%, sqlstate=%)', v_failed, v_sqlstate;
  end if;
  -- controls: a different key and two keyless rows still insert
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, client_id) values (v_org, v_pat, 'dizziness', 3, 'aaaaaaaa-0000-0000-0000-000000000002');
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (v_org, v_pat, 'dizziness', 3);
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (v_org, v_pat, 'dizziness', 3);
  execute 'reset role';
  -- another patient may reuse the same key
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, client_id)
  values (v_org, v_pat2, 'dizziness', 3, 'aaaaaaaa-0000-0000-0000-000000000001');
  execute 'reset role';

  -- a medication to log doses against, and the dose-log key
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active)
  values (v_org, v_pat, 'S05 Amlodipine', '5mg', 'daily', 'clinician', true) returning id into v_med;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_for_date, scheduled_time, client_id)
  values (v_org, v_pat, v_med, 'taken', current_date, '08:00', 'bbbbbbbb-0000-0000-0000-000000000001');
  v_failed := false; v_sqlstate := null;
  begin
    insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_for_date, scheduled_time, client_id)
    values (v_org, v_pat, v_med, 'taken', current_date, '08:00', 'bbbbbbbb-0000-0000-0000-000000000001');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '23505' then
    raise exception 'FAIL 1b: a repeated dose-log client_id was accepted (failed=%, sqlstate=%)', v_failed, v_sqlstate;
  end if;
  -- the existing vitals key
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, client_reading_id)
  values (v_org, v_pat, 'blood_pressure', 124, 78, 'manual', now(), 'cccccccc-0000-0000-0000-000000000001');
  v_failed := false;
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, client_reading_id)
    values (v_org, v_pat, 'blood_pressure', 124, 78, 'manual', now(), 'cccccccc-0000-0000-0000-000000000001');
  exception when unique_violation then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 1c: a repeated vitals client_reading_id was accepted'; end if;
  execute 'reset role';

  -- =========================================================================
  -- 2. v5-shaped views
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.observations where type = 'bp' and systolic = 124 and diastolic = 78 and unit = 'mmHg'
     and client_id = 'cccccccc-0000-0000-0000-000000000001' and source = 'patient' and recorded_by = v_pat;
  if v_n <> 1 then raise exception 'FAIL 2a: observations did not map the BP reading (found %)', v_n; end if;
  select count(*) into v_n from public.dose_events where status = 'taken' and schedule_id = v_med and client_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if v_n <> 1 then raise exception 'FAIL 2b: dose_events did not map the dose (found %)', v_n; end if;
  select count(*) into v_n from public.symptom_reports where patient_id = v_pat;
  if v_n <> 4 then raise exception 'FAIL 2c: symptom_reports shows % rows, expected 4', v_n; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.observations where patient_id = v_pat;
  if v_n <> 0 then raise exception 'FAIL 2d: another patient read % observations of the first patient', v_n; end if;
  select count(*) into v_n from public.dose_events where patient_id = v_pat;
  if v_n <> 0 then raise exception 'FAIL 2d: another patient read % dose events of the first patient', v_n; end if;
  execute 'reset role';

  -- =========================================================================
  -- 3. Existing triggers still fire
  -- =========================================================================
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values (v_org, v_pat2, 'blood_pressure', 200, 125, 'device', now()) returning id into v_bp;
  if not exists (select 1 from public.emergency_events where vital_reading_id = v_bp) then
    raise exception 'FAIL 3a: a hypertensive-crisis BP raised no emergency event';
  end if;
  select count(*) into v_n from public.emergency_events where patient_id = v_pat2;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at)
  values (v_org, v_pat2, 'spo2', 80, 'device', now());
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at)
  values (v_org, v_pat2, 'pulse', 190, 'device', now());
  if (select count(*) from public.emergency_events where patient_id = v_pat2) < v_n + 2 then
    raise exception 'FAIL 3b: a low SpO2 and a dangerous pulse did not each raise an emergency event';
  end if;
  -- the manual-vitals rule: a patient cannot backdate a manual reading (the trigger stamps taken_at = now())
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, source, taken_at)
  values (v_org, v_pat2, 'weight', 70.5, 'manual', now() - interval '10 days') returning id into v_bp;
  execute 'reset role';
  if (select taken_at from public.vitals_readings where id = v_bp) < now() - interval '1 day' then
    raise exception 'FAIL 3c: a manual reading was backdated, the existing timestamp rule no longer holds';
  end if;
  -- a weight reading maps to value_numeric and unit in the generic view
  select count(*) into v_n from public.observations where id = v_bp and type = 'weight' and value_numeric = 70.5 and unit = 'kg';
  if v_n <> 1 then raise exception 'FAIL 3d: the weight observation did not map (found %)', v_n; end if;

  -- =========================================================================
  -- 4. Prescriptions (INV-02)
  -- =========================================================================
  -- an untied, non-prescribing clinician cannot create one
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    insert into public.prescriptions (organisation_id, patient_id, items) values (v_org, v_pat, '[{"drug":"x"}]');
  exception when others then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 4a: an untied, non-prescribing clinician created a prescription'; end if;

  -- the tied prescriber creates a draft; a session cannot create one already past draft
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    insert into public.prescriptions (organisation_id, patient_id, items, state) values (v_org, v_pat, '[{"drug":"x"}]', 'sent');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 4b: a prescription was created already sent'; end if;
  insert into public.prescriptions (organisation_id, patient_id, items, pharmacy_partner_id)
  values (v_org, v_pat, '[{"drug":"Amlodipine","dose":"5mg"}]', v_pp) returning id into v_rx;
  select state::text, signed_by into v_state, v_signed_by from public.prescriptions where id = v_rx;
  if v_state <> 'draft' or v_signed_by is not null then raise exception 'FAIL 4c: new prescription not an unsigned draft'; end if;
  execute 'reset role';

  -- the patient cannot see the draft
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.prescriptions;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 4d: the patient saw % draft prescriptions', v_n; end if;

  -- an unqualified clinician cannot sign it (RLS: zero rows touched)
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.prescriptions set state = 'signed' where id = v_rx;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n <> 0 or (select state from public.prescriptions where id = v_rx) <> 'draft' then
    raise exception 'FAIL 4e: an untied, non-prescribing clinician signed a prescription';
  end if;

  -- the tied prescriber signs: stamped as herself; items now frozen; cannot skip ahead or go back
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.prescriptions set state = 'signed' where id = v_rx;
  select signed_by into v_signed_by from public.prescriptions where id = v_rx;
  if v_signed_by is distinct from v_tied or (select signed_at from public.prescriptions where id = v_rx) is null then
    raise exception 'FAIL 4f: signing did not stamp the prescriber and the time';
  end if;
  v_failed := false;
  begin update public.prescriptions set items = '[{"drug":"Other"}]' where id = v_rx;
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '42501' then raise exception 'FAIL 4g: signed items were altered (sqlstate=%)', v_sqlstate; end if;
  v_failed := false;
  begin update public.prescriptions set state = 'draft' where id = v_rx;
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 4h: a signed prescription moved back to draft'; end if;
  v_failed := false;
  begin update public.prescriptions set state = 'dispensed' where id = v_rx;
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 4i: a signed prescription skipped straight to dispensed'; end if;
  v_failed := false;
  begin update public.prescriptions set signed_by = v_untied where id = v_rx;
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 4j: the signature was reassigned'; end if;
  update public.prescriptions set state = 'sent' where id = v_rx;
  execute 'reset role';

  -- the unsigned prescription can never be sent, even from a service context that skips the stamping
  perform set_config('request.jwt.claims', null, true);
  v_failed := false; v_sqlstate := null;
  begin
    insert into public.prescriptions (organisation_id, patient_id, items, state) values (v_org, v_pat, '[]', 'sent');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '23514' then
    raise exception 'FAIL 4k: an unsigned prescription was sent from a service context (failed=%, sqlstate=%)', v_failed, v_sqlstate;
  end if;

  -- the patient now sees the sent prescription; the other patient does not
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.prescriptions where id = v_rx;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL 4l: the patient did not see her sent prescription'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.prescriptions;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 4m: another patient saw % prescriptions', v_n; end if;

  -- Care Circle: the supporter granted `medications` sees the sent prescription; the one granted another category does not
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);  -- only the patient may grant
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level)
  values (v_pat, v_sup, v_pat, 'view') returning id into v_pa;
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medications');
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level)
  values (v_pat, v_sup2, v_pat, 'view') returning id into v_pa;
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'vitals_readings');
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.prescriptions where id = v_rx;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL 4m2: a supporter granted medications did not see the prescription (the gate does not open)'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.prescriptions;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 4m3: a supporter without the medications category saw % prescriptions', v_n; end if;

  -- staff have no direct read: an admin and an untied clinician see nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.prescriptions;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 4n: an admin read % prescriptions directly', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.prescriptions;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 4o: an untied clinician read % prescriptions directly', v_n; end if;

  -- partner scoping: the pharmacist of partner B sees none; partner A sees it and can dispense but not alter it
  perform set_config('request.jwt.claims', json_build_object('sub', v_ph2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.prescriptions;
  update public.prescriptions set state = 'dispensed' where id = v_rx;
  execute 'reset role';
  if v_n <> 0 or (select state from public.prescriptions where id = v_rx) <> 'sent' then
    raise exception 'FAIL 4p: the wrong partner saw or dispensed the prescription';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ph, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.prescriptions where id = v_rx;
  if v_n <> 1 then raise exception 'FAIL 4q: the named partner did not see the prescription'; end if;
  v_failed := false;
  begin update public.prescriptions set items = '[]' where id = v_rx;
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 4r: the pharmacist altered the signed items'; end if;
  v_failed := false;
  begin update public.prescriptions set pharmacy_partner_id = v_pp2, state = 'dispensed' where id = v_rx;
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 4r2: the pharmacist rerouted the prescription to another partner'; end if;
  update public.prescriptions set state = 'dispensed' where id = v_rx;
  execute 'reset role';
  if (select state from public.prescriptions where id = v_rx) <> 'dispensed' then
    raise exception 'FAIL 4s: the named partner could not dispense (the gate does not open)';
  end if;

  -- the author reads back her own row only within the inserting transaction; a later session no longer sees it directly
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.prescriptions where id = v_rx;
  if v_n <> 1 then raise exception 'FAIL 4t: the author could not read back the row she wrote'; end if;
  execute 'reset role';
  update public.prescriptions set created_at = now() - interval '1 day' where id = v_rx;
  execute 'set local role authenticated';
  select count(*) into v_n from public.prescriptions where id = v_rx;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 4u: the author kept a standing direct read of a prescription from an earlier day'; end if;

  -- =========================================================================
  -- 5. Referrals (INV-02)
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason, status)
  values (v_org, v_pat, (enum_range(null::public.specialist_type))[1], 'S05 proof', 'draft') returning id into v_ref;
  if (select signed_by from public.specialist_referrals where id = v_ref) is not null then
    raise exception 'FAIL 5a: a draft referral carries a signature';
  end if;
  execute 'reset role';
  -- from a service context nothing stamps it, so leaving draft is refused by the CHECK
  perform set_config('request.jwt.claims', null, true);
  v_failed := false; v_sqlstate := null;
  begin update public.specialist_referrals set status = 'pending' where id = v_ref;
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '23514' then
    raise exception 'FAIL 5b: an unsigned referral left draft (failed=%, sqlstate=%)', v_failed, v_sqlstate;
  end if;
  -- the clinician leaving draft is the signing act, stamped as herself
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.specialist_referrals set status = 'pending' where id = v_ref;
  execute 'reset role';
  select signed_by into v_signed_by from public.specialist_referrals where id = v_ref;
  if v_signed_by is distinct from v_tied or (select signed_at from public.specialist_referrals where id = v_ref) is null then
    raise exception 'FAIL 5c: the referral signing act did not stamp the clinician';
  end if;
  v_failed := false;
  begin update public.specialist_referrals set signed_by = v_untied where id = v_ref;
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 5d: the referral signature was reassigned'; end if;

  -- =========================================================================
  -- 6. Notes (INV-11)
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter)
  values (v_org, v_pat, 'phone', 'S05 review') returning id into v_note;
  insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter, ai_drafted)
  values (v_org, v_pat, 'phone', 'S05 AI draft', true) returning id into v_note_ai;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.clinical_encounter_notes;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 6a: the patient saw % draft notes (INV-11)', v_n; end if;

  -- an amendment of a draft is refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter, amends_note_id)
    values (v_org, v_pat, 'phone', 'S05 amend draft', v_note);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 6b: a draft note was amended'; end if;
  -- finalize the first note
  update public.clinical_encounter_notes
     set status = 'finalized', identity_confirmed = true, outcome = (enum_range(null::public.consultation_outcome))[1]
   where id = v_note;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.clinical_encounter_notes;
  if v_n <> 1 then raise exception 'FAIL 6c: the patient sees % notes, expected only the finalized one', v_n; end if;
  select count(*) into v_n from public.notes where state = 'signed';
  if v_n <> 1 then raise exception 'FAIL 6d: the notes view did not report the signed note'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.clinical_encounter_notes;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 6e: another patient saw % notes', v_n; end if;

  -- an amendment of a finalized note: allowed for the same patient, refused across patients
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter, amends_note_id)
    values (v_org, v_pat2, 'phone', 'S05 cross-patient amend', v_note);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 6f: a note amended another patient''s note'; end if;
  insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter, amends_note_id)
  values (v_org, v_pat, 'phone', 'S05 amendment', v_note) returning id into v_note2;
  update public.clinical_encounter_notes
     set status = 'finalized', identity_confirmed = true, outcome = (enum_range(null::public.consultation_outcome))[1]
   where id = v_note2;
  execute 'reset role';
  select count(*) into v_n from public.notes where id = v_note and state = 'amended';
  if v_n <> 1 then raise exception 'FAIL 6g: the original did not read as amended'; end if;
  select count(*) into v_n from public.notes where id = v_note2 and state = 'signed';
  if v_n <> 1 then raise exception 'FAIL 6h: the amendment did not read as signed'; end if;

  -- =========================================================================
  -- 7. Audited reads (INV-10, INV-12)
  -- =========================================================================
  -- the insert trigger stamps uploaded_by from the session, so act as the patient to keep her as the uploader
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source, uploaded_by)
  values (v_org, v_pat, 'other', v_pat::text || '/s05-test.pdf', 'patient', v_pat) returning id into v_doc;

  -- 7a. the tied clinician reads the chart; the read is audited with its sections
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_chart_audited(v_pat, c_other_sections, 'S05 proof: tied clinician review') into v_json;
  execute 'reset role';
  if jsonb_array_length(v_json -> 'sections' -> 'vitals') < 1
     or jsonb_array_length(v_json -> 'sections' -> 'medications') < 1
     or jsonb_array_length(v_json -> 'sections' -> 'notes') < 2 then
    raise exception 'FAIL 7a: the tied clinician did not receive the chart sections: %', v_json;
  end if;
  select count(*) into v_n from public.audit_log
   where action = 'staff.chart_read' and result = 'success' and actor_id = v_tied and subject_patient_id = v_pat
     and event -> 'sections' @> '"vitals"'::jsonb and event ->> 'reason' = 'S05 proof: tied clinician review';
  if v_n <> 1 then raise exception 'FAIL 7a: the tied read left % success audit rows, expected 1', v_n; end if;

  -- 7b. an untied clinician is refused and the refusal is audited
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_chart_audited(v_pat, c_other_sections, 'S05 proof: untied clinician attempt') into v_json;
  execute 'reset role';
  if v_json -> 'sections' <> '{}'::jsonb then raise exception 'FAIL 7b: an untied clinician received chart data: %', v_json; end if;
  select count(*) into v_n from public.audit_log
   where action = 'staff.chart_read' and result = 'denied' and actor_id = v_untied and subject_patient_id = v_pat;
  if v_n < 1 then raise exception 'FAIL 7b: the refusal was not audited'; end if;

  -- 7b2. a stale booked appointment never ties a clinician; an upcoming one does (the gate opens)
  insert into public.appointments (organisation_id, patient_id, clinician_id, scheduled_for, ends_at, status, appointment_type, consultation_method)
  values (v_org, v_pat, v_untied, now() - interval '30 days', now() - interval '30 days' + interval '30 minutes', 'booked', (enum_range(null::public.appointment_type))[1], (enum_range(null::public.appointment_consultation_method))[1]);
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_chart_audited(v_pat, array['vitals'], 'S05 proof: stale appointment attempt') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'denied' then raise exception 'FAIL 7b2: a stale booked appointment tied the clinician: %', v_json; end if;
  insert into public.appointments (organisation_id, patient_id, clinician_id, scheduled_for, ends_at, status, appointment_type, consultation_method)
  values (v_org, v_pat, v_untied, now() + interval '2 days', now() + interval '2 days' + interval '30 minutes', 'booked', (enum_range(null::public.appointment_type))[1], (enum_range(null::public.appointment_consultation_method))[1]);
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_chart_audited(v_pat, array['vitals'], 'S05 proof: upcoming appointment read') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' then raise exception 'FAIL 7b2: an upcoming appointment did not tie the clinician: %', v_json; end if;
  delete from public.appointments where clinician_id = v_untied and patient_id = v_pat;

  -- 7c. an admin with no support session is refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_chart_audited(v_pat, array['vitals'], 'S05 proof: admin attempt') into v_json;
  execute 'reset role';
  if v_json -> 'sections' <> '{}'::jsonb then raise exception 'FAIL 7c: an admin without a session received chart data'; end if;

  -- 7d. a patient caller raises and writes nothing
  select count(*) into v_audits_before from public.audit_log where actor_id = v_pat2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_sqlstate := null;
  begin perform public.read_patient_chart_audited(v_pat, array['vitals'], 'S05 proof: patient attempt');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  execute 'reset role';
  if not v_failed or v_sqlstate <> '42501' then raise exception 'FAIL 7d: a patient caller was not refused (sqlstate=%)', v_sqlstate; end if;
  if (select count(*) from public.audit_log where actor_id = v_pat2 and action = 'staff.chart_read') <> 0 then
    raise exception 'FAIL 7d: a patient caller left a chart_read audit row';
  end if;

  -- 7e. short reason and unknown section raise
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_sqlstate := null;
  begin perform public.read_patient_chart_audited(v_pat, array['vitals'], 'short');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '22023' then raise exception 'FAIL 7e: a short reason was accepted'; end if;
  v_failed := false; v_sqlstate := null;
  begin perform public.read_patient_chart_audited(v_pat, array['vitals', null], 'S05 proof: null section');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '22023' then raise exception 'FAIL 7e: a NULL section was accepted'; end if;
  v_failed := false; v_sqlstate := null;
  begin perform public.read_patient_chart_audited(v_pat, array['reproductive_health'], 'S05 proof: unknown section');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '22023' then raise exception 'FAIL 7e: an unknown section was accepted'; end if;
  execute 'reset role';

  -- 7f. anon cannot execute either function
  if has_function_privilege('anon', 'public.read_patient_chart_audited(uuid,text[],text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.open_patient_document_audited(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL 7f: anon can execute an audited clinical read';
  end if;

  -- 7g. break-glass admits the untied clinician for a covered category (control: the gate opens)
  insert into public.emergency_record_access_grants (patient_id, patient_org_id, requester_id, requester_org_id, reason, expires_at)
  values (v_pat, v_org, v_untied, v_org, 'S05 proof: emergency read of a collapsed patient', now() + interval '1 hour');
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_chart_audited(v_pat, array['vitals'], 'S05 proof: break-glass read') into v_json;
  execute 'reset role';
  if jsonb_array_length(v_json -> 'sections' -> 'vitals') < 1 then
    raise exception 'FAIL 7g: break-glass did not admit the untied clinician';
  end if;

  -- 7h. opening a document: the tied clinician gets the path (audited); a refused caller gets null (audited)
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.open_patient_document_audited(v_doc, 'S05 proof: open the uploaded document') into v_path;
  execute 'reset role';
  if v_path is distinct from v_pat::text || '/s05-test.pdf' then raise exception 'FAIL 7h: the tied clinician did not get the document path'; end if;
  if (select count(*) from public.audit_log where action = 'staff.document_open' and result = 'success' and actor_id = v_tied and entity_id = v_doc) <> 1 then
    raise exception 'FAIL 7h: the document open was not audited';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.open_patient_document_audited(v_doc, 'S05 proof: admin opens a document') into v_path;
  execute 'reset role';
  if v_path is not null then raise exception 'FAIL 7h: a refused caller received the document path'; end if;

  -- =========================================================================
  -- 8. Direct staff reads closed on patient_documents and family_history
  -- =========================================================================
  insert into public.family_history (organisation_id, patient_id, condition_name, relationship, recorded_by)
  values (v_org, v_pat, 'S05 hypertension', 'mother', v_pat);
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_documents;
  if v_n <> 0 then raise exception 'FAIL 8a: staff read % documents directly', v_n; end if;
  select count(*) into v_n from public.family_history;
  if v_n <> 0 then raise exception 'FAIL 8b: staff read % family-history rows directly', v_n; end if;
  -- own-entry: a document the clinician uploaded herself reads back (INSERT ... RETURNING needs the policy)
  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source, uploaded_by)
  values (v_org, v_pat, 'specialist_letter', v_pat::text || '/s05-letter.pdf', 'clinician', v_tied) returning id into v_doc_staff;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_documents;
  if v_n <> 2 then raise exception 'FAIL 8c: the patient reads % documents, expected her 2', v_n; end if;
  select count(*) into v_n from public.family_history;
  if v_n <> 1 then raise exception 'FAIL 8c: the patient reads % family-history rows, expected 1', v_n; end if;
  execute 'reset role';

  -- =========================================================================
  -- 9. SABOTAGE: each proves its check can fail
  -- =========================================================================
  -- 9a. without the signature CHECK and trigger an unsigned prescription is sent
  perform set_config('request.jwt.claims', null, true);
  alter table public.prescriptions drop constraint prescriptions_signed_before_send;
  alter table public.prescriptions disable trigger prescriptions_enforce_rules;
  insert into public.prescriptions (organisation_id, patient_id, items, state) values (v_org, v_pat, '[]', 'sent') returning id into v_rx2;
  if not exists (select 1 from public.prescriptions where id = v_rx2 and signed_by is null and state = 'sent') then
    raise exception 'FAIL SABOTAGE 9a: with the guards off the unsigned send still failed, so checks 4b/4k prove nothing';
  end if;

  -- 9b. restore the old staff read of patient_documents: the tied clinician would see the patient's documents
  create policy s05_sabotage_old_staff_read on public.patient_documents for select to authenticated using (private.is_org_staff(organisation_id));
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_documents where patient_id = v_pat and uploaded_by = v_pat;
  execute 'reset role';
  drop policy s05_sabotage_old_staff_read on public.patient_documents;
  if v_n = 0 then raise exception 'FAIL SABOTAGE 9b: the old policy did not expose the documents, so check 8a proves nothing'; end if;

  -- 9c. make the INV-12 stub return true: the untied clinician would now pass the gate (break-glass grant removed first)
  delete from public.emergency_record_access_grants where requester_id = v_untied;
  create or replace function private.clinician_has_patient_access(p_patient uuid) returns boolean
    language sql stable security definer set search_path = '' as 'select true';
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_chart_audited(v_pat, array['vitals'], 'S05 proof: sabotage of the tie') into v_json;
  execute 'reset role';
  if v_json -> 'sections' = '{}'::jsonb then
    raise exception 'FAIL SABOTAGE 9c: with the tie stubbed to true the untied clinician was still refused, so check 7b proves nothing';
  end if;

  -- 9d. relax the signed-notes-only patient policy: the patient would see the drafts
  drop policy clinical_encounter_notes_select_own_signed on public.clinical_encounter_notes;
  create policy clinical_encounter_notes_select_own_signed on public.clinical_encounter_notes
    for select to authenticated using (patient_id = (select auth.uid()));
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.clinical_encounter_notes where status = 'draft';
  execute 'reset role';
  if v_n = 0 then raise exception 'FAIL SABOTAGE 9d: the relaxed policy did not expose the drafts, so check 6a proves nothing'; end if;

  raise notice 'S05 proof: all checks and 4 sabotages passed';
end $$;

rollback;
