-- S54 proof (migration *_s54_pharmacy_price_compare_quality_chat_pickup_only.sql). Module 8 rows 8.9 to 8.12, 8.16 and decision D5.
-- One rolled-back transaction. Every role is tested and every role that must be refused is shown refused.
--  A. Quality rules (8.11): a pharmacy is listable only with a verified licence AND a recorded NAFDAC-source attestation; only an admin or
--     partner manager can attest, through the function; a prescription cannot be routed to an unlisted pharmacy by any door.
--  B. Verified batch (8.11): only Tarragon staff can set it; a pharmacy cannot mark its own batch; it needs a listable pharmacy.
--  C. Price compare (8.9): the patient sees only listable pharmacies, cheapest complete match first, no price for a different strength;
--     another patient, a clinician, a pharmacist and anon are refused; the output and the function carry no commission or earning (8.16).
--  D. Pharmacist chat (8.12): patient and pharmacist of that pharmacy only; no staff or admin read; audited pharmacist reads; first name
--     only; emergency words flagged; notices carry no message; a closed thread takes no message; refused roles are refused.
--  E. Refill (8.10): the reminder payload names the chosen pharmacy; the patient can read where to collect; nobody else can.
--  F. Pickup only (D5): a delivery order cannot be created; a pickup order can.
--  G. SABOTAGE: with the routing trigger dropped the unlisted pharmacy is accepted (the rule A check would FAIL).
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
  values (v, 's54-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, p_name, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkrx(p_org uuid, p_pat uuid, p_doc uuid, p_items jsonb, p_state text) returns uuid language plpgsql as
$f$ declare v_rx uuid; v_name text := p_items -> 0 ->> 'drug';
begin
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test)
  values (p_org, p_pat, p_items, p_state::public.prescription_state, p_doc, now(), true) returning id into v_rx;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, quantity, repeats_allowed, source, is_active, prescription_id)
  values (p_org, p_pat, v_name, '5 mg', '30 tablets', 0, 'clinician', true, v_rx);
  return v_rx;
end $f$;

-- Fixtures ----------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_pA uuid; v_pB uuid; v_pC uuid; v_pD uuid; v_doc uuid; v_pat uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  -- A and C are listable (active, approved, licence verified, NAFDAC source attested). B has everything except the attestation. D has the
  -- attestation but an expired licence.
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status, nafdac_source_attested_at, nafdac_source_note)
    values ('S54 Pharmacy A', true, now(), now(), 'activated', now(), 'proof fixture') returning id into v_pA;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status)
    values ('S54 Pharmacy B no attestation', true, now(), now(), 'activated') returning id into v_pB;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status, nafdac_source_attested_at, nafdac_source_note)
    values ('S54 Pharmacy C', true, now(), now(), 'activated', now(), 'proof fixture') returning id into v_pC;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, license_expires_at, onboarding_status, nafdac_source_attested_at, nafdac_source_note)
    values ('S54 Pharmacy D expired licence', true, now(), now(), now() - interval '1 day', 'activated', now(), 'proof fixture') returning id into v_pD;
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state, address, is_active, verified_at) values
    (v_pA, 'S54 A Lekki', 'Lagos', '1 Test Road', true, now()), (v_pB, 'S54 B Ikeja', 'Lagos', '2 Test Road', true, now()),
    (v_pC, 'S54 C Yaba', 'Lagos', '3 Test Road', true, now()), (v_pD, 'S54 D Surulere', 'Lagos', '4 Test Road', true, now());
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('pA', v_pA); perform pg_temp.setf('pB', v_pB); perform pg_temp.setf('pC', v_pC); perform pg_temp.setf('pD', v_pD);
  -- the catalogue: amlodipine 5 mg at A (3000, in stock), B (1000, cheapest but unlisted), C (2500, low stock), D (900, expired licence);
  -- amlodipine 10 mg only at A (so a 5 mg prescription must never be priced from it); every row carries a commission the patient must never see
  insert into public.pharmacy_medications (pharmacy_partner_id, drug_name, strength, pack_size, price_kobo, is_active, stock_status, commission_rate, commission_rate_type, commission_flat_kobo) values
    (v_pA, 'Amlodipine', '5 mg', '30', 300000, true, 'in_stock', 0.4321, 'percentage', 98765),
    (v_pA, 'Amlodipine', '10 mg', '28', 450000, true, 'in_stock', 0.4321, 'percentage', 98765),
    (v_pB, 'Amlodipine', '5 mg', '30', 100000, true, 'in_stock', 0.9, 'percentage', 98765),
    (v_pC, 'Amlodipine', '5 mg', '30', 250000, true, 'low_stock', 0.0123, 'percentage', 98765),
    (v_pD, 'Amlodipine', '5 mg', '30', 90000, true, 'in_stock', 0.5, 'percentage', 98765),
    (v_pA, 'Metformin', '500 mg', '60', 150000, true, 'unavailable', 0.1, 'percentage', 98765),
    (v_pC, 'Metformin', '500 mg', '60', 200000, true, 'in_stock', 0.1, 'percentage', 98765),
    (v_pA, 'Insulin aspart', '100 units/ml', '5', 900000, true, 'in_stock', 0.1, 'percentage', 98765),
    (v_pA, 'Paracetamol', null, '20', 50000, true, 'in_stock', 0.1, 'percentage', 98765);
  perform pg_temp.setf('phA', pg_temp.mkuser(v_org, 'phA', 'pharmacist', 'S54 Pharmacist A'));
  perform pg_temp.setf('phB', pg_temp.mkuser(v_org, 'phB', 'pharmacist', 'S54 Pharmacist B'));
  update public.profiles set pharmacy_partner_id = v_pA where id = pg_temp.f('phA');
  update public.profiles set pharmacy_partner_id = v_pB where id = pg_temp.f('phB');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician', 'S54 Prescriber');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', 'S54 Patient');
  perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient', 'S54 Other Patient'));
  perform pg_temp.setf('adm', pg_temp.mkuser(v_org, 'adm', 'admin', 'S54 Admin'));
  perform pg_temp.setf('rx1', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
  perform pg_temp.setf('rx2', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"},{"drug":"Metformin","dose":"500 mg","quantity":"60 tablets"}]'::jsonb, 'signed'));
  perform pg_temp.setf('rx4', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Insulin glargine","dose":"100 units/ml","quantity":"5 pens"}]'::jsonb, 'signed'));
  perform pg_temp.setf('rx5', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Paracetamol","dose":"500 mg","quantity":"20 tablets"}]'::jsonb, 'signed'));
  perform pg_temp.setf('rx3', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Amlodipine","dose":"2.5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
end $$;

\o /dev/null
-- A. quality rules -----------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('A', 'A1 listable: A, C yes; B (no attestation) and D (expired licence) no', 'true,false,true,false',
  (select string_agg(private.pharmacy_partner_listable(id)::text, ',' order by name) from public.pharmacy_partners where name in ('S54 Pharmacy A', 'S54 Pharmacy B no attestation', 'S54 Pharmacy C', 'S54 Pharmacy D expired licence')));
select pg_temp.ck('A', 'A2 a patient cannot attest', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.attest_pharmacy_nafdac_source(%L, 'Saw the supplier invoices')::text$q$, pg_temp.f('pB'))));
select pg_temp.ck('A', 'A3 a pharmacist cannot attest for its own pharmacy', 'ERR:42501', pg_temp.q_as(pg_temp.f('phB'), format($q$select public.attest_pharmacy_nafdac_source(%L, 'Saw the supplier invoices')::text$q$, pg_temp.f('pB'))));
select pg_temp.ck('A', 'A4 a clinician cannot attest', 'ERR:42501', pg_temp.q_as(pg_temp.f('doc'), format($q$select public.attest_pharmacy_nafdac_source(%L, 'Saw the supplier invoices')::text$q$, pg_temp.f('pB'))));
select pg_temp.ck('A', 'A5 anon cannot attest', 'ERR:42501', pg_temp.anon_q(format($q$select public.attest_pharmacy_nafdac_source(%L, 'Saw the supplier invoices')::text$q$, pg_temp.f('pB'))));
select pg_temp.ck('A', 'A6 an admin cannot write the attestation columns directly', 'ERR:42501',
  pg_temp.q_as(pg_temp.f('adm'), format($q$update public.pharmacy_partners set nafdac_source_attested_at = now() where id = %L returning 'x'$q$, pg_temp.f('pB'))));
select pg_temp.ck('A', 'A7 a note that says nothing is refused', 'ERR:22023', pg_temp.q_as(pg_temp.f('adm'), format($q$select public.attest_pharmacy_nafdac_source(%L, 'ok')::text$q$, pg_temp.f('pB'))));
select pg_temp.ck('A', 'A8 B is still not listable after every refusal', 'false', private.pharmacy_partner_listable(pg_temp.f('pB'))::text);
-- routing: an unlisted pharmacy cannot be set on a prescription, whoever does it
do $$
declare r text;
begin
  begin
    update public.prescriptions set pharmacy_partner_id = pg_temp.f('pB') where id = pg_temp.f('rx1');
    r := 'accepted';
  exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.sett('routeB', r);
  begin
    update public.prescriptions set pharmacy_partner_id = pg_temp.f('pD') where id = pg_temp.f('rx1');
    r := 'accepted';
  exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.sett('routeD', r);
end $$;
select pg_temp.ck('A', 'A9 routing a prescription to the unlisted B (no attestation) is refused', 'ERR:22023', pg_temp.t('routeB'));
select pg_temp.ck('A', 'A10 routing to D (expired licence) is refused', 'ERR:22023', pg_temp.t('routeD'));
-- the admin attests B through the function: now it is listable
select pg_temp.ck('A', 'A11 an admin attests B through the function', '{"ok": true}', pg_temp.q_as(pg_temp.f('adm'), format($q$select public.attest_pharmacy_nafdac_source(%L, 'Saw the supplier invoices and the wholesaler licence')::text$q$, pg_temp.f('pB'))));
select pg_temp.ck('A', 'A12 B is listable after the attestation', 'true', private.pharmacy_partner_listable(pg_temp.f('pB'))::text);
-- put B back to unattested for the rest of the proof (as the owner, no session)
update public.pharmacy_partners set nafdac_source_attested_at = null, nafdac_source_attested_by = null, nafdac_source_note = null where id = pg_temp.f('pB');

select pg_temp.ck('A', 'A13 the routing trigger is SECURITY DEFINER (a prescriber who may not execute the private helper is not blocked from a listable pharmacy)', 'true',
  (select prosecdef::text from pg_proc where oid = 'private.enforce_listable_pharmacy_on_prescription()'::regprocedure));
do $$ declare r text; begin
  begin
    insert into public.prescriptions (organisation_id, patient_id, items, state, pharmacy_partner_id, is_test)
      values (pg_temp.f('org'), pg_temp.f('pat'), '[{"drug":"X","dose":"1 mg"}]'::jsonb, 'draft', pg_temp.f('pB'), true);
    r := 'accepted';
  exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.ck('A', 'A14 a prescription cannot even be CREATED pointing at an unlisted pharmacy', 'ERR:22023', r);
end $$;
do $$
declare r text;
begin
  if to_regprocedure('public.patient_collection_pharmacies(uuid)') is null then
    perform pg_temp.ck('A', 'A15 (S28 absent) chooser check skipped', 'skipped', 'skipped');
    return;
  end if;
  perform pg_temp.ck('A', 'A15 the S28 chooser offers A and C but not the unattested B', 'S54 Pharmacy A,S54 Pharmacy C',
    pg_temp.q_as(pg_temp.f('pat'), format($q$select string_agg(distinct partner_name, ',' order by partner_name) from public.patient_collection_pharmacies(%L) where partner_name like 'S54%%'$q$, pg_temp.f('rx1'))));
  begin
    r := pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, (select id from public.pharmacy_partner_locations where pharmacy_partner_id = %L limit 1))$q$, pg_temp.f('rx3'), pg_temp.f('pB'), pg_temp.f('pB')));
  end;
  perform pg_temp.ck('A', 'A16 choosing the unattested B is refused', 'ERR:22023', r);
end $$;

-- B. verified batch -----------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('B', 'B1 a pharmacist cannot mark its own batch verified', 'ERR:42501',
  pg_temp.q_as(pg_temp.f('phA'), format($q$update public.pharmacy_medications set verified_batch = true where pharmacy_partner_id = %L and strength = '5 mg' returning 'x'$q$, pg_temp.f('pA'))));
select pg_temp.ck('B', 'B2 an admin can mark a listable pharmacy''s batch verified', 'x',
  pg_temp.q_as(pg_temp.f('adm'), format($q$update public.pharmacy_medications set verified_batch = true where pharmacy_partner_id = %L and strength = '5 mg' returning 'x'$q$, pg_temp.f('pA'))));
select pg_temp.ck('B', 'B2b ...and it is stamped with who and when', 'true',
  (select (verified_batch_at is not null and verified_batch_by = pg_temp.f('adm'))::text from public.pharmacy_medications where pharmacy_partner_id = pg_temp.f('pA') and strength = '5 mg'));
select pg_temp.ck('B', 'B3 a batch cannot be verified for an unlisted pharmacy (B has no attestation)', 'ERR:22023',
  pg_temp.q_as(pg_temp.f('adm'), format($q$update public.pharmacy_medications set verified_batch = true where pharmacy_partner_id = %L returning 'x'$q$, pg_temp.f('pB'))));
select pg_temp.ck('B', 'B4 the patient reads the flag and when, never who', 'true|ERR:42501',
  (pg_temp.q_as(pg_temp.f('pat'), format($q$select verified_batch::text from public.pharmacy_medications where pharmacy_partner_id = %L and strength = '5 mg'$q$, pg_temp.f('pA'))) = 'true')::text || '|' ||
  pg_temp.q_as(pg_temp.f('pat'), format($q$select verified_batch_by::text from public.pharmacy_medications where pharmacy_partner_id = %L and strength = '5 mg'$q$, pg_temp.f('pA'))));

-- an unrelated edit on a verified line of a pharmacy that has since stopped being listable is never blocked...
update public.pharmacy_partners set license_expires_at = now() - interval '1 day' where id = pg_temp.f('pA');
select pg_temp.ck('B', 'B5 the pharmacist can still switch off a verified line after its licence lapsed', 'x',
  pg_temp.q_as(pg_temp.f('phA'), format($q$update public.pharmacy_medications set is_active = false where pharmacy_partner_id = %L and strength = '5 mg' returning 'x'$q$, pg_temp.f('pA'))));
select pg_temp.ck('B', 'B5b ...and the flag is kept (the line was not edited)', 'true', (select verified_batch::text from public.pharmacy_medications where pharmacy_partner_id = pg_temp.f('pA') and strength = '5 mg'));
update public.pharmacy_partners set license_expires_at = null where id = pg_temp.f('pA');
update public.pharmacy_medications set is_active = true where pharmacy_partner_id = pg_temp.f('pA') and strength = '5 mg';
-- ...but changing what the flag vouches for clears it
select pg_temp.ck('B', 'B6 an admin can change the price of a verified line', 'x',
  pg_temp.q_as(pg_temp.f('adm'), format($q$update public.pharmacy_medications set price_kobo = price_kobo + 1000 where pharmacy_partner_id = %L and strength = '5 mg' returning 'x'$q$, pg_temp.f('pA'))));
select pg_temp.ck('B', 'B6b ...and that clears the verified flag (the check no longer applies to a different price)', 'false',
  (select verified_batch::text from public.pharmacy_medications where pharmacy_partner_id = pg_temp.f('pA') and strength = '5 mg'));
update public.pharmacy_medications set price_kobo = 300000 where pharmacy_partner_id = pg_temp.f('pA') and strength = '5 mg';
select pg_temp.ck('B', 'B7 an admin re-verifies it', 'x', pg_temp.q_as(pg_temp.f('adm'), format($q$update public.pharmacy_medications set verified_batch = true where pharmacy_partner_id = %L and strength = '5 mg' returning 'x'$q$, pg_temp.f('pA'))));

-- C. price compare ------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('C', 'C1 for a one-item prescription the patient sees only the listable pharmacies, cheapest first (C 2500 then A 3000)', 'S54 Pharmacy C|S54 Pharmacy A',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select string_agg(partner_name, '|' order by ord) from (select partner_name, row_number() over () ord from public.patient_price_compare(%L)) x$q$, pg_temp.f('rx1'))));
select pg_temp.ck('C', 'C2 B (unattested), D (expired licence) and every unlisted pharmacy are absent', '0',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.patient_price_compare(%L) where partner_name ~ '(B no|D expired)'$q$, pg_temp.f('rx1'))));
select pg_temp.ck('C', 'C3 the total is the matched price; C is flagged low stock; A shows the verified batch', '250000|true|false',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select total_kobo::text || '|' || any_low_stock::text || '|' || all_verified_batch::text from public.patient_price_compare(%L) where partner_name = 'S54 Pharmacy C'$q$, pg_temp.f('rx1'))));
select pg_temp.ck('C', 'C4 A (all verified) reads as verified', 'true',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select all_verified_batch::text from public.patient_price_compare(%L) where partner_name = 'S54 Pharmacy A'$q$, pg_temp.f('rx1'))));
select pg_temp.ck('C', 'C5 a two-item prescription ranks the pharmacy that supplies both first (C), not the cheaper partial one (A: metformin unavailable but listed)', 'S54 Pharmacy C',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select partner_name from public.patient_price_compare(%L) limit 1$q$, pg_temp.f('rx2'))));
select pg_temp.ck('C', 'C6 a strength nobody stocks is never priced from another strength (2.5 mg finds nothing)', '0',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.patient_price_compare(%L)$q$, pg_temp.f('rx3'))));
select pg_temp.ck('C', 'C6b a different insulin is never priced (glargine is not aspart)', '0',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.patient_price_compare(%L)$q$, pg_temp.f('rx4'))));
select pg_temp.ck('C', 'C6c a price line with no strength is not matched to a prescription that names a strength', '0',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.patient_price_compare(%L)$q$, pg_temp.f('rx5'))));
select pg_temp.ck('C', 'C7 another patient is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat2'), format($q$select count(*)::text from public.patient_price_compare(%L)$q$, pg_temp.f('rx1'))));
select pg_temp.ck('C', 'C8 a clinician is refused (no ranking, no prices for the prescriber)', 'ERR:42501', pg_temp.q_as(pg_temp.f('doc'), format($q$select count(*)::text from public.patient_price_compare(%L)$q$, pg_temp.f('rx1'))));
select pg_temp.ck('C', 'C9 a pharmacist is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('phA'), format($q$select count(*)::text from public.patient_price_compare(%L)$q$, pg_temp.f('rx1'))));
select pg_temp.ck('C', 'C10 anon is refused', 'ERR:42501', pg_temp.anon_q(format($q$select count(*)::text from public.patient_price_compare(%L)$q$, pg_temp.f('rx1'))));
select pg_temp.ck('C', 'C11 8.16: the function source never names a commission', 'false', (pg_get_functiondef('public.patient_price_compare(uuid)'::regprocedure) ~* 'commission')::text);
select pg_temp.ck('C', 'C12 8.16: nothing in the patient''s output holds the fixture commission values', 'false',
  (pg_temp.q_as(pg_temp.f('pat'), format($q$select string_agg(to_jsonb(c)::text, ' ') from public.patient_price_compare(%L) c$q$, pg_temp.f('rx2'))) ~ '(0\.4321|98765|0\.0123|commission)')::text);
select pg_temp.ck('C', 'C13 the output columns hold no earning', '0',
  (select count(*)::text from pg_proc p, unnest(p.proargnames) n where p.oid = 'public.patient_price_compare(uuid)'::regprocedure and n ~* '(commission|margin|earn|rate)'));

-- D. pharmacist chat ----------------------------------------------------------------------------------------------------------------------
do $$ begin perform pg_temp.sett('chat1', pg_temp.q_as(pg_temp.f('pat'), format($q$select (public.patient_start_pharmacist_chat(%L, null, 'A question about my tablets', 'Can I take this with food?')->>'thread_id')$q$, pg_temp.f('pA')))); end $$;
select pg_temp.ck('D', 'D1 the patient starts a thread with a listable pharmacy', 'true', (pg_temp.t('chat1') ~ '^[0-9a-f-]{36}$')::text);
select pg_temp.ck('D', 'D2 the unlisted pharmacy B cannot be asked', 'ERR:22023', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_start_pharmacist_chat(%L, null, 'x', 'hello')::text$q$, pg_temp.f('pB'))));
select pg_temp.ck('D', 'D3 anon cannot start a thread', 'ERR:42501', pg_temp.anon_q(format($q$select public.patient_start_pharmacist_chat(%L, null, 'x', 'hello')::text$q$, pg_temp.f('pA'))));
select pg_temp.ck('D', 'D4 the patient reads her thread', '1', pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.patient_pharmacist_chat_messages(%L)$q$, pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D5 another patient cannot read it', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat2'), format($q$select count(*)::text from public.patient_pharmacist_chat_messages(%L)$q$, pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D6 the tables are closed to a clinician, an admin, another patient and the other pharmacist', '0/0/0/0',
  pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.pharmacist_chat_messages') || '/' || pg_temp.q_as(pg_temp.f('adm'), 'select count(*)::text from public.pharmacist_chat_messages') || '/' ||
  pg_temp.q_as(pg_temp.f('pat2'), 'select count(*)::text from public.pharmacist_chat_threads') || '/' || pg_temp.q_as(pg_temp.f('phB'), 'select count(*)::text from public.pharmacist_chat_threads'));
select pg_temp.ck('D', 'D7 anon cannot read the tables', 'ERR:42501', pg_temp.anon_q('select count(*)::text from public.pharmacist_chat_threads'));
select pg_temp.ck('D', 'D8 no client can write the tables directly', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), format($q$insert into public.pharmacist_chat_messages (thread_id, patient_id, sender_profile_id, sender_role, body) values (%L, %L, %L, 'patient', 'x') returning 'x'$q$, pg_temp.t('chat1'), pg_temp.f('pat'), pg_temp.f('pat'))));
select pg_temp.ck('D', 'D9 the pharmacist of that pharmacy lists the thread with the first name only', 'S54|1',
  pg_temp.q_as(pg_temp.f('phA'), 'select patient_first_name || ''|'' || count(*)::text from public.pharmacist_chat_threads() group by patient_first_name'));
select pg_temp.ck('D', 'D10 the other pharmacy''s pharmacist sees none and cannot read the thread', '0|ERR:42501',
  pg_temp.q_as(pg_temp.f('phB'), 'select count(*)::text from public.pharmacist_chat_threads()') || '|' || pg_temp.q_as(pg_temp.f('phB'), format($q$select count(*)::text from public.pharmacist_chat_read(%L)$q$, pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D11 a clinician, a patient and anon cannot use the pharmacist functions', 'ERR:42501/ERR:42501/ERR:42501',
  pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.pharmacist_chat_threads()') || '/' || pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.pharmacist_chat_read(%L)$q$, pg_temp.t('chat1'))) || '/' ||
  pg_temp.anon_q('select count(*)::text from public.pharmacist_chat_threads()'));
select pg_temp.ck('D', 'D12 the pharmacist opens the thread', '1', pg_temp.q_as(pg_temp.f('phA'), format($q$select count(*)::text from public.pharmacist_chat_read(%L)$q$, pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D12b reading a thread is audited (INV-10): an audit row exists for it', 'true', (exists (select 1 from public.audit_log where action = 'pharmacy.chat_opened' and entity_id = pg_temp.t('chat1')::uuid))::text);
select pg_temp.ck('D', 'D13 the pharmacist reads only the words, the first name and the one medicine named (none here)', 'S54||',
  pg_temp.q_as(pg_temp.f('phA'), format($q$select (select patient_first_name from public.pharmacist_chat_read(%L) limit 1) || '|' || coalesce((select medicine from public.pharmacist_chat_read(%L) limit 1), '') || '|' || coalesce((select dose from public.pharmacist_chat_read(%L) limit 1), '')$q$, pg_temp.t('chat1'), pg_temp.t('chat1'), pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D14 the pharmacist replies', 'true', pg_temp.q_as(pg_temp.f('phA'), format($q$select public.pharmacist_chat_reply(%L, 'Yes, taking it with food is fine for most people. Ask your care team if unsure.')::text$q$, pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D14b ...the patient is told neutrally and the notice carries no words', 'true',
  (select (n.payload = '{}'::jsonb and l.body !~* 'food|tablet|medic|drug')::text from public.notifications n join public.notification_template_locales l on l.template_key = n.template and l.locale = 'en'
     where n.template = 'pharmacist_chat_reply_patient' and n.recipient_id = pg_temp.f('pat') limit 1));
select pg_temp.ck('D', 'D15 the pharmacy''s notice about a new question carries no words either', 'true',
  (select (bool_and(n.payload = '{}'::jsonb))::text from public.notifications n where n.template = 'pharmacist_chat_new_message' and n.recipient_id = pg_temp.f('phA')));
select pg_temp.ck('D', 'D16 emergency words in a patient message are flagged so the screen can point at the emergency steps', 'true',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select (public.patient_send_pharmacist_chat(%L, 'I have chest pain after the tablet')->>'emergency')$q$, pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D16b the pharmacist sees the possible-emergency flag on the list and in the thread', 'true/true',
  pg_temp.q_as(pg_temp.f('phA'), 'select bool_or(possible_emergency)::text from public.pharmacist_chat_threads()') || '/' ||
  pg_temp.q_as(pg_temp.f('phA'), format($q$select bool_or(possible_emergency)::text from public.pharmacist_chat_read(%L)$q$, pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D17 an ordinary message is not flagged', 'false',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select (public.patient_send_pharmacist_chat(%L, 'Thank you')->>'emergency')$q$, pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D18 the pharmacist suggests the care team', 'true', pg_temp.q_as(pg_temp.f('phA'), format($q$select public.pharmacist_chat_escalate(%L)::text$q$, pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D18b ...the patient is told once', '1', (select count(*)::text from public.notifications where template = 'pharmacist_chat_escalated_patient' and recipient_id = pg_temp.f('pat')));
select pg_temp.ck('D', 'D19 a second escalate is accepted', 'true', pg_temp.q_as(pg_temp.f('phA'), format($q$select public.pharmacist_chat_escalate(%L)::text$q$, pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D19b ...the patient was still told only once', '1', (select count(*)::text from public.notifications where template = 'pharmacist_chat_escalated_patient' and recipient_id = pg_temp.f('pat')));
select pg_temp.ck('D', 'D21a the pharmacist closes the thread', 'true', pg_temp.q_as(pg_temp.f('phA'), format($q$select public.pharmacist_chat_close(%L)::text$q$, pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D21b a closed thread takes no message from the patient', 'ERR:22023', pg_temp.q_as(pg_temp.f('pat'), format($q$select (public.patient_send_pharmacist_chat(%L, 'more')->>'emergency')$q$, pg_temp.t('chat1'))));
select pg_temp.ck('D', 'D21c ...nor from the pharmacist', 'ERR:22023', pg_temp.q_as(pg_temp.f('phA'), format($q$select public.pharmacist_chat_reply(%L, 'more')::text$q$, pg_temp.t('chat1'))));
-- a guardian with an unrestricted manage grant can use an ADULT dependant's thread but never a young person's
do $$
declare v_guard uuid; v_teen uuid; v_adult uuid; v_t1 text; v_t2 text; v_org uuid := pg_temp.f('org');
begin
  v_guard := pg_temp.mkuser(v_org, 'guard', 'patient', 'S54 Guardian');
  v_teen := pg_temp.mkuser(v_org, 'teen', 'patient', 'S54 Teen');
  v_adult := pg_temp.mkuser(v_org, 'adultdep', 'patient', 'S54 Adult Dependant');
  update public.profiles set date_of_birth = (current_date - interval '14 years')::date where id = v_teen;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
    values (v_teen, v_guard, 'manage', v_teen, false, null), (v_adult, v_guard, 'manage', v_adult, false, null);
  v_t1 := pg_temp.q_as(v_teen, format($q$select (public.patient_start_pharmacist_chat(%L, null, 'Private question', 'Hello')->>'thread_id')$q$, pg_temp.f('pA')));
  v_t2 := pg_temp.q_as(v_adult, format($q$select (public.patient_start_pharmacist_chat(%L, null, 'Adult question', 'Hello')->>'thread_id')$q$, pg_temp.f('pA')));
  perform pg_temp.ck('D', 'D22a a guardian cannot read a young person''s thread', 'ERR:42501', pg_temp.q_as(v_guard, format($q$select count(*)::text from public.patient_pharmacist_chat_messages(%L)$q$, v_t1)));
  perform pg_temp.ck('D', 'D22b ...nor see it in the list, nor in the table', '0/0',
    pg_temp.q_as(v_guard, format($q$select count(*)::text from public.patient_pharmacist_chat_threads() where thread_id = %L$q$, v_t1)) || '/' ||
    pg_temp.q_as(v_guard, format($q$select count(*)::text from public.pharmacist_chat_messages where thread_id = %L$q$, v_t1)));
  perform pg_temp.ck('D', 'D22c the young person reads her own thread', '1', pg_temp.q_as(v_teen, format($q$select count(*)::text from public.patient_pharmacist_chat_messages(%L)$q$, v_t1)));
  perform pg_temp.ck('D', 'D22d the gate OPENS for an adult dependant: the guardian with the pharmacy permission reads that thread', '1', pg_temp.q_as(v_guard, format($q$select count(*)::text from public.patient_pharmacist_chat_messages(%L)$q$, v_t2)));
end $$;
select pg_temp.ck('D', 'D22 the chat lists only listable pharmacies to the patient', 'S54 Pharmacy A,S54 Pharmacy C',
  pg_temp.q_as(pg_temp.f('pat'), $q$select string_agg(partner_name, ',' order by partner_name) from public.patient_chat_pharmacies() where partner_name like 'S54%'$q$));

-- a patient cannot open unlimited threads (each one notifies every pharmacist): the sixth in a day is refused
do $$ declare i integer; r text; begin
  for i in 1..5 loop
    r := pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.patient_start_pharmacist_chat(%L, null, 'Topic %s', 'Hello')::text$q$, pg_temp.f('pA'), i));
  end loop;
  r := pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.patient_start_pharmacist_chat(%L, null, 'Topic six', 'Hello')::text$q$, pg_temp.f('pA')));
  perform pg_temp.ck('D', 'D24 the sixth new thread in a day is refused', 'ERR:22023', r);
end $$;

-- E. refill tied to the chosen pharmacy ----------------------------------------------------------------------------------------------
update public.prescriptions set pharmacy_partner_id = pg_temp.f('pA'), state = 'sent' where id = pg_temp.f('rx1');
update public.medications set refill_date = current_date + 2 where prescription_id = pg_temp.f('rx1');
select private.queue_medication_refill_reminders();
select pg_temp.ck('E', 'E1 the refill reminder payload names the chosen pharmacy and nothing else about it', 'true',
  (select (n.payload ->> 'pharmacy_partner_id' = pg_temp.f('pA')::text and n.payload ->> 'refill_date' is not null and not (n.payload ? 'drug_name'))::text
     from public.notifications n join public.medications m on m.id = (n.payload ->> 'medication_id')::uuid
    where n.template = 'medication_refill_reminder' and m.prescription_id = pg_temp.f('rx1') limit 1));
select pg_temp.ck('E', 'E2 the patient reads where to collect', 'S54 Pharmacy A',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select partner_name from public.medication_refill_pharmacy((select id from public.medications where prescription_id = %L))$q$, pg_temp.f('rx1'))));
select pg_temp.ck('E', 'E3 another patient and anon cannot', 'ERR:42501/ERR:42501',
  pg_temp.q_as(pg_temp.f('pat2'), format($q$select partner_name from public.medication_refill_pharmacy((select id from public.medications where prescription_id = %L))$q$, pg_temp.f('rx1'))) || '/' ||
  pg_temp.anon_q(format($q$select partner_name from public.medication_refill_pharmacy((select id from public.medications where prescription_id = %L))$q$, pg_temp.f('rx1'))));

-- F. pickup only ---------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('F', 'F1 a delivery order cannot be created, even by the owner', 'ERR:23514',
  pg_temp.q_as(pg_temp.f('pat'), format($q$insert into public.pharmacy_orders (organisation_id, patient_id, pharmacy_partner_id, items, total_kobo, fulfilment_method) values (%L, %L, %L, '[{"drug_name":"Amlodipine 5 mg"}]', 100, 'delivery') returning 'x'$q$, pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('pA'))));
do $$ declare r text; begin
  begin
    insert into public.pharmacy_orders (organisation_id, patient_id, pharmacy_partner_id, items, total_kobo, fulfilment_method) values (pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('pA'), '[{"drug_name":"Amlodipine 5 mg"}]', 100, 'delivery');
    r := 'inserted';
  exception when check_violation then r := '23514'; end;
  perform pg_temp.ck('F', 'F2 the constraint holds for the table owner too', '23514', r);
end $$;
select pg_temp.ck('F', 'F3 a pickup order still works', 'x',
  pg_temp.q_as(pg_temp.f('pat'), format($q$insert into public.pharmacy_orders (organisation_id, patient_id, pharmacy_partner_id, items, total_kobo, fulfilment_method) values (%L, %L, %L, '[{"drug_name":"Amlodipine 5 mg"}]', 100, 'pickup') returning 'x'$q$, pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('pA'))));

-- H. 8.16 standing check: nothing a patient or clinician can call or select exposes a commission -----------------------------------------
select pg_temp.ck('H', 'H1 no function executable by a signed-in user returns a column named like a commission', '0',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and exists (select 1 from unnest(coalesce(p.proargnames, '{}')) a where a ~* 'commission')));
select pg_temp.ck('H', 'H2 the only view a signed-in user can read with a commission column is the admin-gated one', 'pharmacy_medications_admin.commission_flat_kobo,pharmacy_medications_admin.commission_rate,pharmacy_medications_admin.commission_rate_type',
  (select string_agg(c.relname || '.' || a.attname, ',' order by c.relname, a.attname) from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm') and a.attname ~* 'commission' and a.attnum > 0 and has_table_privilege('authenticated', c.oid, 'SELECT')));
select pg_temp.ck('H', 'H3 a patient, a clinician and a pharmacist read no commission from that view', '0/0/0',
  pg_temp.q_as(pg_temp.f('pat'), 'select count(*)::text from public.pharmacy_medications_admin') || '/' || pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.pharmacy_medications_admin') || '/' || pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.pharmacy_medications_admin'));
-- sabotage of the standing check itself: a leaking view must change what H2 sees
create view public.s54_leak as select id, commission_rate from public.pharmacy_medications;
grant select on public.s54_leak to authenticated;
select pg_temp.ck('H', 'H4 SABOTAGE: a leaking view is caught by the same query (so H2 would FAIL)', 'true',
  (exists (select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relname = 's54_leak' and a.attname = 'commission_rate' and has_table_privilege('authenticated', c.oid, 'SELECT')))::text);
drop view public.s54_leak;

-- G. SABOTAGE: with the routing trigger dropped the unlisted pharmacy is accepted ------------------------------------------------------
drop trigger prescriptions_listable_pharmacy on public.prescriptions;
do $$ declare r text; begin
  begin
    update public.prescriptions set pharmacy_partner_id = pg_temp.f('pB') where id = pg_temp.f('rx2');
    r := 'accepted';
  exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.ck('G', 'G1 SABOTAGE: without the trigger the unlisted pharmacy is accepted (so check A9 would FAIL)', 'accepted', r);
end $$;

\o
select phase, check_name, expected, actual from results where expected is distinct from actual order by phase, check_name;
do $$ declare v_bad text; begin
  select string_agg(phase || ' ' || check_name || ' expected=' || expected || ' actual=' || coalesce(actual, 'null'), E'\n') into v_bad from results where expected is distinct from actual;
  if v_bad is not null then raise exception E'HOLE OPEN:\n%', v_bad; end if;
end $$;
select phase, check_name, expected, actual, 'PASS' as verdict from results order by phase, check_name;
rollback;
