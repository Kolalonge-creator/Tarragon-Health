-- S54c proof (migration *_s54c_clinician_suggests_pharmacy_patient_confirms.sql). OQ-310 option (b): the care team suggests, the patient confirms.
-- One rolled-back transaction. Every role is tested and every role that must be refused is shown refused.
--  A. Options read (clinician): tied clinical-tier clinician sees neutral facts only, ordered by proximity then name, never by an earning;
--     an untied clinician, a care coordinator, a patient, another patient, a pharmacist, finance, admin and anon get nothing (and denials are audited).
--  B. Suggest: only the tied clinical-tier clinician; unlisted pharmacy refused; it routes NOTHING (prescription stays signed, no code, no pharmacy);
--     a neutral notice, an event and an audit row; a second suggestion replaces the first.
--  C. Visibility and writes: the patient reads her own; nobody else can read the table (clinician, other patient, pharmacist of the suggested
--     pharmacy, finance, admin, anon); no client can write it.
--  D. Patient responds: accept goes through the S28 door (state sent, the pharmacy sees it only now, code exists); decline; choose another;
--     cancelled prescription lapses; an unlisted pharmacy cannot be accepted; only the author withdraws.
--  E. 8.16: no clinician-facing function or output names an earning; the ordering does not move when the commissions are swapped.
--  F. SABOTAGE: (1) a leaking function is caught by the same scanner, (2) a staff select policy lets a clinician read the table (C would FAIL),
--     (3) without the settle trigger an accepted suggestion stays pending (D would FAIL).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table txt(k text primary key, v text) on commit drop;
grant all on txt to public;
create function pg_temp.sett(p text, p_v text) returns void language sql as $$ insert into txt values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.t(p text) returns text language sql as $$ select v from txt where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
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
  values (v, 's54c-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, p_name, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_profile uuid, p_tier text, p_admin uuid) returns void language plpgsql as
$f$ begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, p_profile, 'S54c staff', 'MDCN', 'S54c-' || substr(p_profile::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true);
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
declare v_org uuid; v_pA uuid; v_pB uuid; v_pC uuid; v_pE uuid; v_pG uuid; v_rx6 uuid; v_adm uuid; v_pat uuid; v_doc uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  -- A: listable, same city as the patient (Ikeja). C: listable, same state (Yaba, Lagos). E: listable, another state (Kano): far, never offered.
  -- B: everything but the NAFDAC-source attestation: not listable.
  insert into public.pharmacy_partners (name, city, state, is_active, approved_at, license_verified_at, onboarding_status, nafdac_source_attested_at, nafdac_source_note)
    values ('S54c Pharmacy A', 'Ikeja', 'Lagos', true, now(), now(), 'activated', now(), 'proof fixture') returning id into v_pA;
  insert into public.pharmacy_partners (name, city, state, is_active, approved_at, license_verified_at, onboarding_status)
    values ('S54c Pharmacy B no attestation', 'Ikeja', 'Lagos', true, now(), now(), 'activated') returning id into v_pB;
  insert into public.pharmacy_partners (name, city, state, is_active, approved_at, license_verified_at, onboarding_status, nafdac_source_attested_at, nafdac_source_note)
    values ('S54c Pharmacy C', 'Yaba', 'Lagos', true, now(), now(), 'activated', now(), 'proof fixture') returning id into v_pC;
  insert into public.pharmacy_partners (name, city, state, is_active, approved_at, license_verified_at, onboarding_status, nafdac_source_attested_at, nafdac_source_note)
    values ('S54c Pharmacy E', 'Kano', 'Kano', true, now(), now(), 'activated', now(), 'proof fixture') returning id into v_pE;
  insert into public.pharmacy_partners (name, city, state, is_active, approved_at, license_verified_at, onboarding_status, nafdac_source_attested_at, nafdac_source_note)
    values ('S54c Pharmacy G', 'Ikeja', 'Lagos', true, now(), now(), 'activated', now(), 'proof fixture') returning id into v_pG;
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state, address, is_active, verified_at) values
    (v_pG, 'S54c G Epe', 'Lagos', '9 Epe Road, Epe', true, now()), (v_pG, 'S54c G Ikeja', 'Lagos', '10 Allen Avenue, Ikeja', true, now());
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state, address, is_active, verified_at) values
    (v_pA, 'S54c A Ikeja', 'Lagos', '1 Test Road', true, now()), (v_pB, 'S54c B Ikeja', 'Lagos', '2 Test Road', true, now()),
    (v_pC, 'S54c C Yaba', 'Lagos', '3 Test Road', true, now()), (v_pE, 'S54c E Kano', 'Kano', '5 Test Road', true, now());
  -- commissions: A (nearest) earns Tarragon the LEAST, C the MOST, so an earning-ordered list would put C first
  insert into public.pharmacy_medications (pharmacy_partner_id, drug_name, strength, pack_size, price_kobo, is_active, stock_status, commission_rate, commission_rate_type, commission_flat_kobo) values
    (v_pA, 'Amlodipine', '5 mg', '30', 300000, true, 'in_stock', 0.0001, 'percentage', 1),
    (v_pC, 'Amlodipine', '5 mg', '30', 250000, true, 'unavailable', 0.9, 'percentage', 999999);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('pA', v_pA); perform pg_temp.setf('pB', v_pB); perform pg_temp.setf('pC', v_pC); perform pg_temp.setf('pE', v_pE);
  select (select pl.id from public.pharmacy_partner_locations pl where pl.pharmacy_partner_id = v_pA) into v_pA;
  perform pg_temp.setf('pG', v_pG);
  perform pg_temp.setf('lA', v_pA);
  perform pg_temp.setf('lB', (select id from public.pharmacy_partner_locations where pharmacy_partner_id = pg_temp.f('pB')));
  perform pg_temp.setf('lC', (select id from public.pharmacy_partner_locations where pharmacy_partner_id = pg_temp.f('pC')));
  perform pg_temp.setf('lE', (select id from public.pharmacy_partner_locations where pharmacy_partner_id = pg_temp.f('pE')));

  v_adm := pg_temp.mkuser(v_org, 'adm', 'admin', 'S54c Admin'); perform pg_temp.setf('adm', v_adm);
  -- S28c put collection behind the S37 prescribing guard (fail closed); this proof exercises the open path, so switch it on the way the guard's trigger allows (a log row, then the update)
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions) values ('prescribing_enabled', 'switched_on', v_adm, 'admin', 'S54c proof', '[]'::jsonb);
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = v_adm, change_note = 'S54c proof' where key = 'prescribing_enabled';
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician', 'S54c Prescriber'); perform pg_temp.setf('doc', v_doc);
  perform pg_temp.mkstaff(v_org, v_doc, 'senior_medical_officer', v_adm);
  perform pg_temp.setf('doc2', pg_temp.mkuser(v_org, 'doc2', 'clinician', 'S54c Untied Clinician'));
  perform pg_temp.mkstaff(v_org, pg_temp.f('doc2'), 'medical_officer', v_adm);
  perform pg_temp.setf('coord', pg_temp.mkuser(v_org, 'coord', 'care_coordinator', 'S54c Coordinator'));
  perform pg_temp.mkstaff(v_org, pg_temp.f('coord'), 'care_coordinator', v_adm);
  perform pg_temp.setf('phA', pg_temp.mkuser(v_org, 'phA', 'pharmacist', 'S54c Pharmacist A'));
  update public.profiles set pharmacy_partner_id = pg_temp.f('pA') where id = pg_temp.f('phA');
  perform pg_temp.setf('fin', pg_temp.mkuser(v_org, 'fin', 'finance', 'S54c Finance'));
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', 'S54c Patient'); perform pg_temp.setf('pat', v_pat);
  update public.profiles set city = 'Ikeja', state = 'Lagos' where id = v_pat;
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient', 'S54c Other Patient'));
  -- the care team: doc and the coordinator are tied to the patient, doc2 is not
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id) values (v_org, v_pat, v_doc, pg_temp.f('coord'));
  perform pg_temp.setf('rx1', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
  perform pg_temp.setf('rx2', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
  perform pg_temp.setf('rx3', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
  perform pg_temp.setf('rx4', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
  perform pg_temp.setf('rx5', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
  -- rx6: signed, but its medicine is already stopped (inserted that way: a medicine's own row cannot be edited after the fact)
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test)
  values (v_org, v_pat, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed', v_doc, now(), true) returning id into v_rx6;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, quantity, repeats_allowed, source, is_active, prescription_id)
  values (v_org, v_pat, 'Amlodipine', '5 mg', '30 tablets', 0, 'clinician', false, v_rx6);
  perform pg_temp.setf('rx6', v_rx6);
  -- a dependant (a child account nobody logs into) with a signed prescription
  perform pg_temp.setf('kid', pg_temp.mkuser(v_org, 'kid', 'patient', 'S54c Dependant'));
  update public.profiles set is_dependent_account = true, city = 'Ikeja', state = 'Lagos' where id = pg_temp.f('kid');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, pg_temp.f('kid'), v_doc);
  perform pg_temp.setf('rxkid', pg_temp.mkrx(v_org, pg_temp.f('kid'), v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
  perform pg_temp.setf('rx8', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
  perform pg_temp.setf('rx9', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
  perform pg_temp.setf('rx10', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
  -- accounts whose role is NOT clinician but who hold a clinical doctor tier row: the allow-list must still refuse them
  perform pg_temp.setf('odd_corporate_admin', pg_temp.mkuser(v_org, 'oddca', 'corporate_admin', 'S54c Odd corporate'));
  perform pg_temp.setf('odd_hmo_admin', pg_temp.mkuser(v_org, 'oddhmo', 'hmo_admin', 'S54c Odd hmo'));
  perform pg_temp.setf('odd_care_coordinator', pg_temp.mkuser(v_org, 'oddcc', 'care_coordinator', 'S54c Odd coordinator'));
  perform pg_temp.setf('odd_analyst', pg_temp.mkuser(v_org, 'oddan', 'analyst', 'S54c Odd analyst'));
  perform pg_temp.setf('odd_lab_liaison', pg_temp.mkuser(v_org, 'oddll', 'lab_liaison', 'S54c Odd liaison'));
  perform pg_temp.mkstaff(v_org, pg_temp.f('odd_corporate_admin'), 'medical_officer', v_adm);
  perform pg_temp.mkstaff(v_org, pg_temp.f('odd_hmo_admin'), 'medical_officer', v_adm);
  perform pg_temp.mkstaff(v_org, pg_temp.f('odd_care_coordinator'), 'medical_officer', v_adm);
  perform pg_temp.mkstaff(v_org, pg_temp.f('odd_analyst'), 'medical_officer', v_adm);
  perform pg_temp.mkstaff(v_org, pg_temp.f('odd_lab_liaison'), 'medical_officer', v_adm);
  perform pg_temp.setf('rx7', pg_temp.mkrx(v_org, v_pat, v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
  -- a patient whose city is her state (Lagos, Lagos): nearness must stay a state-level fact
  perform pg_temp.setf('lagos', pg_temp.mkuser(v_org, 'lagos', 'patient', 'S54c Lagos Patient'));
  update public.profiles set city = 'Lagos', state = 'Lagos' where id = pg_temp.f('lagos');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, pg_temp.f('lagos'), v_doc);
  perform pg_temp.setf('rxlagos', pg_temp.mkrx(v_org, pg_temp.f('lagos'), v_doc, '[{"drug":"Amlodipine","dose":"5 mg","quantity":"30 tablets"}]'::jsonb, 'signed'));
end $$;

\o /dev/null
-- A. options (neutral facts) -----------------------------------------------------------------------------------------------------------
create function pg_temp.opts(p_uid uuid, p_rx uuid) returns jsonb language sql as
$$ select pg_temp.q_as(p_uid, format($q$select coalesce(jsonb_agg(to_jsonb(o)), '[]')::text from public.care_team_pharmacy_options(%L, %L, 'Preparing to route this prescription') o$q$, pg_temp.f('pat'), p_rx))::jsonb $$;
create function pg_temp.opts_line(p jsonb) returns text language sql as
$$ select string_agg(x ->> 'partner_name' || '/' || (x ->> 'proximity') || '/' || (x ->> 'in_stock'), ',' order by ord) from jsonb_array_elements(p) with ordinality as t(x, ord) $$;
select pg_temp.ck('A', 'A1 the tied clinician sees same-city branches (A, then the Ikeja branch of G) before same-state ones (C, then the Epe branch of G); B unlisted and E (another state) are not offered, and the Epe branch of G is not same city just because its head office is', 'S54c Pharmacy A/same_city/yes,S54c Pharmacy G/same_city/unknown,S54c Pharmacy C/same_state/no,S54c Pharmacy G/same_state/unknown',
  pg_temp.opts_line(pg_temp.opts(pg_temp.f('doc'), pg_temp.f('rx1'))));
select pg_temp.ck('A', 'A2 the output has exactly the neutral columns and every row is listable', 'address,in_stock,listable,location_id,location_name,partner_id,partner_name,proximity,state/true',
  (select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(x) k from jsonb_array_elements(pg_temp.opts(pg_temp.f('doc'), pg_temp.f('rx1'))) x) z)
  || '/' || (select bool_and((x ->> 'listable')::boolean)::text from jsonb_array_elements(pg_temp.opts(pg_temp.f('doc'), pg_temp.f('rx1'))) x));
select pg_temp.ck('A', 'A3 no earning-like word anywhere in the clinician-facing output (keys or values)', '0',
  (select count(*)::text from jsonb_array_elements(pg_temp.opts(pg_temp.f('doc'), pg_temp.f('rx1'))) x where x::text ~* '\y(commission|margin|earn|payout|rate_bps|price)'));
-- the order does not follow earnings: swap the commissions (A now the highest, C the lowest) and the order is the same
update public.pharmacy_medications set commission_rate = case pharmacy_partner_id when pg_temp.f('pA') then 0.9 else 0.0001 end,
  commission_flat_kobo = case pharmacy_partner_id when pg_temp.f('pA') then 999999 else 1 end where pharmacy_partner_id in (pg_temp.f('pA'), pg_temp.f('pC'));
select pg_temp.ck('A', 'A4 swapping the commissions does not change the order or any value shown', 'S54c Pharmacy A/same_city/yes,S54c Pharmacy G/same_city/unknown,S54c Pharmacy C/same_state/no,S54c Pharmacy G/same_state/unknown',
  pg_temp.opts_line(pg_temp.opts(pg_temp.f('doc'), pg_temp.f('rx1'))));
select pg_temp.ck('A', 'A5 an untied clinician sees nothing', '0',
  pg_temp.q_as(pg_temp.f('doc2'), format($q$select count(*)::text from public.care_team_pharmacy_options(%L, %L, 'Trying to look without being on the team')$q$, pg_temp.f('pat'), pg_temp.f('rx1'))));
select pg_temp.ck('A', 'A6 the care coordinator (tied, but not a clinical tier) sees nothing', '0',
  pg_temp.q_as(pg_temp.f('coord'), format($q$select count(*)::text from public.care_team_pharmacy_options(%L, %L, 'Trying to look as a coordinator')$q$, pg_temp.f('pat'), pg_temp.f('rx1'))));
select pg_temp.ck('A', 'A7 the patient, another patient, the pharmacist, finance and admin see nothing', '0/0/0/0/0',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.care_team_pharmacy_options(%L, %L, 'The patient asking for herself')$q$, pg_temp.f('pat'), pg_temp.f('rx1')))
  || '/' || pg_temp.q_as(pg_temp.f('pat2'), format($q$select count(*)::text from public.care_team_pharmacy_options(%L, %L, 'Another patient trying to look')$q$, pg_temp.f('pat'), pg_temp.f('rx1')))
  || '/' || pg_temp.q_as(pg_temp.f('phA'), format($q$select count(*)::text from public.care_team_pharmacy_options(%L, %L, 'A pharmacist trying to look')$q$, pg_temp.f('pat'), pg_temp.f('rx1')))
  || '/' || pg_temp.q_as(pg_temp.f('fin'), format($q$select count(*)::text from public.care_team_pharmacy_options(%L, %L, 'Finance trying to look')$q$, pg_temp.f('pat'), pg_temp.f('rx1')))
  || '/' || pg_temp.q_as(pg_temp.f('adm'), format($q$select count(*)::text from public.care_team_pharmacy_options(%L, %L, 'Admin trying to look at this')$q$, pg_temp.f('pat'), pg_temp.f('rx1'))));
select pg_temp.ck('A', 'A8 anon cannot call it', 'ERR:42501',
  pg_temp.anon_q(format($q$select count(*)::text from public.care_team_pharmacy_options(%L, %L, 'Anonymous attempt to look')$q$, pg_temp.f('pat'), pg_temp.f('rx1'))));
select pg_temp.ck('A', 'A9 a reason that says nothing is refused', 'ERR:22023',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select count(*)::text from public.care_team_pharmacy_options(%L, %L, 'x')$q$, pg_temp.f('pat'), pg_temp.f('rx1'))));
select pg_temp.ck('A', 'A10 the tied read and the untied denial are both audited', 'true',
  (exists (select 1 from public.audit_log where actor_id = pg_temp.f('doc') and action = 'staff.chart_read' and result = 'success' and event -> 'sections' ? 'pharmacy_suggestions')
   and exists (select 1 from public.audit_log where actor_id = pg_temp.f('doc2') and action = 'staff.chart_read' and result = 'denied' and event -> 'sections' ? 'pharmacy_suggestions'))::text);

-- B. suggest ---------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('B', 'B1 untied clinician, coordinator, patient, pharmacist, finance, admin refused', 'ERR:42501/ERR:42501/ERR:42501/ERR:42501/ERR:42501/ERR:42501',
  pg_temp.q_as(pg_temp.f('doc2'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lA')))
  || '/' || pg_temp.q_as(pg_temp.f('coord'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lA')))
  || '/' || pg_temp.q_as(pg_temp.f('pat'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lA')))
  || '/' || pg_temp.q_as(pg_temp.f('phA'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lA')))
  || '/' || pg_temp.q_as(pg_temp.f('fin'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lA')))
  || '/' || pg_temp.q_as(pg_temp.f('adm'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lA'))));
select pg_temp.ck('B', 'B2 anon cannot suggest', 'ERR:42501', pg_temp.anon_q(format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lA'))));
select pg_temp.ck('B', 'B3 an unlisted pharmacy (no NAFDAC attestation) cannot be suggested', 'ERR:22023',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx1'), pg_temp.f('pB'), pg_temp.f('lB'))));
select pg_temp.ck('B', 'B4 a branch that belongs to another pharmacy cannot be paired with this one', 'ERR:22023',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lC'))));
do $$ begin
  perform pg_temp.sett('b5', pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx1'), pg_temp.f('pA'), pg_temp.f('lA'))));
end $$;
select pg_temp.ck('B', 'B5 the tied clinician suggests A and gets the suggestion id and the patient id back', 'true/true',
  ((pg_temp.t('b5')::jsonb ->> 'suggestion_id') ~ '^[0-9a-f-]{36}$')::text || '/' || ((pg_temp.t('b5')::jsonb ->> 'patient_id') = pg_temp.f('pat')::text)::text);
select pg_temp.ck('B', 'B6 a suggestion routes NOTHING: still signed, no pharmacy, no choice time, no collection code', 'signed/null/null/0',
  (select rx.state::text || '/' || coalesce(rx.pharmacy_partner_id::text, 'null') || '/' || coalesce(rx.chosen_by_patient_at::text, 'null') || '/' ||
          (select count(*)::text from public.prescription_collection_codes c where c.prescription_id = rx.id)
     from public.prescriptions rx where rx.id = pg_temp.f('rx1')));
select pg_temp.ck('B', 'B7 one neutral in-app notice, no medicine or pharmacy in the template text, empty payload', '1/true/true',
  (select count(*)::text from public.notifications where recipient_id = pg_temp.f('pat') and template = 'pharmacy_suggestion_patient' and payload = '{}'::jsonb)
  || '/' || (select (body !~* '(amlodipine|pharmacy a|S54c)')::text from public.notification_template_locales where template_key = 'pharmacy_suggestion_patient' and locale = 'en')
  || '/' || (select (subject !~* '(amlodipine|pharmacy a|S54c)')::text from public.notification_template_locales where template_key = 'pharmacy_suggestion_patient' and locale = 'en'));
select pg_temp.ck('B', 'B8 an event with ids only went through the outbox, and the audit row exists', '1/true',
  (select count(*)::text from public.domain_events where event_type = 'prescription.pharmacy_suggested' and aggregate_id = pg_temp.f('rx1'))
  || '/' || (exists (select 1 from public.audit_log where action = 'prescription.pharmacy_suggested' and actor_id = pg_temp.f('doc'))::text));
select pg_temp.ck('B', 'B9 the event payload carries only the prescription id', 'prescription_id',
  (select string_agg(k, ',') from (select distinct jsonb_object_keys(payload) k from public.domain_events where event_type = 'prescription.pharmacy_suggested' and aggregate_id = pg_temp.f('rx1')) z));
do $$ begin
  perform pg_temp.setf('sugg2', (pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx1'), pg_temp.f('pC'), pg_temp.f('lC')))::jsonb ->> 'suggestion_id')::uuid);
end $$;
select pg_temp.ck('B', 'B10 a second suggestion replaces the first (the first is withdrawn)', '1',
  (select count(*)::text from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx1') and status = 'withdrawn'));
select pg_temp.ck('B', 'B10b replacing a pending suggestion sends the patient no second notice', '1',
  (select count(*)::text from public.notifications where recipient_id = pg_temp.f('pat') and template = 'pharmacy_suggestion_patient'));
select pg_temp.ck('B', 'B11 exactly one pending suggestion remains', '1',
  (select count(*)::text from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx1') and status = 'pending'));
select pg_temp.ck('B', 'B12 the clinician list shows the prescription with its pending suggestion by name (their own)', 'signed/pending/S54c Pharmacy C',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select rx_state || '/' || suggestion_status || '/' || suggested_partner_name from public.care_team_prescriptions_for_routing(%L, 'Preparing to route this prescription') where prescription_id = %L$q$, pg_temp.f('pat'), pg_temp.f('rx1'))));
select pg_temp.ck('B', 'B13 the untied clinician, a pharmacist and another patient get an empty routing list', '0/0/0',
  pg_temp.q_as(pg_temp.f('doc2'), format($q$select count(*)::text from public.care_team_prescriptions_for_routing(%L, 'Trying to look without being on the team')$q$, pg_temp.f('pat')))
  || '/' || pg_temp.q_as(pg_temp.f('phA'), format($q$select count(*)::text from public.care_team_prescriptions_for_routing(%L, 'A pharmacist trying to look')$q$, pg_temp.f('pat')))
  || '/' || pg_temp.q_as(pg_temp.f('pat2'), format($q$select count(*)::text from public.care_team_prescriptions_for_routing(%L, 'Another patient trying to look')$q$, pg_temp.f('pat'))));
select pg_temp.ck('B', 'B13b repeated denied reads are recorded once an hour per clinician and patient, and accounts that can never be clinicians write none', '1/0/0',
  (select count(*)::text from public.audit_log where actor_id = pg_temp.f('doc2') and subject_patient_id = pg_temp.f('pat') and result = 'denied' and event -> 'sections' ? 'pharmacy_suggestions')
  || '/' || (select count(*)::text from public.audit_log where actor_id in (pg_temp.f('phA'), pg_temp.f('fin'), pg_temp.f('adm'), pg_temp.f('pat2'), pg_temp.f('coord')) and event -> 'sections' ? 'pharmacy_suggestions')
  || '/' || (select count(*)::text from public.audit_log where actor_id = pg_temp.f('pat') and event -> 'sections' ? 'pharmacy_suggestions'));
-- a prescription already sent cannot take a suggestion
do $$ declare v_rx uuid := pg_temp.mkrx(pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('doc'), '[{"drug":"Amlodipine","dose":"5 mg"}]'::jsonb, 'signed'); begin
  update public.prescriptions set state = 'cancelled' where id = v_rx;
  perform pg_temp.setf('rxcancelled', v_rx);
end $$;
select pg_temp.ck('B', 'B14 a cancelled prescription cannot take a suggestion', 'ERR:22023',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rxcancelled'), pg_temp.f('pA'), pg_temp.f('lA'))));

select pg_temp.ck('B', 'B15 a prescription whose medicine is no longer live cannot take a suggestion, is not listed, and offers no options', 'ERR:22023/0/0',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx6'), pg_temp.f('pA'), pg_temp.f('lA')))
  || '/' || pg_temp.q_as(pg_temp.f('doc'), format($q$select count(*)::text from public.care_team_prescriptions_for_routing(%L, 'Preparing to route this prescription') where prescription_id = %L$q$, pg_temp.f('pat'), pg_temp.f('rx6')))
  || '/' || pg_temp.q_as(pg_temp.f('doc'), format($q$select count(*)::text from public.care_team_pharmacy_options(%L, %L, 'Preparing to route this prescription')$q$, pg_temp.f('pat'), pg_temp.f('rx6'))));
select pg_temp.ck('B', 'B17 a dependant account gets no suggestion (nobody can confirm it), offers no options, and the routing list says the patient cannot confirm', 'ERR:22023/0/false',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rxkid'), pg_temp.f('pA'), pg_temp.f('lA')))
  || '/' || pg_temp.q_as(pg_temp.f('doc'), format($q$select count(*)::text from public.care_team_pharmacy_options(%L, %L, 'Preparing to route this prescription')$q$, pg_temp.f('kid'), pg_temp.f('rxkid')))
  || '/' || pg_temp.q_as(pg_temp.f('doc'), format($q$select patient_can_confirm::text from public.care_team_prescriptions_for_routing(%L, 'Preparing to route this prescription') where prescription_id = %L$q$, pg_temp.f('kid'), pg_temp.f('rxkid'))));
select pg_temp.ck('B', 'B18 a patient whose city is her state gets state-level nearness only (no branch is called same city)', 'same_state,same_state,same_state,same_state',
  (select string_agg(x ->> 'proximity', ',') from jsonb_array_elements(
     pg_temp.q_as(pg_temp.f('doc'), format($q$select coalesce(jsonb_agg(to_jsonb(o)), '[]')::text from public.care_team_pharmacy_options(%L, %L, 'Preparing to route this prescription') o$q$, pg_temp.f('lagos'), pg_temp.f('rxlagos')))::jsonb) x));
select pg_temp.ck('B', 'B16 the author sees her own suggestion flagged as hers', 'true',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select suggested_by_me::text from public.care_team_prescriptions_for_routing(%L, 'Preparing to route this prescription') where prescription_id = %L$q$, pg_temp.f('pat'), pg_temp.f('rx1'))));

-- C. visibility and writes ------------------------------------------------------------------------------------------------------------
select pg_temp.ck('C', 'C1 the patient reads her own suggestion (table and function)', '2/1',
  pg_temp.q_as(pg_temp.f('pat'), 'select count(*)::text from public.prescription_pharmacy_suggestions where prescription_id = ' || quote_literal(pg_temp.f('rx1')))
  || '/' || pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.patient_pharmacy_suggestion(%L)$q$, pg_temp.f('rx1'))));
select pg_temp.ck('C', 'C2 the function shows the pharmacy the care team named', 'S54c Pharmacy C',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select partner_name from public.patient_pharmacy_suggestion(%L)$q$, pg_temp.f('rx1'))));
select pg_temp.ck('C', 'C3 another patient reads nothing (table and function)', '0/0',
  pg_temp.q_as(pg_temp.f('pat2'), 'select count(*)::text from public.prescription_pharmacy_suggestions')
  || '/' || pg_temp.q_as(pg_temp.f('pat2'), format($q$select count(*)::text from public.patient_pharmacy_suggestion(%L)$q$, pg_temp.f('rx1'))));
select pg_temp.ck('C', 'C4 the prescriber has no direct table read (she reads through the audited function)', '0',
  pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.prescription_pharmacy_suggestions'));
select pg_temp.ck('C', 'C5 the pharmacist of the suggested pharmacy, finance and admin read nothing from the table', '0/0/0',
  pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.prescription_pharmacy_suggestions')
  || '/' || pg_temp.q_as(pg_temp.f('fin'), 'select count(*)::text from public.prescription_pharmacy_suggestions')
  || '/' || pg_temp.q_as(pg_temp.f('adm'), 'select count(*)::text from public.prescription_pharmacy_suggestions'));
select pg_temp.ck('C', 'C6 anon cannot read the table', 'ERR:42501', pg_temp.anon_q('select count(*)::text from public.prescription_pharmacy_suggestions'));
select pg_temp.ck('C', 'C7 the pharmacist sees no prescription while it is only suggested (the S28 list is empty)', '0',
  pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.pharmacist_prescriptions()'));
select pg_temp.ck('C', 'C8 no client can write the table: patient update, clinician insert, patient delete', 'ERR:42501/ERR:42501/ERR:42501',
  pg_temp.q_as(pg_temp.f('pat'), 'update public.prescription_pharmacy_suggestions set status = ' || quote_literal('accepted') || ' returning ' || quote_literal('x'))
  || '/' || pg_temp.q_as(pg_temp.f('doc'), format($q$insert into public.prescription_pharmacy_suggestions (organisation_id, prescription_id, patient_id, pharmacy_partner_id, pharmacy_location_id, recorded_by) values (%L, %L, %L, %L, %L, %L) returning 'x'$q$, pg_temp.f('org'), pg_temp.f('rx2'), pg_temp.f('pat'), pg_temp.f('pA'), pg_temp.f('lA'), pg_temp.f('doc')))
  || '/' || pg_temp.q_as(pg_temp.f('pat'), 'delete from public.prescription_pharmacy_suggestions returning ' || quote_literal('x')));

-- D. the patient responds --------------------------------------------------------------------------------------------------------------
select pg_temp.ck('D', 'D1 another patient and the clinician cannot accept it', 'ERR:22023/ERR:22023',
  pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.patient_accept_pharmacy_suggestion(%L)::text$q$, (select id from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx1') and status = 'pending')))
  || '/' || pg_temp.q_as(pg_temp.f('doc'), format($q$select public.patient_accept_pharmacy_suggestion(%L)::text$q$, (select id from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx1') and status = 'pending'))));
select pg_temp.ck('D', 'D2 anon cannot accept', 'ERR:42501',
  pg_temp.anon_q(format($q$select public.patient_accept_pharmacy_suggestion(%L)::text$q$, (select id from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx1') and status = 'pending'))));
do $$ begin
  perform pg_temp.sett('code', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_accept_pharmacy_suggestion(%L)$q$, pg_temp.f('sugg2'))));
end $$;
select pg_temp.ck('D', 'D3 the patient accepts: she gets her code, the prescription is sent to that branch, chosen by her', 'true/sent/true/true',
  (pg_temp.t('code') ~ '^[0-9A-Z]{8}$')::text
  || '/' || (select rx.state::text from public.prescriptions rx where rx.id = pg_temp.f('rx1'))
  || '/' || (select (rx.pharmacy_partner_id = pg_temp.f('pC') and rx.pharmacy_location_id = pg_temp.f('lC'))::text from public.prescriptions rx where rx.id = pg_temp.f('rx1'))
  || '/' || (select (rx.chosen_by_patient_at is not null)::text from public.prescriptions rx where rx.id = pg_temp.f('rx1')));
select pg_temp.ck('D', 'D4 the suggestion settled as accepted, by the patient', 'accepted/true',
  (select status || '/' || (settled_by = pg_temp.f('pat'))::text from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx1') and status <> 'withdrawn'));
select pg_temp.ck('D', 'D5 only now is the prescription routed to pharmacy C; the pharmacist of A (never chosen) still sees none', '1/0',
  (select count(*)::text from public.prescriptions where id = pg_temp.f('rx1') and pharmacy_partner_id = pg_temp.f('pC'))
  || '/' || pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.pharmacist_prescriptions()'));
select pg_temp.ck('D', 'D6 the code is on the patient-only table and the patient reads it', '1/1',
  (select count(*)::text from public.prescription_collection_codes where prescription_id = pg_temp.f('rx1'))
  || '/' || pg_temp.q_as(pg_temp.f('pat'), 'select count(*)::text from public.prescription_collection_codes where prescription_id = ' || quote_literal(pg_temp.f('rx1'))));
select pg_temp.ck('D', 'D7 the clinician list shows it as accepted (their own suggestion) and nothing about a code', 'sent/accepted',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select rx_state || '/' || suggestion_status from public.care_team_prescriptions_for_routing(%L, 'Following up on the suggestion') where prescription_id = %L$q$, pg_temp.f('pat'), pg_temp.f('rx1'))));
-- decline
do $$ begin
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx2'), pg_temp.f('pA'), pg_temp.f('lA')));
end $$;
do $$ begin
  perform pg_temp.sett('decl', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_decline_pharmacy_suggestion(%L)::text$q$, (select id from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx2') and status = 'pending'))));
end $$;
select pg_temp.ck('D', 'D8 the patient can decline; the prescription stays signed and unrouted', 'true/declined/signed/null',
  pg_temp.t('decl')
  || '/' || (select status from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx2'))
  || '/' || (select rx.state::text || '/' || coalesce(rx.pharmacy_partner_id::text, 'null') from public.prescriptions rx where rx.id = pg_temp.f('rx2')));
-- choose another: the patient ignores the suggestion and picks C through the normal S28 door
do $$ begin
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx3'), pg_temp.f('pA'), pg_temp.f('lA')));
end $$;
do $$ begin
  perform pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, pg_temp.f('rx3'), pg_temp.f('pC'), pg_temp.f('lC')));
end $$;
select pg_temp.ck('D', 'D9 choosing another pharmacy through the ordinary chooser settles the suggestion as chose_other', 'sent/chose_other',
  (select rx.state::text from public.prescriptions rx where rx.id = pg_temp.f('rx3')) || '/' ||
  (select status from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx3')));
-- a cancelled prescription lapses its pending suggestion
do $$ begin
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx4'), pg_temp.f('pA'), pg_temp.f('lA')));
  update public.prescriptions set state = 'cancelled' where id = pg_temp.f('rx4');
end $$;
select pg_temp.ck('D', 'D10 cancelling the prescription lapses a pending suggestion; the patient no longer sees it', 'lapsed/0',
  (select status from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx4')) || '/' ||
  pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.patient_pharmacy_suggestion(%L)$q$, pg_temp.f('rx4'))));
-- a pharmacy that stops being listable cannot be accepted, and the patient is no longer offered it
do $$ begin
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx5'), pg_temp.f('pA'), pg_temp.f('lA')));
  update public.pharmacy_partners set license_verified_at = null where id = pg_temp.f('pA');
end $$;
select pg_temp.ck('D', 'D11b the pharmacist of the pharmacy named in a PENDING suggestion sees nothing at all of it', '0/0',
  pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.pharmacist_prescriptions()')
  || '/' || pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.prescription_pharmacy_suggestions where status = ' || quote_literal('pending')));
select pg_temp.ck('D', 'D11 once the pharmacy is no longer listable it is not offered and cannot be accepted', '0/ERR:22023/pending/signed',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.patient_pharmacy_suggestion(%L)$q$, pg_temp.f('rx5')))
  || '/' || pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_accept_pharmacy_suggestion(%L)::text$q$, (select id from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx5') and status = 'pending')))
  || '/' || (select status from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx5'))
  || '/' || (select state::text from public.prescriptions where id = pg_temp.f('rx5')));
select pg_temp.ck('D', 'D11c the clinician is told the pending suggestion is unavailable, not that the patient is deciding', 'unavailable',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select suggestion_status from public.care_team_prescriptions_for_routing(%L, 'Preparing to route this prescription') where prescription_id = %L$q$, pg_temp.f('pat'), pg_temp.f('rx5'))));
update public.pharmacy_partners set license_verified_at = now() where id = pg_temp.f('pA');
-- withdrawing: only the author, and the patient then sees nothing
-- a second clinician becomes tied to the patient (as clinical director on her care team): she sees the suggestion as NOT hers and cannot withdraw it
update public.care_team_assignment set clinical_director_id = pg_temp.f('doc2') where patient_id = pg_temp.f('pat');
select pg_temp.ck('D', 'D12a a second tied clinician sees it as a colleague''s (not hers) and is still refused a withdraw', 'false/ERR:42501',
  pg_temp.q_as(pg_temp.f('doc2'), format($q$select suggested_by_me::text from public.care_team_prescriptions_for_routing(%L, 'Preparing to route this prescription') where prescription_id = %L$q$, pg_temp.f('pat'), pg_temp.f('rx5')))
  || '/' || pg_temp.q_as(pg_temp.f('doc2'), format($q$select (public.care_team_withdraw_pharmacy_suggestion(%L) ->> 'withdrawn')$q$, (select id from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx5') and status = 'pending'))));
do $$ declare v_id uuid := (select id from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx5') and status = 'pending'); begin
  perform pg_temp.sett('w1', pg_temp.q_as(pg_temp.f('doc2'), format($q$select (public.care_team_withdraw_pharmacy_suggestion(%L) ->> 'withdrawn')$q$, v_id)));
  perform pg_temp.sett('w2', pg_temp.q_as(pg_temp.f('doc'), format($q$select (public.care_team_withdraw_pharmacy_suggestion(%L) ->> 'withdrawn')$q$, v_id)));
end $$;
select pg_temp.ck('D', 'D12 only the author withdraws: another clinician refused, the author succeeds, the patient then sees none', 'ERR:42501/true/0',
  pg_temp.t('w1') || '/' || pg_temp.t('w2') || '/' || pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.patient_pharmacy_suggestion(%L)$q$, pg_temp.f('rx5'))));

-- a prescriber (or any non-patient route) moving the prescription to a pharmacy never records the suggestion as the patient's choice
do $$ begin
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx7'), pg_temp.f('pC'), pg_temp.f('lC')));
  -- the table owner stands in for the prescriber path: no patient flag is set, so this is routing by staff
  update public.prescriptions set state = 'sent', pharmacy_partner_id = pg_temp.f('pC'), pharmacy_location_id = pg_temp.f('lC') where id = pg_temp.f('rx7');
end $$;
select pg_temp.ck('D', 'D13 routing by anyone but the patient never records her as having accepted: the suggestion lapses', 'lapsed/true',
  (select status || '/' || (settled_by is null)::text from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx7')));

-- X. expiry (versioned rule) ---------------------------------------------------------------------------------------------------------------
do $$ begin
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx8'), pg_temp.f('pA'), pg_temp.f('lA')));
end $$;
select pg_temp.ck('X', 'X1 the active rule carries the suggestion window (PROPOSED, 14 days) and a new suggestion expires that far ahead', '14/14',
  (private.pharmacy_cfg() ->> 'suggestion_valid_days')
  || '/' || (select extract(day from expires_at - suggested_at)::text from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx8') and status = 'pending'));
-- push it past its expiry
update public.prescription_pharmacy_suggestions set suggested_at = now() - interval '15 days', expires_at = now() - interval '1 day' where prescription_id = pg_temp.f('rx8') and status = 'pending';
select pg_temp.ck('X', 'X2 an expired suggestion cannot be accepted (and nothing is routed)', 'ERR:22023/signed',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_accept_pharmacy_suggestion(%L)::text$q$, (select id from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx8') and status = 'pending')))
  || '/' || (select state::text from public.prescriptions where id = pg_temp.f('rx8')));
do $$ begin
  perform pg_temp.sett('x3', pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.patient_pharmacy_suggestion(%L)$q$, pg_temp.f('rx8'))));
end $$;
select pg_temp.ck('X', 'X3 the patient is no longer shown it, and reading lapses it to expired', '0/expired',
  pg_temp.t('x3') || '/' || (select status from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx8')));
-- a second, expired-but-not-yet-lapsed one is shown to the clinician as expired, not as waiting
do $$ begin
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx9'), pg_temp.f('pA'), pg_temp.f('lA')));
  update public.prescription_pharmacy_suggestions set suggested_at = now() - interval '15 days', expires_at = now() - interval '1 day' where prescription_id = pg_temp.f('rx9') and status = 'pending';
end $$;
select pg_temp.ck('X', 'X4 the clinician sees it as expired, not waiting for the patient', 'expired',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select suggestion_status from public.care_team_prescriptions_for_routing(%L, 'Preparing to route this prescription') where prescription_id = %L$q$, pg_temp.f('pat'), pg_temp.f('rx9'))));
do $$ begin
  perform pg_temp.sett('x5', pg_temp.q_as(pg_temp.f('doc'), format($q$select (public.care_team_suggest_pharmacy(%L, %L, %L) ->> 'suggestion_id') is not null$q$, pg_temp.f('rx9'), pg_temp.f('pC'), pg_temp.f('lC'))));
end $$;
select pg_temp.ck('X', 'X5 she can suggest again after expiry: the old one is expired, one new pending, and the patient is told again', 'true/expired/1/2',
  pg_temp.t('x5')
  || '/' || (select string_agg(status, ',' order by status) filter (where status <> 'pending') from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx9'))
  || '/' || (select count(*)::text from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx9') and status = 'pending')
  || '/' || (select count(*)::text from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx9')));
-- changing the rule is a new version, and the new window applies to the next suggestion
update public.pharmacy_config set is_active = false where is_active;
insert into public.pharmacy_config (version, is_active, config) values (900, true, '{"code_length": 8, "code_valid_days": 14, "max_wrong_attempts": 5, "suggestion_valid_days": 3}'::jsonb);
do $$ begin
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx10'), pg_temp.f('pA'), pg_temp.f('lA')));
end $$;
select pg_temp.ck('X', 'X6 a new rule version (3 days) governs the next suggestion', '3',
  (select extract(day from expires_at - suggested_at)::text from public.prescription_pharmacy_suggestions where prescription_id = pg_temp.f('rx10') and status = 'pending'));

-- Y. allow-list ---------------------------------------------------------------------------------------------------------------------------
do $$ declare u text; r text; v_res text := ''; begin
  foreach u in array array['odd_corporate_admin', 'odd_hmo_admin', 'odd_care_coordinator', 'odd_analyst', 'odd_lab_liaison'] loop
    update public.care_team_assignment set care_coordinator_id = pg_temp.f(u) where patient_id = pg_temp.f('pat');
    r := pg_temp.q_as(pg_temp.f(u), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, pg_temp.f('rx10'), pg_temp.f('pC'), pg_temp.f('lC')));
    v_res := v_res || r || '/' || pg_temp.q_as(pg_temp.f(u), format($q$select count(*)::text from public.care_team_prescriptions_for_routing(%L, 'Trying with an odd role')$q$, pg_temp.f('pat'))) || ',';
  end loop;
  perform pg_temp.sett('odd', v_res);
end $$;
select pg_temp.ck('Y', 'Y1 corporate_admin, hmo_admin, care_coordinator, analyst and lab_liaison accounts, each holding a clinical tier row and tied to the patient, are all refused', 'ERR:42501/0,ERR:42501/0,ERR:42501/0,ERR:42501/0,ERR:42501/0,', pg_temp.t('odd'));
-- SABOTAGE: without the explicit role check the same care_coordinator account is let in (so Y1 would FAIL)
do $$ begin
  update public.care_team_assignment set care_coordinator_id = pg_temp.f('odd_care_coordinator') where patient_id = pg_temp.f('pat');
  create or replace function private.may_suggest_pharmacy(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $f$
    select (select auth.uid()) is not null
       and exists (select 1 from public.profiles pt where pt.id = p_patient and pt.organisation_id is not null and private.is_clinical_tier(pt.organisation_id))
       and private.clinician_has_patient_access(p_patient) $f$;
  perform pg_temp.sett('sab', pg_temp.q_as(pg_temp.f('odd_care_coordinator'), format($q$select (public.care_team_suggest_pharmacy(%L, %L, %L) ->> 'suggestion_id') is not null$q$, pg_temp.f('rx10'), pg_temp.f('pC'), pg_temp.f('lC'))));
end $$;
select pg_temp.ck('Y', 'Y2 SABOTAGE: with the role check removed a care_coordinator-role account suggests a pharmacy (so Y1 would FAIL)', 'true', pg_temp.t('sab'));

-- E. 8.16 standing checks ---------------------------------------------------------------------------------------------------------------
select pg_temp.ck('E', 'E1 no clinician-facing function body names an earning, a margin, a payout or a price', '0',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('care_team_prescriptions_for_routing', 'care_team_pharmacy_options', 'care_team_suggest_pharmacy', 'care_team_withdraw_pharmacy_suggestion')
      and pg_get_functiondef(p.oid) ~* '\y(commission|margin|earn|payout|rate_bps|price_kobo|price)'));
select pg_temp.ck('E', 'E2 no clinician-facing function returns a column named for an earning or a price', '0',
  (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('care_team_prescriptions_for_routing', 'care_team_pharmacy_options', 'care_team_suggest_pharmacy', 'care_team_withdraw_pharmacy_suggestion')
      and exists (select 1 from unnest(coalesce(p.proargnames, '{}')) a where a ~* '(commission|margin|earn|payout|rate|price)')));
select pg_temp.ck('E', 'E3 anon holds no execute and no table privilege on any of it', '0',
  ((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'care_team_%pharmac%' or p.proname like 'patient_%pharmacy_suggestion%')
     and has_function_privilege('anon', p.oid, 'EXECUTE')) + (case when has_table_privilege('anon', 'public.prescription_pharmacy_suggestions', 'SELECT') then 1 else 0 end))::text);

-- F. SABOTAGE ----------------------------------------------------------------------------------------------------------------------------
-- F1: a clinician-facing function that leaks an earning is caught by the very scanner E1 uses
create function public.care_team_pharmacy_options_leaky(p_patient uuid) returns numeric language sql security definer set search_path = '' as
$$ select commission_rate from public.pharmacy_medications limit 1 $$;
select pg_temp.ck('F', 'F1 SABOTAGE: a leaking function is caught by the E1 scanner (so E1 would FAIL)', 'true',
  (pg_get_functiondef('public.care_team_pharmacy_options_leaky(uuid)'::regprocedure) ~* '\y(commission|margin|earn|payout|rate_bps|price_kobo|price)')::text);
drop function public.care_team_pharmacy_options_leaky(uuid);
-- F2: a staff select policy lets a clinician read the table (so C4 would FAIL)
create policy sab_staff_select on public.prescription_pharmacy_suggestions for select to authenticated using (true);
select pg_temp.ck('F', 'F2 SABOTAGE: with a staff select policy the prescriber reads the table directly (so C4 would FAIL)', 'true',
  (pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.prescription_pharmacy_suggestions')::int > 0)::text);
drop policy sab_staff_select on public.prescription_pharmacy_suggestions;
-- F3: without the settle trigger an accepted suggestion stays pending (so D4 would FAIL)
drop trigger prescriptions_settle_pharmacy_suggestions on public.prescriptions;
do $$ declare v_rx uuid := pg_temp.mkrx(pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('doc'), '[{"drug":"Amlodipine","dose":"5 mg"}]'::jsonb, 'signed'); begin
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.care_team_suggest_pharmacy(%L, %L, %L)::text$q$, v_rx, pg_temp.f('pC'), pg_temp.f('lC')));
  perform pg_temp.q_as(pg_temp.f('pat'), format($q$select public.patient_accept_pharmacy_suggestion(%L)$q$, (select id from public.prescription_pharmacy_suggestions where prescription_id = v_rx and status = 'pending')));
  perform pg_temp.ck('F', 'F3 SABOTAGE: without the settle trigger the accepted suggestion stays pending (so D4 would FAIL)', 'pending',
    (select status from public.prescription_pharmacy_suggestions where prescription_id = v_rx));
end $$;

\o
select phase, check_name, expected, actual from results where expected is distinct from actual order by phase, check_name;
do $$ declare v_bad text; begin
  select string_agg(phase || ' ' || check_name || ' expected=' || expected || ' actual=' || coalesce(actual, 'null'), E'\n') into v_bad from results where expected is distinct from actual;
  if v_bad is not null then raise exception E'HOLE OPEN:\n%', v_bad; end if;
end $$;
select phase, check_name, expected, actual, 'PASS' as verdict from results order by phase, check_name;
rollback;
