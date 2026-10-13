-- ===========================================================================
-- Proof: *_s05b_blood_profile_verification.sql, *_s05b_supersede_not_edit_corrections.sql, *_s05b_lab_range_source.sql (S05b).
--
--   A. Blood group and genotype: a clinician recording against the patient's own lab report gives verification = lab_verified; a patient
--      can only ever produce self_reported (even when she claims a lab document, and even when she edits a lab-backed row); the column
--      cannot be written; a report that belongs to someone else is refused.
--   B. Supersede-not-edit on vitals_readings, patient_allergies, lab_analyte_readings (and the same trigger on patient_conditions):
--      value columns cannot be edited (even by the service role), rows cannot be deleted (a cascade from the account still works),
--      correction links cannot be forged, and public.correct_clinical_value keeps the original, creates the replacement, records the
--      actor and reason (also in record_corrections), refuses a second correction, an untied clinician, another patient, a patient
--      marking "cancelled", and a patient touching a reading a clinician already reviewed (entered_in_error is then refused for the
--      clinician too: cancelled).
--   C. Range source: a stored range must declare its source; named sources need a reference; lab_result_items are stamped from the
--      sign-off state of the panel version; the three read paths carry range_source.
--   D. SABOTAGE (each must flip): the provenance trigger dropped lets a patient reach lab_verified; the supersession trigger dropped lets
--      the service role edit a value; the range constraint dropped lets an unlabelled range in.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_p   uuid := gen_random_uuid();
  v_p2  uuid := gen_random_uuid();
  v_p3  uuid := gen_random_uuid();
  v_c   uuid := gen_random_uuid();   -- tied clinician
  v_u   uuid := gen_random_uuid();   -- untied clinician
  v_cs  uuid;
  v_doc uuid;
  v_doc2 uuid;
  v_v1 uuid; v_v2 uuid; v_v3 uuid; v_v4 uuid; v_v5 uuid;
  v_al uuid;
  v_lab uuid;
  v_res jsonb;
  v_state text;
  v_row record;
  v_n int;
  v_flipped boolean;
  v_lr uuid;
  v_pv uuid;
  v_pc text;
  v_wc uuid;
  v_cc uuid := gen_random_uuid();   -- care coordinator
  v_v6 uuid; v_v7 uuid; v_al2 uuid; v_ccs uuid;
  v_item record;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_p,  's05b-p@example.invalid',  'x', now(), '{}', '{}'),
    (v_p2, 's05b-p2@example.invalid', 'x', now(), '{}', '{}'),
    (v_p3, 's05b-p3@example.invalid', 'x', now(), '{}', '{}'),
    (v_c,  's05b-c@example.invalid',  'x', now(), '{}', '{}'),
    (v_u,  's05b-u@example.invalid',  'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_p,  v_org, 'patient',   'S05b Patient One',  '+2348055550001'),
    (v_p2, v_org, 'patient',   'S05b Patient Two',  '+2348055550002'),
    (v_p3, v_org, 'patient',   'S05b Patient Three','+2348055550003'),
    (v_c,  v_org, 'clinician', 'S05b Tied Doctor',  '+2348055550004'),
    (v_u,  v_org, 'clinician', 'S05b Untied Doctor','+2348055550005')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_c, 'S05b Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org, v_u, 'S05b Untied Doctor', true, now(), 'senior_medical_officer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_cc, 's05b-cc@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone)
  values (v_cc, v_org, 'clinician', 'S05b Coordinator', '+2348055550006')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
  values (v_org, v_cc, 'S05b Coordinator', true, now(), 'care_coordinator');
  select id into v_cs from public.clinical_staff where profile_id = v_c;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_p, v_c, now()) on conflict (patient_id) do update set clinician_id = v_c;

  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, source)
  values (v_org, v_p, 'test/s05b-mine.pdf', 'mine.pdf', 'application/pdf', 'patient') returning id into v_doc;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, source)
  values (v_org, v_p2, 'test/s05b-theirs.pdf', 'theirs.pdf', 'application/pdf', 'patient') returning id into v_doc2;

  -- ======================================================================== A. blood verification
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- A1 NEGATIVE: a report that belongs to another patient is refused
  v_state := null;
  begin
    insert into public.patient_blood_profile (patient_id, organisation_id, genotype, provenance, document_id, recorded_by)
    values (v_p, v_org, 'AS', 'lab_document', v_doc2, v_c);
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
  end;
  if v_state is null then raise exception 'FAIL A1: a lab-backed value against someone else''s report was accepted'; end if;

  -- A2 CONTROL (the gate opens): the clinician records against the patient's own report
  insert into public.patient_blood_profile (patient_id, organisation_id, blood_group, genotype, provenance, document_id, recorded_by)
  values (v_p, v_org, 'O+', 'AS', 'lab_document', v_doc, v_c);
  if (select verification from public.patient_blood_profile where patient_id = v_p) is distinct from 'lab_verified' then
    raise exception 'FAIL A2: a lab-backed row is not lab_verified';
  end if;

  -- A3 the column is generated: nobody can write it
  v_state := null;
  begin
    update public.patient_blood_profile set verification = 'lab_verified' where patient_id = v_p;
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
  end;
  if v_state is distinct from '428C9' then raise exception 'FAIL A3: verification was writable (state %)', v_state; end if;

  -- A4 the patient tries to overwrite the lab-backed row: source precedence (lab beats attestation) keeps the lab values, the row stays
  --    lab_verified, and her claim is recorded rather than applied
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  update public.patient_blood_profile
     set genotype = 'AA', provenance = 'patient_attested', document_id = null, attestation_version = 'v1'
   where patient_id = v_p;
  select * into v_row from public.patient_blood_profile where patient_id = v_p;
  if v_row.genotype <> 'AS' or v_row.verification is distinct from 'lab_verified' then
    raise exception 'FAIL A4: a patient edit overwrote a lab-backed value (genotype %, verification %)', v_row.genotype, v_row.verification;
  end if;
  execute 'reset role';
  if not exists (select 1 from public.superseded_source_values where entity_table = 'patient_blood_profile' and patient_id = v_p) then
    raise exception 'FAIL A4b: the refused patient claim was not recorded';
  end if;
  execute 'set local role authenticated';

  -- A5 a patient insert claiming a lab document is stored as self_reported
  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  insert into public.patient_blood_profile (patient_id, organisation_id, genotype, provenance, document_id, attestation_version)
  values (v_p2, v_org, 'SS', 'lab_document', v_doc2, 'v1');
  if (select verification from public.patient_blood_profile where patient_id = v_p2) is distinct from 'self_reported' then
    raise exception 'FAIL A5: a patient reached lab_verified';
  end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS A: blood group and genotype verification';

  -- ======================================================================== B. supersede, never edit
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p, 'weight', 70, now() - interval '3 hours', 'manual') returning id into v_v1;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p, 'weight', 71, now() - interval '2 hours', 'manual') returning id into v_v2;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p, 'weight', 72, now() - interval '1 hours', 'manual') returning id into v_v3;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p, 'weight', 73, now() - interval '50 minutes', 'manual') returning id into v_v4;
  update public.vitals_readings set validated_by = v_cs, validated_at = now() where id = v_v4;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p2, 'weight', 80, now() - interval '40 minutes', 'manual') returning id into v_v5;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source)
  values (v_org, v_p, 'Penicillin', 'moderate', 'clinician') returning id into v_al;
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, range_source, reference_range_text)
  values (v_org, v_p, 'hba1c', 6.1, '%', now(), 'lab_report', '4.0 - 5.6') returning id into v_lab;

  -- B1 NEGATIVE: even the service role (bypasses RLS) cannot edit a value, delete a row, or forge a chain
  execute 'set local role service_role';
  v_state := null;
  begin update public.vitals_readings set weight_kg = 99 where id = v_v1;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B1a: a recorded vitals value was edited (state %)', v_state; end if;

  v_state := null;
  begin delete from public.vitals_readings where id = v_v1;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B1b: a recorded vitals row was deleted (state %)', v_state; end if;

  v_state := null;
  begin update public.vitals_readings set correction_status = 'corrected', correction_reason = 'forged entry', corrected_at = now() where id = v_v1;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B1c: correction columns were writable directly (state %)', v_state; end if;

  v_state := null;
  begin insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source, supersedes_id)
        values (v_org, v_p, 'weight', 60, now(), 'manual', v_v1);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B1d: a forged supersedes_id was accepted (state %)', v_state; end if;

  v_state := null;
  begin update public.patient_allergies set allergen = 'Aspirin' where id = v_al;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B1e: an allergy value was edited (state %)', v_state; end if;

  v_state := null;
  begin update public.lab_analyte_readings set value = 5.0 where id = v_lab;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B1f: a lab value was edited (state %)', v_state; end if;

  -- B1 CONTROL: a non-value column still updates, so the guard is not "everything is frozen"
  update public.vitals_readings set note = 'checked by the nurse' where id = v_v1;
  if (select note from public.vitals_readings where id = v_v1) is distinct from 'checked by the nurse' then
    raise exception 'FAIL B1g: a note could not be added';
  end if;
  execute 'reset role';

  -- B2 a delete is refused unless the explicit flag is set, whether it is direct or arrives through a parent cascade. Shown on two throwaway
  --    tables carrying the same trigger function (deleting a real account also trips the append-only record_corrections link, a separate rule).
  create temporary table s05b_parent (id uuid primary key);
  create temporary table s05b_child (id uuid primary key default gen_random_uuid(), parent_id uuid references s05b_parent (id) on delete cascade);
  create trigger a_clinical_value_supersession before delete on s05b_child
    for each row execute function private.enforce_clinical_value_supersession('parent_id');
  insert into s05b_parent values (v_p3);
  insert into s05b_child (parent_id) values (v_p3);
  v_state := null;
  begin delete from s05b_child where parent_id = v_p3;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B2a: a direct delete was allowed (state %)', v_state; end if;
  v_state := null;
  begin delete from s05b_parent where id = v_p3;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B2b: a parent cascade removed a recorded row (state %)', v_state; end if;
  perform set_config('app.allow_clinical_value_delete', 'on', true);
  delete from s05b_parent where id = v_p3;
  perform set_config('app.allow_clinical_value_delete', 'off', true);
  if exists (select 1 from s05b_child) then raise exception 'FAIL B2b2: with the flag the cascade did not remove the row'; end if;
  -- a trigger-initiated delete without the flag is refused (the old depth rule would have let it through)
  insert into s05b_parent values (v_p3);
  insert into s05b_child (parent_id) values (v_p3);
  v_state := null;
  begin delete from s05b_parent where id = v_p3;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B2b3: a nested delete bypassed the guard (state %)', v_state; end if;

  -- B2c CONTROL: the patient's own "delete my wearable data" still works (it sets the one sanctioned flag) and still reports the count
  insert into public.wearable_connections (organisation_id, patient_id, provider, status, external_id, access_token, refresh_token)
  values (v_org, v_p2, 'fitbit', 'active', 's05b-account', 'tok', 'refresh') returning id into v_wc;
  insert into public.vitals_readings (patient_id, organisation_id, vital_type, source, wearable_connection_id, taken_at, pulse_bpm)
  values (v_p2, v_org, 'pulse', 'wearable', v_wc, now(), 72);
  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select vitals_deleted into v_n from public.delete_wearable_connection_data(v_wc);
  execute 'reset role';
  if v_n <> 1 or exists (select 1 from public.vitals_readings where wearable_connection_id = v_wc) then
    raise exception 'FAIL B2c: wearable erasure broke (deleted %)', v_n;
  end if;
  -- and the flag does not leak: a direct delete right after is refused again
  execute 'set local role service_role';
  v_state := null;
  begin delete from public.vitals_readings where id = v_v5;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '42501' then raise exception 'FAIL B2d: the erasure flag stayed on (state %)', v_state; end if;

  -- B3 the tied clinician corrects v1 (value changes)
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_res := public.correct_clinical_value('vitals_readings', v_v1, 'corrected', 'Scale was not zeroed', '{"weight_kg": 68.5}'::jsonb);
  execute 'reset role';
  select * into v_row from public.vitals_readings where id = v_v1;
  if v_row.weight_kg <> 70 or v_row.correction_status <> 'corrected' or v_row.corrected_by <> v_c
     or v_row.correction_reason <> 'Scale was not zeroed' or v_row.superseded_by_id <> (v_res ->> 'replacement_id')::uuid then
    raise exception 'FAIL B3a: the original was altered or the actor/reason/link is wrong';
  end if;
  select * into v_row from public.vitals_readings where id = (v_res ->> 'replacement_id')::uuid;
  if v_row.weight_kg <> 68.5 or v_row.supersedes_id <> v_v1 or v_row.patient_id <> v_p or v_row.vital_type <> 'weight' then
    raise exception 'FAIL B3b: the replacement row is wrong';
  end if;
  if not exists (select 1 from public.record_corrections where table_name = 'vitals_readings' and entity_id = v_v1 and reason = 'Scale was not zeroed') then
    raise exception 'FAIL B3c: the existing record_corrections ledger did not record the reason';
  end if;

  -- B4 a second correction of the same row is refused; reason and shape rules
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_v1, 'corrected', 'second attempt here', '{"weight_kg": 1}'::jsonb);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '22023' then raise exception 'FAIL B4a: a superseded row was corrected twice (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_v2, 'entered_in_error', 'no', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '22023' then raise exception 'FAIL B4b: a 2 character reason was accepted (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_v2, 'corrected', 'forgot the value', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '22023' then raise exception 'FAIL B4c: corrected without replacement accepted (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_v2, 'corrected', 'try to move the patient', ('{"patient_id": "' || v_p2 || '"}')::jsonb);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '22023' then raise exception 'FAIL B4d: patient_id was accepted in a replacement (state %)', v_state; end if;
  execute 'reset role';

  -- B5 who may: an untied clinician, another patient, a patient marking cancelled
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_v2, 'entered_in_error', 'untied doctor guess', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B5a: an untied clinician corrected a reading (state %)', v_state; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_v2, 'entered_in_error', 'someone else''s reading', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B5b: another patient corrected a reading (state %)', v_state; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_v2, 'cancelled', 'patient cancels it', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B5c: a patient marked an entry cancelled (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_v4, 'entered_in_error', 'wrong day', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B5d: a patient corrected a reading a clinician reviewed (state %)', v_state; end if;

  -- B6 CONTROL (the gate opens): the patient marks her own unreviewed reading entered_in_error; the original is kept
  v_res := public.correct_clinical_value('vitals_readings', v_v2, 'entered_in_error', 'typed the wrong number', null);
  execute 'reset role';
  select * into v_row from public.vitals_readings where id = v_v2;
  if v_row.correction_status <> 'entered_in_error' or v_row.weight_kg <> 71 or v_row.superseded_by_id is not null or v_row.corrected_by <> v_p then
    raise exception 'FAIL B6: entered_in_error did not keep the original with actor and status';
  end if;

  -- B7 a clinician acted on v4: entered_in_error is refused for the clinician too, cancelled is the status
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_v4, 'entered_in_error', 'wrong day', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '22023' then raise exception 'FAIL B7a: entered_in_error allowed after a clinician acted (state %)', v_state; end if;
  perform public.correct_clinical_value('vitals_readings', v_v4, 'cancelled', 'reading cancelled after review', null);
  execute 'reset role';
  if (select correction_status from public.vitals_readings where id = v_v4) is distinct from 'cancelled' then
    raise exception 'FAIL B7b: cancelled was not recorded';
  end if;

  execute 'reset role';
  -- B7c a care coordinator (tied to the patient) cannot correct; the tied doctor can (the gate opens)
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p2, 'weight', 81, now() - interval '30 minutes', 'manual') returning id into v_v6;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_p2, v_cc, now()) on conflict (patient_id) do update set clinician_id = v_cc;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cc, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_v6, 'entered_in_error', 'coordinator tries it', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '42501' then raise exception 'FAIL B7c: a care coordinator corrected a reading (state %)', v_state; end if;
  update public.care_team_assignment set clinician_id = v_c where patient_id = v_p2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  perform public.correct_clinical_value('vitals_readings', v_v6, 'entered_in_error', 'tied doctor confirms the slip', null);
  execute 'reset role';
  if (select correction_status from public.vitals_readings where id = v_v6) is distinct from 'entered_in_error' then
    raise exception 'FAIL B7d: the tied doctor could not correct after the coordinator was refused';
  end if;

  -- B7e a patient cannot correct a device reading or an allergy a clinician recorded
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, taken_at, source)
  values (v_org, v_p, 'pulse', 72, now() - interval '20 minutes', 'device') returning id into v_v7;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_v7, 'corrected', 'patient edits a device reading', '{"pulse_bpm": 60}'::jsonb);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B7e: a patient edited a device reading (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('patient_allergies', v_al, 'entered_in_error', 'patient voids a clinician allergy', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B7f: a patient voided a clinician-recorded allergy (state %)', v_state; end if;
  execute 'reset role';

  -- B7g a corrected manual reading keeps its time (inside the offline window) instead of taking the correction time
  select * into v_row from public.vitals_readings where supersedes_id = v_v1;
  if abs(extract(epoch from (v_row.taken_at - (select taken_at from public.vitals_readings where id = v_v1)))) > 5 then
    raise exception 'FAIL B7g: the replacement manual reading lost the original time (% vs original)', v_row.taken_at;
  end if;

  -- B7g2 a clinician's correction is the clinician's entry: the patient cannot supersede it
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_state := null;
  begin perform public.correct_clinical_value('vitals_readings', v_row.id, 'entered_in_error', 'patient voids the clinician fix', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '42501' then raise exception 'FAIL B7g2: a patient superseded a clinician correction (state %)', v_state; end if;

  -- B7h the foreign key that nulls corrected_by when a profile is later removed is the one outside change the guard lets through
  create temporary table s05b_fkp (id uuid primary key);
  create temporary table s05b_fkc (
    id uuid primary key default gen_random_uuid(), supersedes_id uuid, superseded_by_id uuid, correction_status text, correction_reason text,
    corrected_by uuid references s05b_fkp (id) on delete set null, corrected_at timestamptz);
  create trigger a_clinical_value_supersession before update on s05b_fkc
    for each row execute function private.enforce_clinical_value_supersession();
  insert into s05b_fkp values (v_p3);
  insert into s05b_fkc (correction_status, correction_reason, corrected_by, corrected_at) values ('corrected', 'earlier fix', v_p3, now());
  v_state := null;
  begin update s05b_fkc set corrected_by = null;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B7h: corrected_by was nulled by a plain update (state %)', v_state; end if;
  delete from s05b_fkp where id = v_p3;
  if exists (select 1 from s05b_fkc where corrected_by is not null) then raise exception 'FAIL B7h2: the foreign key action did not null corrected_by'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);

  -- B8 allergies and lab values go through the same function
  execute 'set local role service_role';
  v_res := public.correct_clinical_value('patient_allergies', v_al, 'amended', 'Reaction was more severe', '{"severity": "severe"}'::jsonb);
  execute 'reset role';
  select * into v_row from public.patient_allergies where id = (v_res ->> 'replacement_id')::uuid;
  if v_row.severity <> 'severe' or v_row.supersedes_id <> v_al or v_row.allergen <> 'Penicillin' then
    raise exception 'FAIL B8a: the replacement allergy is wrong';
  end if;
  if v_row.source::text <> 'clinician' then raise exception 'FAIL B8a2: a clinician correction is not marked as a clinician entry'; end if;
  if (select severity from public.patient_allergies where id = v_al) <> 'moderate' then
    raise exception 'FAIL B8b: the original allergy changed';
  end if;
  execute 'set local role service_role';
  v_res := public.correct_clinical_value('lab_analyte_readings', v_lab, 'corrected', 'Lab sent a corrected report',
                                         '{"value": 5.9, "range_source": "lab_report", "reference_range_text": "4.0 - 5.6"}'::jsonb);
  execute 'reset role';
  if (select value from public.lab_analyte_readings where id = (v_res ->> 'replacement_id')::uuid) <> 5.9
     or (select value from public.lab_analyte_readings where id = v_lab) <> 6.1 then
    raise exception 'FAIL B8c: lab correction did not keep the original and add the replacement';
  end if;
  execute 'reset role';

  -- B9 a patient cannot correct a lab value
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_state := null;
  begin perform public.correct_clinical_value('lab_analyte_readings', v_lab, 'entered_in_error', 'patient wants it gone', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B9: a patient corrected a lab value (state %)', v_state; end if;
  execute 'reset role';
  -- anon cannot execute
  if has_function_privilege('anon', 'public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE') then
    raise exception 'FAIL B10: anon or authenticated can execute the correction function before the read paths hide superseded rows';
  end if;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS B: supersede, never edit';

  -- ======================================================================== C. range source
  v_state := null;
  begin insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, reference_range_text)
        values (v_org, v_p, 'ldl', 3.1, 'mmol/L', now(), '< 3.0');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '23514' then raise exception 'FAIL C1: an unlabelled range was stored (state %)', v_state; end if;
  v_state := null;
  begin insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, reference_range_text, range_source)
        values (v_org, v_p, 'ldl', 3.1, 'mmol/L', now(), '< 3.0', 'guideline');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '23514' then raise exception 'FAIL C2: a guideline range with no guideline named was stored (state %)', v_state; end if;
  v_state := null;
  begin insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, range_source)
        values (v_org, v_p, 'ldl', 3.1, 'mmol/L', now(), 'lab_report');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '23514' then raise exception 'FAIL C3: lab_report with no range was stored (state %)', v_state; end if;
  -- controls: the valid shapes are accepted
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, reference_range_text, range_source, range_source_ref)
  values (v_org, v_p, 'ldl', 3.1, 'mmol/L', now(), '< 3.0', 'guideline', 'ESC/EAS dyslipidaemia guideline 2019');
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
  values (v_org, v_p, 'ldl', 3.2, 'mmol/L', now());
  if (select range_source from public.lab_analyte_readings where patient_id = v_p and code = 'ldl' and value = 3.2) <> 'unspecified' then
    raise exception 'FAIL C4: the default is not unspecified';
  end if;

  -- C5 lab_result_items are stamped from the sign-off state of the panel version
  select id, panel_code into v_pv, v_pc from public.lab_panel_versions where is_active order by panel_code limit 1;
  if v_pv is null then raise exception 'fixture FAIL: no active panel version'; end if;
  insert into public.lab_results (organisation_id, patient_id, panel_code, panel_version_id, source, submitted_by_kind, release_state, is_test)
  values (v_org, v_p, v_pc, v_pv, 'portal_entry', 'tarragon_team', 'awaiting_review', true) returning id into v_lr;

  update public.lab_panel_signoffs set approved_at = null, approved_by = null where is_active;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, ref_low, ref_high, flag, is_test)
  values (v_lr, v_org, v_p, 'hba1c', 5.0, '%', 4.0, 5.6, 'normal', true);
  if (select range_source from public.lab_result_items where lab_result_id = v_lr and analyte_code = 'hba1c') <> 'unspecified' then
    raise exception 'FAIL C5a: an unsigned panel range was labelled as signed';
  end if;
  if (select range_source_ref from public.lab_result_items where lab_result_id = v_lr and analyte_code = 'hba1c') not like 'proposed lab panel %' then
    raise exception 'FAIL C5a2: an unsigned range does not say it is a proposed panel range';
  end if;
  select * into v_item from public.lab_result_items where lab_result_id = v_lr and analyte_code = 'hba1c';
  if private.eff_range_source(v_item.range_source, v_item.range_source_ref, v_item.ref_low, v_item.ref_high) <> 'proposed_unsigned' then
    raise exception 'FAIL C5a3: an unsigned stored range does not read as proposed_unsigned';
  end if;

  update public.lab_panel_signoffs set approved_at = now(), approved_by = v_cs where is_active;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, ref_low, ref_high, flag, is_test)
  values (v_lr, v_org, v_p, 'fpg', 5.0, 'mmol/L', 3.9, 5.5, 'normal', true);
  select * into v_item from public.lab_result_items where lab_result_id = v_lr and analyte_code = 'fpg';
  if v_item.range_source <> 'cmo_signed_config' or v_item.range_source_ref is null or v_item.range_source_ref not like 'lab panel % version %' then
    raise exception 'FAIL C5b: a signed panel range is not labelled (source %, ref %)', v_item.range_source, v_item.range_source_ref;
  end if;
  -- the item stored while unsigned now reads as signed (resolved at read time), with the panel named and no 'proposed' wording
  select * into v_item from public.lab_result_items where lab_result_id = v_lr and analyte_code = 'hba1c';
  if private.eff_range_source(v_item.range_source, v_item.range_source_ref, v_item.ref_low, v_item.ref_high) <> 'cmo_signed_config'
     or private.eff_range_ref(v_item.range_source, v_item.range_source_ref, v_item.ref_low, v_item.ref_high) not like 'lab panel % version %'
     or private.eff_range_ref(v_item.range_source, v_item.range_source_ref, v_item.ref_low, v_item.ref_high) like 'proposed%' then
    raise exception 'FAIL C5e: a result entered before signing stays unsigned for the patient after the sign-off (% / %)',
      private.eff_range_source(v_item.range_source, v_item.range_source_ref, v_item.ref_low, v_item.ref_high),
      private.eff_range_ref(v_item.range_source, v_item.range_source_ref, v_item.ref_low, v_item.ref_high);
  end if;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_text, unit, flag, is_test)
  values (v_lr, v_org, v_p, 'hiv', 'negative', 'n/a', 'negative', true);
  if (select range_source from public.lab_result_items where lab_result_id = v_lr and analyte_code = 'hiv') <> 'unspecified' then
    raise exception 'FAIL C5c: an item without a range carries a source';
  end if;

  -- C6 the read paths carry the source
  if position('range_source' in pg_get_functiondef('public.my_lab_results()'::regprocedure)) = 0
     or position('range_source' in pg_get_functiondef('public.lab_result_for_review(uuid,text)'::regprocedure)) = 0
     or exists (select 1 from pg_proc p where p.proname = 'record_share_by_token' and p.pronamespace = 'public'::regnamespace
                 and position('range_source' in pg_get_functiondef(p.oid)) = 0) then
    raise exception 'FAIL C6: a read path does not return range_source';
  end if;
  raise notice 'PASS C: range source';

  -- ======================================================================== D. sabotage (each must flip)
  execute 'set constraints all immediate';   -- the deferred superseded_by_id checks must settle before DDL

  -- D1: without the provenance trigger a patient reaches lab_verified
  v_flipped := false;
  begin
    drop trigger blood_profile_enforce_provenance on public.patient_blood_profile;
    perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.patient_blood_profile set provenance = 'lab_document', document_id = v_doc2, attested_at = null, attestation_version = null where patient_id = v_p2;
    execute 'reset role';
    if (select verification from public.patient_blood_profile where patient_id = v_p2) = 'lab_verified' then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL D1: sabotage did not flip (the blood proof is vacuous)'; end if;

  -- D2: without the supersession trigger the service role edits a value
  v_flipped := false;
  begin
    drop trigger a_clinical_value_supersession on public.vitals_readings;
    execute 'set local role service_role';
    update public.vitals_readings set weight_kg = 99 where id = v_v3;
    execute 'reset role';
    if (select weight_kg from public.vitals_readings where id = v_v3) = 99 then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL D2: sabotage did not flip (the supersession proof is vacuous)'; end if;
  if (select weight_kg from public.vitals_readings where id = v_v3) <> 72 then raise exception 'FAIL D2b: sabotage was not undone'; end if;

  -- D3: without the range constraint an unlabelled range is stored
  v_flipped := false;
  begin
    alter table public.lab_analyte_readings drop constraint lab_analyte_readings_range_needs_source;
    insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, reference_range_text)
    values (v_org, v_p, 'ldl', 3.3, 'mmol/L', now(), '< 3.0');
    v_flipped := true;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if not v_flipped then raise exception 'FAIL D3: sabotage did not flip (the range proof is vacuous)'; end if;

  -- D4: with the read-time resolver stubbed out, a result entered before signing stays unsigned for the patient
  v_flipped := false;
  begin
    create or replace function private.eff_range_source(p_source text, p_ref text, p_low numeric, p_high numeric) returns text
      language sql as 'select p_source';
    select * into v_item from public.lab_result_items where lab_result_id = v_lr and analyte_code = 'hba1c';
    if private.eff_range_source(v_item.range_source, v_item.range_source_ref, v_item.ref_low, v_item.ref_high) = 'unspecified' then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if not v_flipped then raise exception 'FAIL D4: sabotage did not flip (the read-time range proof is vacuous)'; end if;

  raise notice 'PASS D: four sabotages each flipped';
  select count(*) into v_n from public.vitals_readings where patient_id = v_p;
  raise notice 'S05b record integrity proof complete (% vitals rows for the fixture patient)', v_n;
end $$;

rollback;
