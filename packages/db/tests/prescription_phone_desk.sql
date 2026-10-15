-- ===========================================================================
-- Proof: *_prescription_phone_desk.sql (the "no smartphone" route: TarragonHealth staff look a prescription up by phone and record the supply).
--
-- Proves, with simulated sessions: an admin and an active clinical-staff member can look a prescription up by Rx number + verification code (code case-insensitive);
-- a wrong code or Rx number answers found = false; the result has NO patient-name column and the name on the paper only ever yields matches / does not match
-- (same words in any order, title ignored, a middle name left out accepted, a single first name or a different surname refused, blank = not checked);
-- a patient, a clinician with no active staff row and anon are refused; every lookup is audited (a found one against the patient, a failed one as denied) and the
-- verification code is never stored; recording a supply needs the registration, is stored as recorded_via = 'desk_phone' with the staff member as recorder, notifies the
-- patient, is refused as a duplicate inside the window, and the lookup then shows the supply used. SABOTAGE: a name matcher that always says true accepts a wrong name.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_nostaff uuid := gen_random_uuid();
  v_med uuid; v_rx text; v_code text;
  r record;
  v_n integer;
  v_cols text;
  v_failed boolean;
  v_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'rxdesk-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_pat, v_doc, v_adm, v_staff, v_nostaff]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone, is_active) values
    (v_pat,     v_org, 'patient',   'Ada Obi Eze',     '+2348058881101', true),
    (v_doc,     v_org, 'clinician', 'RxDesk Doctor',   '+2348058881102', true),
    (v_adm,     v_org, 'admin',     'RxDesk Admin',    '+2348058881103', true),
    (v_staff,   v_org, 'clinician', 'RxDesk Staff',    '+2348058881104', true),
    (v_nostaff, v_org, 'clinician', 'RxDesk No Staff', '+2348058881105', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, is_active = true;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org, v_doc,   'RxDesk Doctor', true, now(), 'senior_medical_officer', 'MDCN', 'RXDESK-1', 'Probe', 'RXD-1', now() + interval '1 year'),
    (v_org, v_staff, 'RxDesk Staff',  true, now(), 'senior_medical_officer',        'MDCN', 'RXDESK-2', 'Probe', 'RXD-2', now() + interval '1 year');

  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, quantity, duration_days, source, added_by)
  values (v_org, v_pat, 'RxDesk Drug', '5 mg', 'daily', '30 tablets', 30, 'clinician', v_doc)
  returning id, rx_number, verification_code into v_med, v_rx, v_code;
  perform set_config('request.jwt.claims', '', true);

  -- 1. admin finds it; a lower-case code works; the result has no patient column
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.desk_verify_prescription(v_rx, lower(v_code));
  execute 'reset role';
  if r.found is not true or r.status <> 'active' or r.drug_name <> 'RxDesk Drug' or r.quantity <> '30 tablets' or r.duration_days <> 30
     or r.supplies_dispensed <> 0 or r.supply_available is not true or r.prescriber_credential is distinct from 'MDCN RXDESK-1' or r.name_checked is not false then
    raise exception 'FAIL: admin lookup wrong: %', r;
  end if;
  select string_agg(a, ',') into v_cols from unnest((select proargnames from pg_proc where oid = 'public.desk_verify_prescription(text,text,text)'::regprocedure)) a
   where a ~* 'patient|dob|birth|phone|email|address' ;
  if v_cols is not null then raise exception 'FAIL: the result exposes identifier-like columns: %', v_cols; end if;

  -- 2. wrong code / wrong number: found = false, nothing else
  execute 'set local role authenticated';
  select * into r from public.desk_verify_prescription(v_rx, 'ZZZZZZ');
  if r.found is not false or r.drug_name is not null then execute 'reset role'; raise exception 'FAIL: wrong code answered: %', r; end if;
  select * into r from public.desk_verify_prescription('TRG-RX-0000-000000', v_code);
  if r.found is not false then execute 'reset role'; raise exception 'FAIL: wrong Rx number answered'; end if;

  -- 3. the name on the paper: only matches / does not match
  select * into r from public.desk_verify_prescription(v_rx, v_code, 'Ada Obi Eze');   if r.name_matches is not true or r.name_checked is not true then execute 'reset role'; raise exception 'FAIL: exact name'; end if;
  select * into r from public.desk_verify_prescription(v_rx, v_code, 'EZE, ada obi');  if r.name_matches is not true then execute 'reset role'; raise exception 'FAIL: reordered name'; end if;
  select * into r from public.desk_verify_prescription(v_rx, v_code, 'Dr. Ada Eze');   if r.name_matches is not true then execute 'reset role'; raise exception 'FAIL: middle name left out'; end if;
  select * into r from public.desk_verify_prescription(v_rx, v_code, 'Ada');           if r.name_matches is not false or r.name_checked is not true then execute 'reset role'; raise exception 'FAIL: a single first name matched'; end if;
  select * into r from public.desk_verify_prescription(v_rx, v_code, 'Ada Okafor');    if r.name_matches is not false then execute 'reset role'; raise exception 'FAIL: a different surname matched'; end if;
  select * into r from public.desk_verify_prescription(v_rx, v_code, '   ');          if r.name_checked is not false then execute 'reset role'; raise exception 'FAIL: blank counted as checked'; end if;
  execute 'reset role';

  -- 4. who may use it
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.desk_verify_prescription(v_rx, v_code);
  execute 'reset role';
  if r.found is not true then raise exception 'FAIL: an active clinical-staff member could not use the desk'; end if;
  for r in select u from unnest(array[v_pat, v_nostaff]) u loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.u, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false;
    begin perform public.desk_verify_prescription(v_rx, v_code); exception when insufficient_privilege then v_failed := true; end;
    if not v_failed then execute 'reset role'; raise exception 'FAIL: % could use the desk lookup', r.u; end if;
    v_failed := false;
    begin perform public.desk_record_prescription_supply(v_rx, v_code, 'P Pharmacy', 'Ee Pharmacist', 'PCN-1234'); exception when insufficient_privilege then v_failed := true; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL: % could record a supply from the desk', r.u; end if;
  end loop;
  execute 'set local role anon';
  v_failed := false;
  begin perform public.desk_verify_prescription(v_rx, v_code); exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL: anon could call the desk lookup'; end if;

  -- 5. audit: found against the patient, failed as denied, the code never stored
  select count(*) into v_n from public.audit_log where action = 'prescription.desk_lookup' and result = 'success' and subject_patient_id = v_pat and actor_id = v_adm;
  if v_n < 1 then raise exception 'FAIL: a found lookup was not audited against the patient'; end if;
  select count(*) into v_n from public.audit_log where action = 'prescription.desk_lookup' and result = 'denied' and actor_id = v_adm;
  if v_n < 2 then raise exception 'FAIL: failed lookups were not audited (%)', v_n; end if;
  select count(*) into v_n from public.audit_log where action like 'prescription.desk_%' and (event::text ilike '%' || v_code || '%' or event::text ilike '%ZZZZZZ%');
  if v_n <> 0 then raise exception 'FAIL: a verification code was stored in the audit log'; end if;

  -- 6. recording a supply from the desk
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.desk_record_prescription_supply(v_rx, v_code, 'Phone Pharmacy', 'Ee Pharmacist', '');
  if r.outcome <> 'invalid' then execute 'reset role'; raise exception 'FAIL: a supply without a registration was accepted (%)', r.outcome; end if;
  select * into r from public.desk_record_prescription_supply(v_rx, 'ZZZZZZ', 'Phone Pharmacy', 'Ee Pharmacist', 'PCN-1234');
  if r.outcome <> 'not_found' then execute 'reset role'; raise exception 'FAIL: a wrong code recorded a supply (%)', r.outcome; end if;
  select * into r from public.desk_record_prescription_supply(v_rx, v_code, 'Phone Pharmacy', 'Ee Pharmacist', 'PCN-1234');
  if r.outcome <> 'recorded' or r.supplies_dispensed <> 1 then execute 'reset role'; raise exception 'FAIL: desk recording: %', r; end if;
  select * into r from public.desk_record_prescription_supply(v_rx, v_code, 'Phone Pharmacy', 'Ee Pharmacist', 'PCN-1234');
  execute 'reset role';
  if r.outcome <> 'duplicate' then raise exception 'FAIL: an immediate repeat was not refused as a duplicate (%)', r.outcome; end if;
  select recorded_via, recorded_by, pharmacy_name into r from public.pharmacy_order_dispenses where medication_id = v_med and source = 'pharmacy';
  if r.recorded_via <> 'desk_phone' or r.recorded_by is distinct from v_adm or r.pharmacy_name <> 'Phone Pharmacy' then raise exception 'FAIL: stored supply row wrong: %', r; end if;
  select count(*) into v_n from public.notifications where recipient_id = v_pat and template = 'prescription_supply_recorded' and payload->>'pharmacy_name' = 'Phone Pharmacy';
  if v_n <> 1 then raise exception 'FAIL: the patient was not notified (%)', v_n; end if;
  select count(*) into v_n from public.audit_log where action = 'prescription.desk_supply_recorded' and actor_id = v_adm and subject_patient_id = v_pat;
  if v_n <> 1 then raise exception 'FAIL: the desk recording was not audited (%)', v_n; end if;
  execute 'set local role authenticated';
  select * into r from public.desk_verify_prescription(v_rx, v_code);
  execute 'reset role';
  if r.supplies_dispensed <> 1 or r.supply_available is not false then raise exception 'FAIL: lookup after recording: %', r; end if;

  -- SABOTAGE: a name matcher that always says true accepts a wrong name
  create or replace function private.person_names_match(p_a text, p_b text) returns boolean language sql immutable set search_path = '' as $f$ select true $f$;
  execute 'set local role authenticated';
  select * into r from public.desk_verify_prescription(v_rx, v_code, 'Totally Different Person');
  execute 'reset role';
  if r.name_matches is not true then raise exception 'SABOTAGE not effective: the always-true matcher did not accept a wrong name'; end if;

  raise notice 'prescription phone desk: all assertions passed';
end $$;

rollback;
