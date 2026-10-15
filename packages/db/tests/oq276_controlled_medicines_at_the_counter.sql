-- OQ-276 proof: a second check at the pharmacy counter against the controlled-medicines list (CMO decision 2026-10-07).
-- Migration *_oq276_controlled_medicines_at_the_counter.sql. Proves in one rolled-back transaction, calling EVERY function the migration changes:
--   * ONE list: private.is_controlled_medicine drives signing (prescription_safety_findings / check_prescription_safety hard stop) and the counter;
--   * S28 pharmacist_verify_collection and pharmacist_dispense_prescription refuse a controlled medicine (named on the medicine row OR only in the
--     signed items) with the plain outcome 'controlled_medicine', show nothing about the patient, record no supply, leave the prescription waiting,
--     and write an audit row naming the step; a wrong code on a controlled prescription still answers wrong_code (the check leaks nothing);
--   * verify_prescription (QR check by a pharmacist) reports status 'controlled_medicine' and audits it; an ordinary medicine stays 'active';
--   * pharmacist_record_dispense (order screen) refuses a controlled drug, a controlled original it substitutes, and the old tick-box flag, writes
--     no dispense row and one audit row; an ordinary drug is recorded and returns 'recorded';
--   * record_prescription_supply_public (QR page) refuses a controlled medicine and logs it in prescription_supply_attempts;
--   * APPROVED REPEATS KEEP WORKING: an ordinary medicine with one approved repeat is supplied twice through the partner door, and twice through
--     the QR door, then refused with no_supply_available; a controlled medicine with the same approved repeat is still refused.
-- SABOTAGE: the counter check removed from the dispense function (a controlled medicine must then be recorded), and the single list emptied
-- (signing must then stop blocking). Both must flip, or the test is vacuous.
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
  values (v, 'oq276-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, p_name, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
-- a signed prescription (as the owner, no session) with its clinician medicine row
create function pg_temp.mkrx(p_org uuid, p_pat uuid, p_doc uuid, p_drug text, p_state text, p_rep integer default 0) returns uuid language plpgsql as
$f$ declare v_rx uuid;
begin
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test)
  values (p_org, p_pat, jsonb_build_array(jsonb_build_object('drug', p_drug, 'dose', '5 mg', 'quantity', '30 tablets')), p_state::public.prescription_state,
          case when p_state = 'draft' then null else p_doc end, case when p_state = 'draft' then null else now() end, true) returning id into v_rx;
  if p_state <> 'draft' then
    insert into public.medications (organisation_id, patient_id, drug_name, dose, quantity, repeats_allowed, source, is_active, prescription_id)
    values (p_org, p_pat, p_drug, '5 mg', '30 tablets', p_rep, 'clinician', true, v_rx);
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

-- S28c: the whole feature sits behind the S37 prescribing guard (closed by default). This proof opens it the way the guard's own trigger allows,
-- a log row in this transaction and then the update; the closed state is proved in s28c_pharmacy_extras.sql.
create function pg_temp.guard(p_on boolean) returns void language plpgsql as $f$
begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
  select 'prescribing_enabled', case when p_on then 'switched_on' else 'switched_off' end, p.id, 'admin', 'S28 proof', '[]'::jsonb from public.profiles p order by p.created_at limit 1;
  update public.go_live_guards
     set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then (select id from public.profiles order by created_at limit 1) end, change_note = case when p_on then 'S28 proof' end
   where key = 'prescribing_enabled';
end $f$;


-- Fixtures ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_pA uuid; v_lA uuid; v_doc uuid; v_pat uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status) values ('OQ276 Pharmacy A', true, now(), now(), 'activated') returning id into v_pA;
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state, address, is_active, verified_at) values (v_pA, 'OQ276 A Lekki', 'Lagos', '1 Test Road', true, now()) returning id into v_lA;
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('pA', v_pA); perform pg_temp.setf('lA', v_lA);
  perform pg_temp.setf('phA', pg_temp.mkuser(v_org, 'phA', 'pharmacist', 'OQ276 Pharmacist A'));
  update public.profiles set pharmacy_partner_id = v_pA where id = pg_temp.f('phA');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician', 'OQ276 Prescriber');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', 'OQ276 Patient');
  perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('pat', v_pat);
  insert into public.patient_allergies (organisation_id, patient_id, allergen, reaction, severity) values (v_org, v_pat, 'Penicillin', 'rash', 'moderate');
  perform pg_temp.setf('rxCtl', pg_temp.mkrx(v_org, v_pat, v_doc, 'Tramadol 50mg', 'signed'));
  perform pg_temp.setf('rxOk', pg_temp.mkrx(v_org, v_pat, v_doc, 'Proofdrug Ordinary', 'signed'));
  perform pg_temp.setf('rxRep', pg_temp.mkrx(v_org, v_pat, v_doc, 'Proofdrug Repeat', 'signed', 1));
  perform pg_temp.setf('rxRepCtl', pg_temp.mkrx(v_org, v_pat, v_doc, 'Diazepam 5mg', 'signed', 1));
  perform pg_temp.setf('rxQr', pg_temp.mkrx(v_org, v_pat, v_doc, 'Proofdrug QR', 'signed', 1));
  perform pg_temp.setf('rxQrCtl', pg_temp.mkrx(v_org, v_pat, v_doc, 'Codeine Phosphate 30mg', 'signed'));
  -- controlled only in the signed items: the medicine row carries an ordinary name
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test)
  values (v_org, v_pat, '[{"drug_name":"Proofdrug Cover"},{"drug_name":"Morphine sulfate","dose":"10 mg"}]', 'signed', v_doc, now(), true) returning id into v_pat;
  perform pg_temp.setf('rxItem', v_pat);
  insert into public.medications (organisation_id, patient_id, drug_name, dose, quantity, repeats_allowed, source, is_active, prescription_id)
  values (v_org, pg_temp.f('pat'), 'Proofdrug Cover', '5 mg', '30 tablets', 0, 'clinician', true, v_pat);
  -- one approved repeat on the ordinary and the controlled-with-repeat and the QR ones
  insert into public.medication_repeat_requests (organisation_id, patient_id, medication_id) select v_org, pg_temp.f('pat'), id from public.medications where id in (pg_temp.med_of(pg_temp.f('rxRep')), pg_temp.med_of(pg_temp.f('rxRepCtl')), pg_temp.med_of(pg_temp.f('rxQr')));
  update public.medication_repeat_requests set status = 'approved' where patient_id = pg_temp.f('pat');
end $$;

select pg_temp.guard(true);
create function pg_temp.send(p_rx uuid) returns text language sql as
$$ select pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, p_rx, pg_temp.f('pA'), pg_temp.f('lA'))) $$;
create function pg_temp.tok(p_rx uuid) returns text language sql as $$ select public_token from public.medications where id = pg_temp.med_of(p_rx) $$;
create function pg_temp.qr_as_anon(p_rx uuid) returns text language sql as
$$ select pg_temp.anon_q(format($q$select outcome from public.record_prescription_supply_public(%L, 'Other Pharmacy', 'Bola Counter', 'PCN99999', '30')$q$, pg_temp.tok(p_rx))) $$;
create function pg_temp.audit_n(p_action text, p_entity uuid, p_step text) returns text language sql as
$$ select count(*)::text from public.audit_log where action = p_action and entity_id = p_entity and (p_step is null or event ->> 'step' = p_step) $$;

-- A. one list, used by signing ------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'A1 the list names tramadol, diazepam, codeine and morphine', 'true|true|true|true',
  private.is_controlled_medicine('Tramadol 50mg')::text || '|' || private.is_controlled_medicine('DIAZEPAM')::text || '|' || private.is_controlled_medicine('  codeine phosphate ')::text || '|' || private.is_controlled_medicine('Morphine sulfate')::text);
select pg_temp.ck('real', 'A2 ordinary medicines, empty and null are not controlled (and a word that merely contains one is not)', 'false|false|false|false',
  private.is_controlled_medicine('Amlodipine 5mg')::text || '|' || private.is_controlled_medicine('Metformin')::text || '|' || private.is_controlled_medicine('')::text || '|' || coalesce(private.is_controlled_medicine('Tramadolxyz')::text, 'null'));
select pg_temp.ck('real', 'A3 signing: the safety findings carry a blocking controlled_medicine finding for tramadol', 'true',
  (private.prescription_safety_findings(pg_temp.f('pat'), 'Tramadol 50mg', null) @> '[{"code":"controlled_medicine","blocking":true}]'::jsonb)::text);
select pg_temp.ck('real', 'A4 signing: an ordinary medicine has no controlled finding', 'false',
  (private.prescription_safety_findings(pg_temp.f('pat'), 'Amlodipine 5mg', null) @> '[{"code":"controlled_medicine"}]'::jsonb)::text);
do $$ declare v text; begin
  begin perform private.check_prescription_safety(pg_temp.f('pat'), 'Tramadol 50mg', null, true, 'override attempt'); v := 'no error';
  exception when others then get stacked diagnostics v = pg_exception_detail; end;
  perform pg_temp.ck('real', 'A5 signing: check_prescription_safety hard-stops tramadol even with an override reason', 'SAFETY_BLOCKED', v);
end $$;
select pg_temp.ck('real', 'A6 only one function body carries the list (word-boundary scan with \y)', 'private.is_controlled_medicine(text)',
  (select string_agg(p.oid::regprocedure::text, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc ~* '\ytramadol\y'));

-- A2b. the real signed-item key (drug_name) and the older keys are all seen
select pg_temp.ck('real', 'A7 items with drug_name, drug, name or medication are all seen; ordinary items are not', 'true|true|true|true|false',
  private.prescription_has_controlled_item('Safe', '[{"drug_name":"Tramadol"}]')::text || '|' || private.prescription_has_controlled_item('Safe', '[{"drug":"Diazepam"}]')::text || '|' ||
  private.prescription_has_controlled_item('Safe', '[{"name":"Codeine"}]')::text || '|' || private.prescription_has_controlled_item('Safe', '[{"medication":"Morphine"}]')::text || '|' ||
  private.prescription_has_controlled_item('Safe', '[{"drug_name":"Amlodipine","dose":"5 mg"}]')::text);

-- B. S28 counter: controlled refused, nothing shown, nothing recorded, audited --------------------------------------------------------
do $$ begin
  perform pg_temp.sett('codeCtl', pg_temp.send(pg_temp.f('rxCtl')));
  perform pg_temp.sett('codeItem', pg_temp.send(pg_temp.f('rxItem')));
  perform pg_temp.sett('codeOk', pg_temp.send(pg_temp.f('rxOk')));
end $$;
select pg_temp.ck('real', 'B0 the patient can still send a controlled prescription to a pharmacy (the refusal is the counter''s, the patient is not blocked)', 'true', (pg_temp.t('codeCtl') ~ '^[0-9A-HJKMNP-TV-Z]{8}$')::text);
select pg_temp.ck('real', 'B1 a wrong code on a controlled prescription still answers wrong_code: the check leaks nothing before the code', 'wrong_code', pg_temp.verify_as(pg_temp.f('phA'), pg_temp.f('rxCtl'), 'NOPENOPE'));
select pg_temp.ck('real', 'B2 verify with the right code: controlled_medicine', 'controlled_medicine', pg_temp.verify_as(pg_temp.f('phA'), pg_temp.f('rxCtl'), pg_temp.t('codeCtl')));
select pg_temp.ck('real', 'B3 the refusal shows nothing about the patient or the items', '||',
  coalesce(pg_temp.q_as(pg_temp.f('phA'), format($q$select coalesce(patient_name, '') || '|' || coalesce(items::text, '') || '|' || coalesce(allergies::text, '') from public.pharmacist_verify_collection(%L, %L)$q$, pg_temp.f('rxCtl'), pg_temp.t('codeCtl'))), 'null'));
select pg_temp.ck('real', 'B4 dispense with the right code and a full valid record: controlled_medicine', 'controlled_medicine', pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rxCtl'), pg_temp.t('codeCtl'), false, null, 'PCN12345'));
select pg_temp.ck('real', 'B5 nothing was recorded and the prescription is still waiting', '0|sent',
  (select count(*) from public.pharmacy_order_dispenses where medication_id = pg_temp.med_of(pg_temp.f('rxCtl')))::text || '|' || pg_temp.rxstate(pg_temp.f('rxCtl')));
select pg_temp.ck('real', 'B6 INV-10: each refusal is audited with its step', '3|2|1',
  pg_temp.audit_n('pharmacy.controlled_medicine_refused', pg_temp.f('rxCtl'), null) || '|' || pg_temp.audit_n('pharmacy.controlled_medicine_refused', pg_temp.f('rxCtl'), 'verify') || '|' || pg_temp.audit_n('pharmacy.controlled_medicine_refused', pg_temp.f('rxCtl'), 'dispense'));
select pg_temp.ck('real', 'B7 controlled only in the signed items: refused at verify and at dispense', 'controlled_medicine|controlled_medicine',
  pg_temp.verify_as(pg_temp.f('phA'), pg_temp.f('rxItem'), pg_temp.t('codeItem')) || '|' || pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rxItem'), pg_temp.t('codeItem'), false, null, 'PCN12345'));
select pg_temp.ck('real', 'B8 control: an ordinary prescription still verifies and shows the patient', 'ok|OQ276 Patient',
  pg_temp.verify_as(pg_temp.f('phA'), pg_temp.f('rxOk'), pg_temp.t('codeOk')) || '|' ||
  coalesce(pg_temp.q_as(pg_temp.f('phA'), format($q$select patient_name from public.pharmacist_verify_collection(%L, %L)$q$, pg_temp.f('rxOk'), pg_temp.t('codeOk'))), 'null'));
select pg_temp.ck('real', 'B9 control: an ordinary prescription is still recorded as supplied and moves to dispensed', 'recorded|dispensed',
  pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rxOk'), pg_temp.t('codeOk'), false, null, 'PCN12345') || '|' || pg_temp.rxstate(pg_temp.f('rxOk')));

-- C. approved repeats keep working (partner door) --------------------------------------------------------------------------------------
do $$ begin perform pg_temp.sett('rep1', pg_temp.send(pg_temp.f('rxRep'))); end $$;
select pg_temp.ck('real', 'C1 ordinary medicine with one approved repeat: first supply recorded (1 of 2)', 'recorded', pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rxRep'), pg_temp.t('rep1'), false, null, 'PCN12345'));
update public.pharmacy_order_dispenses set created_at = now() - interval '1 hour' where medication_id = pg_temp.med_of(pg_temp.f('rxRep'));
do $$ begin perform pg_temp.sett('rep2', pg_temp.send(pg_temp.f('rxRep'))); end $$;
select pg_temp.ck('real', 'C2 the repeat is a new send with a new code', 'true', (pg_temp.t('rep2') ~ '^[0-9A-HJKMNP-TV-Z]{8}$' and pg_temp.t('rep2') <> pg_temp.t('rep1'))::text);
select pg_temp.ck('real', 'C3 the approved repeat is supplied through the same door (2 of 2)', 'recorded', pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rxRep'), pg_temp.t('rep2'), false, null, 'PCN12345'));
select pg_temp.ck('real', 'C4 a third attempt records nothing (the prescription is dispensed and only two supply rows exist)', 'not_found|2', pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rxRep'), pg_temp.t('rep2'), false, null, 'PCN12345') || '|' ||
  (select count(*) from public.pharmacy_order_dispenses where medication_id = pg_temp.med_of(pg_temp.f('rxRep')))::text);
do $$ begin perform pg_temp.sett('repCtl', pg_temp.send(pg_temp.f('rxRepCtl'))); end $$;
select pg_temp.ck('real', 'C5 a controlled medicine with the same approved repeat is still refused', 'controlled_medicine|0',
  pg_temp.disp_as(pg_temp.f('phA'), pg_temp.f('rxRepCtl'), pg_temp.t('repCtl'), false, null, 'PCN12345') || '|' || (select count(*) from public.pharmacy_order_dispenses where medication_id = pg_temp.med_of(pg_temp.f('rxRepCtl')))::text);

-- D. QR check by a pharmacist (verify_prescription) -------------------------------------------------------------------------------
select pg_temp.ck('real', 'D1 a controlled medicine: status controlled_medicine', 'controlled_medicine',
  pg_temp.q_as(pg_temp.f('phA'), format($q$select status from public.verify_prescription(%L, %L)$q$, (select rx_number from public.medications where id = pg_temp.med_of(pg_temp.f('rxQrCtl'))), (select verification_code from public.medications where id = pg_temp.med_of(pg_temp.f('rxQrCtl'))))));
select pg_temp.ck('real', 'D2 and the check is audited', '1', (select count(*)::text from public.audit_log where action = 'pharmacy.controlled_medicine_refused' and entity_id = pg_temp.med_of(pg_temp.f('rxQrCtl')) and event ->> 'step' = 'qr_verify'));
select pg_temp.ck('real', 'D3 control: an ordinary medicine is active', 'active',
  pg_temp.q_as(pg_temp.f('phA'), format($q$select status from public.verify_prescription(%L, %L)$q$, (select rx_number from public.medications where id = pg_temp.med_of(pg_temp.f('rxQr'))), (select verification_code from public.medications where id = pg_temp.med_of(pg_temp.f('rxQr'))))));

-- E. QR page: controlled refused and logged; approved repeat still supplied ---------------------------------------------------------------
select pg_temp.ck('real', 'E1 QR page, controlled medicine: refused', 'controlled_medicine', pg_temp.qr_as_anon(pg_temp.f('rxQrCtl')));
select pg_temp.ck('real', 'E2 it is logged as an attempt and no supply row exists', '1|0',
  (select count(*) from public.prescription_supply_attempts where medication_id = pg_temp.med_of(pg_temp.f('rxQrCtl')) and outcome = 'controlled_medicine')::text || '|' ||
  (select count(*) from public.pharmacy_order_dispenses where medication_id = pg_temp.med_of(pg_temp.f('rxQrCtl')))::text);
select pg_temp.ck('real', 'E3 QR page, ordinary medicine with an approved repeat: first supply recorded', 'recorded', pg_temp.qr_as_anon(pg_temp.f('rxQr')));
update public.pharmacy_order_dispenses set created_at = now() - interval '1 hour' where medication_id = pg_temp.med_of(pg_temp.f('rxQr'));
select pg_temp.ck('real', 'E4 the approved repeat is supplied (2 of 2)', 'recorded', pg_temp.qr_as_anon(pg_temp.f('rxQr')));
update public.pharmacy_order_dispenses set created_at = now() - interval '2 hours' where medication_id = pg_temp.med_of(pg_temp.f('rxQr'));
select pg_temp.ck('real', 'E5 then no supply is available', 'no_supply_available', pg_temp.qr_as_anon(pg_temp.f('rxQr')));

-- E6. the hourly cap never swallows a controlled refusal's audit row
insert into public.prescription_supply_attempts (organisation_id, patient_id, medication_id, outcome, token_hash)
  select pg_temp.f('org'), pg_temp.f('pat'), pg_temp.med_of(pg_temp.f('rxQrCtl')), 'invalid', 'cap' || g from generate_series(1, 25) g;
do $$ begin perform pg_temp.sett('e6', pg_temp.qr_as_anon(pg_temp.f('rxQrCtl'))); end $$;
select pg_temp.ck('real', 'E6 past the 20 per hour cap a controlled refusal is still logged', 'controlled_medicine|2', pg_temp.t('e6') || '|' ||
  (select count(*) from public.prescription_supply_attempts where medication_id = pg_temp.med_of(pg_temp.f('rxQrCtl')) and outcome = 'controlled_medicine')::text);

-- F. order screen (pharmacist_record_dispense) -------------------------------------------------------------------------------------
do $$ declare v_o uuid; begin
  insert into public.pharmacy_orders (organisation_id, patient_id, pharmacy_partner_id, items, total_kobo, status)
  values (pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('pA'), jsonb_build_array(jsonb_build_object('medication_id', pg_temp.med_of(pg_temp.f('rxOk')), 'drug_name', 'Proofdrug Ordinary', 'price_kobo', 100, 'quantity', 1)), 100, 'confirmed') returning id into v_o;
  perform pg_temp.setf('order', v_o);
  update public.pharmacy_orders set status = 'confirmed' where id = v_o;
end $$;
create function pg_temp.rec_as(p_drug text, p_sub text, p_tier text, p_ok boolean) returns text language sql as
$$ select pg_temp.q_as(pg_temp.f('phA'), format($q$select public.pharmacist_record_dispense(%L, %L, '10', current_date, null, false, null, 'B1', %L, %L, %L, %L)$q$,
     pg_temp.f('order'), p_drug, p_sub, case when p_sub is null then null else 'out of stock' end, p_tier, p_ok)) $$;
select pg_temp.ck('real', 'F1 a controlled drug is refused even with the old tick-box confirmed', 'controlled_medicine', pg_temp.rec_as('Tramadol 50mg', null, 'restricted', true));
select pg_temp.ck('real', 'F2 a controlled original substituted by an ordinary drug is refused', 'controlled_medicine', pg_temp.rec_as('Proofdrug Sub', 'Diazepam 5mg', null, false));
select pg_temp.ck('real', 'F3 the old tier flag alone is refused', 'controlled_medicine', pg_temp.rec_as('Proofdrug Flag', null, 'narcotic', false));
select pg_temp.ck('real', 'F4 nothing recorded, order status unchanged, three audited refusals', '0|confirmed|3',
  (select count(*) from public.pharmacy_order_dispenses where pharmacy_order_id = pg_temp.f('order'))::text || '|' || (select status::text from public.pharmacy_orders where id = pg_temp.f('order')) || '|' ||
  pg_temp.audit_n('pharmacy.controlled_medicine_refused', pg_temp.f('order'), 'order_dispense'));
do $$ begin perform pg_temp.sett('f5', pg_temp.rec_as('Proofdrug Ordinary', null, null, false)); end $$;
select pg_temp.ck('real', 'F5 control: an ordinary drug is recorded, one supply row exists and the order moves to dispensed', 'recorded|1|dispensed', pg_temp.t('f5') || '|' ||
  (select count(*) from public.pharmacy_order_dispenses where pharmacy_order_id = pg_temp.f('order'))::text || '|' || (select status::text from public.pharmacy_orders where id = pg_temp.f('order')));
select pg_temp.ck('real', 'F6 anon cannot call it', 'ERR:42501', pg_temp.anon_q(format($q$select public.pharmacist_record_dispense(%L, 'x', '1', current_date)$q$, pg_temp.f('order'))));

-- Sabotage -------------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_def text; v_out text; v_code text; v_rx uuid;
begin
  -- (1) the counter check removed from the dispense function: a controlled medicine must now be RECORDED (the test would catch the hole)
  select pg_get_functiondef('public.pharmacist_dispense_prescription(uuid,text,text,boolean,text,text,date,text,text)'::regprocedure) into v_def;
  v_def := replace(v_def, 'if private.prescription_has_controlled_item(v_med.drug_name, rx.items) then', 'if false then');
  execute v_def;
  v_rx := pg_temp.mkrx(pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('doc'), 'Tramadol 100mg', 'signed');
  v_code := pg_temp.send(v_rx);
  v_out := pg_temp.disp_as(pg_temp.f('phA'), v_rx, v_code, false, null, 'PCN12345');
  insert into results values ('sabotaged', 'SABOTAGE counter check removed: a controlled medicine is refused', 'controlled_medicine', v_out);
end $$;
do $$
declare v_def text; v_out text;
begin
  -- (2) the single list emptied: signing must stop blocking, so the hard stop truly depends on the one list
  select pg_get_functiondef('private.is_controlled_medicine(text)'::regprocedure) into v_def;
  v_def := replace(v_def, E'~* ''\\m(', E'~* ''\\mXX(');
  execute v_def;
  v_out := (private.prescription_safety_findings(pg_temp.f('pat'), 'Tramadol 50mg', null) @> '[{"code":"controlled_medicine"}]'::jsonb)::text;
  insert into results values ('sabotaged', 'SABOTAGE list emptied: signing still blocks tramadol', 'true', v_out);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'OQ-276 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), E'\n   ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks (%)', v_caught, (select string_agg(check_name || '=' || coalesce(actual, 'null'), ' | ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;
