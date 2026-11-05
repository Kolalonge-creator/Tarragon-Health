-- ===========================================================================
-- Proof: 20261105130145_t2_11c_patient_confirms_supply.sql
--
-- Proves: (A) a patient's confirmation of their own signed prescription counts as one supply, so the anonymous QR check shows it used and
-- labelled patient-reported, a repeat tap is a duplicate and a later one finds no supply; (B) a pharmacy recording the same supply within
-- the window is not refused and does not double count: the patient's row is matched and stops counting, and a second pharmacy then finds no
-- supply; (C) a patient confirming after a pharmacy recorded writes a receipt against that record, not a second supply; (D) another patient,
-- and anon, cannot confirm; (E) the patient can undo within 24 hours (audited, row kept), not after, not once a pharmacy matched it, and
-- nobody else can; (F) no client can rewrite the history directly (patient or staff), and a patient can no longer insert or edit a pharmacy
-- row through the table policy; (G) disputing the pharmacy row that matched a report makes the report count again.
-- SABOTAGE: (1) the shared count reverted to pharmacy rows only makes a patient-confirmed prescription look available; (2) without the
-- matching trigger a pharmacy record after a patient report double counts; (3) without the history guard the patient rewrites their own
-- confirmation directly. Each must flip.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_m4 uuid;
  v_t1 text; v_t2 text; v_t3 text; v_t4 text;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  r record;
  v_n integer;
  v_c1 uuid; v_c3 uuid; v_p1 uuid; v_p2 uuid;
  v_out text;
  v_failed boolean;
  v_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 't211c-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_pat, v_other, v_doc]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,   v_org, 'patient',   'T211c Patient', '+2348058881101'),
    (v_other, v_org, 'patient',   'T211c Other',   '+2348058881102'),
    (v_doc,   v_org, 'clinician', 'T211c Doctor',  '+2348058881103')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
  values (v_org, v_doc, 'T211c Doctor', true, now(), 'senior_medical_officer', 'MDCN', 'T211C-1', 'Probe', 'T211C-1', now() + interval '1 year');

  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, quantity, source, added_by, repeats_allowed)
  values (v_org, v_pat, 'T211c Amlodipine', '5 mg', 'Once daily', '30 tablets', 'clinician', v_doc, 0) returning id, public_token into v_m1, v_t1;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, quantity, source, added_by, repeats_allowed)
  values (v_org, v_pat, 'T211c Metformin', '500 mg', 'Twice daily', '60 tablets', 'clinician', v_doc, 0) returning id, public_token into v_m2, v_t2;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, quantity, source, added_by, repeats_allowed)
  values (v_org, v_pat, 'T211c Losartan', '50 mg', 'Once daily', '30 tablets', 'clinician', v_doc, 0) returning id, public_token into v_m3, v_t3;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, quantity, source, added_by, repeats_allowed)
  values (v_org, v_pat, 'T211c Atorvastatin', '20 mg', 'At night', '30 tablets', 'clinician', v_doc, 0) returning id, public_token into v_m4, v_t4;
  if (select count(*) from public.medications where id in (v_m1, v_m2, v_m3, v_m4) and rx_number is not null and public_token is not null) <> 4 then
    raise exception 'FIXTURE: clinician medications have no rx_number/public_token';
  end if;

  -- (A) the patient confirms: counts once, labelled patient-reported on the QR page --------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m1, null, 'Corner Chemist', 'Ikeja', null);
  execute 'reset role';
  if r.outcome <> 'recorded' or r.supplies_dispensed <> 1 or r.supplies_permitted <> 1 or r.dispense_id is null then
    raise exception 'FAIL A1: patient confirmation: %', r;
  end if;
  v_c1 := r.dispense_id;
  select * into r from public.pharmacy_order_dispenses where id = v_c1;
  if r.source <> 'patient' or r.recorded_via <> 'patient_confirmation' or r.recorded_by <> v_pat or r.pharmacy_name <> 'Corner Chemist'
     or r.pharmacy_town <> 'Ikeja' or r.dispensed_on <> v_today or r.quantity <> '30 tablets' then
    raise exception 'FAIL A2: stored confirmation wrong: %', r;
  end if;
  if not exists (select 1 from public.audit_log where entity_id = v_c1 and action = 'prescription.patient_reported_supply' and actor_id = v_pat) then
    raise exception 'FAIL A3: no audit row for the confirmation';
  end if;
  execute 'set local role anon';
  select * into r from public.verify_prescription_public(v_t1);
  execute 'reset role';
  if r.supplies_dispensed <> 1 or r.supply_available is not false or r.patient_reported_supplies <> 1
     or r.last_patient_report_on is distinct from v_today or r.patient_report_awaiting_pharmacy is not true or r.last_supplied_on is distinct from v_today then
    raise exception 'FAIL A4: QR page after a patient confirmation: %', r;
  end if;
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m1);
  execute 'reset role';
  if r.outcome <> 'duplicate' then raise exception 'FAIL A5: immediate repeat not a duplicate: %', r; end if;
  update public.pharmacy_order_dispenses set created_at = now() - interval '11 minutes' where id = v_c1;
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m1);
  execute 'reset role';
  if r.outcome <> 'no_supply_available' or r.supplies_dispensed <> 1 then raise exception 'FAIL A6: second patient supply: %', r; end if;
  -- future dates and dates before signing are refused
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m4, v_today + 1);
  if r.outcome <> 'invalid' then execute 'reset role'; raise exception 'FAIL A7: future date accepted: %', r; end if;
  select * into r from public.confirm_prescription_collected(v_m4, v_today - 30);
  if r.outcome <> 'invalid' then execute 'reset role'; raise exception 'FAIL A8: date before signing accepted: %', r; end if;
  execute 'reset role';

  -- (D) another patient and anon cannot confirm ------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m4);
  execute 'reset role';
  if r.outcome <> 'not_found' then raise exception 'FAIL D1: another patient confirmed: %', r; end if;
  execute 'set local role anon';
  v_failed := false;
  begin
    perform public.confirm_prescription_collected(v_m4);
  exception when insufficient_privilege then v_failed := true;
  end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL D2: anon can call confirm_prescription_collected'; end if;
  if exists (select 1 from public.pharmacy_order_dispenses where medication_id = v_m4) then raise exception 'FAIL D3: refused confirmations wrote a row'; end if;

  -- (B) the pharmacy that supplied it records within the window: recorded, no double count, second pharmacy refused -----------
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t1, 'Corner Chemist', 'Ada Pharmacist', 'PCN-123');
  execute 'reset role';
  if r.outcome <> 'recorded' or r.supplies_dispensed <> 1 then raise exception 'FAIL B1: pharmacy record after patient report: %', r; end if;
  select id into v_p1 from public.pharmacy_order_dispenses where medication_id = v_m1 and source = 'pharmacy';
  select * into r from public.pharmacy_order_dispenses where id = v_c1;
  if r.matched_dispense_id is distinct from v_p1 or r.matched_at is null then raise exception 'FAIL B2: patient report not matched: %', r; end if;
  select count(*) into v_n from public.pharmacy_order_dispenses d where d.medication_id = v_m1 and private.dispense_counts_as_supply(d);
  if v_n <> 1 then raise exception 'FAIL B3: % counted supplies after the pharmacy record (double count)', v_n; end if;
  execute 'set local role anon';
  select * into r from public.verify_prescription_public(v_t1);
  execute 'reset role';
  if r.supplies_dispensed <> 1 or r.patient_reported_supplies <> 0 or r.patient_report_awaiting_pharmacy is not false or r.supply_available is not false then
    raise exception 'FAIL B4: QR page after the match: %', r;
  end if;
  update public.pharmacy_order_dispenses set created_at = now() - interval '11 minutes' where id = v_p1;
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t1, 'Second Pharmacy', 'Bola Pharmacist', 'PCN-456');
  execute 'reset role';
  if r.outcome <> 'no_supply_available' then raise exception 'FAIL B5: second pharmacy supplied: %', r; end if;

  -- (C) patient confirms after a pharmacy recorded: a receipt, not a second supply ----------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t2, 'Main Street Pharmacy', 'Chi Pharmacist', 'PCN-789');
  execute 'reset role';
  select id into v_p2 from public.pharmacy_order_dispenses where medication_id = v_m2 and source = 'pharmacy';
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m2, null, 'Main Street Pharmacy');
  execute 'reset role';
  if r.outcome <> 'matched_pharmacy_record' or r.dispense_id is distinct from v_p2 or r.supplies_dispensed <> 1 then
    raise exception 'FAIL C1: confirm after pharmacy record: %', r;
  end if;
  if not exists (select 1 from public.medication_receipt_confirmations where pharmacy_order_dispense_id = v_p2 and patient_id = v_pat
                   and confirmation_source = 'patient_self_report') then
    raise exception 'FAIL C2: no receipt confirmation against the pharmacy record';
  end if;
  select count(*) into v_n from public.pharmacy_order_dispenses d where d.medication_id = v_m2 and private.dispense_counts_as_supply(d);
  if v_n <> 1 then raise exception 'FAIL C3: % counted supplies on m2', v_n; end if;
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m2);
  execute 'reset role';
  if r.outcome <> 'already_recorded' then raise exception 'FAIL C4: second confirm after the receipt: %', r; end if;

  -- (E) undo -----------------------------------------------------------------------------------------------------------------------
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m3, null, 'Ward Pharmacy', 'Yaba');
  execute 'reset role';
  v_c3 := r.dispense_id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_out := public.undo_prescription_collected(v_c3, 'not mine');
  execute 'reset role';
  if v_out <> 'not_found' then raise exception 'FAIL E1: another patient undid it: %', v_out; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_out := public.undo_prescription_collected(v_c3, 'staff');
  execute 'reset role';
  if v_out <> 'not_found' then raise exception 'FAIL E2: a clinician undid the patient confirmation: %', v_out; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_out := public.undo_prescription_collected(v_c3, 'Tapped by mistake');
  execute 'reset role';
  if v_out <> 'undone' then raise exception 'FAIL E3: own undo: %', v_out; end if;
  select * into r from public.pharmacy_order_dispenses where id = v_c3;
  if r.withdrawn_at is null or r.withdrawn_by <> v_pat or r.withdraw_reason <> 'Tapped by mistake' then raise exception 'FAIL E4: withdrawn row: %', r; end if;
  if not exists (select 1 from public.audit_log where entity_id = v_c3 and action = 'prescription.patient_reported_supply_withdrawn' and actor_id = v_pat) then
    raise exception 'FAIL E5: undo not audited';
  end if;
  execute 'set local role anon';
  select * into r from public.verify_prescription_public(v_t3);
  execute 'reset role';
  if r.supplies_dispensed <> 0 or r.supply_available is not true or r.patient_reported_supplies <> 0 then raise exception 'FAIL E6: QR page after undo: %', r; end if;
  -- confirm again, then the window passes
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m3);
  execute 'reset role';
  if r.outcome <> 'recorded' then raise exception 'FAIL E7: confirm after undo: %', r; end if;
  v_c3 := r.dispense_id;
  update public.pharmacy_order_dispenses set created_at = now() - interval '25 hours' where id = v_c3;
  execute 'set local role authenticated';
  v_out := public.undo_prescription_collected(v_c3);
  execute 'reset role';
  if v_out <> 'window_passed' then raise exception 'FAIL E8: undo after 24 hours: %', v_out; end if;
  -- a matched report cannot be undone (v_c1 is matched to the pharmacy record; make it recent)
  update public.pharmacy_order_dispenses set created_at = now() - interval '1 hour' where id = v_c1;
  execute 'set local role authenticated';
  v_out := public.undo_prescription_collected(v_c1);
  execute 'reset role';
  if v_out <> 'confirmed_by_pharmacy' then raise exception 'FAIL E9: undo of a matched report: %', v_out; end if;

  -- (F) no client rewrites history directly ---------------------------------------------------------------------------------------
  execute 'set local role authenticated';
  v_failed := false;
  begin update public.pharmacy_order_dispenses set withdrawn_at = now(), withdrawn_by = v_pat where id = v_c3;
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL F1: patient withdrew outside the undo function'; end if;
  v_failed := false;
  begin update public.pharmacy_order_dispenses set pharmacy_name = 'Edited' where id = v_c3;
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL F2: patient edited their confirmation directly'; end if;
  v_failed := false;
  begin
    insert into public.pharmacy_order_dispenses (organisation_id, patient_id, medication_id, drug_name, source, recorded_via)
    values (v_org, v_pat, v_m4, 'T211c Atorvastatin', 'patient', 'patient_confirmation');
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL F3: patient inserted a confirmation directly'; end if;
  v_failed := false;
  begin
    insert into public.pharmacy_order_dispenses (organisation_id, patient_id, medication_id, drug_name, source)
    values (v_org, v_pat, v_m4, 'T211c Atorvastatin', 'pharmacy');
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL F4: patient inserted a pharmacy supply directly'; end if;
  v_failed := false;
  begin update public.pharmacy_order_dispenses set disputed_at = now() where id = v_p2;
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL F5: patient un-counted a pharmacy supply directly'; end if;
  -- control: the old "I picked this up" row still works for the patient, and does not count
  insert into public.pharmacy_order_dispenses (organisation_id, patient_id, medication_id, drug_name, source, pharmacy_name)
  values (v_org, v_pat, v_m4, 'T211c Atorvastatin', 'patient', 'Somewhere');
  execute 'reset role';
  select count(*) into v_n from public.pharmacy_order_dispenses d where d.medication_id = v_m4 and private.dispense_counts_as_supply(d);
  if v_n <> 0 then raise exception 'FAIL F6: an app-logged patient row counted as a supply'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin update public.pharmacy_order_dispenses set dispensed_on = v_today - 1 where id = v_c3;
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL F7: a clinician edited a patient confirmation'; end if;
  -- the clinician reads it, labelled
  execute 'set local role authenticated';
  select count(*) into v_n from public.pharmacy_order_dispenses where id = v_c3 and recorded_via = 'patient_confirmation';
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL F8: the care team cannot see the patient confirmation'; end if;

  -- (G) a disputed pharmacy record un-matches the patient report -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if not public.dispute_prescription_supply(v_p1, 'This pharmacy did not supply it') then
    execute 'reset role'; raise exception 'FAIL G1: dispute refused';
  end if;
  execute 'reset role';
  if (select matched_dispense_id from public.pharmacy_order_dispenses where id = v_c1) is not null then
    raise exception 'FAIL G2: report still matched to a disputed pharmacy record';
  end if;
  execute 'set local role anon';
  select * into r from public.verify_prescription_public(v_t1);
  execute 'reset role';
  if r.supplies_dispensed <> 1 or r.patient_reported_supplies <> 1 or r.supply_available is not false then raise exception 'FAIL G3: after dispute: %', r; end if;

  -- SABOTAGE 1: the count without patient confirmations -----------------------------------------------------------------------------
  v_def := pg_get_functiondef('private.dispense_counts_as_supply(public.pharmacy_order_dispenses)'::regprocedure);
  execute $s$create or replace function private.dispense_counts_as_supply(d public.pharmacy_order_dispenses) returns boolean
    language sql immutable set search_path = '' as $b$ select d.source = 'pharmacy'::public.dispense_source and d.disputed_at is null $b$ $s$;
  execute 'set local role anon';
  select * into r from public.verify_prescription_public(v_t3);
  execute 'reset role';
  if r.supply_available is not true then raise exception 'SABOTAGE 1 did not flip: a patient-confirmed supply still counted without the shared count'; end if;
  execute v_def;
  execute 'set local role anon';
  select * into r from public.verify_prescription_public(v_t3);
  execute 'reset role';
  if r.supply_available is not false then raise exception 'FAIL S1 restore: %', r; end if;

  -- SABOTAGE 2: no matching trigger, a pharmacy record after a patient report double counts ----------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m4, null, 'Corner Chemist');
  execute 'reset role';
  if r.outcome <> 'recorded' then raise exception 'FIXTURE S2: %', r; end if;
  alter table public.pharmacy_order_dispenses disable trigger pharmacy_order_dispenses_match_patient_report;
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t4, 'Corner Chemist', 'Ada Pharmacist', 'PCN-123');
  execute 'reset role';
  alter table public.pharmacy_order_dispenses enable trigger pharmacy_order_dispenses_match_patient_report;
  select count(*) into v_n from public.pharmacy_order_dispenses d where d.medication_id = v_m4 and private.dispense_counts_as_supply(d);
  if v_n <> 2 then raise exception 'SABOTAGE 2 did not flip: % counted supplies without the matching trigger', v_n; end if;

  -- SABOTAGE 3: without the history guard the patient rewrites their confirmation ---------------------------------------------------
  alter table public.pharmacy_order_dispenses disable trigger pharmacy_order_dispenses_guard_history;
  execute 'set local role authenticated';
  update public.pharmacy_order_dispenses set withdrawn_at = now(), withdrawn_by = v_pat where id = v_c3;
  get diagnostics v_n = row_count;
  execute 'reset role';
  alter table public.pharmacy_order_dispenses enable trigger pharmacy_order_dispenses_guard_history;
  if v_n <> 1 then raise exception 'SABOTAGE 3 did not flip: the direct rewrite was refused without the guard'; end if;

  raise notice 'PASS: t2_11c patient confirms supply';
end $$;

rollback;
