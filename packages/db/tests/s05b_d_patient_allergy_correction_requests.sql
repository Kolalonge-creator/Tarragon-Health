-- ===========================================================================
-- Proof: *_s05b_d_patient_allergy_correction_requests_and_grant.sql (S05b-d).
--
--   A. A PATIENT voiding an allergy she entered herself only SAVES A REQUEST: the original stays active in prescription safety, in the
--      _current view and in her own reads; she sees her request, another patient and an untied clinician see nothing; a second request,
--      a bad column, a bad value and 'cancelled' are refused. (Control: a patient correcting her own manual reading is still immediate.)
--   B. Nobody but a tied non-coordinator clinician can resolve it: the patient, another patient, an untied clinician and a care
--      coordinator are refused (one answer for missing and not permitted); clients cannot write the request or audit tables.
--   C. Reject: the original is untouched, one in-app notification reaches the patient with no clinical word in it; a decided request is
--      final; the patient may ask again.
--   D. Confirm (corrected): the original is marked and the replacement inserted by the same supersede path (stored as a clinician entry),
--      prescription safety follows the replacement; the audit trail holds requested then confirmed. Confirm (entered_in_error) hides it.
--   E. Void: a clinician correcting the entry directly closes a waiting request as void (and it can no longer be confirmed); a request
--      colliding with another current allergy is refused up front. A clinician correcting directly stays immediate. A clinician-recorded allergy still cannot be touched by the patient.
--   F. The grant: authenticated can execute correct_clinical_value and the new functions, anon cannot; my_corrected_record_entries returns
--      the patient's own superseded values only; every _current view has exactly its table's columns.
--   G. SABOTAGE (each must flip): the patient branch removed, the clinician test made permissive, the PUBLIC grant restored, the audit
--      trail's append-only trigger dropped, the stale-request voiding trigger dropped, the withdrawal ownership check and the history-export guard
--      removed.
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
  v_a1 uuid; v_a2 uuid; v_a3 uuid; v_a4 uuid; v_a5 uuid; v_acl uuid; v_cond uuid;
  v_w uuid;
  v_res jsonb;
  v_req uuid; v_req2 uuid; v_req3 uuid;
  v_state text;
  v_n int;
  v_row record;
  v_f jsonb;
  v_def text;
  v_flipped boolean;
  v_text text;
  v_json jsonb;
  c constant text := 'public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb)';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_p,  's05bd-p@example.invalid',  'x', now(), '{}', '{}'),
    (v_p2, 's05bd-p2@example.invalid', 'x', now(), '{}', '{}'),
    (v_c,  's05bd-c@example.invalid',  'x', now(), '{}', '{}'),
    (v_u,  's05bd-u@example.invalid',  'x', now(), '{}', '{}'),
    (v_cc, 's05bd-cc@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_p,  v_org, 'patient',   'S05bd Patient One',   '+2348055570001'),
    (v_p2, v_org, 'patient',   'S05bd Patient Two',   '+2348055570002'),
    (v_c,  v_org, 'clinician', 'S05bd Tied Doctor',   '+2348055570004'),
    (v_u,  v_org, 'clinician', 'S05bd Untied Doctor', '+2348055570005'),
    (v_cc, v_org, 'clinician', 'S05bd Coordinator',   '+2348055570006')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_c,  'S05bd Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org, v_u,  'S05bd Untied Doctor', true, now(), 'senior_medical_officer'),
    (v_org, v_cc, 'S05bd Coordinator',   true, now(), 'care_coordinator');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at)
  values (v_org, v_p, v_c, v_cc, now()) on conflict (patient_id) do update set clinician_id = v_c, care_coordinator_id = v_cc;

  -- four allergies the patient typed herself (one per case) and one a clinician recorded
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Peanut',  'moderate', 'patient') returning id into v_a1;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Shellfish', 'mild',    'patient') returning id into v_a2;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Latex',   'mild',     'patient') returning id into v_a3;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Sesame',  'mild',     'patient') returning id into v_a4;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Penicillin', 'severe', 'clinician') returning id into v_acl;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Dust', 'mild', 'patient') returning id into v_a5;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, source, diagnosing_clinician_id) values (v_org, v_p, 'Hypertension', 'clinician', v_c) returning id into v_cond;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p, 'weight', 70, now() - interval '2 hours', 'manual') returning id into v_w;

  -- ======================================================================== A. the patient's request changes nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a1, 'entered_in_error', 'I do not have this allergy', null);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'pending' or v_res ->> 'replacement_id' is not null then
    raise exception 'FAIL A1: the patient call did not return a pending request (%)', v_res;
  end if;
  v_req := (v_res ->> 'request_id')::uuid;
  select * into v_row from public.patient_allergies where id = v_a1;
  if v_row.correction_status is not null or v_row.superseded_by_id is not null or v_row.corrected_at is not null then
    raise exception 'FAIL A2: the original allergy was marked by a patient request';
  end if;
  v_f := private.prescription_safety_findings(v_p, 'peanut butter', null);
  if not (v_f @> '[{"code": "allergy_match"}]'::jsonb) then raise exception 'FAIL A3: prescription safety lost the allergy while the request is pending (%)', v_f; end if;
  select count(*) into v_n from private.patient_allergies_current where id = v_a1;
  if v_n <> 1 then raise exception 'FAIL A4: the pending allergy is not in the current view'; end if;

  -- the patient reads her own allergy and her request; the other patient and the untied clinician read nothing of it
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_allergies where id = v_a1;
  if v_n <> 1 then raise exception 'FAIL A5a: the patient no longer sees her own allergy'; end if;
  select count(*) into v_n from public.patient_allergy_correction_requests where id = v_req;
  if v_n <> 1 then raise exception 'FAIL A5b: the patient cannot see her own request'; end if;
  select count(*) into v_n from public.patient_allergy_correction_events where request_id = v_req;
  if v_n <> 1 then raise exception 'FAIL A5c: the patient cannot see her own request trail'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_allergy_correction_requests;
  if v_n <> 0 then raise exception 'FAIL A6a: another patient sees a request (%)', v_n; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_allergy_correction_requests where id = v_req;
  if v_n <> 0 then raise exception 'FAIL A6b: an untied clinician sees the request'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_allergy_correction_requests where id = v_req;
  if v_n <> 0 then raise exception 'FAIL A6c: a care coordinator sees the request'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_allergy_correction_requests where id = v_req;
  if v_n <> 1 then raise exception 'FAIL A6d (control): the tied clinician cannot see the request'; end if;
  execute 'reset role';

  -- refusals on the patient path
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin perform public.correct_clinical_value('patient_allergies', v_a1, 'amended', 'asking twice for the same entry', '{"severity": "mild"}'::jsonb);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '22023' then raise exception 'FAIL A7: a second pending request was accepted (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('patient_allergies', v_a2, 'corrected', 'wrong column in the replacement', '{"verified_by": null, "severity": "mild"}'::jsonb);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '22023' then raise exception 'FAIL A8: a non-value column was accepted in a request (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('patient_allergies', v_a2, 'corrected', 'severity is not one of the allowed values', '{"severity": "catastrophic"}'::jsonb);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is null then raise exception 'FAIL A9: an invalid severity was accepted in a request'; end if;
  v_state := null;
  begin perform public.correct_clinical_value('patient_allergies', v_a2, 'cancelled', 'a patient cannot cancel an entry', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL A10: a patient cancelled an allergy (state %)', v_state; end if;
  v_state := null;
  begin perform public.correct_clinical_value('patient_allergies', v_acl, 'entered_in_error', 'patient voids a clinician allergy', null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL A11: a patient could request a change of a clinician-recorded allergy (state %)', v_state; end if;
  -- control (other tables keep the current rule): her own manual reading is corrected at once
  v_res := public.correct_clinical_value('vitals_readings', v_w, 'corrected', 'Typed the wrong weight', '{"weight_kg": 71}'::jsonb);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'corrected' or (v_res ->> 'replacement_id') is null then raise exception 'FAIL A12: the patient reading correction is no longer immediate (%)', v_res; end if;
  if (select correction_status from public.vitals_readings where id = v_w) is distinct from 'corrected' then raise exception 'FAIL A12b: the reading was not superseded'; end if;
  select count(*) into v_n from public.patient_allergy_correction_requests where patient_id = v_p;
  if v_n <> 1 then raise exception 'FAIL A13: refused requests left rows behind (%)', v_n; end if;
  raise notice 'PASS A: a patient allergy request saves and changes nothing';

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
  if (select status from public.patient_allergy_correction_requests where id = v_req) <> 'pending' or
     (select correction_status from public.patient_allergies where id = v_a1) is not null then
    raise exception 'FAIL B6: a refused resolver changed something';
  end if;
  -- clients cannot write the tables directly, not even the patient whose request it is
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin update public.patient_allergy_correction_requests set status = 'confirmed' where id = v_req;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B7a: a client updated a request (state %)', v_state; end if;
  v_state := null;
  begin insert into public.patient_allergy_correction_requests (organisation_id, patient_id, allergy_id, requested_status, reason)
        values (v_org, v_p, v_a2, 'entered_in_error', 'forged request');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B7b: a client inserted a request (state %)', v_state; end if;
  v_state := null;
  begin delete from public.patient_allergy_correction_events where request_id = v_req;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B7c: a client deleted audit rows (state %)', v_state; end if;
  execute 'reset role';
  -- even the service role cannot edit the audit trail or decide a request outside the functions
  v_state := null;
  begin update public.patient_allergy_correction_events set note = 'tampered' where request_id = v_req;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then raise exception 'FAIL B8: the audit trail was edited (state %)', v_state; end if;
  -- the audit trail leaves with its request when the request is removed (a removed account), and only then
  v_flipped := false;
  begin
    delete from public.patient_allergy_correction_requests where id = v_req;
    if not exists (select 1 from public.patient_allergy_correction_events where request_id = v_req) then v_flipped := true; end if;
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if not v_flipped then raise exception 'FAIL B9: removing a request did not take its audit rows with it'; end if;
  if not exists (select 1 from public.patient_allergy_correction_events where request_id = v_req) then raise exception 'FAIL B9b: the removal was not undone'; end if;
  -- a request goes with its allergy when that allergy is hard-deleted by a privileged path (a purge, the wearable erasure flag), never blocking it
  v_flipped := false;
  begin
    perform set_config('app.allow_clinical_value_delete', 'on', true);
    perform set_config('app.change_reason', 'proof: privileged removal', true);
    delete from public.patient_allergies where id = (select allergy_id from public.patient_allergy_correction_requests where id = v_req);
    perform set_config('app.allow_clinical_value_delete', 'off', true);
    perform set_config('app.change_reason', '', true);
    if not exists (select 1 from public.patient_allergy_correction_requests where id = v_req)
       and not exists (select 1 from public.patient_allergy_correction_events where request_id = v_req) then v_flipped := true; end if;
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if not v_flipped then raise exception 'FAIL B10: deleting an allergy was blocked by, or left behind, its correction request'; end if;
  raise notice 'PASS B: only a tied, non-coordinator clinician resolves; tables are not client-writable';

  -- ======================================================================== C. reject
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.reject_patient_allergy_correction(v_req, 'Please discuss at the next visit');
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'rejected' then raise exception 'FAIL C1: reject returned %', v_res; end if;
  select * into v_row from public.patient_allergies where id = v_a1;
  if v_row.correction_status is not null or v_row.allergen <> 'Peanut' or v_row.severity <> 'moderate' then raise exception 'FAIL C2: a rejection changed the allergy'; end if;
  if not (private.prescription_safety_findings(v_p, 'peanut butter', null) @> '[{"code": "allergy_match"}]'::jsonb) then
    raise exception 'FAIL C3: prescription safety lost the allergy after a rejection';
  end if;
  select count(*) into v_n from public.notifications where recipient_id = v_p and template = 'record_change_not_confirmed' and channel = 'in_app' and content_class = 'non_clinical';
  if v_n <> 1 then raise exception 'FAIL C4: expected exactly one in-app notice, found %', v_n; end if;
  select payload::text into v_text from public.notifications where recipient_id = v_p and template = 'record_change_not_confirmed';
  if v_text ~* '(peanut|allerg|severity|moderate|please discuss)' then raise exception 'FAIL C5: the notice carries a clinical or note word: %', v_text; end if;
  select count(*) into v_n from public.notifications where recipient_id = v_p and template = 'record_change_not_confirmed' and channel <> 'in_app';
  if v_n <> 0 then raise exception 'FAIL C6: the notice went out on another channel'; end if;
  select * into v_row from public.patient_allergy_correction_requests where id = v_req;
  if v_row.status <> 'rejected' or v_row.decided_by is distinct from v_c or v_row.decided_at is null then raise exception 'FAIL C7: the rejection is not recorded'; end if;
  if (select array_agg(event order by at, event) from public.patient_allergy_correction_events where request_id = v_req) <> array['rejected', 'requested'] then
    raise exception 'FAIL C8: audit trail is not requested then rejected';
  end if;
  v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.confirm_patient_allergy_correction(v_req, null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '22023' then raise exception 'FAIL C9: a decided request was decided again (state %)', v_state; end if;
  -- the patient may ask again
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a1, 'amended', 'It is a tree nut allergy, not peanut', '{"allergen": "Tree nut", "severity": "severe"}'::jsonb);
  execute 'reset role';
  v_req2 := (v_res ->> 'request_id')::uuid;
  if v_res ->> 'status' is distinct from 'pending' or v_req2 = v_req then raise exception 'FAIL C10: the second request was not created'; end if;
  raise notice 'PASS C: reject leaves the original, notifies in-app without clinical words, is final';

  -- ======================================================================== D. confirm
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.confirm_patient_allergy_correction(v_req2, 'Checked with the patient');
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'confirmed' or v_res ->> 'correction_status' is distinct from 'amended' or (v_res ->> 'replacement_id') is null then raise exception 'FAIL D1: confirm returned %', v_res; end if;
  select * into v_row from public.patient_allergies where id = v_a1;
  if v_row.correction_status is distinct from 'amended' or v_row.superseded_by_id is distinct from (v_res ->> 'replacement_id')::uuid
     or v_row.corrected_by is distinct from v_c or length(btrim(v_row.correction_reason)) < 5 then
    raise exception 'FAIL D2: the original was not marked by the clinician through the supersede path';
  end if;
  select * into v_row from public.patient_allergies where id = (v_res ->> 'replacement_id')::uuid;
  if v_row.allergen <> 'Tree nut' or v_row.severity <> 'severe' or v_row.supersedes_id <> v_a1 or v_row.source <> 'clinician' or v_row.patient_id <> v_p then
    raise exception 'FAIL D3: the replacement allergy is wrong (%)', row_to_json(v_row);
  end if;
  v_f := private.prescription_safety_findings(v_p, 'peanut butter', null);
  if v_f @> '[{"code": "allergy_match"}]'::jsonb then raise exception 'FAIL D4: the superseded allergy still blocks a prescription'; end if;
  if not (private.prescription_safety_findings(v_p, 'tree nut oil', null) @> '[{"code": "allergy_match"}]'::jsonb) then raise exception 'FAIL D5: the replacement allergy does not block'; end if;
  select * into v_row from public.patient_allergy_correction_requests where id = v_req2;
  if v_row.status <> 'confirmed' or v_row.decided_by is distinct from v_c or v_row.replacement_id is distinct from (v_res ->> 'replacement_id')::uuid then
    raise exception 'FAIL D6: the request is not marked confirmed';
  end if;
  if (select array_agg(event order by at, event) from public.patient_allergy_correction_events where request_id = v_req2) <> array['confirmed', 'requested'] then
    raise exception 'FAIL D7: audit trail is not requested then confirmed';
  end if;
  -- the supersede ledger carries a reason too
  if not exists (select 1 from public.record_corrections rc where rc.entity_id = v_a1 and rc.table_name = 'patient_allergies' and length(btrim(rc.reason)) >= 5) then
    raise exception 'FAIL D8: record_corrections has no row with a reason for the marked allergy';
  end if;
  -- entered_in_error, confirmed: the allergy leaves the readers
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a2, 'entered_in_error', 'I never had a shellfish allergy', null);
  execute 'reset role';
  v_req3 := (v_res ->> 'request_id')::uuid;
  if not (private.prescription_safety_findings(v_p, 'shellfish stock', null) @> '[{"code": "allergy_match"}]'::jsonb) then raise exception 'FAIL D9: shellfish stopped blocking before the confirmation'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.confirm_patient_allergy_correction(v_req3, null);
  execute 'reset role';
  if private.prescription_safety_findings(v_p, 'shellfish stock', null) @> '[{"code": "allergy_match"}]'::jsonb then raise exception 'FAIL D10: shellfish still blocks after the confirmation'; end if;
  if (select correction_status from public.patient_allergies where id = v_a2) is distinct from 'entered_in_error' then raise exception 'FAIL D11: the allergy is not entered_in_error'; end if;
  raise notice 'PASS D: confirm supersedes through the one path, prescription safety follows';

  -- ======================================================================== E. void, and the clinician's own direct correction
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a3, 'entered_in_error', 'Latex was a mistake of mine', null);
  execute 'reset role';
  v_req := (v_res ->> 'request_id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a3, 'corrected', 'Clinician confirmed severity at the visit', '{"severity": "severe"}'::jsonb);
  if v_res ->> 'status' is distinct from 'corrected' then raise exception 'FAIL E1: the clinician correction is no longer immediate (%)', v_res; end if;
  execute 'reset role';
  if (select status from public.patient_allergy_correction_requests where id = v_req) <> 'void'
     or not exists (select 1 from public.patient_allergy_correction_events where request_id = v_req and event = 'void' and actor_role = 'system') then
    raise exception 'FAIL E2: a request for an allergy a clinician corrected directly was not closed as void';
  end if;
  v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.confirm_patient_allergy_correction(v_req, null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '22023' then raise exception 'FAIL E3: a voided request could still be confirmed (state %)', v_state; end if;
  if (select count(*) from public.patient_allergies where supersedes_id = v_a3) <> 1 then raise exception 'FAIL E4: more than one replacement exists'; end if;
  -- control: the confirm path itself does not void its own request (D already proved it ends confirmed)
  -- a request for a name another current allergy already has is refused now, not at the clinician's confirmation
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin perform public.correct_clinical_value('patient_allergies', v_a4, 'corrected', 'Sesame is actually a shellfish allergy', '{"allergen": "Penicillin"}'::jsonb);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '22023' then raise exception 'FAIL E5: a request colliding with another current allergy was accepted (state %)', v_state; end if;
  -- a collision that appears AFTER the request was made is refused at confirmation with a clear message, and the request stays for a decision
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a5, 'corrected', 'Dust should be recorded as mold', '{"allergen": "Mold"}'::jsonb);
  execute 'reset role';
  v_req2 := (v_res ->> 'request_id')::uuid;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, severity, source) values (v_org, v_p, 'Mold', 'mild', 'patient');
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin perform public.confirm_patient_allergy_correction(v_req2, null);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  v_res := public.reject_patient_allergy_correction(v_req2, null);
  execute 'reset role';
  if v_state is distinct from '22023' then raise exception 'FAIL E6: a late name collision was not refused with a clear error (state %)', v_state; end if;
  raise notice 'PASS E: stale request voids; clinician correction stays immediate';

  -- the patient takes a pending request back; nobody else may; a withdrawn request is final and no longer blocks a new one
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.correct_clinical_value('patient_allergies', v_a4, 'entered_in_error', 'I typed sesame by mistake', null);
  execute 'reset role';
  v_req3 := (v_res ->> 'request_id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin perform public.withdraw_patient_allergy_correction(v_req3);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '42501' then raise exception 'FAIL E7: another patient withdrew a request (state %)', v_state; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin perform public.withdraw_patient_allergy_correction(v_req3);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '42501' then raise exception 'FAIL E8: a clinician used the patient withdrawal (state %)', v_state; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.withdraw_patient_allergy_correction(v_req3);
  execute 'reset role';
  if v_res ->> 'status' is distinct from 'withdrawn' or (select status from public.patient_allergy_correction_requests where id = v_req3) <> 'withdrawn'
     or not exists (select 1 from public.patient_allergy_correction_events where request_id = v_req3 and event = 'withdrawn' and actor_role = 'patient') then
    raise exception 'FAIL E9: the withdrawal is not recorded';
  end if;
  if (select correction_status from public.patient_allergies where id = v_a4) is not null then raise exception 'FAIL E10: a withdrawal changed the allergy'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin perform public.withdraw_patient_allergy_correction(v_req3);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  v_res := public.correct_clinical_value('patient_allergies', v_a4, 'amended', 'Sesame is a mild allergy after all', '{"severity": "mild"}'::jsonb);
  execute 'reset role';
  if v_state is distinct from '22023' then raise exception 'FAIL E11: a withdrawn request could be withdrawn again (state %)', v_state; end if;
  if v_res ->> 'status' is distinct from 'pending' then raise exception 'FAIL E12: a new request after a withdrawal was refused'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.withdraw_patient_allergy_correction((v_res ->> 'request_id')::uuid);   -- leave the entry clean for the sabotage steps
  execute 'reset role';
  -- the export function refuses to be asked for somebody else
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin perform public.my_corrected_record_entries(v_p2);
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  execute 'reset role';
  if v_state is distinct from '42501' then raise exception 'FAIL E13: the history export answered for another patient (state %)', v_state; end if;

  -- ======================================================================== F. grant, export, views
  if not has_function_privilege('authenticated', c, 'EXECUTE') or has_function_privilege('anon', c, 'EXECUTE') then
    raise exception 'FAIL F1: correct_clinical_value must be executable by authenticated and never by anon';
  end if;
  if has_function_privilege('anon', 'public.confirm_patient_allergy_correction(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reject_patient_allergy_correction(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_corrected_record_entries(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.withdraw_patient_allergy_correction(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.request_patient_allergy_correction(uuid, public.correction_status, text, jsonb)', 'EXECUTE') then
    raise exception 'FAIL F2: a new function is callable by the wrong role';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.my_corrected_record_entries();
  execute 'reset role';
  if jsonb_array_length(v_json -> 'patient_allergies') <> 3 or jsonb_array_length(v_json -> 'vitals_readings') <> 1 then
    raise exception 'FAIL F3: the patient export lost superseded values (%)', v_json;
  end if;
  if v_json::text ~ '"(corrected_by|recorded_by|verified_by|logged_by_profile_id)"' then raise exception 'FAIL F4: the export carries a staff identifier'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.my_corrected_record_entries();
  execute 'reset role';
  if jsonb_array_length(v_json -> 'patient_allergies') <> 0 or jsonb_array_length(v_json -> 'vitals_readings') <> 0 then
    raise exception 'FAIL F5: another patient received superseded values (%)', v_json;
  end if;
  -- the patient's superseded values never carry a staff identifier, whichever column holds it (a name pattern, not a list)
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.correct_clinical_value('patient_conditions', v_cond, 'corrected', 'Name recorded in full', '{"condition_name": "Essential hypertension"}'::jsonb);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.my_corrected_record_entries();
  execute 'reset role';
  if jsonb_array_length(v_json -> 'patient_conditions') <> 1 or (v_json -> 'patient_conditions' -> 0) ? 'diagnosing_clinician_id'
     or (v_json -> 'patient_conditions' -> 0) ? 'corrected_by' or (v_json -> 'patient_conditions' -> 0) ? 'recorded_by'
     or not ((v_json -> 'patient_conditions' -> 0) ? 'superseded_by_id') or not ((v_json -> 'patient_conditions' -> 0) ? 'correction_reason') then
    raise exception 'FAIL F11: the corrected condition leaks a staff identifier or lost its link and reason (%)', v_json -> 'patient_conditions';
  end if;
  for v_text in select c.column_name from information_schema.columns c
                 where c.table_schema = 'public' and c.table_name in ('vitals_readings', 'patient_conditions', 'patient_allergies', 'lab_analyte_readings')
                   and (c.column_name ~ '(clinician|staff|doctor|_by$)' or c.column_name = 'logged_by_profile_id') and c.column_name <> 'superseded_by_id' loop
    if not private.is_staff_identifier_column(v_text) then raise exception 'FAIL F12: staff-like column % is not excluded from the patient export', v_text; end if;
  end loop;
  -- a client never reads the clinician's note or identity, on either table (column grants), but reads the safe columns
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin perform decision_note from public.patient_allergy_correction_requests;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then execute 'reset role'; raise exception 'FAIL F7a: a patient can read the clinician note (state %)', v_state; end if;
  v_state := null;
  begin perform decided_by from public.patient_allergy_correction_requests;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then execute 'reset role'; raise exception 'FAIL F7b: a patient can read the deciding clinician (state %)', v_state; end if;
  v_state := null;
  begin perform note from public.patient_allergy_correction_events;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then execute 'reset role'; raise exception 'FAIL F7c: a patient can read the audit note (state %)', v_state; end if;
  v_state := null;
  begin perform actor_id from public.patient_allergy_correction_events;
  exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
  if v_state is distinct from '42501' then execute 'reset role'; raise exception 'FAIL F7d: a patient can read the audit actor (state %)', v_state; end if;
  select count(*) into v_n from (select id, status, requested_status, reason, decided_at from public.patient_allergy_correction_requests) q;
  execute 'reset role';
  if v_n < 3 then raise exception 'FAIL F7e (control): the patient cannot read the safe columns of her own requests (%)', v_n; end if;
  -- the export carries her own requests, without the clinician's note or identity
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.my_corrected_record_entries();
  execute 'reset role';
  if jsonb_array_length(v_json -> 'patient_allergy_correction_requests') < 3 or v_json::text ~ '(decision_note|decided_by|Please discuss at the next visit|Checked with the patient)' then
    raise exception 'FAIL F8: the export lost her requests or carries the clinician note or identity';
  end if;
  -- decided_by has no foreign key (its SET NULL update would hit the decided-request guard when a profile is removed)
  if exists (select 1 from pg_constraint where conrelid = 'public.patient_allergy_correction_requests'::regclass and contype = 'f' and conkey = array[(select attnum from pg_attribute where attrelid = 'public.patient_allergy_correction_requests'::regclass and attname = 'decided_by')]) then
    raise exception 'FAIL F9: decided_by has a foreign key again';
  end if;
  -- the registry export dumps whole rows, so the request table (clinician note and identity) is registered as not exported
  if not exists (select 1 from public.data_registry where table_name = 'patient_allergy_correction_requests' and in_export = false) then
    raise exception 'FAIL F13: the request table is exported whole by the registry export';
  end if;
  -- the template is registered like every other in-app notice
  if not exists (select 1 from public.notification_templates where key = 'record_change_not_confirmed' and default_channels = array['in_app']::public.notification_channel[])
     or not exists (select 1 from public.notification_template_locales where template_key = 'record_change_not_confirmed' and channel = 'in_app') then
    raise exception 'FAIL F10: the notice template is not registered';
  end if;
  for v_text in select unnest(array['vitals_readings', 'patient_conditions', 'patient_allergies', 'lab_analyte_readings']) loop
    if (select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = v_text)
       is distinct from (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a where a.attrelid = ('private.' || v_text || '_current')::regclass and a.attnum > 0 and not a.attisdropped) then
      raise exception 'FAIL F6: private.%_current is out of step with its table', v_text;
    end if;
  end loop;
  raise notice 'PASS F: grant open to authenticated only, export complete, views in step';

  -- ======================================================================== G. sabotage (each must flip)
  -- G1: without the patient branch the patient's void takes effect at once
  v_flipped := false;
  begin
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.proname = 'correct_clinical_value' and p.pronamespace = 'public'::regnamespace;
    if position('if not v_is_staff and p_table = ''patient_allergies'' then' in v_def) = 0 then raise exception 'sabotage anchor missing'; end if;
    execute replace(v_def, 'if not v_is_staff and p_table = ''patient_allergies'' then', 'if false and p_table = ''patient_allergies'' then');
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.correct_clinical_value('patient_allergies', v_a4, 'entered_in_error', 'Sesame is not an allergy of mine', null);
    execute 'reset role';
    if (select correction_status from public.patient_allergies where id = v_a4) is not null
       and not (private.prescription_safety_findings(v_p, 'sesame oil', null) @> '[{"code": "allergy_match"}]'::jsonb) then
      v_flipped := true;
    end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL G1: sabotage did not flip (the pending-request proof is vacuous)'; end if;
  if (select correction_status from public.patient_allergies where id = v_a4) is not null then raise exception 'FAIL G1b: sabotage was not undone'; end if;

  -- G2: with a permissive clinician test an untied clinician can resolve a request
  v_flipped := false;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := public.correct_clinical_value('patient_allergies', v_a4, 'entered_in_error', 'Sesame is not an allergy of mine', null);
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

  -- G3: with the PUBLIC grant back, anon can execute the correction function
  v_flipped := false;
  begin
    grant execute on function public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb) to public;
    if has_function_privilege('anon', c, 'EXECUTE') then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if not v_flipped then raise exception 'FAIL G3: sabotage did not flip (the anon proof is vacuous)'; end if;
  if has_function_privilege('anon', c, 'EXECUTE') then raise exception 'FAIL G3b: sabotage was not undone'; end if;

  -- G4: with the append-only trigger gone the audit trail can be rewritten
  v_flipped := false;
  begin
    drop trigger patient_allergy_correction_events_append_only on public.patient_allergy_correction_events;
    update public.patient_allergy_correction_events set note = 'tampered' where request_id = v_req2;
    v_flipped := true;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if not v_flipped then raise exception 'FAIL G4: sabotage did not flip (the append-only proof is vacuous)'; end if;
  if exists (select 1 from public.patient_allergy_correction_events where note = 'tampered') then raise exception 'FAIL G4b: sabotage was not undone'; end if;

  -- G5: with the voiding trigger gone a request for a corrected allergy stays pending for good
  v_flipped := false;
  begin
    drop trigger z_void_pending_allergy_requests on public.patient_allergies;
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := public.correct_clinical_value('patient_allergies', v_a4, 'entered_in_error', 'Sesame was typed by mistake', null);
    execute 'reset role';
    v_req := (v_res ->> 'request_id')::uuid;
    perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.correct_clinical_value('patient_allergies', v_a4, 'corrected', 'Clinician corrected it directly', '{"severity": "severe"}'::jsonb);
    execute 'reset role';
    if (select status from public.patient_allergy_correction_requests where id = v_req) = 'pending' then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL G5: sabotage did not flip (the stale-request proof is vacuous)'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'z_void_pending_allergy_requests') then raise exception 'FAIL G5b: sabotage was not undone'; end if;

  -- G6: without the ownership check another patient can withdraw somebody else's request
  v_flipped := false;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := public.correct_clinical_value('patient_allergies', v_a4, 'entered_in_error', 'Sesame was typed by mistake', null);
    execute 'reset role';
    v_req := (v_res ->> 'request_id')::uuid;
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.proname = 'withdraw_patient_allergy_correction' and p.pronamespace = 'public'::regnamespace;
    if position('v_req.patient_id <> v_uid' in v_def) = 0 then raise exception 'sabotage anchor missing'; end if;
    execute replace(v_def, 'v_req.patient_id <> v_uid', 'false');
    perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.withdraw_patient_allergy_correction(v_req);
    execute 'reset role';
    v_flipped := true;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL G6: sabotage did not flip (the withdrawal ownership proof is vacuous)'; end if;

  -- G7: without the guard the history function answers for another patient
  v_flipped := false;
  begin
    select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.proname = 'my_corrected_record_entries' and p.pronamespace = 'public'::regnamespace;
    if position('p_patient <> v_uid' in v_def) = 0 then raise exception 'sabotage anchor missing'; end if;
    execute replace(v_def, 'p_patient <> v_uid', 'false');
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    perform public.my_corrected_record_entries(v_p2);
    execute 'reset role';
    v_flipped := true;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL G7: sabotage did not flip (the history-export guard proof is vacuous)'; end if;

  raise notice 'PASS G: seven sabotages each flipped';
  raise notice 'S05b-d patient allergy correction requests proof complete';
end $$;

rollback;
