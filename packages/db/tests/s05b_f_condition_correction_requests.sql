-- ===========================================================================
-- Proof: *_s05b_f_condition_correction_requests.sql (S05b-f): the S05b-d hold rule, extended to conditions.
--
--   A. A PATIENT voiding or correcting a condition she entered herself only SAVES A REQUEST: the original stays active in the _current
--      view, in her own reads and in the audited chart reader the clinician screen uses. She sees her request; another patient, an
--      untied clinician and a care coordinator see nothing; a second request, a bad column, a blank name, a bad date, 'cancelled', a
--      clinician-recorded condition and a condition a clinician diagnosed are refused. Controls: the allergy rule is unchanged, her own
--      manual reading is still corrected at once, a tied clinician's own correction of a condition is still immediate.
--   B. Nobody but a tied non-coordinator clinician can resolve it (patient, other patient, untied clinician, coordinator, missing id);
--      a client cannot write the table; the one-record check refuses a row naming both an allergy and a condition.
--   C. Reject: the original is untouched, one in-app notice with no clinical word, final, she may ask again.
--   D. Confirm (corrected and entered_in_error): the original is marked by the one supersede path, the replacement is a clinician entry,
--      the readers follow, the patient gets ONE in-app confirmation notice; the audit trail holds requested then confirmed.
--   E. Void: a clinician correcting the condition directly closes the waiting request as void; withdraw by the owner only; the export
--      lists her condition requests without the clinician's note or identity.
--   F. Notices and the resubmit limit apply to conditions: one arrival notice to the tied non-coordinator clinician only (payload is the
--      request id and nothing else), 3 requests per condition in a rolling 7 days, per record, void excluded, other records unaffected.
--   G. SABOTAGE (each must flip): the condition patient branch removed, a permissive clinician test, the condition voiding trigger
--      dropped, the diagnosing-clinician rule removed, the resubmit limit trigger dropped, the confirm function pointed at the wrong table.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_p   uuid := gen_random_uuid();
  v_p2  uuid := gen_random_uuid();
  v_c   uuid := gen_random_uuid();   -- tied clinician (senior)
  v_u   uuid := gen_random_uuid();   -- untied clinician
  v_cc  uuid := gen_random_uuid();   -- care coordinator on the care team
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; c7 uuid; c8 uuid; c9 uuid; c10 uuid; c_clin uuid; c_diag uuid; c_rev uuid; c_ctrl uuid;
  v_al uuid; v_w uuid;
  v_res jsonb;
  v_req uuid; v_req2 uuid; v_req3 uuid;
  v_state text;
  v_msg text;
  v_n int;
  v_row record;
  v_def text;
  v_flipped boolean;
  v_text text;
  v_json jsonb;
  i int;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_p,  's05bf-p@example.invalid',  'x', now(), '{}', '{}'),
    (v_p2, 's05bf-p2@example.invalid', 'x', now(), '{}', '{}'),
    (v_c,  's05bf-c@example.invalid',  'x', now(), '{}', '{}'),
    (v_u,  's05bf-u@example.invalid',  'x', now(), '{}', '{}'),
    (v_cc, 's05bf-cc@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_p,  v_org, 'patient',   'S05bf Patient One',   '+2348055590001'),
    (v_p2, v_org, 'patient',   'S05bf Patient Two',   '+2348055590002'),
    (v_c,  v_org, 'clinician', 'S05bf Tied Doctor',   '+2348055590004'),
    (v_u,  v_org, 'clinician', 'S05bf Untied Doctor', '+2348055590005'),
    (v_cc, v_org, 'clinician', 'S05bf Coordinator',   '+2348055590006')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_c,  'S05bf Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org, v_u,  'S05bf Untied Doctor', true, now(), 'senior_medical_officer'),
    (v_org, v_cc, 'S05bf Coordinator',   true, now(), 'care_coordinator');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at)
  values (v_org, v_p, v_c, v_cc, now()) on conflict (patient_id) do update set clinician_id = v_c, care_coordinator_id = v_cc;

  -- conditions the patient typed herself (one per case), one a clinician recorded, one a clinician diagnosed
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, icd10_code, source) values (v_org, v_p, 'Gout', 'M10', 'patient') returning id into c1;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source) values (v_org, v_p, 'Migraine', 'patient') returning id into c2;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source) values (v_org, v_p, 'Asthma',   'patient') returning id into c3;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source) values (v_org, v_p, 'Eczema',   'patient') returning id into c4;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source) values (v_org, v_p, 'Sinusitis', 'patient') returning id into c5;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source) values (v_org, v_p, 'Rosacea',  'patient') returning id into c6;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source) values (v_org, v_p, 'Acne',     'patient') returning id into c7;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source) values (v_org, v_p, 'Vertigo',  'patient') returning id into c8;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source) values (v_org, v_p, 'Tinnitus', 'patient') returning id into c9;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source) values (v_org, v_p, 'Hives',    'patient') returning id into c10;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source) values (v_org, v_p, 'Hypertension', 'clinician') returning id into c_clin;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source, diagnosing_clinician_id) values (v_org, v_p, 'Anaemia', 'patient', v_c) returning id into c_diag;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source) values (v_org, v_p, 'Reflux', 'patient') returning id into c_ctrl;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source, last_reviewed_at) values (v_org, v_p, 'Psoriasis', 'patient', now() - interval '1 day') returning id into c_rev;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Peanut', 'moderate', 'patient') returning id into v_al;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p, 'weight', 70, now() - interval '2 hours', 'manual') returning id into v_w;

  -- ======================================================================== A. the patient's request changes nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_conditions', c1, 'entered_in_error', 'I do not have gout', null);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'pending' or v_res ->> 'replacement_id' is not null or v_res ->> 'table' is distinct from 'patient_conditions' then
    raise exception 'FAIL A1: the patient call did not return a pending condition request (%)', v_res;
  end if;
  v_req := (v_res ->> 'request_id')::uuid;
  select * into v_row from public.patient_conditions where id = c1;
  if v_row.correction_status is not null or v_row.superseded_by_id is not null or v_row.corrected_at is not null then
    raise exception 'FAIL A2: the original condition was marked by a patient request';
  end if;
  select * into v_row from public.patient_allergy_correction_requests where id = v_req;
  if v_row.record_table <> 'patient_conditions' or v_row.condition_id is distinct from c1 or v_row.allergy_id is not null then
    raise exception 'FAIL A3: the request does not point at the condition (%)', row_to_json(v_row);
  end if;
  select count(*) into v_n from private.patient_conditions_current where id = c1;
  if v_n <> 1 then raise exception 'FAIL A4: the pending condition is not in the current view'; end if;

  -- the audited chart reader (what the clinician screen uses) still returns the original
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.read_patient_chart_audited(v_p, array['conditions'], 'Reviewing a change the patient asked for in their record');
  execute 'reset role';
  if v_json ->> 'status' = 'denied' or not exists (select 1 from jsonb_array_elements(v_json -> 'sections' -> 'conditions') e where e ->> 'id' = c1::text) then
    raise exception 'FAIL A5: the chart reader does not return the pending condition (%)', v_json;
  end if;

  -- the patient reads her own condition and her request; others read nothing of the request
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_conditions where id = c1;
  if v_n <> 1 then raise exception 'FAIL A6a: the patient no longer sees her own condition'; end if;
  select count(*) into v_n from public.patient_allergy_correction_requests where id = v_req and condition_id = c1 and record_table = 'patient_conditions';
  if v_n <> 1 then raise exception 'FAIL A6b: the patient cannot see her own condition request'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_allergy_correction_requests;
  if v_n <> 0 then raise exception 'FAIL A7a: another patient sees a request (%)', v_n; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_allergy_correction_requests where id = v_req;
  if v_n <> 0 then raise exception 'FAIL A7b: an untied clinician sees the request'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_allergy_correction_requests where id = v_req;
  if v_n <> 0 then raise exception 'FAIL A7c: a care coordinator sees the request'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_allergy_correction_requests where id = v_req;
  if v_n <> 1 then raise exception 'FAIL A7d (control): the tied clinician cannot see the request'; end if;
  execute 'reset role';

  -- refusals on the patient path
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin perform public.correct_clinical_value('patient_conditions', c1, 'amended', 'asking twice for the same entry', '{"condition_name": "Gouty arthritis"}'::jsonb);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '22023' then raise exception 'FAIL A8: a second pending request was accepted (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('patient_conditions', c2, 'corrected', 'a status is not a patient value', '{"status": "resolved"}'::jsonb);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '22023' then raise exception 'FAIL A9: a non-value column was accepted in a request (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('patient_conditions', c2, 'corrected', 'a blank name is not a name', '{"condition_name": "   "}'::jsonb);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '22023' then raise exception 'FAIL A10: a blank name was accepted (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('patient_conditions', c2, 'corrected', 'this date does not exist', '{"date_identified": "not-a-date"}'::jsonb);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is null then raise exception 'FAIL A11: an invalid date was accepted in a request'; end if;
  v_state := null;
  begin perform public.correct_clinical_value('patient_conditions', c2, 'cancelled', 'a patient cannot cancel an entry', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL A12: a patient cancelled a condition (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('patient_conditions', c_clin, 'entered_in_error', 'patient voids a clinician condition', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL A13: a patient could request a change of a clinician-recorded condition (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('patient_conditions', c_diag, 'entered_in_error', 'patient voids a condition a clinician diagnosed', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL A14: a patient could request a change of a condition a clinician diagnosed (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('patient_conditions', c_rev, 'entered_in_error', 'patient voids a condition a clinician reviewed', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL A14b: a patient could request a change of a condition a clinician reviewed (state %)', v_state; end if;
  -- controls: the allergy rule is unchanged (pending), and her own manual reading is still corrected at once
  v_res := public.correct_clinical_value('patient_allergies', v_al, 'entered_in_error', 'I typed this allergy by mistake', null);
  if v_res ->> 'status' is distinct from 'pending' or v_res ->> 'table' is distinct from 'patient_allergies' then raise exception 'FAIL A15: the allergy request path changed (%)', v_res; end if;
  perform public.withdraw_patient_allergy_correction((v_res ->> 'request_id')::uuid);
  v_res := public.correct_clinical_value('vitals_readings', v_w, 'corrected', 'Typed the wrong weight', '{"weight_kg": 71}'::jsonb);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'corrected' or (v_res ->> 'replacement_id') is null then raise exception 'FAIL A16: the patient reading correction is no longer immediate (%)', v_res; end if;
  -- gate opens: the tied clinician's own correction of a (patient-entered) condition is immediate and stored as a clinician entry
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_conditions', c_ctrl, 'corrected', 'Name recorded in full by the clinician', '{"condition_name": "Gastro-oesophageal reflux"}'::jsonb);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'corrected' or (v_res ->> 'replacement_id') is null
     or (select source from public.patient_conditions where id = (v_res ->> 'replacement_id')::uuid) <> 'clinician' then
    raise exception 'FAIL A17 (gate opens): a tied clinician correction of a condition is not immediate (%)', v_res;
  end if;
  select count(*) into v_n from public.patient_allergy_correction_requests where patient_id = v_p and record_table = 'patient_conditions';
  if v_n <> 1 then raise exception 'FAIL A18: refused requests left rows behind (%)', v_n; end if;
  raise notice 'PASS A: a patient condition request saves and changes nothing';

  -- ======================================================================== B. who may resolve
  v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.confirm_patient_allergy_correction(v_req, 'confirming my own');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '42501' then raise exception 'FAIL B1: the patient confirmed her own request (state %)', v_state; end if;
  v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.reject_patient_allergy_correction(v_req, null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '42501' then raise exception 'FAIL B2: another patient resolved the request (state %)', v_state; end if;
  v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.confirm_patient_allergy_correction(v_req, null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '42501' then raise exception 'FAIL B3: an untied clinician confirmed the request (state %)', v_state; end if;
  v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.confirm_patient_allergy_correction(v_req, null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '42501' then raise exception 'FAIL B4: a care coordinator confirmed the request (state %)', v_state; end if;
  v_state := null;
  begin perform public.confirm_patient_allergy_correction(gen_random_uuid(), null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B5: a missing request id answered differently from a refused one (state %)', v_state; end if;
  if (select status from public.patient_allergy_correction_requests where id = v_req) <> 'pending'
     or (select correction_status from public.patient_conditions where id = c1) is not null then
    raise exception 'FAIL B6: a refused resolver changed something';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin insert into public.patient_allergy_correction_requests (organisation_id, patient_id, record_table, condition_id, requested_status, reason)
        values (v_org, v_p, 'patient_conditions', c2, 'entered_in_error', 'forged request');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B7a: a client inserted a condition request (state %)', v_state; end if;
  v_state := null;
  begin update public.patient_allergy_correction_requests set condition_id = c2 where id = v_req;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B7b: a client repointed a request (state %)', v_state; end if;
  execute 'reset role';
  -- even the database owner cannot repoint a request or name two records in one row
  v_state := null;
  begin update public.patient_allergy_correction_requests set condition_id = c2 where id = v_req;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B8a: a pending request could be repointed outside the functions (state %)', v_state; end if;
  v_state := null;
  begin insert into public.patient_allergy_correction_requests (organisation_id, patient_id, record_table, allergy_id, condition_id, requested_status, reason)
        values (v_org, v_p, 'patient_conditions', v_al, c2, 'entered_in_error', 'two records in one row');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '23514' then raise exception 'FAIL B8b: a row naming an allergy and a condition was accepted (state %)', v_state; end if;
  v_state := null;
  begin insert into public.patient_allergy_correction_requests (organisation_id, patient_id, record_table, allergy_id, requested_status, reason)
        values (v_org, v_p, 'patient_conditions', v_al, 'entered_in_error', 'wrong table for the id');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '23514' then raise exception 'FAIL B8c: a condition request pointing at an allergy was accepted (state %)', v_state; end if;
  -- a request goes with its condition when a privileged path hard-deletes it, never blocking it
  v_flipped := false;
  begin
    perform set_config('app.allow_clinical_value_delete', 'on', true);
    perform set_config('app.change_reason', 'proof: privileged removal', true);
    delete from public.patient_conditions where id = c1;
    perform set_config('app.allow_clinical_value_delete', 'off', true);
    perform set_config('app.change_reason', '', true);
    if not exists (select 1 from public.patient_allergy_correction_requests where id = v_req)
       and not exists (select 1 from public.patient_allergy_correction_events where request_id = v_req) then v_flipped := true; end if;
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if not v_flipped then raise exception 'FAIL B9: deleting a condition was blocked by, or left behind, its correction request'; end if;
  raise notice 'PASS B: only a tied, non-coordinator clinician resolves; the table is not client-writable';

  -- ======================================================================== C. reject
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.reject_patient_allergy_correction(v_req, 'Please discuss at the next visit');
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'rejected' then raise exception 'FAIL C1: reject returned %', v_res; end if;
  select * into v_row from public.patient_conditions where id = c1;
  if v_row.correction_status is not null or v_row.condition_name <> 'Gout' then raise exception 'FAIL C2: a rejection changed the condition'; end if;
  select count(*) into v_n from public.notifications where recipient_id = v_p and template = 'record_change_not_confirmed' and channel = 'in_app' and content_class = 'non_clinical';
  if v_n <> 1 then raise exception 'FAIL C3: expected exactly one in-app notice, found %', v_n; end if;
  select payload::text into v_text from public.notifications where recipient_id = v_p and template = 'record_change_not_confirmed';
  if v_text ~* '(gout|condition|diagnos|please discuss)' then raise exception 'FAIL C4: the notice carries a clinical or note word: %', v_text; end if;
  if (select array_agg(event order by at, event) from public.patient_allergy_correction_events where request_id = v_req) <> array['rejected', 'requested'] then
    raise exception 'FAIL C5: audit trail is not requested then rejected';
  end if;
  v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.confirm_patient_allergy_correction(v_req, null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '22023' then raise exception 'FAIL C6: a decided request was decided again (state %)', v_state; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_conditions', c1, 'amended', 'It is gouty arthritis, not just gout', '{"condition_name": "Gouty arthritis", "date_identified": "2024-05-01"}'::jsonb);
  execute 'reset role';
  v_req2 := (v_res ->> 'request_id')::uuid;
  if v_res ->> 'status' is distinct from 'pending' or v_req2 = v_req then raise exception 'FAIL C7: the second request was not created'; end if;
  -- renamed without a code: the request says "no code" itself, so the old code (M10) is not silently kept
  select replacement into v_json from public.patient_allergy_correction_requests where id = v_req2;
  if not (v_json ? 'icd10_code') or v_json -> 'icd10_code' <> 'null'::jsonb then raise exception 'FAIL C8: a rename without a code kept the old code in the request (%)', v_json; end if;
  raise notice 'PASS C: reject leaves the original, notifies in-app without clinical words, is final';

  -- ======================================================================== D. confirm
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.confirm_patient_allergy_correction(v_req2, 'Checked with the patient');
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'confirmed' or v_res ->> 'correction_status' is distinct from 'amended' or (v_res ->> 'replacement_id') is null
     or v_res ->> 'table' is distinct from 'patient_conditions' then raise exception 'FAIL D1: confirm returned %', v_res; end if;
  select * into v_row from public.patient_conditions where id = c1;
  if v_row.correction_status is distinct from 'amended' or v_row.superseded_by_id is distinct from (v_res ->> 'replacement_id')::uuid
     or v_row.corrected_by is distinct from v_c or length(btrim(v_row.correction_reason)) < 5 then
    raise exception 'FAIL D2: the original was not marked by the clinician through the supersede path';
  end if;
  select * into v_row from public.patient_conditions where id = (v_res ->> 'replacement_id')::uuid;
  if v_row.icd10_code is not null then raise exception 'FAIL D3b: the replacement kept the old code %', v_row.icd10_code; end if;
  if v_row.condition_name <> 'Gouty arthritis' or v_row.date_identified is distinct from date '2024-05-01' or v_row.supersedes_id <> c1
     or v_row.source <> 'clinician' or v_row.patient_id <> v_p then
    raise exception 'FAIL D3: the replacement condition is wrong (%)', row_to_json(v_row);
  end if;
  select count(*) into v_n from private.patient_conditions_current where id = c1;
  if v_n <> 0 then raise exception 'FAIL D4: the superseded condition is still in the current view'; end if;
  select * into v_row from public.patient_allergy_correction_requests where id = v_req2;
  if v_row.status <> 'confirmed' or v_row.decided_by is distinct from v_c or v_row.replacement_id is distinct from (v_res ->> 'replacement_id')::uuid then
    raise exception 'FAIL D5: the request is not marked confirmed';
  end if;
  if (select array_agg(event order by at, event) from public.patient_allergy_correction_events where request_id = v_req2) <> array['confirmed', 'requested'] then
    raise exception 'FAIL D6: audit trail is not requested then confirmed';
  end if;
  if not exists (select 1 from public.record_corrections rc where rc.entity_id = c1 and rc.table_name = 'patient_conditions' and length(btrim(rc.reason)) >= 5) then
    raise exception 'FAIL D7: record_corrections has no row with a reason for the marked condition';
  end if;
  select count(*) into v_n from public.notifications where recipient_id = v_p and template = 'record_change_confirmed' and channel = 'in_app' and content_class = 'non_clinical';
  if v_n <> 1 then raise exception 'FAIL D8: the patient got % confirmation notices, expected 1', v_n; end if;
  select string_agg(payload::text, ' ') into v_text from public.notifications where template in ('record_change_confirmed', 'record_change_request_waiting');
  if v_text ~* '(gout|arthritis|condition)' then raise exception 'FAIL D9: a notice payload carries a clinical word (%)', v_text; end if;
  -- the chart reader now returns the replacement and not the original
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.read_patient_chart_audited(v_p, array['conditions'], 'Reviewing a change the patient asked for in their record');
  execute 'reset role';
  if exists (select 1 from jsonb_array_elements(v_json -> 'sections' -> 'conditions') e where e ->> 'id' = c1::text)
     or not exists (select 1 from jsonb_array_elements(v_json -> 'sections' -> 'conditions') e where e ->> 'display' = 'Gouty arthritis') then
    raise exception 'FAIL D10: the chart reader does not follow the confirmation (%)', v_json -> 'sections' -> 'conditions';
  end if;
  if position('correction_status' in pg_get_viewdef('public.allergies'::regclass)) = 0 then raise exception 'FAIL D10b: the allergies chart view returns superseded entries'; end if;
  -- entered_in_error, confirmed: the condition leaves the readers only after the confirmation
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_conditions', c2, 'entered_in_error', 'I never had migraines', null);
  execute 'reset role';
  v_req3 := (v_res ->> 'request_id')::uuid;
  select count(*) into v_n from private.patient_conditions_current where id = c2;
  if v_n <> 1 then raise exception 'FAIL D11: the condition left the readers before the confirmation'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.confirm_patient_allergy_correction(v_req3, null);
  execute 'reset role';
  select count(*) into v_n from private.patient_conditions_current where id = c2;
  if v_n <> 0 or (select correction_status from public.patient_conditions where id = c2) is distinct from 'entered_in_error' then
    raise exception 'FAIL D12: the condition is still current after the confirmation';
  end if;
  raise notice 'PASS D: confirm supersedes through the one path, readers follow, one confirmation notice';

  -- ======================================================================== E. void, withdraw, export
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_conditions', c3, 'entered_in_error', 'Asthma was a mistake of mine', null);
  execute 'reset role';
  v_req := (v_res ->> 'request_id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_conditions', c3, 'corrected', 'Clinician confirmed the diagnosis at the visit', '{"condition_name": "Asthma (confirmed)"}'::jsonb);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'corrected' then raise exception 'FAIL E1: the clinician correction is no longer immediate (%)', v_res; end if;
  if (select status from public.patient_allergy_correction_requests where id = v_req) <> 'void'
     or not exists (select 1 from public.patient_allergy_correction_events where request_id = v_req and event = 'void' and actor_role = 'system') then
    raise exception 'FAIL E2: a request for a condition a clinician corrected directly was not closed as void';
  end if;
  v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.confirm_patient_allergy_correction(v_req, null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '22023' then raise exception 'FAIL E3: a voided request could still be confirmed (state %)', v_state; end if;
  if (select count(*) from public.patient_conditions where supersedes_id = c3) <> 1 then raise exception 'FAIL E4: more than one replacement exists'; end if;
  -- withdraw: the owner only; final; a new request is allowed afterwards
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_conditions', c4, 'entered_in_error', 'I typed eczema by mistake', null);
  execute 'reset role';
  v_req3 := (v_res ->> 'request_id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin perform public.withdraw_patient_allergy_correction(v_req3);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '42501' then raise exception 'FAIL E5: another patient withdrew a request (state %)', v_state; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin perform public.withdraw_patient_allergy_correction(v_req3);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '42501' then raise exception 'FAIL E6: a clinician used the patient withdrawal (state %)', v_state; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.withdraw_patient_allergy_correction(v_req3);
  if v_res ->> 'status' is distinct from 'withdrawn' or (select correction_status from public.patient_conditions where id = c4) is not null then
    execute 'reset role'; raise exception 'FAIL E7: the withdrawal is not recorded, or it changed the condition';
  end if;
  v_res := public.correct_clinical_value('patient_conditions', c4, 'amended', 'Eczema is mild after all', '{"condition_name": "Mild eczema"}'::jsonb);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'pending' then raise exception 'FAIL E8: a new request after a withdrawal was refused'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.withdraw_patient_allergy_correction((v_res ->> 'request_id')::uuid);
  -- the export lists her condition requests, without the clinician's note or identity; another patient gets none of it
  v_json := public.my_corrected_record_entries();
  execute 'reset role';
  if not exists (select 1 from jsonb_array_elements(v_json -> 'patient_allergy_correction_requests') e where e ->> 'record_table' = 'patient_conditions' and e ->> 'condition_id' = c4::text)
     or v_json::text ~ '(decision_note|decided_by|Please discuss at the next visit|Checked with the patient)' then
    raise exception 'FAIL E9: the export lost her condition requests or carries the clinician note or identity';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.my_corrected_record_entries();
  execute 'reset role';
  if jsonb_array_length(v_json -> 'patient_allergy_correction_requests') <> 0 or jsonb_array_length(v_json -> 'patient_conditions') <> 0 then
    raise exception 'FAIL E10: another patient received condition history (%)', v_json;
  end if;
  raise notice 'PASS E: stale request voids, withdraw is the owner''s, export lists condition requests safely';

  -- ======================================================================== F. notices and the resubmit limit
  delete from public.notifications where template = 'record_change_request_waiting';
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_conditions', c5, 'entered_in_error', 'Sinusitis was typed by mistake', null);
  execute 'reset role';
  select count(*) into v_n from public.notifications where recipient_id = v_c and template = 'record_change_request_waiting' and channel = 'in_app' and content_class = 'non_clinical';
  if v_n <> 1 then raise exception 'FAIL F1: the tied clinician got % arrival notices, expected 1', v_n; end if;
  select count(*) into v_n from public.notifications where recipient_id in (v_cc, v_u, v_p) and template = 'record_change_request_waiting';
  if v_n <> 0 then raise exception 'FAIL F2: the notice reached a coordinator, an untied clinician or the patient (%)', v_n; end if;
  if (select count(*) from public.notifications n, jsonb_object_keys(n.payload) k where n.template = 'record_change_request_waiting' and k <> 'request_id') <> 0
     or exists (select 1 from public.notifications where template in ('record_change_request_waiting', 'record_change_confirmed') and channel <> 'in_app') then
    raise exception 'FAIL F3: a notice carries more than the request id, or left the in-app rail';
  end if;
  for i in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := public.correct_clinical_value('patient_conditions', c6, 'entered_in_error', 'Rosacea was typed by mistake', null);
    perform public.withdraw_patient_allergy_correction((v_res ->> 'request_id')::uuid);
    execute 'reset role';
  end loop;
  v_state := null; v_msg := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.correct_clinical_value('patient_conditions', c6, 'entered_in_error', 'Rosacea was typed by mistake', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  execute 'reset role';
  if v_state is distinct from '22023' or v_msg not like '%message your care team%' then
    raise exception 'FAIL F4: the 4th request in 7 days was not refused with the calm message (state %, message %)', v_state, v_msg;
  end if;
  if v_msg ~* '(rosacea|condition|limit|error|exception)' then raise exception 'FAIL F4b: the refusal wording is not plain (%)', v_msg; end if;
  select count(*) into v_n from public.patient_allergy_correction_requests where condition_id = c6;
  if v_n <> 3 then raise exception 'FAIL F5: a refused request left a row behind (%)', v_n; end if;
  -- the limit is per record: another condition is unaffected, and the allergy and the condition do not share a count
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_conditions', c7, 'entered_in_error', 'Acne was typed by mistake', null);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'pending' then raise exception 'FAIL F6: another condition was refused (%)', v_res; end if;
  -- once the three are older than 7 days she may ask again (the audit guard is lifted only for this backdating, inside the rolled-back test)
  alter table public.patient_allergy_correction_requests disable trigger patient_allergy_correction_requests_guard;
  update public.patient_allergy_correction_requests set created_at = now() - interval '8 days' where condition_id = c6;
  alter table public.patient_allergy_correction_requests enable trigger patient_allergy_correction_requests_guard;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_conditions', c6, 'entered_in_error', 'Rosacea was typed by mistake', null);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'pending' then raise exception 'FAIL F7: the window did not roll (%)', v_res; end if;
  -- requests the system closed as void do not use up her three
  for i in 1..3 loop
    insert into public.patient_allergy_correction_requests (organisation_id, patient_id, record_table, condition_id, requested_status, reason, status, decided_at)
    values (v_org, v_p, 'patient_conditions', c8, 'entered_in_error', 'closed by the system', 'void', now());
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_conditions', c8, 'entered_in_error', 'Vertigo was typed by mistake', null);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'pending' then raise exception 'FAIL F8: void requests used up the limit (%)', v_res; end if;
  raise notice 'PASS F: one arrival notice to the tied doctor, 3 per condition per rolling 7 days, per record, void excluded';

  -- ======================================================================== G. sabotage (each must flip)
  -- G1: without the condition branch the patient's void takes effect at once
  v_flipped := false;
  begin
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.proname = 'correct_clinical_value' and p.pronamespace = 'public'::regnamespace;
    if position('if not v_is_staff and p_table in (''patient_allergies'', ''patient_conditions'') then' in v_def) = 0 then raise exception 'sabotage anchor missing'; end if;
    execute replace(v_def, 'if not v_is_staff and p_table in (''patient_allergies'', ''patient_conditions'') then', 'if not v_is_staff and p_table in (''patient_allergies'') then');
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.correct_clinical_value('patient_conditions', c9, 'entered_in_error', 'Tinnitus is not mine', null);
    execute 'reset role';
    if (select correction_status from public.patient_conditions where id = c9) is not null
       and not exists (select 1 from private.patient_conditions_current where id = c9) then
      v_flipped := true;
    end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL G1: sabotage did not flip (the pending-request proof is vacuous)'; end if;
  if (select correction_status from public.patient_conditions where id = c9) is not null then raise exception 'FAIL G1b: sabotage was not undone'; end if;

  -- G2: with a permissive clinician test an untied clinician can resolve a request
  v_flipped := false;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := public.correct_clinical_value('patient_conditions', c9, 'entered_in_error', 'Tinnitus is not mine', null);
    execute 'reset role';
    v_req := (v_res ->> 'request_id')::uuid;
    create or replace function private.is_correcting_clinician(p_patient uuid) returns boolean language sql stable as 'select true';
    perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.reject_patient_allergy_correction(v_req, null);
    execute 'reset role';
    v_flipped := true;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL G2: sabotage did not flip (the tie proof is vacuous)'; end if;
  if position('clinician_has_patient_access' in pg_get_functiondef('private.is_correcting_clinician(uuid)'::regprocedure)) = 0 then
    raise exception 'FAIL G2b: sabotage was not undone (the clinician test is still permissive)';
  end if;

  -- G3: with the condition voiding trigger gone a request for a corrected condition stays pending for good
  v_flipped := false;
  begin
    drop trigger z_void_pending_condition_requests on public.patient_conditions;
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := public.correct_clinical_value('patient_conditions', c9, 'entered_in_error', 'Tinnitus is not mine', null);
    execute 'reset role';
    v_req := (v_res ->> 'request_id')::uuid;
    perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.correct_clinical_value('patient_conditions', c9, 'corrected', 'Clinician corrected it directly', '{"condition_name": "Tinnitus (confirmed)"}'::jsonb);
    execute 'reset role';
    if (select status from public.patient_allergy_correction_requests where id = v_req) = 'pending' then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL G3: sabotage did not flip (the stale-request proof is vacuous)'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'z_void_pending_condition_requests') then raise exception 'FAIL G3b: sabotage was not undone'; end if;

  -- G4: without the diagnosing-clinician rule a patient can void a condition a clinician diagnosed
  v_flipped := false;
  begin
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.proname = 'correct_clinical_value' and p.pronamespace = 'public'::regnamespace;
    if position('or (p_table = ''patient_conditions'' and (v_old ->> ''diagnosing_clinician_id'' is not null or v_old ->> ''last_reviewed_at'' is not null))' in v_def) = 0 then raise exception 'sabotage anchor missing'; end if;
    execute replace(v_def, 'or (p_table = ''patient_conditions'' and (v_old ->> ''diagnosing_clinician_id'' is not null or v_old ->> ''last_reviewed_at'' is not null))', 'or false');
    select id into v_req from public.patient_conditions where patient_id = v_p and diagnosing_clinician_id is not null and correction_status is null limit 1;
    if v_req is null then raise exception 'sabotage fixture missing'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.correct_clinical_value('patient_conditions', v_req, 'entered_in_error', 'Voiding a diagnosed condition', null);
    execute 'reset role';
    v_flipped := true;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL G4: sabotage did not flip (the clinician-verified proof is vacuous)'; end if;

  -- G5: without the limit trigger a 4th request on one condition in a week is accepted
  v_flipped := false;
  begin
    drop trigger patient_allergy_correction_requests_rate_limit on public.patient_allergy_correction_requests;
    for i in 1..4 loop
      perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_res := public.correct_clinical_value('patient_conditions', c10, 'entered_in_error', 'Hives were typed by mistake', null);
      perform public.withdraw_patient_allergy_correction((v_res ->> 'request_id')::uuid);
      execute 'reset role';
    end loop;
    v_flipped := true;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL G5: sabotage did not flip (the limit proof is vacuous)'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'patient_allergy_correction_requests_rate_limit') then raise exception 'FAIL G5b: sabotage was not undone'; end if;

  -- G6: a confirm function that always acts on the allergy table cannot confirm a condition request
  v_flipped := false;
  begin
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.proname = 'confirm_patient_allergy_correction' and p.pronamespace = 'public'::regnamespace;
    if position('public.correct_clinical_value(v_req.record_table, v_rid,' in v_def) = 0 then raise exception 'sabotage anchor missing'; end if;
    execute replace(v_def, 'public.correct_clinical_value(v_req.record_table, v_rid,', 'public.correct_clinical_value(''patient_allergies'', v_rid,');
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := public.correct_clinical_value('patient_conditions', c10, 'entered_in_error', 'Hives were typed by mistake', null);
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin perform public.confirm_patient_allergy_correction((v_res ->> 'request_id')::uuid, null);
    exception when others then v_flipped := true; end;
    execute 'reset role';
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL G6: sabotage did not flip (the table-aware confirm proof is vacuous)'; end if;

  raise notice 'PASS G: six sabotages each flipped';
  raise notice 'S05b-f condition correction requests proof complete';
end $$;

rollback;
