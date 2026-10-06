-- S28 proof: a patient chooses a verified pharmacy, gets a collection code; the pharmacy verifies it and records a full or partial supply
-- (migration *_s28_pharmacy_collection_and_dispensing.sql). INV-02, INV-07, INV-10, INV-13.
-- Proves in one rolled-back transaction: only verified, active pharmacies are offered; only the patient who owns the prescription can choose,
-- and the code is readable by her alone (not the pharmacy, not a clinician, not another patient); a pharmacy sees only prescriptions sent to
-- it, through an audited list that carries no code; direct reads of prescriptions by a pharmacy are gone; a wrong code is counted and the
-- fifth locks it, a new code from the patient unlocks it; another pharmacy cannot verify or dispense; a partial supply needs a written
-- outstanding note and leaves the prescription waiting; a full supply moves it to dispensed once, uses the code and tells the patient
-- neutrally; the QR path and the partner path share ONE supply count in both directions; changing pharmacy is allowed before a supply
-- starts and never after; every notice names no medicine; anon and the wrong roles are refused.
-- SABOTAGE: the wrong-attempt lock removed and the shared supply count removed; both must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table txt(k text primary key, v text) on commit drop;
grant all on txt to public;

create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.sett(p text, p_v text) returns void language sql as $$ insert into txt values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.t(p text) returns text language sql as $$ select v from txt where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run one statement as a user; returns its single text result, or ERR:sqlstate. A failed statement still leaves the transaction usable.
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.anon_q(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_name text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's28-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, p_name, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
-- a signed prescription (as the owner, no session) with its clinician medicine row
create function pg_temp.mkrx(p_org uuid, p_pat uuid, p_doc uuid, p_drug text, p_state text) returns uuid language plpgsql as
$f$ declare v_rx uuid;
begin
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test)
  values (p_org, p_pat, jsonb_build_array(jsonb_build_object('drug', p_drug, 'dose', '5 mg', 'quantity', '30 tablets')), p_state::public.prescription_state,
          case when p_state = 'draft' then null else p_doc end, case when p_state = 'draft' then null else now() end, true) returning id into v_rx;
  if p_state <> 'draft' then
    insert into public.medications (organisation_id, patient_id, drug_name, dose, quantity, repeats_allowed, source, is_active, prescription_id)
    values (p_org, p_pat, p_drug, '5 mg', '30 tablets', 0, 'clinician', true, v_rx);
  end if;
  return v_rx;
end $f$;
create function pg_temp.med_of(p_rx uuid) returns uuid language sql as $$ select id from public.medications where prescription_id = p_rx $$;
create function pg_temp.rxstate(p_rx uuid) returns text language sql as $$ select state::text from public.prescriptions where id = p_rx $$;
-- the first column of a pharmacist function that returns rows
create function pg_temp.verify_as(p_uid uuid, p_rx uuid, p_code text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select outcome from public.pharmacist_verify_collection(%L, %L)$q$, p_rx, p_code)) $$;
create function pg_temp.disp_as(p_uid uuid, p_rx uuid, p_code text, p_partial boolean, p_note text, p_reg text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select outcome from public.pharmacist_dispense_prescription(%L, %L, '30 tablets', %L, %L, 'B-1234', %L, %L, 'Ada Pharmacist')$q$,
     p_rx, p_code, p_partial, p_note, (current_date + 400)::text, p_reg)) $$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_pA uuid; v_pB uuid; v_pC uuid; v_lA uuid; v_lB uuid; v_lU uuid; v_lC uuid; v_doc uuid; v_pat uuid; v_pat2 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status) values ('S28 Pharmacy A', true, now(), now(), 'activated') returning id into v_pA;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status) values ('S28 Pharmacy B', true, now(), now(), 'activated') returning id into v_pB;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status) values ('S28 Pharmacy C inactive', false, now(), now(), 'activated') returning id into v_pC;
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state, address, is_active, verified_at) values (v_pA, 'S28 A Lekki', 'Lagos', '1 Test Road', true, now()) returning id into v_lA;
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state, address, is_active, verified_at) values (v_pB, 'S28 B Ikeja', 'Lagos', '2 Test Road', true, now()) returning id into v_lB;
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state, address, is_active, verified_at) values (v_pA, 'S28 A Unverified', 'Lagos', '3 Test Road', true, null) returning id into v_lU;
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state, address, is_active, verified_at) values (v_pC, 'S28 C Inactive', 'Lagos', '4 Test Road', true, now()) returning id into v_lC;
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('pA', v_pA); perform pg_temp.setf('pB', v_pB); perform pg_temp.setf('pC', v_pC);
  perform pg_temp.setf('lA', v_lA); perform pg_temp.setf('lB', v_lB); perform pg_temp.setf('lU', v_lU); perform pg_temp.setf('lC', v_lC);
  perform pg_temp.setf('phA', pg_temp.mkuser(v_org, 'phA', 'pharmacist', 'S28 Pharmacist A'));
  perform pg_temp.setf('phB', pg_temp.mkuser(v_org, 'phB', 'pharmacist', 'S28 Pharmacist B'));
  update public.profiles set pharmacy_partner_id = v_pA where id = pg_temp.f('phA');
  update public.profiles set pharmacy_partner_id = v_pB where id = pg_temp.f('phB');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician', 'S28 Prescriber');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', 'S28 Patient');
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient', 'S28 Other Patient');
  perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('pat2', v_pat2);
  insert into public.patient_allergies (organisation_id, patient_id, allergen, reaction, severity) values (v_org, v_pat, 'Penicillin', 'rash', 'moderate');
  perform pg_temp.setf('rx1', pg_temp.mkrx(v_org, v_pat, v_doc, 'Proofdrug One', 'signed'));
  perform pg_temp.setf('rx2', pg_temp.mkrx(v_org, v_pat, v_doc, 'Proofdrug Two', 'signed'));
  perform pg_temp.setf('rx3', pg_temp.mkrx(v_org, v_pat, v_doc, 'Proofdrug Three', 'signed'));
  perform pg_temp.setf('rxDraft', pg_temp.mkrx(v_org, v_pat, v_doc, 'Proofdrug Draft', 'draft'));
end $$;

-- A. the patient's chooser ------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'A1 the patient is offered the two verified, active locations only (not the unverified or the inactive pharmacy)', '2',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.patient_collection_pharmacies(%L) where partner_name like 'S28%%'$q$, pg_temp.f('rx1'))));
select pg_temp.ck('real', 'A2 another patient cannot list for this prescription', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat2'), format($q$select count(*)::text from public.patient_collection_pharmacies(%L)$q$, pg_temp.f('rx1'))));
select pg_temp.ck('real', 'A3 anon cannot list', 'ERR:42501', pg_temp.anon_q(format($q$select count(*)::text from public.patient_collection_pharmacies(%L)$q$, pg_temp.f('rx1'))));
select pg_temp.ck('real', 'A4 an unverified location is refused', 'ERR:22023', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lU'))));
select pg_temp.ck('real', 'A5 an inactive pharmacy is refused', 'ERR:22023', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx1'), pg_temp.f('pC'), pg_temp.f('lC'))));
select pg_temp.ck('real', 'A6 a location of another pharmacy is refused', 'ERR:22023', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lB'))));
select pg_temp.ck('real', 'A7 a draft cannot be sent', 'ERR:22023', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rxDraft'), pg_temp.f('pA'), pg_temp.f('lA'))));
select pg_temp.ck('real', 'A8 another patient cannot choose for it', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lA'))));
select pg_temp.ck('real', 'A9 a pharmacist cannot choose', 'ERR:42501', pg_temp.q_as(pg_temp.f('phA'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lA'))));
select pg_temp.ck('real', 'A10 anon cannot choose', 'ERR:42501', pg_temp.anon_q(format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lA'))));
select pg_temp.ck('real', 'A11 refusals changed nothing: still signed, no pharmacy', 'signed|', pg_temp.rxstate(pg_temp.f('rx1')) || '|' || coalesce((select pharmacy_partner_id::text from public.prescriptions where id = pg_temp.f('rx1')), ''));

do $$ begin perform pg_temp.sett('code1', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lA')))); end $$;
select pg_temp.ck('real', 'A12 choosing returns an 8 character code from the safe alphabet', 'true', (pg_temp.t('code1') ~ '^[0-9A-HJKMNP-TV-Z]{8}$')::text);
select pg_temp.ck('real', 'A13 the prescription is now sent to pharmacy A at the chosen location, with no plain code on the prescription row', 'sent|true|true|',
  (select state::text || '|' || (pharmacy_partner_id = pg_temp.f('pA'))::text || '|' || (pharmacy_location_id = pg_temp.f('lA'))::text || '|' || coalesce(collection_code, '') from public.prescriptions where id = pg_temp.f('rx1')));
select pg_temp.ck('real', 'A14 the patient reads her own code', 'true', (coalesce(pg_temp.q_as(pg_temp.f('pat'), format($q$select code from public.patient_prescription_collection(%L)$q$, pg_temp.f('rx1'))), '') = pg_temp.t('code1'))::text);
select pg_temp.ck('real', 'A15 the pharmacy cannot read the code table', '0', pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.prescription_collection_codes'));
select pg_temp.ck('real', 'A16 a clinician cannot read the code table', '0', pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.prescription_collection_codes'));
select pg_temp.ck('real', 'A17 another patient cannot read the code table', '0', pg_temp.q_as(pg_temp.f('pat2'), 'select count(*)::text from public.prescription_collection_codes'));
select pg_temp.ck('real', 'A18 anon cannot read the code table', 'ERR:42501', pg_temp.anon_q('select count(*)::text from public.prescription_collection_codes'));
select pg_temp.ck('real', 'A19 INV-07: one neutral notice to pharmacy A, none to B, one to the patient, none names the medicine',
  '1|0|1|0',
  (select count(*) filter (where template = 'pharmacy_new_prescription' and recipient_id = pg_temp.f('phA'))::text || '|' ||
          count(*) filter (where template = 'pharmacy_new_prescription' and recipient_id = pg_temp.f('phB'))::text || '|' ||
          count(*) filter (where template = 'prescription_sent_patient' and recipient_id = pg_temp.f('pat'))::text || '|' ||
          count(*) filter (where template in ('pharmacy_new_prescription', 'prescription_sent_patient') and payload::text ilike '%Proofdrug%')::text from public.notifications where organisation_id = pg_temp.f('org') and created_at > now() - interval '5 minutes'));
select pg_temp.ck('real', 'A20 one prescription.sent event and an audit row', '1|1',
  (select count(*) from public.domain_events where event_type = 'prescription.sent' and aggregate_id = pg_temp.f('rx1'))::text || '|' ||
  (select count(*) from public.audit_log where action = 'prescription.pharmacy_chosen' and entity_id = pg_temp.f('rx1'))::text);
select pg_temp.ck('real', 'A21 the patient cannot move her own prescription by a direct update', 'pA',
  (with u as (select pg_temp.q_as(pg_temp.f('pat'), format($q$update public.prescriptions set pharmacy_partner_id = %L where id = %L$q$, pg_temp.f('pB'), pg_temp.f('rx1')))),
        v as (select case when pharmacy_partner_id = pg_temp.f('pA') then 'pA' else 'moved' end r from public.prescriptions where id = pg_temp.f('rx1')) select r from v));

-- B. the pharmacy's list --------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'B1 pharmacy A lists its one prescription', '1', pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.pharmacist_prescriptions()'));
select pg_temp.ck('real', 'B2 pharmacy B lists none of A''s', '0', pg_temp.q_as(pg_temp.f('phB'), 'select count(*)::text from public.pharmacist_prescriptions()'));
select pg_temp.ck('real', 'B3 a patient cannot call the list', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), 'select count(*)::text from public.pharmacist_prescriptions()'));
select pg_temp.ck('real', 'B4 anon cannot call the list', 'ERR:42501', pg_temp.anon_q('select count(*)::text from public.pharmacist_prescriptions()'));
select pg_temp.ck('real', 'B5 INV-10: the list wrote an audit row naming the prescription', 'true',
  (exists (select 1 from public.audit_log where action = 'pharmacy.prescriptions_listed' and (event -> 'prescription_ids') ? pg_temp.f('rx1')::text))::text);
select pg_temp.ck('real', 'B6 the list carries no collection code column', 'false', (pg_get_function_result('public.pharmacist_prescriptions()'::regprocedure) ilike '%code%' and pg_get_function_result('public.pharmacist_prescriptions()'::regprocedure) not ilike '%code_locked%')::text);
select pg_temp.ck('real', 'B7 a pharmacy cannot read prescriptions directly (INV-10: only through the audited door)', '0', pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.prescriptions'));
select pg_temp.ck('real', 'B8 a pharmacy cannot flip a prescription to dispensed directly', 'sent',
  (with u as (select pg_temp.q_as(pg_temp.f('phA'), format($q$update public.prescriptions set state = 'dispensed' where id = %L$q$, pg_temp.f('rx1')))) select pg_temp.rxstate(pg_temp.f('rx1')) from u));

-- C. the counter: verify ---------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'C1 another pharmacy cannot verify it', 'not_found', pg_temp.verify_as(pg_temp.f('phB'), pg_temp.f('rx1'), pg_temp.t('code1')));
select pg_temp.ck('real', 'C2 a wrong code is wrong_code', 'wrong_code', pg_temp.verify_as(pg_temp.f('phA'), pg_temp.f('rx1'), 'WRONG123'));
select pg_temp.ck('real', 'C3 a patient cannot verify', 'ERR:42501', pg_temp.verify_as(pg_temp.f('pat'), pg_temp.f('rx1'), pg_temp.t('code1')));
select pg_temp.ck('real', 'C4 anon cannot verify', 'ERR:42501', pg_temp.anon_q(format($q$select outcome from public.pharmacist_verify_collection(%L, 'X')$q$, pg_temp.f('rx1'))));
do $$ declare i integer; begin for i in 1 .. 3 loop perform pg_temp.verify_as(pg_temp.f('phA'), pg_temp.f('rx1'), 'WRONG' || i); end loop; end $$;
select pg_temp.ck('real', 'C5 the fifth wrong try locks the code', 'locked', pg_temp.verify_as(pg_temp.f('phA'), pg_temp.f('rx1'), 'WRONG5'));
select pg_temp.ck('real', 'C6 once locked, even the right code is refused', 'locked', pg_temp.verify_as(pg_temp.f('phA'), pg_temp.f('rx1'), pg_temp.t('code1')));
select pg_temp.ck('real', 'C7 every wrong try was audited', '5', (select count(*)::text from public.audit_log where action = 'pharmacy.collection_code_failed' and entity_id = pg_temp.f('rx1')));
select pg_temp.ck('real', 'C8 the list shows the code is locked', 'true', pg_temp.q_as(pg_temp.f('phA'), 'select code_locked::text from public.pharmacist_prescriptions() limit 1'));
do $$ begin perform pg_temp.sett('code1b', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_new_collection_code(%L)$q$, pg_temp.f('rx1')))); end $$;
select pg_temp.ck('real', 'C9 the patient gets a new code and the old one stops working', 'wrong_code', pg_temp.verify_as(pg_temp.f('phA'), pg_temp.f('rx1'), pg_temp.t('code1')));
select pg_temp.ck('real', 'C10 another patient cannot renew it', 'ERR:22023', pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.patient_new_collection_code(%L)$q$, pg_temp.f('rx1'))));
select pg_temp.ck('real', 'C11 the new code verifies, with the patient and the allergies the counter needs', 'ok|1',
  pg_temp.verify_as(pg_temp.f('phA'), pg_temp.f('rx1'), pg_temp.t('code1b')) || '|' ||
  pg_temp.q_as(pg_temp.f('phA'), format($q$select jsonb_array_length(allergies)::text from public.pharmacist_verify_collection(%L, %L)$q$, pg_temp.f('rx1'), pg_temp.t('code1b'))));
select pg_temp.ck('real', 'C12 INV-10: opening it wrote an audit row', 'true', (exists (select 1 from public.audit_log where action = 'pharmacy.prescription_opened' and entity_id = pg_temp.f('rx1')))::text);
select pg_temp.ck('real', 'C13 the code can be typed with spaces and lower case', 'ok', pg_temp.verify_as(pg_temp.f('phA'), pg_temp.f('rx1'), lower(substr(pg_temp.t('code1b'), 1, 4)) || ' ' || lower(substr(pg_temp.t('code1b'), 5))));

-- D. dispensing --------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'D1 a bad pharmacist registration is invalid', 'invalid', pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rx1'), pg_temp.t('code1b'), false, null, '!!'));
select pg_temp.ck('real', 'D2 a partial supply needs a written outstanding note', 'invalid', pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rx1'), pg_temp.t('code1b'), true, null, 'PCN12345'));
select pg_temp.ck('real', 'D3 another pharmacy cannot dispense it', 'not_found', pg_temp.disp_as(pg_temp.f('phB'), pg_temp.f('rx1'), pg_temp.t('code1b'), false, null, 'PCN12345'));
select pg_temp.ck('real', 'D4 a wrong code does not dispense', 'wrong_code', pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rx1'), 'NOTTHECODE', false, null, 'PCN12345'));
select pg_temp.ck('real', 'D5 a patient cannot dispense', 'ERR:42501', pg_temp.disp_as(pg_temp.f('pat'), pg_temp.f('rx1'), pg_temp.t('code1b'), false, null, 'PCN12345'));
select pg_temp.ck('real', 'D6 anon cannot dispense', 'ERR:42501', pg_temp.anon_q(format($q$select outcome from public.pharmacist_dispense_prescription(%L, 'X', '1', false, null, null, null, 'PCN12345', 'Ada')$q$, pg_temp.f('rx1'))));
select pg_temp.ck('real', 'D7 refusals left it waiting with no dispense row', 'sent|0', pg_temp.rxstate(pg_temp.f('rx1')) || '|' || (select count(*) from public.pharmacy_order_dispenses where medication_id = pg_temp.med_of(pg_temp.f('rx1')))::text);
select pg_temp.ck('real', 'D8 a partial supply with a note is recorded', 'partial_recorded', pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rx1'), pg_temp.t('code1b'), true, 'Ten tablets owed, back in stock Friday', 'PCN12345'));
select pg_temp.ck('real', 'D9 a partial leaves the prescription waiting, the code usable and tells the patient nothing yet', 'sent|0|true', pg_temp.rxstate(pg_temp.f('rx1')) || '|' ||
  (select count(*) from public.notifications where template = 'prescription_collected_patient' and recipient_id = pg_temp.f('pat'))::text || '|' ||
  (select (used_at is null)::text from public.prescription_collection_codes where prescription_id = pg_temp.f('rx1')));
select pg_temp.ck('real', 'D10 the counter then sees the outstanding note', 'Ten tablets owed, back in stock Friday',
  pg_temp.q_as(pg_temp.f('phA'), format($q$select outstanding_note from public.pharmacist_verify_collection(%L, %L)$q$, pg_temp.f('rx1'), pg_temp.t('code1b'))));
select pg_temp.ck('real', 'D11 the pharmacy cannot change pharmacy mid supply: the patient is refused', 'ERR:22023',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx1'), pg_temp.f('pB'), pg_temp.f('lB'))));
select pg_temp.ck('real', 'D12 the full supply is recorded', 'recorded', pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rx1'), pg_temp.t('code1b'), false, null, 'PCN12345'));
select pg_temp.ck('real', 'D13 it is dispensed once, the code is used, one neutral notice, one event, one audit row', 'dispensed|true|1|1|1',
  pg_temp.rxstate(pg_temp.f('rx1')) || '|' || (select (used_at is not null)::text from public.prescription_collection_codes where prescription_id = pg_temp.f('rx1')) || '|' ||
  (select count(*) from public.notifications where template = 'prescription_collected_patient' and recipient_id = pg_temp.f('pat') and payload::text not ilike '%Proofdrug%')::text || '|' ||
  (select count(*) from public.domain_events where event_type = 'prescription.dispensed' and aggregate_id = pg_temp.f('rx1'))::text || '|' ||
  (select count(*) from public.audit_log where action = 'pharmacy.dispensed' and entity_id = pg_temp.f('rx1') and (event ->> 'partial') = 'false')::text);
select pg_temp.ck('real', 'D14 the supply row says pharmacy, partner, and carries the batch', 'pharmacy|partner|B-1234',
  (select source::text || '|' || recorded_via || '|' || batch_number from public.pharmacy_order_dispenses where medication_id = pg_temp.med_of(pg_temp.f('rx1')) and not is_partial));
select pg_temp.ck('real', 'D15 a second full supply on the same prescription is refused', 'not_found', pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rx1'), pg_temp.t('code1b'), false, null, 'PCN12345'));
select pg_temp.ck('real', 'D16 the dispensed prescription cannot be sent elsewhere', 'ERR:22023', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx1'), pg_temp.f('pB'), pg_temp.f('lB'))));

-- E. one supply count across doors --------------------------------------------------------------------------------------------------------
-- E1: partner supply first, then the QR path (after the 10 minute duplicate window) must find no supply left
update public.pharmacy_order_dispenses set created_at = now() - interval '1 hour' where medication_id = pg_temp.med_of(pg_temp.f('rx1'));
select pg_temp.ck('real', 'E1 after the partner supply, the QR path finds no supply left', 'no_supply_available',
  pg_temp.anon_q(format($q$select outcome from public.record_prescription_supply_public(%L, 'Other Pharmacy', 'Bola Counter', 'PCN99999', '30')$q$, (select public_token from public.medications where id = pg_temp.med_of(pg_temp.f('rx1'))))));
-- E2: QR supply first on rx2 (sent to A), then the partner path must refuse
do $$ begin perform pg_temp.sett('code2', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx2'), pg_temp.f('pA'), pg_temp.f('lA')))); end $$;
select pg_temp.ck('real', 'E2a the QR path records a supply on rx2', 'recorded',
  pg_temp.anon_q(format($q$select outcome from public.record_prescription_supply_public(%L, 'Other Pharmacy', 'Bola Counter', 'PCN99999', '30')$q$, (select public_token from public.medications where id = pg_temp.med_of(pg_temp.f('rx2'))))));
select pg_temp.ck('real', 'E2b the partner path then finds no supply left and the prescription stays waiting', 'no_supply_available|sent',
  pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rx2'), pg_temp.t('code2'), false, null, 'PCN12345') || '|' || pg_temp.rxstate(pg_temp.f('rx2')));

-- F. changing pharmacy before any supply ----------------------------------------------------------------------------------------------------
do $$ begin
  perform pg_temp.sett('code3a', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx3'), pg_temp.f('pA'), pg_temp.f('lA'))));
  perform pg_temp.sett('code3b', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx3'), pg_temp.f('pB'), pg_temp.f('lB'))));
end $$;
select pg_temp.ck('real', 'F1 the patient can change pharmacy before a supply: it is now B''s, the code is new', 'true|true',
  (select (pharmacy_partner_id = pg_temp.f('pB'))::text from public.prescriptions where id = pg_temp.f('rx3')) || '|' || (pg_temp.t('code3a') <> pg_temp.t('code3b'))::text);
select pg_temp.ck('real', 'F2 pharmacy A no longer sees it', 'not_found', pg_temp.verify_as(pg_temp.f('phA'), pg_temp.f('rx3'), pg_temp.t('code3a')));
select pg_temp.ck('real', 'F3 pharmacy B verifies with the new code', 'ok', pg_temp.verify_as(pg_temp.f('phB'), pg_temp.f('rx3'), pg_temp.t('code3b')));
select pg_temp.ck('real', 'F4 INV-02: the signed items are untouched by routing', 'Proofdrug Three',
  (select items -> 0 ->> 'drug' from public.prescriptions where id = pg_temp.f('rx3')));
select pg_temp.ck('real', 'F5 no test row is counted as real: every fixture is is_test', 'true', (select bool_and(is_test)::text from public.prescription_collection_codes where prescription_id in (pg_temp.f('rx1'), pg_temp.f('rx2'), pg_temp.f('rx3'))));

-- Sabotage -------------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_def text; v_out text; v_i integer; v_last text;
begin
  -- (1) the wrong-attempt lock removed: six wrong tries on rx3 must no longer lock
  select pg_get_functiondef('private.check_collection_code(uuid,text,uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, 'case when v_n >= v_max then now() end', 'null');
  v_def := replace(v_def, E'return case when v_n >= v_max then ''locked'' else ''wrong_code'' end;', E'return ''wrong_code'';');
  execute v_def;
  for v_i in 1 .. 6 loop v_last := pg_temp.verify_as(pg_temp.f('phB'), pg_temp.f('rx3'), 'NOPE' || v_i); end loop;
  insert into results values ('sabotaged', 'SABOTAGE lock removed: the sixth wrong try is locked', 'locked', v_last);
end $$;

do $$
declare v_def text; v_tok text; v_out text; v_rx uuid;
begin
  -- (2) the shared supply count removed from the partner path: after a QR supply the partner path must NOT refuse any more
  select pg_get_functiondef('public.pharmacist_dispense_prescription(uuid,text,text,boolean,text,text,date,text,text)'::regprocedure) into v_def;
  v_def := replace(v_def, 'if v_disp >= v_perm then return query select ''no_supply_available''::text, v_disp, v_perm; return; end if;', '');
  execute v_def;
  v_out := pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rx2'), pg_temp.t('code2'), false, null, 'PCN12345');
  insert into results values ('sabotaged', 'SABOTAGE shared count removed: the partner path refuses after a QR supply', 'no_supply_available', v_out);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S28 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), E'\n   ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks (%)', v_caught, (select string_agg(check_name || '=' || coalesce(actual, 'null'), ' | ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;
