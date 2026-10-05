-- ===========================================================================
-- Proof: *_prescription_supply_record_and_repeat_control.sql (prescription PDF phase 3).
--
-- Proves, as an ANONYMOUS caller holding the token: the first supply records (source 'pharmacy', recorded_via 'public_verification', names stored,
-- no recorder); an immediate repeat is refused as a duplicate; once the window passes a second supply is refused while no repeat has been approved;
-- an approved repeat request permits exactly one more; the permitted number never exceeds 1 + repeats_allowed; a patient's own "I picked this up"
-- row is not counted as a supply; a superseded, expired or stopped prescription cannot be supplied; unknown/malformed tokens and invalid names are
-- refused; the check reports supplies_dispensed / supply_available / repeats_used correctly afterwards; anon cannot write or read the dispense table
-- directly. SABOTAGE: removing the permitted-supplies guard from a copy of the function lets an exhausted prescription be supplied again, so the
-- exhaustion assertions are not vacuous.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_m4 uuid; v_m5 uuid;
  v_t1 text; v_t2 text; v_t3 text; v_t4 text; v_t5 text;
  r record;
  v_n integer;
  v_def text;
  v_i integer;
  v_disp uuid;
  v_ok boolean;
  v_failed boolean;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'rxsup-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_pat, v_doc]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat, v_org, 'patient',   'RxSup Patient', '+2348058880601'),
    (v_doc, v_org, 'clinician', 'RxSup Doctor',  '+2348058880602')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
  values (v_org, v_doc, 'RxSup Doctor', true, now(), 'senior_medical_officer', 'MDCN', 'RXSUP-1', 'Probe', 'RXSUP-1', now() + interval '1 year');

  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, quantity, source, added_by, repeats_allowed)
  values (v_org, v_pat, 'RxSup Amlodipine', '5 mg', 'Once daily', '30 tablets', 'clinician', v_doc, 1) returning id, public_token into v_m1, v_t1;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by, repeats_allowed)
  values (v_org, v_pat, 'RxSup Patient Claimed', '1 mg', 'Daily', 'clinician', v_doc, 0) returning id, public_token into v_m2, v_t2;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by)
  values (v_org, v_pat, 'RxSup Superseded', '1 mg', 'Daily', 'clinician', v_doc) returning id, public_token into v_m3, v_t3;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by)
  values (v_org, v_pat, 'RxSup Expired', '1 mg', 'Daily', 'clinician', v_doc) returning id, public_token into v_m4, v_t4;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by)
  values (v_org, v_pat, 'RxSup Stopped', '1 mg', 'Daily', 'clinician', v_doc) returning id, public_token into v_m5, v_t5;
  update public.medications set superseded_at = now(), is_active = false where id = v_m3;
  update public.medications set expires_at = now() - interval '1 day' where id = v_m4;
  update public.medications set is_active = false where id = v_m5;

  -- 1. before anything: 0 of 1, available
  execute 'set local role anon';
  select * into r from public.verify_prescription_public(v_t1);
  execute 'reset role';
  if r.supplies_dispensed <> 0 or r.supplies_permitted <> 1 or r.supply_available is not true or r.repeats_used <> 0 or r.repeats_remaining <> 1 then
    raise exception 'FAIL: initial supply state wrong: %', r;
  end if;

  -- 2. first supply records
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t1, 'RxSup Pharmacy', 'Ada Pharmacist', 'PCN-123');
  execute 'reset role';
  if r.outcome <> 'recorded' or r.supplies_dispensed <> 1 or r.supplies_permitted <> 1 then raise exception 'FAIL: first supply: %', r; end if;
  select * into r from public.pharmacy_order_dispenses where medication_id = v_m1;
  if r.source <> 'pharmacy' or r.recorded_via <> 'public_verification' or r.recorded_by is not null or r.pharmacy_name <> 'RxSup Pharmacy'
     or r.pharmacist_name <> 'Ada Pharmacist' or r.pharmacist_registration <> 'PCN-123' or r.patient_id <> v_pat or r.organisation_id <> v_org
     or r.quantity <> '30 tablets' or r.dispensed_on <> (now() at time zone 'Africa/Lagos')::date then
    raise exception 'FAIL: stored supply row wrong: %', r;
  end if;

  -- 3. immediate repeat of the same recording is a duplicate; after the window it is refused for lack of an approved repeat
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t1, 'Other Pharmacy', 'Bola Pharmacist', 'PCN-1234');
  execute 'reset role';
  if r.outcome <> 'duplicate' then raise exception 'FAIL: duplicate not caught: %', r; end if;
  update public.pharmacy_order_dispenses set created_at = now() - interval '11 minutes' where medication_id = v_m1;
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t1, 'Other Pharmacy', 'Bola Pharmacist', 'PCN-1234');
  execute 'reset role';
  if r.outcome <> 'no_supply_available' or r.supplies_dispensed <> 1 or r.supplies_permitted <> 1 then raise exception 'FAIL: second supply without approval: %', r; end if;
  select count(*) into v_n from public.pharmacy_order_dispenses where medication_id = v_m1;
  if v_n <> 1 then raise exception 'FAIL: refused supply still wrote a row (%)', v_n; end if;
  execute 'set local role anon';
  select * into r from public.verify_prescription_public(v_t1);
  execute 'reset role';
  if r.supply_available is not false or r.supplies_dispensed <> 1 or r.last_supplied_on is distinct from (now() at time zone 'Africa/Lagos')::date then
    raise exception 'FAIL: exhausted state not reported: %', r;
  end if;

  -- 4. an approved repeat permits exactly one more (a request is raised pending, then a clinician approves it)
  insert into public.medication_repeat_requests (organisation_id, patient_id, medication_id) values (v_org, v_pat, v_m1);
  update public.medication_repeat_requests set status = 'approved' where medication_id = v_m1;
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t1, 'Other Pharmacy', 'Bola Pharmacist', 'PCN-1234');
  execute 'reset role';
  if r.outcome <> 'recorded' or r.supplies_dispensed <> 2 or r.supplies_permitted <> 2 then raise exception 'FAIL: approved repeat supply: %', r; end if;
  execute 'set local role anon';
  select * into r from public.verify_prescription_public(v_t1);
  execute 'reset role';
  if r.supplies_dispensed <> 2 or r.repeats_used <> 1 or r.repeats_remaining <> 0 or r.supply_available is not false then raise exception 'FAIL: state after repeat: %', r; end if;
  -- the permitted number never exceeds 1 + repeats_allowed even if more approvals exist (the allowance is lowered to 0 here)
  update public.pharmacy_order_dispenses set created_at = now() - interval '11 minutes' where medication_id = v_m1;
  update public.medications set repeats_allowed = 0 where id = v_m1;
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t1, 'Third Pharmacy', 'Cy Pharmacist', 'PCN-1234');
  execute 'reset role';
  if r.outcome <> 'no_supply_available' or r.supplies_permitted <> 1 then raise exception 'FAIL: cap beyond repeats_allowed: %', r; end if;
  update public.medications set repeats_allowed = 1 where id = v_m1;

  -- 5. a patient's own collection claim is not a supply
  insert into public.pharmacy_order_dispenses (organisation_id, patient_id, medication_id, drug_name, source, pharmacy_name)
  values (v_org, v_pat, v_m2, 'RxSup Patient Claimed', 'patient', 'Somewhere');
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t2, 'Real Pharmacy', 'Di Pharmacist', 'PCN-1234');
  execute 'reset role';
  if r.outcome <> 'recorded' or r.supplies_dispensed <> 1 then raise exception 'FAIL: patient claim counted as a supply: %', r; end if;

  -- 6. superseded, expired, stopped, unknown, malformed, invalid
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t3, 'Pharmacy', 'Ee Pharmacist', 'PCN-1234'); if r.outcome <> 'not_active' then execute 'reset role'; raise exception 'FAIL: superseded supplied (%)', r.outcome; end if;
  select * into r from public.record_prescription_supply_public(v_t4, 'Pharmacy', 'Ee Pharmacist', 'PCN-1234'); if r.outcome <> 'not_active' then execute 'reset role'; raise exception 'FAIL: expired supplied (%)', r.outcome; end if;
  select * into r from public.record_prescription_supply_public(v_t5, 'Pharmacy', 'Ee Pharmacist', 'PCN-1234'); if r.outcome <> 'not_active' then execute 'reset role'; raise exception 'FAIL: stopped supplied (%)', r.outcome; end if;
  select * into r from public.record_prescription_supply_public(repeat('0', 64), 'Pharmacy', 'Ee Pharmacist', 'PCN-1234'); if r.outcome <> 'not_found' then execute 'reset role'; raise exception 'FAIL: unknown token (%)', r.outcome; end if;
  select * into r from public.record_prescription_supply_public('nope', 'Pharmacy', 'Ee Pharmacist', 'PCN-1234'); if r.outcome <> 'not_found' then execute 'reset role'; raise exception 'FAIL: malformed token (%)', r.outcome; end if;
  select * into r from public.record_prescription_supply_public(v_t5, '', 'Ee Pharmacist', 'PCN-1234'); if r.outcome <> 'invalid' then execute 'reset role'; raise exception 'FAIL: empty pharmacy (%)', r.outcome; end if;
  select * into r from public.record_prescription_supply_public(v_t5, 'Pharmacy', repeat('x', 121), 'PCN-1234'); if r.outcome <> 'invalid' then execute 'reset role'; raise exception 'FAIL: long name (%)', r.outcome; end if;
  execute 'reset role';
  select count(*) into v_n from public.pharmacy_order_dispenses where medication_id in (v_m3, v_m4, v_m5);
  if v_n <> 0 then raise exception 'FAIL: a refused prescription gained % supply rows', v_n; end if;

  -- 7. anon cannot touch the table directly
  execute 'set local role anon';
  begin
    insert into public.pharmacy_order_dispenses (organisation_id, patient_id, medication_id, drug_name, source)
    values (v_org, v_pat, v_m5, 'direct', 'pharmacy');
    execute 'reset role'; raise exception 'FAIL: anon inserted a dispense row directly';
  exception when insufficient_privilege or check_violation or others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    execute 'reset role';
  end;
  execute 'set local role anon';
  begin
    select count(*) into v_n from public.pharmacy_order_dispenses;
  exception when insufficient_privilege then v_n := 0; end;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL: anon read % dispense rows', v_n; end if;

  -- 8. HARDENING: registration required, attempts logged, patient notified, supply disputable
  select count(*) into v_n from public.prescription_supply_attempts where medication_id = v_m1;
  if v_n < 3 then raise exception 'FAIL: refused attempts against a real prescription were not logged (%)', v_n; end if;
  select count(*) into v_n from public.prescription_supply_attempts where token_hash = v_t1 or pharmacy_name is null and false;
  if v_n <> 0 then raise exception 'FAIL: a raw token was stored as the hash'; end if;
  select count(*) into v_n from public.prescription_supply_attempts where token_hash = encode(sha256(convert_to(v_t1, 'UTF8')), 'hex') and medication_id = v_m1;
  if v_n < 1 then raise exception 'FAIL: attempt hash is not the sha256 of the token'; end if;
  select count(*) into v_n from public.prescription_supply_attempts where medication_id in (v_m3, v_m4, v_m5);
  if v_n < 3 then raise exception 'FAIL: not_active attempts were not logged (%)', v_n; end if;
  execute 'set local role anon';
  select count(*) into v_n from public.record_prescription_supply_public(repeat('0', 64), 'Pharmacy', 'Ee Pharmacist', 'PCN-1234');
  execute 'reset role';
  select count(*) into v_n from public.prescription_supply_attempts where token_hash = encode(sha256(convert_to(repeat('0', 64), 'UTF8')), 'hex');
  if v_n <> 0 then raise exception 'FAIL: an unknown token was logged'; end if;

  -- the registration is required and shaped
  update public.pharmacy_order_dispenses set created_at = now() - interval '11 minutes' where medication_id = v_m1;
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t2, 'Pharmacy', 'Ee Pharmacist'); if r.outcome <> 'invalid' then execute 'reset role'; raise exception 'FAIL: missing registration accepted (%)', r.outcome; end if;
  select * into r from public.record_prescription_supply_public(v_t2, 'Pharmacy', 'Ee Pharmacist', '!!'); if r.outcome <> 'invalid' then execute 'reset role'; raise exception 'FAIL: malformed registration accepted (%)', r.outcome; end if;
  execute 'reset role';

  -- the log is capped per prescription per hour
  for v_i in 1..30 loop
    execute 'set local role anon';
    perform public.record_prescription_supply_public(v_t3, 'Pharmacy', 'Ee Pharmacist', 'PCN-1234');
    execute 'reset role';
  end loop;
  select count(*) into v_n from public.prescription_supply_attempts where medication_id = v_m3 and created_at > now() - interval '1 hour';
  if v_n > 20 then raise exception 'FAIL: attempt log not capped (%)', v_n; end if;

  -- the stored row is marked unverified, and the patient was notified in-app
  select * into r from public.pharmacy_order_dispenses where medication_id = v_m2 and source = 'pharmacy';
  if r.pharmacist_registration_verified is not false or r.pharmacist_registration is null then raise exception 'FAIL: registration verified flag wrong: %', r; end if;
  select count(*) into v_n from public.notifications where recipient_id = v_pat and template = 'prescription_supply_recorded' and channel = 'in_app'
     and payload->>'pharmacy_name' = 'Real Pharmacy' and payload->>'pharmacist_registration' = 'PCN-1234';
  if v_n <> 1 then raise exception 'FAIL: patient notification missing or duplicated (%)', v_n; end if;

  -- 9. dispute: only the patient, only a pharmacy supply; it stops counting and frees the supply
  v_disp := (select id from public.pharmacy_order_dispenses where medication_id = v_m2 and source = 'pharmacy');
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.dispute_prescription_supply(v_disp, 'not me') into v_ok;
  execute 'reset role';
  if v_ok then raise exception 'FAIL: a clinician disputed the patient supply'; end if;
  execute 'set local role anon';
  v_failed := false;
  begin perform public.dispute_prescription_supply(v_disp, 'x'); exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL: anon can call dispute_prescription_supply'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.dispute_prescription_supply(v_disp, 'I was not there') into v_ok;
  select count(*) into v_n from public.prescription_supply_attempts where patient_id = v_pat;
  execute 'reset role';
  if not v_ok then raise exception 'FAIL: the patient could not dispute their own supply'; end if;
  if v_n < 1 then raise exception 'FAIL: the patient cannot see attempts on their prescriptions'; end if;
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  select * into r from public.verify_prescription_public(v_t2);
  execute 'reset role';
  if r.supplies_dispensed <> 0 or r.supply_available is not true then raise exception 'FAIL: a disputed supply still counted: %', r; end if;
  select count(*) into v_n from public.audit_log where action = 'prescription.supply_disputed' and entity_id = v_disp and actor_id = v_pat;
  if v_n <> 1 then raise exception 'FAIL: dispute not audited (%)', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.dispute_prescription_supply(v_disp, 'again') into v_ok;
  execute 'reset role';
  if v_ok then raise exception 'FAIL: a disputed supply was disputed twice'; end if;
  perform set_config('request.jwt.claims', '', true);

  -- SABOTAGE: remove the permitted-supplies guard from a copy of the function; the exhausted prescription is then supplied again
  update public.pharmacy_order_dispenses set created_at = now() - interval '11 minutes' where medication_id = v_m1;
  select replace(pg_get_functiondef('public.record_prescription_supply_public(text,text,text,text,text)'::regprocedure),
                 'when v_dispensed >= v_permitted then', 'when false then') into v_def;
  if v_def not like '%when false then%' then raise exception 'SABOTAGE not applied'; end if;
  execute v_def;
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t1, 'Sabotage Pharmacy', 'Sab Pharmacist', 'PCN-1234');
  execute 'reset role';
  if r.outcome <> 'recorded' then raise exception 'SABOTAGE not effective: exhausted prescription still refused (%)', r.outcome; end if;

  raise notice 'prescription supply record + repeat control: all assertions passed';
end $$;

rollback;
