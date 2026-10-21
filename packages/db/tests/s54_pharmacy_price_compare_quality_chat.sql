-- S54 proof (migration *_s54_pharmacy_price_compare_quality_chat.sql). Module 8 rows 8.9 to 8.11, 8.16 and decision D5.
-- One rolled-back transaction. Every role is tested and every role that must be refused is shown refused.
--  A. Quality rules (8.11): a pharmacy is listable only with a verified licence AND a recorded NAFDAC-source attestation; only an admin or
--     partner manager can attest, through the function; a prescription cannot be routed to an unlisted pharmacy by any door.
--  B. Verified batch (8.11): only Tarragon staff can set it; a pharmacy cannot mark its own batch; it needs a listable pharmacy.
--  C. (Price compare, 8.9, removed by OQ-714: see oq714_remove_patient_price_compare.sql.)
--  D. (Pharmacist chat, 8.12, is S74's and has its own proof; S54 builds none.)
--  E. Refill (8.10): the reminder payload names the chosen pharmacy; the patient can read where to collect; nobody else can.
--  F. No delivery (D5, done by OQ-261): the order table has no delivery column left; an ordinary order still works.
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
select pg_temp.ck('B', 'B4 a patient reads neither the flag nor who set it (the patient read was dropped with the price comparison, OQ-714)', 'ERR:42501|ERR:42501',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select verified_batch::text from public.pharmacy_medications where pharmacy_partner_id = %L and strength = '5 mg'$q$, pg_temp.f('pA'))) || '|' ||
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

-- C. (the patient price comparison was removed by OQ-714, v5 Part C.2; oq714_remove_patient_price_compare.sql proves it is gone.)

-- D. (the pharmacist chat is S74's and has its own proof; S54 builds none.)

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

-- F. no delivery (D5): carried out by OQ-261; S54 keeps one check that the order table has no delivery path left -------------------------------
select pg_temp.ck('F', 'F1 pharmacy_orders has no fulfilment, courier or delivery column any more', '0',
  (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'pharmacy_orders'
     and (column_name ~ 'deliver' or column_name in ('fulfilment_method', 'logistics_partner_id'))));
select pg_temp.ck('F', 'F2 a pickup order still works', 'x',
  pg_temp.q_as(pg_temp.f('pat'), format($q$insert into public.pharmacy_orders (organisation_id, patient_id, pharmacy_partner_id, items, total_kobo) values (%L, %L, %L, '[{"drug_name":"Amlodipine 5 mg"}]', 100) returning 'x'$q$, pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('pA'))));
select pg_temp.ck('F', 'F3 the older order path cannot name an unlisted pharmacy either', 'ERR:22023',
  pg_temp.q_as(pg_temp.f('pat'), format($q$insert into public.pharmacy_orders (organisation_id, patient_id, pharmacy_partner_id, items, total_kobo) values (%L, %L, %L, '[{"drug_name":"Amlodipine 5 mg"}]', 100) returning 'x'$q$, pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('pB'))));

-- H. 8.16 standing check: nothing a patient or clinician can call or select exposes a commission -----------------------------------------
select pg_temp.ck('H', 'H1 no function executable by a signed-in user returns a column named like a commission', '0',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and exists (select 1 from unnest(coalesce(p.proargnames, '{}')) a where a ~* 'commission')));
select pg_temp.ck('H', 'H2 the only pharmacy view a signed-in user can read with a commission column is the admin-gated one (lab, panel and screening views are proved by Track E)', 'pharmacy_medications_admin.commission_flat_kobo,pharmacy_medications_admin.commission_rate,pharmacy_medications_admin.commission_rate_type',
  (select string_agg(c.relname || '.' || a.attname, ',' order by c.relname, a.attname) from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm') and c.relname ~ '^pharmacy' and a.attname ~* 'commission' and a.attnum > 0 and has_table_privilege('authenticated', c.oid, 'SELECT')));
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
