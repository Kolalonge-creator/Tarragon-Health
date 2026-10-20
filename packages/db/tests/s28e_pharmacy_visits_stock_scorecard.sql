-- S28e proof: pharmacy readiness and reach (migration *_s28e_pharmacy_visits_stock_scorecard.sql). OQ-275, spec 9.6 and 21.7, Part C.2.
-- INV-02 (a signed prescription is never altered), INV-07 (every notice is neutral), INV-10 (reads audited), INV-13 (is_test), INV-14 (go-live guard).
-- One rolled-back transaction, against the real migrations. Sections:
--   1. Shape: the new table, grants, versioned rules, no anon execute, the stock function takes no price.
--   2. One visit, several medicines: one pharmacy and one code for ticked prescriptions, all-or-nothing, owner only, size limits.
--   3. The counter: the code is checked once for the visit, wrong tries and the lock belong to the visit, each medicine is its own supply (full or
--      partial), a controlled medicine is refused for that medicine only, another pharmacy and a patient get nothing, the code is in no notice.
--   4. Stock confirmation: a plain yes or no, own pharmacy only, a controlled medicine is never confirmed, a change of pharmacy clears it.
--   5. Scorecard: turnaround to supply, flags, complaints and licence days; a pharmacy breach is a SUGGESTION and never suspends by itself (a
--      laboratory still does); test patients are left out; the desk read is admin or CMO only.
--   6. SABOTAGE: the visit-aware lock, the suggest-only rule and the stock reset removed; every one must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_name text, p_test boolean default true) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's28e-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, p_name, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true, full_name = excluded.full_name;
  return v;
end $f$;
-- a signed prescription (as the owner, no session) with its clinician medicine row. The item names the medicine under drug_name, as signing does.
create function pg_temp.mkrx(p_org uuid, p_pat uuid, p_doc uuid, p_drug text, p_state text) returns uuid language plpgsql as
$f$ declare v_rx uuid;
begin
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test)
  values (p_org, p_pat, jsonb_build_array(jsonb_build_object('drug_name', p_drug, 'dose', '5 mg', 'quantity', '30 tablets')), p_state::public.prescription_state,
          case when p_state = 'draft' then null else p_doc end, case when p_state = 'draft' then null else now() end, true) returning id into v_rx;
  if p_state <> 'draft' then
    insert into public.medications (organisation_id, patient_id, drug_name, dose, quantity, repeats_allowed, source, is_active, prescription_id)
    values (p_org, p_pat, p_drug, '5 mg', '30 tablets', 0, 'clinician', true, v_rx);
  end if;
  return v_rx;
end $f$;
create function pg_temp.rxstate(p_rx uuid) returns text language sql as $$ select state::text from public.prescriptions where id = p_rx $$;
create function pg_temp.code_of(p_rx uuid) returns text language sql as $$ select code from public.prescription_collection_codes where prescription_id = p_rx $$;
create function pg_temp.visit_of(p_rx uuid) returns uuid language sql as $$ select visit_id from public.prescription_collection_codes where prescription_id = p_rx $$;
create function pg_temp.verify_as(p_uid uuid, p_rx uuid, p_code text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select outcome from public.pharmacist_verify_collection(%L, %L)$q$, p_rx, p_code)) $$;
create function pg_temp.disp_as(p_uid uuid, p_rx uuid, p_code text, p_partial boolean, p_note text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select outcome from public.pharmacist_dispense_prescription(%L, %L, '30 tablets', %L, %L, 'B-1234', %L, 'PCN12345', 'Ada Pharmacist')$q$,
     p_rx, p_code, p_partial, p_note, (current_date + 400)::text)) $$;
create function pg_temp.visit_arr(p_ids uuid[], p_partner uuid, p_loc uuid) returns text language sql as
$$ select format($q$select public.patient_choose_pharmacy_for_visit(%L::uuid[], %L, %L)$q$, p_ids::text, p_partner, p_loc) $$;
-- Switch the S37 prescribing guard the way the guard's own trigger allows: a log row in this transaction, then the update.
create function pg_temp.guard(p_on boolean) returns void language plpgsql as $f$
begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
  values ('prescribing_enabled', case when p_on then 'switched_on' else 'switched_off' end, pg_temp.f('admin'), 'admin', 'S28e proof', '[]'::jsonb);
  update public.go_live_guards
     set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then pg_temp.f('admin') end, change_note = case when p_on then 'S28e proof' end
   where key = 'prescribing_enabled';
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid) returns uuid language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician', 'S28e ' || p_label);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S28e ' || p_label, 'MDCN', 'S28e-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer', 'contracted', 2, true, p_admin, true);
  return v;
end $f$;
create function pg_temp.mkpharm(p_name text, p_loc text, p_active boolean default true) returns uuid language plpgsql as $f$
declare v_p uuid; v_l uuid;
begin
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, license_expires_at, onboarding_status, state, city, area, nafdac_source_attested_at)
    values (p_name, p_active, now(), now(), current_date + 365, 'activated', 'Lagos', 'Lagos', 'Yaba', now()) returning id into v_p;
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state, address, is_active, verified_at) values (v_p, p_loc, 'Lagos', '1 Test Road', true, now()) returning id into v_l;
  perform pg_temp.setf('p:' || p_name, v_p); perform pg_temp.setf('l:' || p_name, v_l);
  return v_p;
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_pA uuid; v_pB uuid; v_pU uuid; v_doc uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', 'S28e Admin', false);   -- a REAL admin: the desk read and the guard log need one
  perform pg_temp.setf('admin', v_admin);
  v_pA := pg_temp.mkpharm('S28e A', 'S28e A Lekki'); v_pB := pg_temp.mkpharm('S28e B', 'S28e B Ikeja'); v_pU := pg_temp.mkpharm('S28e Unlisted', 'S28e U Yaba', false);
  perform pg_temp.setf('pA', v_pA); perform pg_temp.setf('lA', pg_temp.f('l:S28e A'));
  perform pg_temp.setf('pB', v_pB); perform pg_temp.setf('lB', pg_temp.f('l:S28e B'));
  perform pg_temp.setf('pU', v_pU); perform pg_temp.setf('lU', pg_temp.f('l:S28e Unlisted'));
  perform pg_temp.setf('phA', pg_temp.mkuser(v_org, 'phA', 'pharmacist', 'S28e Pharmacist A'));
  perform pg_temp.setf('phB', pg_temp.mkuser(v_org, 'phB', 'pharmacist', 'S28e Pharmacist B'));
  update public.profiles set pharmacy_partner_id = v_pA where id = pg_temp.f('phA');
  update public.profiles set pharmacy_partner_id = v_pB where id = pg_temp.f('phB');
  v_doc := pg_temp.mkdoc(v_org, 'doc', v_admin); perform pg_temp.setf('doc', v_doc);
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient', 'S28e Patient'));
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient', 'S28e Other Patient'));
  perform pg_temp.setf('stranger', pg_temp.mkuser(v_org, 'stranger', 'patient', 'S28e Stranger'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, pg_temp.f('pat'), v_doc, now());
  perform pg_temp.setf('cg', pg_temp.mkuser(v_org, 'cg', 'patient', 'S28e Caregiver'));
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions, expires_at)
    values (pg_temp.f('pat'), pg_temp.f('cg'), 'manage', pg_temp.f('pat'), array['manage_pharmacy']::public.caregiver_permission[], null);
end $$;

-- 1. Shape ---------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('real', '1a the visits table has RLS and no anon or direct write', 'true|false|false|false',
    (select relrowsecurity::text from pg_class where oid = 'public.pharmacy_collection_visits'::regclass) || '|' ||
    has_table_privilege('anon', 'public.pharmacy_collection_visits', 'SELECT')::text || '|' ||
    has_table_privilege('authenticated', 'public.pharmacy_collection_visits', 'INSERT')::text || '|' ||
    has_table_privilege('authenticated', 'public.pharmacy_collection_visits', 'UPDATE')::text);
  perform pg_temp.ck('real', '1b none of the eight new functions can be called by anon, all by a signed-in user', '0|8',
    (select count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))::text || '|' || count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
         ('patient_choose_pharmacy_for_visit', 'patient_collection_visit', 'patient_collection_overview', 'patient_new_visit_code', 'pharmacist_confirm_stock', 'pharmacist_collection_extras', 'pharmacist_verify_visit', 'pharmacy_scorecard')));
  perform pg_temp.ck('real', '1c exactly one active pharmacy configuration, version 3 or later, with a visit size of at least 2', '1|true',
    (select count(*)::text || '|' || (max((config ->> 'max_items_per_visit')::integer) >= 2)::text from public.pharmacy_config where is_active));
  perform pg_temp.ck('real', '1d the older rules are unchanged in the active version', '8|14|5|14',
    (select (config ->> 'code_length') || '|' || (config ->> 'code_valid_days') || '|' || (config ->> 'max_wrong_attempts') || '|' || (config ->> 'suggestion_valid_days') from public.pharmacy_config where is_active));
  perform pg_temp.ck('real', '1e the stock function takes a prescription and a yes or no, and nothing else (no price, no quantity)', 'p_prescription uuid, p_in_stock boolean',
    pg_get_function_arguments('public.pharmacist_confirm_stock(uuid,boolean)'::regprocedure));
  perform pg_temp.ck('real', '1f one active partner quality version; the pharmacy is suggest-only and the laboratory is not', 'true|true|true',
    (select ((rules #> '{removal,suggest_only_kinds}') = '["pharmacy"]'::jsonb)::text || '|' || ((rules #> '{removal,suspend_on}') @> '["licence_expired"]'::jsonb)::text || '|' || (count(*) over () = 1)::text
       from public.partner_quality_config where is_active));
  perform pg_temp.ck('real', '1g the new patient table is in the data registry', '1',
    (select count(*)::text from public.data_registry where table_name = 'pharmacy_collection_visits'));
  perform pg_temp.ck('real', '1h the go-live guard was not touched by the migration: it starts off', 'false', (select is_on::text from public.go_live_guards where key = 'prescribing_enabled'));
end $$;

-- 2. One visit, several medicines ---------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2'); v_doc uuid := pg_temp.f('doc');
  pA uuid := pg_temp.f('pA'); lA uuid := pg_temp.f('lA'); pU uuid := pg_temp.f('pU'); lU uuid := pg_temp.f('lU');
  rx1 uuid; rx2 uuid; rx3 uuid; rxX uuid; rxY uuid; rxO uuid; rxD uuid; v_code text; v_ids uuid[];
begin
  rx1 := pg_temp.mkrx(v_org, v_pat, v_doc, 'Amlodipine', 'signed'); rx2 := pg_temp.mkrx(v_org, v_pat, v_doc, 'Losartan', 'signed');
  rx3 := pg_temp.mkrx(v_org, v_pat, v_doc, 'Metformin', 'signed'); rxX := pg_temp.mkrx(v_org, v_pat, v_doc, 'Atorvastatin', 'signed');
  perform pg_temp.setf('rx1', rx1); perform pg_temp.setf('rx2', rx2); perform pg_temp.setf('rx3', rx3); perform pg_temp.setf('rxX', rxX);
  perform pg_temp.ck('real', '2a while the go-live guard is off the visit door refuses', 'ERR:55000', pg_temp.q_as(v_pat, pg_temp.visit_arr(array[rx1, rx2], pA, lA)));
  perform pg_temp.ck('real', '2a2 ...and so does the overview', 'ERR:55000', pg_temp.q_as(v_pat, 'select count(*)::text from public.patient_collection_overview()'));
  perform pg_temp.guard(true);

  v_code := pg_temp.q_as(v_pat, pg_temp.visit_arr(array[rx1, rx2, rx3], pA, lA));
  perform pg_temp.setf('V1', pg_temp.visit_of(rx1));
  perform pg_temp.ck('real', '2b the patient sends three medicines in one call and gets one code of eight characters', '8', length(v_code)::text);
  perform pg_temp.ck('real', '2c all three are sent to the pharmacy', 'sent,sent,sent', (select string_agg(state::text, ',') from public.prescriptions where id in (rx1, rx2, rx3)));
  perform pg_temp.ck('real', '2d they share one code and one visit, and it is the code she was given', '1|1|3|true',
    (select count(distinct code)::text || '|' || count(distinct visit_id)::text || '|' || count(*) filter (where visit_id is not null)::text || '|' || bool_and(code = v_code)::text
       from public.prescription_collection_codes where prescription_id in (rx1, rx2, rx3)));
  perform pg_temp.ck('real', '2e the visit row carries the same code, the pharmacy and the patient', 'true',
    (select (pharmacy_partner_id = pA and patient_id = v_pat and wrong_attempts = 0 and locked_at is null)::text from public.pharmacy_collection_visits where id = pg_temp.f('V1')));
  perform pg_temp.ck('real', '2e2 the visit row holds no copy of the code: the secret lives on the members only', 'false|false',
    (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pharmacy_collection_visits' and column_name = 'code'))::text || '|' ||
    (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pharmacy_collection_visits' and column_name = 'code_expires_at'))::text);
  perform pg_temp.ck('real', '2f the patient reads her own visit; a stranger, another patient and the pharmacy read none', '1|0|0|0',
    pg_temp.q_as(v_pat, 'select count(*)::text from public.pharmacy_collection_visits') || '|' || pg_temp.q_as(pg_temp.f('stranger'), 'select count(*)::text from public.pharmacy_collection_visits') || '|' ||
    pg_temp.q_as(v_pat2, 'select count(*)::text from public.pharmacy_collection_visits') || '|' || pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.pharmacy_collection_visits'));
  perform pg_temp.ck('real', '2g her overview shows the three sent medicines with the code and the unsent one, by name', '3|1|Amlodipine',
    pg_temp.q_as(v_pat, 'select count(*) filter (where state = ''sent'')::text from public.patient_collection_overview()') || '|' ||
    pg_temp.q_as(v_pat, 'select count(*) filter (where state = ''signed'')::text from public.patient_collection_overview()') || '|' ||
    pg_temp.q_as(v_pat, format($q$select medicine from public.patient_collection_overview() where prescription_id = %L$q$, rx1)));
  perform pg_temp.ck('real', '2h she sees the three that share the code; a stranger sees none', '3|0',
    pg_temp.q_as(v_pat, format($q$select count(*)::text from public.patient_collection_visit(%L)$q$, rx1)) || '|' || pg_temp.q_as(pg_temp.f('stranger'), format($q$select count(*)::text from public.patient_collection_visit(%L)$q$, rx1)));
  perform pg_temp.ck('real', '2h2 a caregiver acting for her is shown none of her other waiting medicines or their names (they can be a confidential category)', '0|0|ERR:42501',
    pg_temp.q_as(pg_temp.f('cg'), format($q$select count(*)::text from public.patient_collection_overview(%L)$q$, v_pat)) || '|' ||
    pg_temp.q_as(pg_temp.f('cg'), format($q$select count(*)::text from public.patient_collection_visit(%L, %L)$q$, rx1, v_pat)) || '|' ||
    pg_temp.q_as(pg_temp.f('stranger'), format($q$select count(*)::text from public.patient_collection_overview(%L)$q$, v_pat)));
  perform pg_temp.ck('real', '2i the pharmacy sees the three as one visit; the other pharmacy sees nothing', '1|3|0|0',
    pg_temp.q_as(pg_temp.f('phA'), 'select count(distinct visit_id)::text from public.pharmacist_collection_extras()') || '|' || pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.pharmacist_collection_extras()') || '|' ||
    pg_temp.q_as(pg_temp.f('phB'), 'select count(distinct visit_id)::text from public.pharmacist_collection_extras()') || '|' || pg_temp.q_as(pg_temp.f('phB'), 'select count(*)::text from public.pharmacist_collection_extras()'));
  perform pg_temp.ck('real', '2j the extras answer carries ids and a time only: no name, no code, no medicine', 'prescription_id,visit_id,stock_confirmed_at',
    (select string_agg(n.nm, ',' order by n.ord) from pg_proc p cross join lateral unnest(p.proargnames) with ordinality n(nm, ord)
      where p.proname = 'pharmacist_collection_extras' and p.pronamespace = 'public'::regnamespace));
  perform pg_temp.ck('real', '2k a signed prescription is not altered by being sent in a visit (INV-02)', 'Amlodipine|5 mg',
    (select (items -> 0 ->> 'drug_name') || '|' || (items -> 0 ->> 'dose') from public.prescriptions where id = rx1));

  -- all or nothing, owner only, size limits
  rxY := pg_temp.mkrx(v_org, v_pat, v_doc, 'Y drug', 'signed'); rxO := pg_temp.mkrx(v_org, v_pat2, v_doc, 'Other patient drug', 'signed'); rxD := pg_temp.mkrx(v_org, v_pat, v_doc, 'Draft drug', 'draft');
  perform pg_temp.setf('rxY', rxY);
  perform pg_temp.ck('real', '2l someone else''s prescription in the list stops the whole call', 'ERR:42501|signed',
    pg_temp.q_as(v_pat, pg_temp.visit_arr(array[rxY, rxO], pA, lA)) || '|' || pg_temp.rxstate(rxY));
  perform pg_temp.ck('real', '2m a prescription that cannot be sent stops the whole call and nothing is half sent', 'ERR:22023|signed',
    pg_temp.q_as(v_pat, pg_temp.visit_arr(array[rxY, rxD], pA, lA)) || '|' || pg_temp.rxstate(rxY));
  perform pg_temp.ck('real', '2n a pharmacy that cannot be chosen stops the whole call', 'ERR:22023|signed',
    pg_temp.q_as(v_pat, pg_temp.visit_arr(array[rxY, rxX], pU, lU)) || '|' || pg_temp.rxstate(rxY));
  perform pg_temp.ck('real', '2o one prescription is not a visit; the same one twice is not a visit', 'ERR:22023|ERR:22023',
    pg_temp.q_as(v_pat, pg_temp.visit_arr(array[rxY], pA, lA)) || '|' || pg_temp.q_as(v_pat, pg_temp.visit_arr(array[rxY, rxY], pA, lA)));
  select array(select gen_random_uuid() from generate_series(1, 11)) into v_ids;
  perform pg_temp.ck('real', '2p more than the configured limit is refused before anything is read', 'ERR:22023', pg_temp.q_as(v_pat, pg_temp.visit_arr(v_ids, pA, lA)));
  perform pg_temp.ck('real', '2q a stranger cannot send the patient''s medicines, and a patient cannot send another patient''s', 'ERR:42501|ERR:42501',
    pg_temp.q_as(pg_temp.f('stranger'), pg_temp.visit_arr(array[rxY, rxX], pA, lA)) || '|' || pg_temp.q_as(v_pat2, pg_temp.visit_arr(array[rxY, rxX], pA, lA)));
  perform pg_temp.ck('real', '2r anon cannot call the door at all', 'ERR:42501', pg_temp.anon_q(pg_temp.visit_arr(array[rx1, rx2], pA, lA)));
  perform pg_temp.ck('real', '2s the choice was audited once for the visit, with a count and no medicine', '1|false',
    (select count(*)::text || '|' || bool_or(event::text ilike '%Amlodipine%')::text from public.audit_log where action = 'prescription.pharmacy_visit_chosen' and entity_id = pg_temp.f('V1')));
  -- the old name key and the new one both give a label
  perform pg_temp.ck('real', '2t the item label reads drug_name, then the older keys', 'Amlodipine|Old name|Older',
    private.rx_item_label('[{"drug_name":"Amlodipine"}]'::jsonb) || '|' || private.rx_item_label('[{"name":"Old name"}]'::jsonb) || '|' || private.rx_item_label('[{"drug":"Older"}]'::jsonb));
end $$;

-- 3. The counter ----------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); phA uuid := pg_temp.f('phA'); phB uuid := pg_temp.f('phB');
  pA uuid := pg_temp.f('pA'); lA uuid := pg_temp.f('lA');
  rx1 uuid := pg_temp.f('rx1'); rx2 uuid := pg_temp.f('rx2'); rx3 uuid := pg_temp.f('rx3'); V uuid := pg_temp.f('V1');
  v_right text := pg_temp.code_of(pg_temp.f('rx1')); v_new text; v_v2 uuid; v_c2 text; rxC uuid; rxM uuid; v_v3 uuid; v_c3 text; i integer;
begin
  perform pg_temp.ck('real', '3a a wrong code is answered, not raised, so the try is kept', 'wrong_code',
    pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_verify_visit(%L, 'WRONG123')$q$, V)));
  perform pg_temp.ck('real', '3b the wrong try is counted ONCE for the visit and shown on every member', '1|1,1,1',
    (select wrong_attempts::text from public.pharmacy_collection_visits where id = V) || '|' || (select string_agg(wrong_attempts::text, ',') from public.prescription_collection_codes where visit_id = V));
  for i in 2 .. 4 loop perform pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_verify_visit(%L, 'WRONG123')$q$, V)); end loop;
  perform pg_temp.ck('real', '3c the fifth wrong try locks the visit', 'locked',
    pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_verify_visit(%L, 'WRONG123')$q$, V)));
  perform pg_temp.ck('real', '3d the lock closes the visit and every waiting member', 'true|3',
    (select (locked_at is not null)::text from public.pharmacy_collection_visits where id = V) || '|' || (select count(*)::text from public.prescription_collection_codes where visit_id = V and locked_at is not null));
  update public.prescription_collection_codes set locked_at = null where prescription_id = rx2;   -- the member's copy of the lock missing, as when a call skipped a held row
  perform pg_temp.ck('real', '3d2 every reader that shows "locked" reads the visit''s own lock: the pharmacy list and the patient''s single page, even where the member copy is missing', 'true|true',
    pg_temp.q_as(phA, format($q$select bool_and(code_locked)::text from public.pharmacist_prescriptions() where prescription_id in (%L, %L, %L)$q$, rx1, rx2, rx3)) || '|' ||
    pg_temp.q_as(v_pat, format($q$select locked::text from public.patient_prescription_collection(%L)$q$, rx2)));
  update public.prescription_collection_codes set locked_at = now() where prescription_id = rx2;
  perform pg_temp.ck('real', '3e the right code does not open a locked visit', 'locked', pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_verify_visit(%L, %L)$q$, V, v_right)));
  perform pg_temp.ck('real', '3f ...nor through a single member (cycling through the members gives no more guesses)', 'locked',
    pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_verify_collection(%L, %L)$q$, rx2, v_right)));
  perform pg_temp.ck('real', '3g ...nor a supply', 'locked', pg_temp.disp_as(phA, rx2, v_right, false, null));

  -- a new code for ONE medicine takes it out of the visit and unlocks it; the others stay locked
  v_new := pg_temp.q_as(v_pat, format($q$select public.patient_new_collection_code(%L)$q$, rx1));
  perform pg_temp.ck('real', '3h a new code for one medicine leaves the visit; the others stay in it, still locked', 'true|true|2',
    (v_new is not null and v_new not like 'ERR:%')::text || '|' || (pg_temp.visit_of(rx1) is null)::text || '|' ||
    (select count(*)::text from public.prescription_collection_codes where visit_id = V and locked_at is not null));
  perform pg_temp.ck('real', '3i the new code opens that one medicine', 'ok', pg_temp.verify_as(phA, rx1, v_new));

  -- sending the other two again makes a new visit with a new code
  v_c2 := pg_temp.q_as(v_pat, pg_temp.visit_arr(array[rx2, rx3], pA, lA));
  v_v2 := pg_temp.visit_of(rx2);
  perform pg_temp.ck('real', '3j sending the two again makes one new visit and a new code; the old visit has no members', 'true|2|0',
    (v_v2 is not null and v_v2 <> V and v_c2 <> v_right)::text || '|' || (select count(*)::text from public.prescription_collection_codes where visit_id = v_v2) || '|' ||
    (select count(*)::text from public.prescription_collection_codes where visit_id = V));
  perform pg_temp.ck('real', '3k the new visit opens with its code: both medicines answer ok, with the patient shown', '2|2|S28e Patient',
    pg_temp.q_as(phA, format($q$select count(*)::text from public.pharmacist_verify_visit(%L, %L) where item_outcome = 'ok'$q$, v_v2, v_c2)) || '|' ||
    pg_temp.q_as(phA, format($q$select count(*)::text from public.pharmacist_verify_visit(%L, %L) where outcome = 'ok'$q$, v_v2, v_c2)) || '|' ||
    pg_temp.q_as(phA, format($q$select min(patient_name) from public.pharmacist_verify_visit(%L, %L)$q$, v_v2, v_c2)));
  perform pg_temp.setf('V2', v_v2);

  -- each medicine is its own supply
  perform pg_temp.ck('real', '3l a full supply of one medicine records it and moves only that prescription to dispensed', 'recorded|dispensed|sent',
    pg_temp.disp_as(phA, rx2, v_c2, false, null) || '|' || pg_temp.rxstate(rx2) || '|' || pg_temp.rxstate(rx3));
  perform pg_temp.ck('real', '3m it is one row in the same supply table the QR and phone-desk paths count, and the shared count falls to zero', '1|0',
    (select count(*)::text from public.pharmacy_order_dispenses d join public.medications m on m.id = d.medication_id where m.prescription_id = rx2 and d.source = 'pharmacy') || '|' || private.supplies_remaining(rx2)::text);
  perform pg_temp.ck('real', '3n a partial supply of the other needs the written note, then records and keeps it waiting', 'invalid|partial_recorded|sent',
    pg_temp.disp_as(phA, rx3, v_c2, true, null) || '|' || pg_temp.disp_as(phA, rx3, v_c2, true, 'Ten tablets owed, back on Friday') || '|' || pg_temp.rxstate(rx3));
  perform pg_temp.ck('real', '3o the visit now offers only the medicine still waiting', '1', pg_temp.q_as(phA, format($q$select count(*)::text from public.pharmacist_verify_visit(%L, %L)$q$, v_v2, v_c2)));
  perform pg_temp.ck('real', '3p a supply already made cannot be made again through the visit', 'not_found', pg_temp.disp_as(phA, rx2, v_c2, false, null));

  -- a controlled medicine stops only that medicine
  rxC := pg_temp.mkrx(v_org, v_pat, v_doc, 'Morphine sulfate', 'signed'); rxM := pg_temp.mkrx(v_org, v_pat, v_doc, 'Cetirizine', 'signed');
  v_c3 := pg_temp.q_as(v_pat, pg_temp.visit_arr(array[rxC, rxM], pA, lA)); v_v3 := pg_temp.visit_of(rxC);
  perform pg_temp.ck('real', '3q the controlled medicine is refused for that medicine, shows nothing about the patient, and the other is still offered', '1|1|1',
    pg_temp.q_as(phA, format($q$select count(*)::text from public.pharmacist_verify_visit(%L, %L) where item_outcome = 'controlled_medicine' and patient_name is null and items is null$q$, v_v3, v_c3)) || '|' ||
    pg_temp.q_as(phA, format($q$select count(*)::text from public.pharmacist_verify_visit(%L, %L) where item_outcome = 'ok'$q$, v_v3, v_c3)) || '|' ||
    pg_temp.q_as(phA, format($q$select count(*)::text from public.pharmacist_verify_visit(%L, %L) where prescription_id = %L and item_outcome = 'controlled_medicine'$q$, v_v3, v_c3, rxC)));
  perform pg_temp.ck('real', '3r supplying the controlled one is refused and records nothing; the other can be supplied', 'controlled_medicine|0|recorded',
    pg_temp.disp_as(phA, rxC, v_c3, false, null) || '|' ||
    (select count(*)::text from public.pharmacy_order_dispenses d join public.medications m on m.id = d.medication_id where m.prescription_id = rxC) || '|' || pg_temp.disp_as(phA, rxM, v_c3, false, null));
  perform pg_temp.ck('real', '3s each refusal was audited', 'true',
    ((select count(*) from public.audit_log where action = 'pharmacy.controlled_medicine_refused' and entity_id = rxC) >= 2)::text);

  -- who can do what
  perform pg_temp.ck('real', '3t another pharmacy gets not_found, a patient is refused, anon is refused', 'not_found|ERR:42501|ERR:42501',
    pg_temp.q_as(phB, format($q$select outcome from public.pharmacist_verify_visit(%L, %L)$q$, v_v3, v_c3)) || '|' ||
    pg_temp.q_as(v_pat, format($q$select outcome from public.pharmacist_verify_visit(%L, %L)$q$, v_v3, v_c3)) || '|' ||
    pg_temp.anon_q(format($q$select outcome from public.pharmacist_verify_visit(%L, %L)$q$, v_v3, v_c3)));
  perform pg_temp.ck('real', '3u the code is in no notice and no audit entry (INV-07)', '0|0',
    (select count(*)::text from public.notifications where payload::text like '%' || v_c2 || '%' or payload::text like '%' || v_c3 || '%') || '|' ||
    (select count(*)::text from public.audit_log where event::text like '%' || v_c2 || '%' or event::text like '%' || v_c3 || '%'));
  perform pg_temp.ck('real', '3v the wrong tries were audited and marked as a visit', 'true',
    ((select count(*) from public.audit_log where action = 'pharmacy.collection_code_failed' and entity_id in (rx1, rx2, rx3) and (event ->> 'visit')::boolean) >= 5)::text);
  perform pg_temp.ck('real', '3w opening an item through the visit is audited as a pharmacist read (INV-10)', 'true',
    ((select count(*) from public.audit_log where action = 'pharmacy.prescription_opened' and entity_id = rx3 and (event ->> 'visit')::boolean) >= 1)::text);
end $$;

-- 3b. A new code for the whole visit keeps the visit together
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); phA uuid := pg_temp.f('phA'); cg uuid := pg_temp.f('cg');
  pA uuid := pg_temp.f('pA'); lA uuid := pg_temp.f('lA'); r1 uuid; r2 uuid; r3 uuid; v_ghost uuid; v_old text; v_new text; v_vr uuid; n0 integer; v_chosen timestamptz; i integer;
begin
  r1 := pg_temp.mkrx(v_org, v_pat, v_doc, 'Renew drug one', 'signed'); r2 := pg_temp.mkrx(v_org, v_pat, v_doc, 'Renew drug two', 'signed');
  r3 := pg_temp.mkrx(v_org, v_pat, v_doc, 'Renew drug alone', 'signed');
  perform pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, r3, pA, lA));
  v_old := pg_temp.q_as(v_pat, pg_temp.visit_arr(array[r1, r2], pA, lA)); v_vr := pg_temp.visit_of(r1);
  perform pg_temp.q_as(phA, format($q$select public.pharmacist_confirm_stock(%L, true)$q$, r1));
  for i in 1 .. 5 loop perform pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_verify_visit(%L, 'WRONG123')$q$, v_vr)); end loop;
  perform pg_temp.ck('real', '3x the visit is locked, and the patient''s overview shows it locked on every medicine', 'true|2',
    (select (locked_at is not null)::text from public.pharmacy_collection_visits where id = v_vr) || '|' ||
    pg_temp.q_as(v_pat, format($q$select count(*)::text from public.patient_collection_overview() where visit_id = %L and locked$q$, v_vr)));
  select count(*) into n0 from public.notifications where template = 'pharmacy_new_prescription';
  select chosen_by_patient_at into v_chosen from public.prescriptions where id = r1;
  v_new := pg_temp.q_as(v_pat, format($q$select public.patient_new_visit_code(%L)$q$, r1));
  perform pg_temp.ck('real', '3y a new visit code is one new code on every member, still in the same visit, lock cleared', 'true|1|1|2|true',
    (v_new is not null and v_new not like 'ERR:%' and v_new <> v_old)::text || '|' ||
    (select count(distinct code)::text from public.prescription_collection_codes where visit_id = v_vr) || '|' ||
    (select count(distinct visit_id)::text from public.prescription_collection_codes where prescription_id in (r1, r2)) || '|' ||
    (select count(*)::text from public.prescription_collection_codes where visit_id = v_vr and locked_at is null and wrong_attempts = 0) || '|' ||
    (select (locked_at is null and wrong_attempts = 0)::text from public.pharmacy_collection_visits where id = v_vr));
  perform pg_temp.ck('real', '3z it keeps the pharmacy''s stock answer, resends nothing (no new pharmacy notice, same send time)', 'true|0|true',
    (select (stock_confirmed_at is not null)::text from public.prescription_collection_codes where prescription_id = r1) || '|' ||
    ((select count(*) from public.notifications where template = 'pharmacy_new_prescription') - n0)::text || '|' ||
    ((select chosen_by_patient_at from public.prescriptions where id = r1) = v_chosen)::text);
  perform pg_temp.ck('real', '3aa the old code is dead and the new one opens both', 'wrong_code|2',
    pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_verify_visit(%L, %L)$q$, v_vr, v_old)) || '|' ||
    pg_temp.q_as(phA, format($q$select count(*)::text from public.pharmacist_verify_visit(%L, %L) where item_outcome = 'ok'$q$, v_vr, v_new)));
  perform pg_temp.ck('real', '3ab only the patient can renew the visit code; a stranger, anon and a caregiver cannot; a prescription sent alone has no visit (a stranger learns nothing: not open)', 'ERR:22023|ERR:42501|ERR:22023|ERR:42501',
    pg_temp.q_as(pg_temp.f('stranger'), format($q$select public.patient_new_visit_code(%L)$q$, r1)) || '|' || pg_temp.anon_q(format($q$select public.patient_new_visit_code(%L)$q$, r1)) || '|' ||
    pg_temp.q_as(v_pat, format($q$select public.patient_new_visit_code(%L)$q$, r3)) || '|' ||
    pg_temp.q_as(cg, format($q$select public.patient_new_visit_code(%L, %L)$q$, r1, v_pat)));
  perform pg_temp.ck('real', '3ac the renewal was audited', 'true',
    ((select count(*) from public.audit_log where action = 'prescription.visit_code_renewed' and entity_id = v_vr) >= 1)::text);
  -- fail closed: a code row that points at a visit its own pharmacy cannot see is not_found, never tried without a count
  insert into public.pharmacy_collection_visits (organisation_id, patient_id, pharmacy_partner_id, pharmacy_location_id, is_test)
    values (v_org, v_pat, pg_temp.f('pB'), pg_temp.f('lB'), true) returning id into v_ghost;
  update public.prescription_collection_codes set visit_id = v_ghost where prescription_id = r3;
  perform pg_temp.ck('real', '3ae a code row pointing at a visit its pharmacy cannot see fails closed: not_found and no free guesses', 'not_found|0',
    pg_temp.verify_as(phA, r3, 'WRONG123') || '|' || (select wrong_attempts::text from public.prescription_collection_codes where prescription_id = r3));
  update public.prescription_collection_codes set visit_id = null where prescription_id = r3;
  perform pg_temp.ck('real', '3ad a caregiver may not send several medicines together or renew the visit-wide code (one code would open every medicine, including ones hidden from her)', 'ERR:42501|ERR:42501',
    pg_temp.q_as(cg, format($q$select public.patient_new_visit_code(%L, %L)$q$, r1, v_pat)) || '|' ||
    pg_temp.q_as(cg, format($q$select public.patient_choose_pharmacy_for_visit(array[%L, %L]::uuid[], %L, %L, %L)$q$, r1, r2, pA, lA, v_pat)));
end $$;

-- 4. Stock confirmation ---------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); phA uuid := pg_temp.f('phA'); phB uuid := pg_temp.f('phB');
  pA uuid := pg_temp.f('pA'); lA uuid := pg_temp.f('lA'); pB uuid := pg_temp.f('pB'); lB uuid := pg_temp.f('lB');
  rxS uuid; rxT uuid; rxK uuid; n0 integer; n1 integer;
begin
  rxS := pg_temp.mkrx(v_org, v_pat, v_doc, 'Stock drug', 'signed'); rxT := pg_temp.mkrx(v_org, v_pat, v_doc, 'Second stock drug', 'signed'); rxK := pg_temp.mkrx(v_org, v_pat, v_doc, 'Tramadol 50 mg', 'signed');
  perform pg_temp.setf('rxS', rxS); perform pg_temp.setf('rxT', rxT);
  perform pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rxS, pA, lA));
  perform pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rxT, pA, lA));
  perform pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rxK, pA, lA));
  perform pg_temp.ck('real', '4a another pharmacy cannot answer for it; a patient and anon are refused', 'not_found|ERR:42501|ERR:42501',
    pg_temp.q_as(phB, format($q$select public.pharmacist_confirm_stock(%L, true)$q$, rxS)) || '|' || pg_temp.q_as(v_pat, format($q$select public.pharmacist_confirm_stock(%L, true)$q$, rxS)) || '|' ||
    pg_temp.anon_q(format($q$select public.pharmacist_confirm_stock(%L, true)$q$, rxS)));
  select count(*) into n0 from public.notifications where recipient_id = v_pat and template = 'pharmacy_collection_update';
  perform pg_temp.ck('real', '4b the pharmacy says yes: confirmed and stamped', 'confirmed|true', pg_temp.q_as(phA, format($q$select public.pharmacist_confirm_stock(%L, true)$q$, rxS)) || '|' ||
    (select (stock_confirmed_at is not null)::text from public.prescription_collection_codes where prescription_id = rxS));
  select count(*) into n1 from public.notifications where recipient_id = v_pat and template = 'pharmacy_collection_update';
  perform pg_temp.ck('real', '4c the patient got one neutral notice', '1', (n1 - n0)::text);
  perform pg_temp.ck('real', '4c2 a second yes is still confirmed and tells nobody again', 'confirmed|0',
    pg_temp.q_as(phA, format($q$select public.pharmacist_confirm_stock(%L, true)$q$, rxS)) || '|' ||
    ((select count(*) from public.notifications where recipient_id = v_pat and template = 'pharmacy_collection_update') - n1)::text);
  perform pg_temp.ck('real', '4d the patient sees the yes on her own overview', 'true',
    pg_temp.q_as(v_pat, format($q$select (stock_confirmed_at is not null)::text from public.patient_collection_overview() where prescription_id = %L$q$, rxS)));
  perform pg_temp.ck('real', '4e the confirmation answer was audited', 'true',
    ((select count(*) from public.audit_log where action = 'pharmacy.stock_answered' and entity_id = rxS and (event ->> 'in_stock')::boolean) >= 1)::text);
  perform pg_temp.ck('real', '4f a controlled medicine is never confirmed and is audited', 'controlled_medicine|false|true',
    pg_temp.q_as(phA, format($q$select public.pharmacist_confirm_stock(%L, true)$q$, rxK)) || '|' || (select (stock_confirmed_at is not null)::text from public.prescription_collection_codes where prescription_id = rxK) || '|' ||
    ((select count(*) from public.audit_log where action = 'pharmacy.controlled_medicine_refused' and entity_id = rxK and event ->> 'step' = 'stock') >= 1)::text);
  perform pg_temp.ck('real', '4f2 a no for a controlled medicine is not an out-of-stock report either: no flag, no task, nothing recorded but the refusal', 'controlled_medicine|0|0',
    pg_temp.q_as(phA, format($q$select public.pharmacist_confirm_stock(%L, false)$q$, rxK)) || '|' ||
    (select count(*)::text from public.prescription_pharmacy_flags where prescription_id = rxK) || '|' ||
    (select count(*)::text from public.clinical_tasks where patient_id = v_pat and type = 'pharmacy_flag_review'));
  perform pg_temp.ck('real', '4g a null answer is refused', 'ERR:22023', pg_temp.q_as(phA, format($q$select public.pharmacist_confirm_stock(%L, null)$q$, rxT)));
  perform pg_temp.ck('real', '4h a no is the existing out-of-stock report: the patient is told and needs another pharmacy', 'out_of_stock|1|true|false',
    pg_temp.q_as(phA, format($q$select public.pharmacist_confirm_stock(%L, false)$q$, rxT)) || '|' ||
    (select count(*)::text from public.prescription_pharmacy_flags where prescription_id = rxT and kind = 'out_of_stock') || '|' ||
    pg_temp.q_as(v_pat, format($q$select other_pharmacy_needed::text from public.patient_collection_overview() where prescription_id = %L$q$, rxT)) || '|' ||
    (select (stock_confirmed_at is not null)::text from public.prescription_collection_codes where prescription_id = rxT));
  perform pg_temp.ck('real', '4h2 a no cannot be taken back: a later yes for the same send is refused and the stock stays unanswered', 'already_reported|false|1',
    pg_temp.q_as(phA, format($q$select public.pharmacist_confirm_stock(%L, true)$q$, rxT)) || '|' ||
    (select (stock_confirmed_at is not null)::text from public.prescription_collection_codes where prescription_id = rxT) || '|' ||
    (select count(*)::text from public.prescription_pharmacy_flags where prescription_id = rxT and kind = 'out_of_stock'));
  -- a change of pharmacy clears the yes
  perform pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rxS, pB, lB));
  perform pg_temp.ck('real', '4i changing pharmacy clears the stock answer and takes the prescription out of any visit', 'true|true',
    (select (stock_confirmed_at is null)::text from public.prescription_collection_codes where prescription_id = rxS) || '|' || (pg_temp.visit_of(rxS) is null)::text);
  perform pg_temp.ck('real', '4j the new pharmacy has no answer yet and the old one cannot answer any more', 'not_found',
    pg_temp.q_as(phA, format($q$select public.pharmacist_confirm_stock(%L, true)$q$, rxS)));
  perform pg_temp.guard(false);
  perform pg_temp.ck('real', '4k with the go-live guard off the stock answer refuses', 'ERR:55000', pg_temp.q_as(phB, format($q$select public.pharmacist_confirm_stock(%L, true)$q$, rxS)));
  perform pg_temp.guard(true);
end $$;

-- 5. Scorecard ------------------------------------------------------------------------------------------------------------------------
-- a dispensed prescription with chosen timing, inserted with triggers off (the fixture is history, not a live transition)
create function pg_temp.mkdispensed(p_org uuid, p_pat uuid, p_doc uuid, p_partner uuid, p_hours numeric, p_chosen_hours numeric default null) returns void language plpgsql as
$f$ begin
  set local session_replication_role = replica;
  -- sent_at 20 days ago; dispensed p_hours later; if p_chosen_hours is given the patient chose THIS pharmacy only that many hours before the supply
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test, pharmacy_partner_id, sent_at, dispensed_at, chosen_by_patient_at)
  values (p_org, p_pat, jsonb_build_array(jsonb_build_object('drug_name', 'History drug')), 'dispensed', p_doc, now() - interval '30 days', true, p_partner,
          now() - interval '20 days', now() - interval '20 days' + make_interval(secs => (p_hours * 3600)::integer),
          case when p_chosen_hours is null then null else now() - interval '20 days' + make_interval(secs => ((p_hours - p_chosen_hours) * 3600)::integer) end);
  set local session_replication_role = origin;
end $f$;
create function pg_temp.mksent(p_org uuid, p_pat uuid, p_doc uuid, p_partner uuid, p_loc uuid, p_oos boolean, p_test boolean) returns void language plpgsql as
$f$ declare v_rx uuid;
begin
  set local session_replication_role = replica;
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test, pharmacy_partner_id, pharmacy_location_id, sent_at)
  values (p_org, p_pat, jsonb_build_array(jsonb_build_object('drug_name', 'Sent drug')), 'sent', p_doc, now() - interval '5 days', true, p_partner, p_loc, now() - interval '5 days') returning id into v_rx;
  insert into public.prescription_collection_codes (prescription_id, organisation_id, patient_id, pharmacy_partner_id, pharmacy_location_id, code, code_expires_at, is_test)
  values (v_rx, p_org, p_pat, p_partner, p_loc, 'ZZZZ' || substr(replace(v_rx::text, '-', ''), 1, 4), now() + interval '9 days', p_test);
  if p_oos then
    insert into public.prescription_pharmacy_flags (organisation_id, prescription_id, pharmacy_partner_id, flagged_by, kind, reason, is_test)
    values (p_org, v_rx, p_partner, pg_temp.f('admin'), 'out_of_stock', 'The pharmacy cannot supply this item', p_test);
  end if;
  set local session_replication_role = origin;
end $f$;
create function pg_temp.status_of(p_kind text, p_id uuid) returns text language sql as
$$ select coalesce((select state from public.partner_work_status where partner_kind = p_kind and partner_id = p_id), 'open') $$;
create function pg_temp.quality_of(p_id uuid, p_col text) returns text language plpgsql as
$f$ declare r text; begin execute format('select %I::text from public.partner_quality where partner_kind = ''pharmacy'' and partner_id = %L order by period_month desc limit 1', p_col, p_id) into r; return r; end $f$;

do $$
declare v_org uuid := pg_temp.f('org'); v_doc uuid := pg_temp.f('doc'); v_admin uuid := pg_temp.f('admin');
  rpat uuid; tpat uuid; pS uuid; lS uuid; pT uuid; lT uuid; pQ uuid; pX uuid; pM uuid; lM uuid; pW uuid; pN1 uuid; pN2 uuid; v_lab uuid; i integer; v jsonb; n integer;
  k0 integer; k1 integer; k2 integer; k3 integer;
begin
  rpat := pg_temp.mkuser(v_org, 'rpat', 'patient', 'S28e Real Patient', false); tpat := pg_temp.mkuser(v_org, 'tpat', 'patient', 'S28e Test Patient', true);
  pS := pg_temp.mkpharm('S28e Slow', 'S28e Slow Yaba'); lS := pg_temp.f('l:S28e Slow');
  pT := pg_temp.mkpharm('S28e Stock', 'S28e Stock Yaba'); lT := pg_temp.f('l:S28e Stock');
  pQ := pg_temp.mkpharm('S28e Quiet', 'S28e Quiet Yaba'); pX := pg_temp.mkpharm('S28e TestOnly', 'S28e TestOnly Yaba');
  perform pg_temp.setf('pS', pS); perform pg_temp.setf('pT', pT); perform pg_temp.setf('pQ', pQ); perform pg_temp.setf('lS', lS);
  -- ten slow supplies (168 hours against a 72 hour target) for a real patient, and ten for a test patient at another pharmacy
  for i in 1 .. 10 loop perform pg_temp.mkdispensed(v_org, rpat, v_doc, pS, 168); perform pg_temp.mkdispensed(v_org, tpat, v_doc, pX, 168); end loop;
  perform private.compute_partner_quality('pharmacy', pS);
  perform pg_temp.ck('real', '5a turnaround to supply is measured: ten supplies, none within target, a median of 168 hours', '10|0.0|168.0|72',
    pg_temp.quality_of(pS, 'orders_measured') || '|' || pg_temp.quality_of(pS, 'pct_within_target') || '|' || pg_temp.quality_of(pS, 'turnaround_actual_median_hours') || '|' || split_part(pg_temp.quality_of(pS, 'turnaround_target_hours'), '.', 1));
  perform pg_temp.ck('real', '5b slow turnaround is a breach code of its own', 'true',
    (select ('dispense_turnaround_slow' = any (breaches))::text from public.partner_quality where partner_kind = 'pharmacy' and partner_id = pS order by period_month desc limit 1));
  perform private.compute_partner_quality('pharmacy', pX);
  perform pg_temp.ck('real', '5c a test patient''s supplies are left out (INV-13)', '0|false',
    pg_temp.quality_of(pX, 'orders_measured') || '|' || (select ('dispense_turnaround_slow' = any (breaches))::text from public.partner_quality where partner_kind = 'pharmacy' and partner_id = pX order by period_month desc limit 1));
  -- a breach is a SUGGESTION: nothing suspends the pharmacy. (One sent prescription gives the pharmacy an organisation to announce to.)
  perform pg_temp.mksent(v_org, rpat, v_doc, pS, lS, false, false);
  v := private.apply_partner_quality('pharmacy', pS);
  perform pg_temp.ck('real', '5d applying the rule to a pharmacy with a breach does not suspend it', 'false|open|true',
    (v ->> 'suspended_now') || '|' || pg_temp.status_of('pharmacy', pS) || '|' || private.pharmacy_location_choosable(pS, lS)::text);
  perform pg_temp.ck('real', '5e ...but the breach is recorded, announced as a breach with suspended false, and the desk is told', 'true|false|true',
    ((select count(*) from public.domain_events where event_type = 'partner.quality_breach' and aggregate_id = pS) = 1)::text || '|' ||
    (select (payload ->> 'suspended') from public.domain_events where event_type = 'partner.quality_breach' and aggregate_id = pS order by created_at desc limit 1) || '|' ||
    ((select count(*) from public.notifications where template = 'partner_quality_attention' and recipient_id = v_admin) >= 1)::text);
  -- an expired licence is shown as a flag but is not an automatic removal either; the patient still cannot be offered the pharmacy
  update public.pharmacy_partners set license_expires_at = now() - interval '1 day' where id = pS;
  v := private.apply_partner_quality('pharmacy', pS);
  perform pg_temp.ck('real', '5f an expired licence is flagged, not suspended by rule, and the pharmacy is no longer offered to patients', 'false|true|false',
    (v ->> 'suspended_now') || '|' || (select ('licence_expired' = any (breaches))::text from public.partner_quality where partner_kind = 'pharmacy' and partner_id = pS order by period_month desc limit 1) || '|' ||
    private.pharmacy_location_choosable(pS, lS)::text);
  update public.pharmacy_partners set license_expires_at = now() + interval '10 days' where id = pS;
  perform private.compute_partner_quality('pharmacy', pS);
  perform pg_temp.ck('real', '5g a licence inside the warning window is "expiring"', 'expiring', pg_temp.quality_of(pS, 'licence_state'));
  -- flags raised: 10 sent, 3 out of stock is 30 percent and a breach; 2 is not
  for i in 1 .. 10 loop perform pg_temp.mksent(v_org, rpat, v_doc, pT, lT, i <= 3, false); end loop;
  perform private.compute_partner_quality('pharmacy', pT);
  perform pg_temp.ck('real', '5h ten sent and three out of stock: counted, and a breach', '10|3|3|true',
    pg_temp.quality_of(pT, 'sent_measured') || '|' || pg_temp.quality_of(pT, 'flags_raised') || '|' || pg_temp.quality_of(pT, 'out_of_stock_flags') || '|' ||
    (select ('out_of_stock_often' = any (breaches))::text from public.partner_quality where partner_kind = 'pharmacy' and partner_id = pT order by period_month desc limit 1));
  -- a prescription reported twice (re-sent, reported again) is one prescription: four flags, three prescriptions, and the rate can never pass 100 percent
  set local session_replication_role = replica;
  insert into public.prescription_pharmacy_flags (organisation_id, prescription_id, pharmacy_partner_id, flagged_by, kind, reason, is_test)
    select organisation_id, prescription_id, pharmacy_partner_id, flagged_by, kind, reason, is_test from public.prescription_pharmacy_flags
     where pharmacy_partner_id = pT and kind = 'out_of_stock' limit 1;
  set local session_replication_role = origin;
  perform private.compute_partner_quality('pharmacy', pT);
  perform pg_temp.ck('real', '5h2 a prescription reported twice counts once in the out-of-stock rate', '4|3',
    pg_temp.quality_of(pT, 'flags_raised') || '|' || pg_temp.quality_of(pT, 'out_of_stock_flags'));
  set local session_replication_role = replica;   -- the flag table is append only; a fixture is history, so the guard is skipped for this one delete
  delete from public.prescription_pharmacy_flags where pharmacy_partner_id = pT and prescription_id = (select prescription_id from public.prescription_pharmacy_flags where pharmacy_partner_id = pT order by prescription_id limit 1);
  set local session_replication_role = origin;
  perform private.compute_partner_quality('pharmacy', pT);
  perform pg_temp.ck('real', '5i two out of ten is 20 percent: no breach', 'false',
    (select ('out_of_stock_often' = any (breaches))::text from public.partner_quality where partner_kind = 'pharmacy' and partner_id = pT order by period_month desc limit 1));
  -- test flags and test sends are left out
  for i in 1 .. 10 loop perform pg_temp.mksent(v_org, tpat, v_doc, pQ, pg_temp.f('l:S28e Quiet'), true, true); end loop;
  perform private.compute_partner_quality('pharmacy', pQ);
  perform pg_temp.ck('real', '5j test sends and test flags are left out', '0|0|0',
    pg_temp.quality_of(pQ, 'sent_measured') || '|' || pg_temp.quality_of(pQ, 'flags_raised') || '|' || pg_temp.quality_of(pQ, 'out_of_stock_flags'));
  -- a send the pharmacy reported out of stock and the patient then moved elsewhere still counts as sent to it (4 reports of 10 sends, not 4 of 6)
  pM := pg_temp.mkpharm('S28e Moved', 'S28e Moved Yaba'); lM := pg_temp.f('l:S28e Moved');
  for i in 1 .. 10 loop perform pg_temp.mksent(v_org, rpat, v_doc, pM, lM, i <= 4, false); end loop;
  update public.prescription_collection_codes set pharmacy_partner_id = pQ, pharmacy_location_id = pg_temp.f('l:S28e Quiet')
   where pharmacy_partner_id = pM and prescription_id in (select f.prescription_id from public.prescription_pharmacy_flags f where f.pharmacy_partner_id = pM);
  perform private.compute_partner_quality('pharmacy', pM);
  perform pg_temp.ck('real', '5j2 reports for sends that moved elsewhere stay in the base: 10 sent, 4 reports, and the breach', '10|4|true',
    pg_temp.quality_of(pM, 'sent_measured') || '|' || pg_temp.quality_of(pM, 'out_of_stock_flags') || '|' ||
    (select ('out_of_stock_often' = any (breaches))::text from public.partner_quality where partner_kind = 'pharmacy' and partner_id = pM order by period_month desc limit 1));
  -- turnaround starts when the patient chose THIS pharmacy, not at the first send: ten supplies two hours after being chosen, though first sent 20 days before
  pW := pg_temp.mkpharm('S28e Chosen', 'S28e Chosen Yaba');
  for i in 1 .. 10 loop perform pg_temp.mkdispensed(v_org, rpat, v_doc, pW, 480, 2); end loop;
  perform private.compute_partner_quality('pharmacy', pW);
  perform pg_temp.ck('real', '5j3 a pharmacy that picks up another''s failed send is timed from when it was chosen', '10|100.0|2.0|false',
    pg_temp.quality_of(pW, 'orders_measured') || '|' || pg_temp.quality_of(pW, 'pct_within_target') || '|' || pg_temp.quality_of(pW, 'turnaround_actual_median_hours') || '|' ||
    (select ('dispense_turnaround_slow' = any (breaches))::text from public.partner_quality where partner_kind = 'pharmacy' and partner_id = pW order by period_month desc limit 1));
  -- a laboratory is unchanged: an expired licence still pauses it by rule
  insert into public.lab_providers (name, is_active, license_expires_at, license_verified_at) values ('S28e Lab', true, now() - interval '1 day', now() - interval '300 days') returning id into v_lab;
  v := private.apply_partner_quality('lab', v_lab);
  perform pg_temp.ck('real', '5k a laboratory with an expired licence is still paused by rule (S74 unchanged)', 'true|suspended',
    (v ->> 'suspended_now') || '|' || pg_temp.status_of('lab', v_lab));

  -- the desk read
  perform pg_temp.ck('real', '5l the desk read is given to an admin and refused to a patient, a pharmacist and anon', 'true|ERR:42501|ERR:42501|ERR:42501',
    (pg_temp.q_as(v_admin, 'select count(*)::text from public.pharmacy_scorecard()')::integer >= 5)::text || '|' || pg_temp.q_as(pg_temp.f('pat'), 'select count(*)::text from public.pharmacy_scorecard()') || '|' ||
    pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.pharmacy_scorecard()') || '|' || pg_temp.anon_q('select count(*)::text from public.pharmacy_scorecard()'));
  perform pg_temp.ck('real', '5m the scorecard row for the slow pharmacy asks for a review, names the suggestions and the licence days, and its work state is open', 'true|true|true|open',
    pg_temp.q_as(v_admin, format($q$select review_suggested::text from public.pharmacy_scorecard() where partner_id = %L$q$, pS)) || '|' ||
    pg_temp.q_as(v_admin, format($q$select ('dispense_turnaround_slow' = any (suggestions) and 'licence_expiring' = any (suggestions))::text from public.pharmacy_scorecard() where partner_id = %L$q$, pS)) || '|' ||
    pg_temp.q_as(v_admin, format($q$select (licence_days_left between 9 and 10)::text from public.pharmacy_scorecard() where partner_id = %L$q$, pS)) || '|' ||
    pg_temp.q_as(v_admin, format($q$select work_state from public.pharmacy_scorecard() where partner_id = %L$q$, pS)));
  perform pg_temp.ck('real', '5n a pharmacy with no figures yet is not marked for review and says it has none', 'false|true',
    pg_temp.q_as(v_admin, format($q$select review_suggested::text from public.pharmacy_scorecard() where partner_id = %L$q$, pg_temp.f('pB'))) || '|' ||
    pg_temp.q_as(v_admin, format($q$select (computed_at is null)::text from public.pharmacy_scorecard() where partner_id = %L$q$, pg_temp.f('pB'))));
  -- the licence is read live: a pharmacy with no nightly snapshot yet, whose licence has already run out, still asks for a review and says expired
  update public.pharmacy_partners set license_expires_at = now() - interval '2 days' where id = pg_temp.f('pB');
  perform pg_temp.ck('real', '5n2 an expired licence shows as expired and asks for a review even before any snapshot exists', 'expired|true|true',
    pg_temp.q_as(v_admin, format($q$select licence_state from public.pharmacy_scorecard() where partner_id = %L$q$, pg_temp.f('pB'))) || '|' ||
    pg_temp.q_as(v_admin, format($q$select review_suggested::text from public.pharmacy_scorecard() where partner_id = %L$q$, pg_temp.f('pB'))) || '|' ||
    pg_temp.q_as(v_admin, format($q$select ('licence_expired' = any (suggestions))::text from public.pharmacy_scorecard() where partner_id = %L$q$, pg_temp.f('pB'))));
  update public.pharmacy_partners set license_expires_at = current_date + 365 where id = pg_temp.f('pB');
  perform pg_temp.ck('real', '5o the scorecard carries no patient data: no column is a name, a number or a medicine', '0',
    (select count(*)::text from pg_proc p, unnest(p.proargnames) a where p.proname = 'pharmacy_scorecard' and p.pronamespace = 'public'::regnamespace and a ~* '(patient|medicine|drug|name_of|phone|email)'));
  -- a person can still pause a pharmacy, with a reason
  perform pg_temp.ck('real', '5p a person pauses a pharmacy from new work with a written reason, and it is then not offered to patients', 'false',
    (select private.pharmacy_location_choosable(pT, lT)::text from (select pg_temp.q_as(v_admin, format($q$select public.suspend_partner_from_new_work('pharmacy', %L, 'Repeated stock failures reviewed with the superintendent')::text$q$, pT)) r) x));
  -- a suggestion is announced once per partner and breach set: the same breach again is silent, and a second partner the same day is not swallowed by the first
  pN1 := pg_temp.mkpharm('S28e Notify One', 'S28e Notify One Yaba'); pN2 := pg_temp.mkpharm('S28e Notify Two', 'S28e Notify Two Yaba');
  for i in 1 .. 10 loop perform pg_temp.mkdispensed(v_org, rpat, v_doc, pN1, 168); perform pg_temp.mkdispensed(v_org, rpat, v_doc, pN2, 168); end loop;
  perform pg_temp.mksent(v_org, rpat, v_doc, pN1, pg_temp.f('l:S28e Notify One'), false, false);   -- gives each an organisation to announce to
  perform pg_temp.mksent(v_org, rpat, v_doc, pN2, pg_temp.f('l:S28e Notify Two'), false, false);
  select count(*) into k0 from public.notifications where template = 'partner_quality_attention' and recipient_id = v_admin;
  perform private.apply_partner_quality('pharmacy', pN1);
  select count(*) into k1 from public.notifications where template = 'partner_quality_attention' and recipient_id = v_admin;
  perform private.apply_partner_quality('pharmacy', pN1);
  select count(*) into k2 from public.notifications where template = 'partner_quality_attention' and recipient_id = v_admin;
  perform private.apply_partner_quality('pharmacy', pN2);
  select count(*) into k3 from public.notifications where template = 'partner_quality_attention' and recipient_id = v_admin;
  perform pg_temp.ck('real', '5q0 a suggestion is announced once per partner and breach set: the same breach again is silent, and a second partner the same day is not swallowed by the first', '1|0|1',
    (k1 - k0)::text || '|' || (k2 - k1)::text || '|' || (k3 - k2)::text);
  -- the nightly sweep still runs over pharmacies without error
  perform pg_temp.ck('real', '5q the nightly sweep checks pharmacies without error', '0', (private.partner_quality_sweep() ->> 'errors'));
end $$;

-- 6. SABOTAGE: the visit-aware lock, the suggest-only rule and the stock reset removed; every one must flip ----------------------------------
-- (a) the code check goes back to the single-prescription version (the S28 body): a visit's wrong tries and lock are lost
create or replace function private.check_collection_code(p_rx uuid, p_code text, p_partner uuid) returns text language plpgsql security definer set search_path = '' as $$
declare c public.prescription_collection_codes%rowtype; v_max integer := coalesce((private.pharmacy_cfg() ->> 'max_wrong_attempts')::integer, 5); v_in text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')); v_n integer;
begin
  select * into c from public.prescription_collection_codes where prescription_id = p_rx and pharmacy_partner_id = p_partner for update;
  if not found then return 'not_found'; end if;
  if c.used_at is not null then return 'already_collected'; end if;
  if c.locked_at is not null then return 'locked'; end if;
  if c.code_expires_at < now() then return 'expired'; end if;
  if v_in <> c.code then
    v_n := c.wrong_attempts + 1;
    update public.prescription_collection_codes set wrong_attempts = v_n, locked_at = case when v_n >= v_max then now() end where prescription_id = p_rx;
    return case when v_n >= v_max then 'locked' else 'wrong_code' end;
  end if;
  return 'ok';
end $$;
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); phA uuid := pg_temp.f('phA'); pA uuid := pg_temp.f('pA'); lA uuid := pg_temp.f('lA');
  a uuid; b uuid; v_c text; v_v uuid; hi uuid; i integer; g2 uuid; ghost uuid;
begin
  a := pg_temp.mkrx(v_org, v_pat, v_doc, 'Sab drug one', 'signed'); b := pg_temp.mkrx(v_org, v_pat, v_doc, 'Sab drug two', 'signed');
  v_c := pg_temp.q_as(v_pat, pg_temp.visit_arr(array[a, b], pA, lA)); v_v := pg_temp.visit_of(a);
  hi := greatest(a, b);   -- verify_visit checks the code on the lowest id, so the highest is the "other" member
  for i in 1 .. 5 loop perform pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_verify_visit(%L, 'WRONG123')$q$, v_v)); end loop;
  insert into results values ('sabotaged', 'five wrong tries on a visit still lock the other member', 'locked', pg_temp.verify_as(phA, hi, v_c));
  -- and the fail-closed branch (a code row pointing at a visit its pharmacy cannot see) is gone with the visit-aware check
  g2 := pg_temp.mkrx(v_org, v_pat, v_doc, 'Sab ghost drug', 'signed');
  perform pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, g2, pA, lA));
  insert into public.pharmacy_collection_visits (organisation_id, patient_id, pharmacy_partner_id, pharmacy_location_id, is_test)
    values (v_org, v_pat, pg_temp.f('pB'), pg_temp.f('lB'), true) returning id into ghost;
  update public.prescription_collection_codes set visit_id = ghost where prescription_id = g2;
  insert into results values ('sabotaged', 'a code row pointing at an unseen visit still fails closed', 'not_found', pg_temp.verify_as(phA, g2, 'WRONG123'));
end $$;

-- (b) the suggest-only rule removed from the active configuration: a pharmacy breach would suspend the pharmacy by itself
update public.partner_quality_config set rules = rules #- '{removal,suggest_only_kinds}' where is_active;
do $$
declare pV uuid; v jsonb;
begin
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, license_expires_at, onboarding_status, nafdac_source_attested_at)
    values ('S28e Sabotage', true, now(), now(), now() - interval '1 day', 'activated', now()) returning id into pV;
  v := private.apply_partner_quality('pharmacy', pV);
  insert into results values ('sabotaged', 'a pharmacy breach is still only a suggestion', 'false', (v ->> 'suspended_now'));
end $$;

-- (c) the reset trigger dropped: a stock answer survives a change of pharmacy
drop trigger prescription_collection_codes_reset_on_change on public.prescription_collection_codes;
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); phA uuid := pg_temp.f('phA');
  pA uuid := pg_temp.f('pA'); lA uuid := pg_temp.f('lA'); pB uuid := pg_temp.f('pB'); lB uuid := pg_temp.f('lB'); rx uuid;
begin
  rx := pg_temp.mkrx(v_org, v_pat, v_doc, 'Sab stock drug', 'signed');
  perform pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx, pA, lA));
  perform pg_temp.q_as(phA, format($q$select public.pharmacist_confirm_stock(%L, true)$q$, rx));
  perform pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx, pB, lB));
  insert into results values ('sabotaged', 'a change of pharmacy clears the stock answer', 'true',
    (select (stock_confirmed_at is null)::text from public.prescription_collection_codes where prescription_id = rx));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S28e proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), E'\n   ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks (%)', v_caught, (select string_agg(check_name || '=' || coalesce(actual, 'null'), ' | ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
select phase, check_name, expected, actual, case when expected <> actual then 'CAUGHT' else 'NOT CAUGHT' end as result from results where phase = 'sabotaged' order by check_name;

rollback;
