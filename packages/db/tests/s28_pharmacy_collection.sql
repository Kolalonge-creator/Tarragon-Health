-- S28 proof: pharmacy collection (migration *_s28_pharmacy_collection.sql). Spec 9.6, Module 8 rows 8.9 to 8.12.
-- INV-02 (only a signed prescription is sendable), INV-07 (neutral notices), INV-10 (a pharmacy opening a prescription is audited),
-- INV-12/partner scoping (a pharmacy sees only what was sent to it), INV-13 (is_test), no delivery field, no direct table access.
-- One rolled-back transaction. Sections:
--   0. Fixtures: two approved pharmacies (one priced, one not), one with an expired licence, a pharmacist each, a signed prescription.
--   1. Gate and grants: dormant, nothing for anon, events table closed, no direct partner policy on prescriptions.
--   2. Choosing: the list carries stock and no price, hides the expired licence, returns no delivery column; another patient is refused.
--   3. Sending: consent required, an unavailable pharmacy refused, the code issued, state sent, direct routing writes refused.
--   4. The pharmacy: inbox shows only its own, detail is audited and carries no patient id, another pharmacy is refused.
--   5. Flags and re-route: out of stock tells the patient neutrally, the patient re-routes, the old pharmacy loses it, the query reaches the signer.
--   6. Dispensing: wrong code refused and counted, lock-out, right code supplies, supply record written, repeat limit, terminal state.
--   7. Notices carry no medicine, name or code. Events are append only. Test data stays flagged.
--   8. SABOTAGE: the licence rule opened and a direct partner policy restored; both checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.err_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's28-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S28 ' || p_label || ' Person', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S28 ' || p_label, 'MDCN', 'S28-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer', 'contracted', 2, true, p_admin, true);
  return v;
end $f$;
create function pg_temp.mkpharmacy(p_name text, p_licence_days integer) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.pharmacy_partners (name, delivery, regions, is_active, onboarding_status, contact_phone, approved_at, license_verified_at, license_expires_at, state, city, area)
  values (p_name, true, array['Lagos'], true, 'activated', '+2348011122233', now(), now(), current_date + p_licence_days, 'Lagos', 'Lagos', 'Yaba')
  returning id into v;
  return v;
end $f$;
-- a signed prescription for one medicine, through the real function; returns the prescription id
create function pg_temp.mkrx(p_doc uuid, p_patient uuid, p_drug text, p_repeats integer) returns uuid language plpgsql as $f$
declare v_med uuid; v_rx uuid;
begin
  perform pg_temp.act(p_doc);
  v_med := public.prescribe_medication(p_patient, p_drug, '5 mg', 'once daily', null, null, null, 'oral', 30, '30 tablets', p_repeats, 'Review', null, true);
  perform pg_temp.back();
  select prescription_id into v_rx from public.medications where id = v_med;
  return v_rx;
end $f$;
-- Switch the S37 prescribing guard the way the guard's own trigger allows: a log row in this transaction, then the update.
create function pg_temp.guard(p_on boolean) returns void language plpgsql as $f$
begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
  values ('prescribing_enabled', case when p_on then 'switched_on' else 'switched_off' end, pg_temp.f('admin'), 'admin', 'S28 proof', '[]'::jsonb);
  update public.go_live_guards
     set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then pg_temp.f('admin') end,
         change_note = case when p_on then 'S28 proof' end
   where key = 'prescribing_enabled';
end $f$;
create function pg_temp.state_of(p_id uuid) returns text language sql as $$ select state::text from public.prescriptions where id = p_id $$;
create function pg_temp.mine(p_uid uuid, p_rx uuid) returns jsonb language sql as
$$ select pg_temp.q_as(p_uid, format('select public.my_prescription_pharmacy(%L)::text', p_rx))::jsonb $$;
create function pg_temp.dispense(p_uid uuid, p_rx uuid, p_code text, p_extra text default '') returns jsonb language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.pharmacy_mark_dispensed(%L, %L, 'Ada Pharmacist', 'PCN-1234'%s)::text$q$, p_rx, p_code, p_extra))::jsonb $$;
create function pg_temp.inbox_codes(p_uid uuid) returns text language sql as
$$ select coalesce(pg_temp.q_as(p_uid, 'select string_agg(collection_code, '','' order by collection_code) from public.pharmacy_inbox()'), '') $$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_pat uuid; v_doc uuid; pa uuid; pb uuid; pc uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  v_doc := pg_temp.mkdoc(v_org, 'doc', v_admin);
  perform pg_temp.setf('doc', v_doc);
  perform pg_temp.setf('doc2', pg_temp.mkdoc(v_org, 'doc2', v_admin));
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  perform pg_temp.setf('pat', v_pat);
  -- caregivers: one with the pharmacy permission, one with a different permission, one expired, one with no access at all
  perform pg_temp.setf('cg_ok', pg_temp.mkuser(v_org, 'cg_ok', 'patient'));
  perform pg_temp.setf('cg_no', pg_temp.mkuser(v_org, 'cg_no', 'patient'));
  perform pg_temp.setf('cg_exp', pg_temp.mkuser(v_org, 'cg_exp', 'patient'));
  perform pg_temp.setf('stranger', pg_temp.mkuser(v_org, 'stranger', 'patient'));
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions, expires_at) values
    (v_pat, pg_temp.f('cg_ok'), 'manage', v_pat, array['manage_pharmacy']::public.caregiver_permission[], null),
    (v_pat, pg_temp.f('cg_no'), 'manage', v_pat, array['view_medication']::public.caregiver_permission[], null),
    (v_pat, pg_temp.f('cg_exp'), 'manage', v_pat, array['manage_pharmacy']::public.caregiver_permission[], now() + interval '1 hour');
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_pat, v_doc, now());
  pa := pg_temp.mkpharmacy('S28 Pharmacy A', 365);
  pb := pg_temp.mkpharmacy('S28 Pharmacy B', 365);
  pc := pg_temp.mkpharmacy('S28 Pharmacy C expired', 5);   -- 5 days left: under the 30-day rule
  perform pg_temp.setf('pa', pa); perform pg_temp.setf('pb', pb); perform pg_temp.setf('pc', pc);
  perform pg_temp.setf('ph_a', pg_temp.mkuser(v_org, 'ph_a', 'pharmacist'));
  perform pg_temp.setf('ph_b', pg_temp.mkuser(v_org, 'ph_b', 'pharmacist'));
  perform pg_temp.setf('ph_a2', pg_temp.mkuser(v_org, 'ph_a2', 'pharmacist'));
  update public.profiles set pharmacy_partner_id = pa where id = pg_temp.f('ph_a2');
  update public.profiles set pharmacy_partner_id = pa where id = pg_temp.f('ph_a');
  update public.profiles set pharmacy_partner_id = pb where id = pg_temp.f('ph_b');
  -- Pharmacy A lists the medicine twice (the worse stock is shown, no price is ever returned); B lists nothing.
  insert into public.pharmacy_medications (pharmacy_partner_id, drug_name, pack_size, price_kobo, is_active, stock_status)
  values (pa, 'Amlodipine', '30', 450000, true, 'in_stock'), (pa, 'amlodipine ', '60', 380000, true, 'low_stock');
  perform pg_temp.setf('rx1', pg_temp.mkrx(v_doc, v_pat, 'Amlodipine', 0));
  perform pg_temp.setf('rx2', pg_temp.mkrx(v_doc, v_pat, 'Losartan', 0));
  perform pg_temp.setf('rx3', pg_temp.mkrx(v_doc, v_pat, 'Atorvastatin', 0));
end $$;

-- 1. Gate and grants -------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); rx uuid := pg_temp.f('rx1');
begin
  perform pg_temp.ck('the module starts off', 'false', (select is_enabled::text from public.platform_modules where key = 'pharmacy_collection'));
  perform pg_temp.ck('while off, the patient list refuses', 'true',
    (pg_temp.q_as(v_pat, format('select count(*) from public.pharmacies_for_prescription(%L)', rx)) like 'ERR:pharmacy_collection_off')::text);
  perform pg_temp.ck('while off, sending refuses', 'true',
    (pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx, pg_temp.f('pa'))) like 'ERR:pharmacy_collection_off')::text);
  perform pg_temp.ck('while off, the pharmacy inbox refuses', 'true',
    (pg_temp.q_as(pg_temp.f('ph_a'), 'select count(*) from public.pharmacy_inbox()') like 'ERR:pharmacy_collection_off')::text);

  perform pg_temp.ck('while off, the patient screen is told not to offer it', 'false', pg_temp.q_as(v_pat, 'select public.pharmacy_collection_available()::text'));
  perform pg_temp.ck('the prescribing guard starts off', 'false', (select is_on::text from public.go_live_guards where key = 'prescribing_enabled'));
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = pg_temp.f('admin'), activation_note = 'S28 proof' where key = 'pharmacy_collection';
  perform pg_temp.ck('module on but the go-live guard off: still not offered', 'false', pg_temp.q_as(v_pat, 'select public.pharmacy_collection_available()::text'));
  perform pg_temp.ck('...and sending still refuses', 'true',
    (pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx, pg_temp.f('pa'))) like 'ERR:pharmacy_collection_off')::text);
  perform pg_temp.guard(true);
  perform pg_temp.ck('once on with approved pharmacies, the screen is told to offer it', 'true', pg_temp.q_as(v_pat, 'select public.pharmacy_collection_available()::text'));
  perform pg_temp.ck('anon is not told anything', '42501', pg_temp.try_anon('select public.pharmacy_collection_available()'));

  perform pg_temp.ck('anon cannot list pharmacies', '42501', pg_temp.try_anon(format('select * from public.pharmacies_for_prescription(%L)', rx)));
  perform pg_temp.ck('anon cannot send', '42501', pg_temp.try_anon(format('select public.send_prescription_to_pharmacy(%L, %L, true)', rx, pg_temp.f('pa'))));
  perform pg_temp.ck('anon cannot read the inbox', '42501', pg_temp.try_anon('select * from public.pharmacy_inbox()'));
  perform pg_temp.ck('anon cannot dispense', '42501', pg_temp.try_anon(format($q$select public.pharmacy_mark_dispensed(%L, 'X', 'Y Z')$q$, rx)));
  perform pg_temp.ck('no one can read the events table directly', 'true',
    (pg_temp.q_as(v_pat, 'select count(*) from public.prescription_pharmacy_events') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('no direct partner policy remains on prescriptions', '0',
    (select count(*)::text from pg_policy where polrelid = 'public.prescriptions'::regclass and polname like '%partner%'));
  perform pg_temp.ck('a pharmacist cannot read prescriptions directly (no policy admits them)', '0',
    pg_temp.q_as(pg_temp.f('ph_a'), 'select count(*)::text from public.prescriptions'));
  perform pg_temp.ck('the result of the pharmacy list has no delivery column', '0',
    (select count(*)::text from pg_proc p, unnest(p.proargnames) n
      where p.proname = 'pharmacies_for_prescription' and n ~* 'deliver'));
end $$;

-- 2. Choosing --------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); rx uuid := pg_temp.f('rx1'); r text;
begin
  perform pg_temp.ck('the list shows both approved pharmacies and not the expired licence', 'S28 Pharmacy A,S28 Pharmacy B',
    pg_temp.q_as(v_pat, format($q$select string_agg(name, ',' order by name) from public.pharmacies_for_prescription(%L) where name like 'S28 %%'$q$, rx)));
  perform pg_temp.ck('the list carries no price at all (OQ-264)', '0',
    (select count(*)::text from pg_proc p, unnest(p.proargnames) n
      where p.proname = 'pharmacies_for_prescription' and (n ~* 'price' or n ~* 'kobo' or n ~* 'priced')));
  perform pg_temp.ck('A reports the worst stock across its listings (low stock)', 'low_stock',
    pg_temp.q_as(v_pat, format($q$select stock from public.pharmacies_for_prescription(%L) where name = 'S28 Pharmacy A'$q$, rx)));
  perform pg_temp.ck('B has no listing: stock unknown', 'unknown',
    pg_temp.q_as(v_pat, format($q$select stock from public.pharmacies_for_prescription(%L) where name = 'S28 Pharmacy B'$q$, rx)));
  perform pg_temp.ck('another patient cannot list for this prescription', 'true',
    (pg_temp.q_as(pg_temp.f('pat2'), format('select count(*) from public.pharmacies_for_prescription(%L)', rx)) like 'ERR:prescription_not_found')::text);
end $$;

-- 3. Sending ---------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); rx uuid := pg_temp.f('rx1'); r text; v_code text;
begin
  perform pg_temp.ck('sending without consent is refused', 'true',
    (pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, false)::text', rx, pg_temp.f('pa'))) like 'ERR:consent_required')::text);
  perform pg_temp.ck('an expired-licence pharmacy cannot be chosen', 'true',
    (pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx, pg_temp.f('pc'))) like 'ERR:pharmacy_not_available')::text);
  perform pg_temp.ck('another patient cannot send it', 'true',
    (pg_temp.q_as(pg_temp.f('pat2'), format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx, pg_temp.f('pa'))) like 'ERR:prescription_not_found')::text);
  perform pg_temp.ck('a clinician cannot send it for the patient', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx, pg_temp.f('pa'))) like 'ERR:prescription_not_found')::text);
  perform pg_temp.ck('a direct routing write by the patient is refused', 'true',
    (pg_temp.err_as(v_pat, format($q$update public.prescriptions set pharmacy_partner_id = %L, state = 'sent' where id = %L$q$, pg_temp.f('pa'), rx)) in ('42501', 'ok'))::text);
  perform pg_temp.ck('...and nothing changed', 'signed', pg_temp.state_of(rx));

  r := pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx, pg_temp.f('pa')));
  perform pg_temp.ck('a good send returns an 8 character code', 'true', (r not like 'ERR:%' and length((r::jsonb ->> 'collection_code')) = 8)::text);
  v_code := r::jsonb ->> 'collection_code';
end $$;

-- 4..7 run in one block so the codes stay in plpgsql variables
do $$
declare
  v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); pa uuid := pg_temp.f('pa'); pb uuid := pg_temp.f('pb');
  ph_a uuid := pg_temp.f('ph_a'); ph_b uuid := pg_temp.f('ph_b');
  rx1 uuid := pg_temp.f('rx1'); rx2 uuid := pg_temp.f('rx2'); rx3 uuid := pg_temp.f('rx3');
  v_code1 text; v_code2 text; v_code2b text; r jsonb; t text; i integer; v_med uuid;
begin
  -- rx1 is already sent to A by section 3; read its code as the patient would
  v_code1 := pg_temp.mine(v_pat, rx1) ->> 'collection_code';
  perform pg_temp.ck('the patient sees the pharmacy and the code', 'S28 Pharmacy A|sent',
    (pg_temp.mine(v_pat, rx1) ->> 'pharmacy_name') || '|' || (pg_temp.mine(v_pat, rx1) ->> 'state'));
  perform pg_temp.ck('the patient preference remembers the pharmacy', pa::text,
    (select pharmacy_partner_id::text from public.patient_pharmacy_preference where patient_id = v_pat));
  perform pg_temp.ck('the list now puts the preferred pharmacy first', 'S28 Pharmacy A',
    (pg_temp.q_as(v_pat, format($q$select name from public.pharmacies_for_prescription(%L) where name like 'S28 %%' order by is_preferred desc, name limit 1$q$, rx2))));

  -- 4. The pharmacy
  perform pg_temp.ck('A sees the code in its inbox', v_code1, pg_temp.inbox_codes(ph_a));
  perform pg_temp.ck('B sees nothing', '', pg_temp.inbox_codes(ph_b));
  perform pg_temp.ck('the inbox shows a first name only', 'S28',
    pg_temp.q_as(ph_a, format('select first_name from public.pharmacy_inbox() where prescription_id = %L', rx1)));
  perform pg_temp.ck('B cannot open A''s prescription', 'true',
    (pg_temp.q_as(ph_b, format('select public.pharmacy_prescription_detail(%L)::text', rx1)) like 'ERR:prescription_not_found')::text);
  t := pg_temp.q_as(ph_a, format('select public.pharmacy_prescription_detail(%L)::text', rx1));
  perform pg_temp.ck('A can open it and the detail carries the medicine and no patient id', 'Amlodipine|false',
    (t::jsonb -> 'items' -> 0 ->> 'drug_name') || '|' || (t ~ (v_pat::text))::text);
  perform pg_temp.ck('opening it was audited (INV-10)', '1',
    (select count(*)::text from public.audit_log where action = 'prescription.pharmacy_opened' and entity_id = rx1 and actor_id = ph_a));
  perform pg_temp.ck('a patient cannot call the pharmacy functions', 'true',
    (pg_temp.q_as(v_pat, 'select count(*) from public.pharmacy_inbox()') like 'ERR:This action is for partner pharmacies')::text);

  -- 5. Flags and re-route (rx1 at A)
  perform pg_temp.ck('a query without a reason is refused', 'true',
    (pg_temp.q_as(ph_a, format($q$select public.pharmacy_flag_prescription(%L, 'query_to_prescriber', null)::text$q$, rx1)) like 'ERR:reason_required')::text);
  perform pg_temp.ck('free text is not accepted as a question (no chat)', 'true',
    (pg_temp.q_as(ph_a, format($q$select public.pharmacy_flag_prescription(%L, 'query_to_prescriber', 'Please confirm the strength.')::text$q$, rx1)) like 'ERR:reason_required')::text);
  perform pg_temp.ck('a reason on an out-of-stock flag is refused', 'true',
    (pg_temp.q_as(ph_a, format($q$select public.pharmacy_flag_prescription(%L, 'out_of_stock', 'dose_unclear')::text$q$, rx1)) like 'ERR:invalid_flag')::text);
  perform pg_temp.ck('B cannot flag A''s prescription', 'true',
    (pg_temp.q_as(ph_b, format($q$select public.pharmacy_flag_prescription(%L, 'out_of_stock', null)::text$q$, rx1)) like 'ERR:prescription_not_found')::text);
  perform pg_temp.ck('an unknown flag kind is refused', 'true',
    (pg_temp.q_as(ph_a, format($q$select public.pharmacy_flag_prescription(%L, 'other', 'x')::text$q$, rx1)) like 'ERR:invalid_flag')::text);
  perform pg_temp.q_as(ph_a, format($q$select public.pharmacy_flag_prescription(%L, 'query_to_prescriber', 'dose_unclear')::text$q$, rx1));
  perform pg_temp.ck('the signer got one neutral notice about the question', '1',
    (select count(*)::text from public.notifications where recipient_id = v_doc and template = 'pharmacy_collection_question'));
  perform pg_temp.ck('the question also reaches the clinical queue as one pharmacy_flag_review task (S36h)', '1',
    (select count(*)::text from public.clinical_tasks where patient_id = v_pat and type = 'pharmacy_flag_review'));
  perform pg_temp.ck('the signer sees the question as a fixed reason', 'dose_unclear|false',
    (pg_temp.q_as(v_doc, 'select public.prescriber_pharmacy_overview()::text')::jsonb -> 'questions' -> 0 ->> 'reason_code') || '|' ||
    ((pg_temp.q_as(v_doc, 'select public.prescriber_pharmacy_overview()::text')::jsonb -> 'questions' -> 0) ? 'phone')::text);
  perform pg_temp.ck('the patient cannot read the prescriber overview', 'true',
    (pg_temp.q_as(v_pat, 'select public.prescriber_pharmacy_overview()::text') like 'ERR:This is for clinicians')::text);
  perform pg_temp.ck('reading the overview was audited', 'true',
    ((select count(*) from public.audit_log where action = 'prescription.pharmacy_overview_read' and actor_id = v_doc) >= 1)::text);
  perform pg_temp.q_as(ph_a, format($q$select public.pharmacy_flag_prescription(%L, 'out_of_stock', null)::text$q$, rx1));
  perform pg_temp.ck('out of stock tells the patient to choose again', 'true', (pg_temp.mine(v_pat, rx1) ->> 'needs_other_pharmacy'));
  perform pg_temp.ck('the patient got a neutral update', '1',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'pharmacy_collection_update'));
  perform pg_temp.ck('re-routing to the same pharmacy is refused', 'true',
    (pg_temp.q_as(v_pat, format('select public.reroute_prescription_pharmacy(%L, %L, true)::text', rx1, pa)) like 'ERR:same_pharmacy')::text);
  r := pg_temp.q_as(v_pat, format('select public.reroute_prescription_pharmacy(%L, %L, true)::text', rx1, pb))::jsonb;
  perform pg_temp.ck('re-routing gives a new code', 'true', ((r ->> 'collection_code') is not null and (r ->> 'collection_code') <> v_code1)::text);
  v_code1 := r ->> 'collection_code';
  perform pg_temp.ck('A no longer sees it', '', pg_temp.inbox_codes(ph_a));
  perform pg_temp.ck('A cannot dispense it any more', 'not_waiting', (pg_temp.dispense(ph_a, rx1, v_code1) ->> 'reason'));
  perform pg_temp.ck('B now sees it', v_code1, pg_temp.inbox_codes(ph_b));
  perform pg_temp.ck('the flag no longer shows against the new pharmacy', 'false', (pg_temp.mine(v_pat, rx1) ->> 'needs_other_pharmacy'));

  -- 6. Dispensing (rx1 at B)
  perform pg_temp.ck('a wrong code is refused', 'code_mismatch', (pg_temp.dispense(ph_b, rx1, 'AAAAAAAA') ->> 'reason'));
  perform pg_temp.ck('...and the miss is recorded', '1',
    (select count(*)::text from public.audit_log where action = 'prescription.pharmacy_code_mismatch' and entity_id = rx1));
  perform pg_temp.ck('a code typed with spaces and lower case still matches', 'true',
    (pg_temp.dispense(ph_b, rx1, lower(substr(v_code1, 1, 4)) || ' ' || lower(substr(v_code1, 5)), $q$, '2 boxes', 'BATCH-77', '2027-06-30'$q$) ->> 'ok'));
  perform pg_temp.ck('the prescription is now dispensed', 'dispensed', pg_temp.state_of(rx1));
  select medication_id into v_med from public.pharmacy_order_dispenses where recorded_via = 'partner' and patient_id = v_pat limit 1;
  perform pg_temp.ck('the supply record was written with the batch (source pharmacy, via partner)', 'pharmacy|partner|BATCH-77',
    (select d.source || '|' || d.recorded_via || '|' || d.batch_number from public.pharmacy_order_dispenses d where d.medication_id = v_med and d.recorded_via = 'partner'));
  perform pg_temp.ck('a second attempt is refused (terminal)', 'not_waiting', (pg_temp.dispense(ph_b, rx1, v_code1) ->> 'reason'));
  perform pg_temp.ck('the patient no longer sees a live code', 'null', coalesce(pg_temp.mine(v_pat, rx1) ->> 'collection_code', 'null'));
  perform pg_temp.ck('the dispensed event is flagged test', 'true',
    (select bool_and(is_test)::text from public.prescription_pharmacy_events where prescription_id = rx1));
  perform pg_temp.ck('events for rx1 in order', 'sent,flagged_query,flagged_out_of_stock,rerouted,dispensed',
    (select string_agg(event_type, ',' order by created_at, id) from public.prescription_pharmacy_events where prescription_id = rx1));
  perform pg_temp.ck('a dispensed prescription cannot be re-routed', 'true',
    (pg_temp.q_as(v_pat, format('select public.reroute_prescription_pharmacy(%L, %L, true)::text', rx1, pa)) like 'ERR:prescription_not_waiting')::text);

  -- repeat limit: a partner supply already on the books uses up the only permitted supply (repeats_allowed = 0)
  perform pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx2, pb));
  v_code2 := pg_temp.mine(v_pat, rx2) ->> 'collection_code';
  insert into public.pharmacy_order_dispenses (organisation_id, patient_id, medication_id, drug_name, source, pharmacy_name, recorded_via)
  select organisation_id, patient_id, id, drug_name, 'pharmacy', 'Elsewhere', 'public_verification' from public.medications where prescription_id = rx2;
  perform pg_temp.ck('a supply already recorded elsewhere blocks a second', 'no_supply_available', (pg_temp.dispense(ph_b, rx2, v_code2) ->> 'reason'));
  perform pg_temp.ck('...and the prescription is still waiting (nothing half done)', 'sent', pg_temp.state_of(rx2));

  -- lock-out: five wrong codes, then even the right one is refused for ten minutes
  perform pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx3, pa));
  v_code2b := pg_temp.mine(v_pat, rx3) ->> 'collection_code';
  for i in 1..5 loop perform pg_temp.dispense(ph_a, rx3, 'WRONG' || i); end loop;
  perform pg_temp.ck('five wrong codes lock this account out', 'too_many_attempts', (pg_temp.dispense(ph_a, rx3, v_code2b) ->> 'reason'));
  perform pg_temp.ck('...and the prescription is untouched', 'sent', pg_temp.state_of(rx3));

  -- partial supply keeps it waiting
  perform pg_temp.ck('a partial supply is recorded and the prescription stays waiting', 'true|sent',
    (pg_temp.dispense(pg_temp.f('ph_a2'), rx3, v_code2b, $q$, '10 tablets', 'B-1', '2027-06-30', true, 'Remainder on Friday'$q$) ->> 'ok') || '|' || pg_temp.state_of(rx3));

  -- 7. Notices and immutability
  perform pg_temp.ck('no pharmacy notice carries a name, medicine or code', '0',
    (select count(*)::text from public.notifications n
      where n.template in ('pharmacy_collection_waiting', 'pharmacy_collection_update', 'pharmacy_collection_question')
        and n.payload::text ~* ('(amlodipine|losartan|atorvastatin|S28|' || v_code1 || ')')));
  perform pg_temp.ck('the pharmacy was told once per send, nothing more', '4',
    (select count(*)::text from public.notifications where template = 'pharmacy_collection_waiting'
        and recipient_id in (ph_a, ph_b)));
  perform pg_temp.ck('the events table is append only (update)', '42501',
    pg_temp.try_sql('update public.prescription_pharmacy_events set note = ''x'''));
  perform pg_temp.ck('the events table is append only (delete)', '42501',
    pg_temp.try_sql('delete from public.prescription_pharmacy_events'));
  perform pg_temp.ck('the signed items never changed', 'true',
    ((select items -> 0 ->> 'drug_name' from public.prescriptions where id = rx1) = 'Amlodipine')::text);
  update public.platform_modules set is_enabled = false, enabled_at = null, enabled_by = null, activation_note = null where key = 'pharmacy_collection';
  perform pg_temp.ck('turning the module off stops a pharmacy again', 'true',
    (pg_temp.q_as(ph_a, 'select count(*) from public.pharmacy_inbox()') like 'ERR:pharmacy_collection_off')::text);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = pg_temp.f('admin'), activation_note = 'S28 proof' where key = 'pharmacy_collection';
end $$;

-- 7b. Review fixes: current-only sending, withdraw, partial then complete, an inactive pharmacy ----------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); pa uuid := pg_temp.f('pa');
  ph_a uuid := pg_temp.f('ph_a'); ph_a2 uuid := pg_temp.f('ph_a2');
  rx_old uuid; rx_w uuid; rx_p uuid; v_code text; v_code2 text; r jsonb; v_med_old uuid;
begin
  -- an amended or stopped medicine leaves its OLD prescription row signed: it must not be offered or sent
  rx_old := pg_temp.mkrx(v_doc, v_pat, 'Paracetamol', 0);
  perform pg_temp.ck('a live prescription is listed as current', 'true',
    pg_temp.q_as(v_pat, format('select is_current::text from public.my_collection_prescriptions() where prescription_id = %L', rx_old)));
  -- the real amendment, by the prescriber: it replaces the medicine and signs a NEW prescription, leaving the old row 'signed'
  select id into v_med_old from public.medications where prescription_id = rx_old;
  perform pg_temp.ck('the amendment itself succeeded', 'true',
    (pg_temp.q_as(v_doc, format($q$select public.amend_medication(%L, 'Dose changed', null, '500 mg', null, null, null, null, null, null, null, null, null, true)::text$q$, v_med_old)) not like 'ERR:%')::text);
  perform pg_temp.ck('amending left the old prescription signed (why state alone is not enough)', 'signed', pg_temp.state_of(rx_old));
  perform pg_temp.ck('once its medicine is replaced it is listed as not current', 'false',
    pg_temp.q_as(v_pat, format('select is_current::text from public.my_collection_prescriptions() where prescription_id = %L', rx_old)));
  perform pg_temp.ck('...it cannot be priced', 'true',
    (pg_temp.q_as(v_pat, format('select count(*) from public.pharmacies_for_prescription(%L)', rx_old)) like 'ERR:prescription_not_current')::text);
  perform pg_temp.ck('...and it cannot be sent', 'true',
    (pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_old, pa)) like 'ERR:prescription_not_current')::text);
  perform pg_temp.ck('the list shows only her own', '0',
    pg_temp.q_as(pg_temp.f('pat2'), 'select count(*)::text from public.my_collection_prescriptions()'));
  perform pg_temp.ck('anon cannot read the list', '42501', pg_temp.try_anon('select * from public.my_collection_prescriptions()'));
  perform pg_temp.ck('anon cannot withdraw', '42501', pg_temp.try_anon(format('select public.withdraw_prescription_from_pharmacy(%L)', rx_old)));

  -- withdraw: consent to share is revocable
  rx_w := pg_temp.mkrx(v_doc, v_pat, 'Omeprazole', 0);
  r := pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_w, pa))::jsonb;
  v_code := r ->> 'collection_code';
  perform pg_temp.ck('before withdrawing, the pharmacy sees it', 'true', (pg_temp.inbox_codes(ph_a2) like '%' || v_code || '%')::text);
  perform pg_temp.ck('another patient cannot withdraw it', 'true',
    (pg_temp.q_as(pg_temp.f('pat2'), format('select public.withdraw_prescription_from_pharmacy(%L)::text', rx_w)) like 'ERR:prescription_not_found')::text);
  perform pg_temp.ck('a pharmacist cannot withdraw it', 'true',
    (pg_temp.q_as(ph_a2, format('select public.withdraw_prescription_from_pharmacy(%L)::text', rx_w)) like 'ERR:prescription_not_found')::text);
  perform pg_temp.ck('the patient can withdraw it', 'true', (pg_temp.q_as(v_pat, format('select public.withdraw_prescription_from_pharmacy(%L)::text', rx_w))::jsonb ->> 'ok'));
  perform pg_temp.ck('...it is back to signed with no pharmacy and no code', 'signed||',
    (select state::text || '|' || coalesce(pharmacy_partner_id::text, '') || '|' || coalesce(collection_code, '') from public.prescriptions where id = rx_w));
  perform pg_temp.ck('...the pharmacy no longer lists it', 'false', (pg_temp.inbox_codes(ph_a2) like '%' || v_code || '%')::text);
  perform pg_temp.ck('...nor can it open it', 'true',
    (pg_temp.q_as(ph_a2, format('select public.pharmacy_prescription_detail(%L)::text', rx_w)) like 'ERR:prescription_not_found')::text);
  perform pg_temp.ck('...nor dispense it with the old code', 'not_waiting', (pg_temp.dispense(ph_a2, rx_w, v_code) ->> 'reason'));
  perform pg_temp.ck('...the patient sees it as not sent', 'false', (pg_temp.mine(v_pat, rx_w) ->> 'sent'));
  perform pg_temp.ck('...withdrawing again is refused', 'true',
    (pg_temp.q_as(v_pat, format('select public.withdraw_prescription_from_pharmacy(%L)::text', rx_w)) like 'ERR:prescription_not_waiting')::text);
  perform pg_temp.ck('...a withdrawn event was kept', '1',
    (select count(*)::text from public.prescription_pharmacy_events where prescription_id = rx_w and event_type = 'withdrawn'));
  r := pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_w, pa))::jsonb;
  perform pg_temp.ck('...and she can send it again, with a fresh code', 'true', ((r ->> 'collection_code') is not null and (r ->> 'collection_code') <> v_code)::text);

  -- a partial supply is not a whole supply: completing it later must still work
  rx_p := pg_temp.mkrx(v_doc, v_pat, 'Cetirizine', 0);
  perform pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_p, pa));
  v_code2 := pg_temp.mine(v_pat, rx_p) ->> 'collection_code';
  perform pg_temp.ck('a partial supply is accepted', 'true',
    (pg_temp.dispense(ph_a2, rx_p, v_code2, $q$, '10 tablets', 'B-1', '2027-06-30', true, 'Remainder on Friday'$q$) ->> 'ok'));
  perform pg_temp.ck('...it does not use up the only permitted supply', '0|1',
    (pg_temp.q_as(ph_a2, format('select (public.pharmacy_prescription_detail(%L) ->> ''supplies_recorded'') || ''|'' || (public.pharmacy_prescription_detail(%L) ->> ''supplies_permitted'')', rx_p, rx_p))));
  perform pg_temp.ck('...so the rest can be supplied when she comes back', 'true|dispensed',
    (pg_temp.dispense(ph_a2, rx_p, v_code2, $q$, '20 tablets', 'B-2', '2027-06-30'$q$) ->> 'ok') || '|' || pg_temp.state_of(rx_p));

  -- a pharmacy that is switched off, or whose licence has run out, sees nothing
  perform pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', pg_temp.mkrx(v_doc, v_pat, 'Loratadine', 0), pa));
  update public.pharmacy_partners set is_active = false where id = pa;
  perform pg_temp.ck('a switched-off pharmacy cannot read its inbox', 'true',
    (pg_temp.q_as(ph_a2, 'select count(*) from public.pharmacy_inbox()') like 'ERR:pharmacy_not_active')::text);
  update public.pharmacy_partners set is_active = true, license_expires_at = current_date - 1 where id = pa;
  perform pg_temp.ck('a pharmacy with an expired licence cannot read its inbox', 'true',
    (pg_temp.q_as(ph_a2, 'select count(*) from public.pharmacy_inbox()') like 'ERR:pharmacy_not_active')::text);
  perform pg_temp.ck('...nor open anything', 'true',
    (pg_temp.q_as(ph_a2, format('select public.pharmacy_prescription_detail(%L)::text', rx_p)) like 'ERR:pharmacy_not_active')::text);
  update public.pharmacy_partners set license_expires_at = current_date + 365 where id = pa;
  perform pg_temp.ck('once the licence is back it works again', 'true', (pg_temp.q_as(ph_a2, 'select count(*) from public.pharmacy_inbox()') not like 'ERR:%')::text);
end $$;

-- 7c. Structured questions, batch and expiry, a caregiver sending, the go-live conditions ----------------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); v_doc2 uuid := pg_temp.f('doc2'); pa uuid := pg_temp.f('pa');
  ph_a uuid := pg_temp.f('ph_a'); ph_b uuid := pg_temp.f('ph_b'); v_org uuid := pg_temp.f('org');
  cg_ok uuid := pg_temp.f('cg_ok'); cg_no uuid := pg_temp.f('cg_no'); cg_exp uuid := pg_temp.f('cg_exp'); stranger uuid := pg_temp.f('stranger');
  rx_q uuid; rx_b uuid; rx_c uuid; v_code text; v_q uuid; v_before integer; v_cond text; v_det jsonb;
begin
  -- A. Structured question and a fixed answer (no chat, no change to the signed prescription)
  rx_q := pg_temp.mkrx(v_doc, v_pat, 'Ibuprofen', 0);
  perform pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_q, pa));
  perform pg_temp.q_as(ph_a, format($q$select public.pharmacy_flag_prescription(%L, 'query_to_prescriber', 'substitute_needed')::text$q$, rx_q));
  select id into v_q from public.prescription_pharmacy_events where prescription_id = rx_q and event_type = 'flagged_query';
  perform pg_temp.ck('the question is stored as a fixed code, with no free text', 'substitute_needed|',
    (select reason_code || '|' || coalesce(note, '') from public.prescription_pharmacy_events where id = v_q));
  perform pg_temp.ck('a clinician who did not sign it cannot answer', 'true',
    (pg_temp.q_as(v_doc2, format($q$select public.answer_pharmacy_question(%L, 'keep_as_written')::text$q$, v_q)) like 'ERR:question_not_found')::text);
  perform pg_temp.ck('...and sees none of it in their overview', '0',
    (pg_temp.q_as(v_doc2, 'select jsonb_array_length(public.prescriber_pharmacy_overview() -> ''questions'')::text')));
  perform pg_temp.ck('the patient cannot answer a pharmacy question', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.answer_pharmacy_question(%L, 'keep_as_written')::text$q$, v_q)) like 'ERR:question_not_found')::text);
  perform pg_temp.ck('the pharmacy cannot answer its own question', 'true',
    (pg_temp.q_as(ph_a, format($q$select public.answer_pharmacy_question(%L, 'keep_as_written')::text$q$, v_q)) like 'ERR:question_not_found')::text);
  perform pg_temp.ck('free text is not accepted as an answer', 'true',
    (pg_temp.q_as(v_doc, format($q$select public.answer_pharmacy_question(%L, 'Yes that is fine')::text$q$, v_q)) like 'ERR:invalid_answer')::text);
  perform pg_temp.ck('the signer answers', 'true', (pg_temp.q_as(v_doc, format($q$select public.answer_pharmacy_question(%L, 'new_prescription_coming')::text$q$, v_q))::jsonb ->> 'ok'));
  perform pg_temp.ck('a second answer is refused', 'already_answered',
    (pg_temp.q_as(v_doc, format($q$select public.answer_pharmacy_question(%L, 'keep_as_written')::text$q$, v_q))::jsonb ->> 'reason'));
  perform pg_temp.ck('the pharmacy sees the answer on the prescription', 'substitute_needed|new_prescription_coming',
    (pg_temp.q_as(ph_a, format('select public.pharmacy_prescription_detail(%L)::text', rx_q))::jsonb -> 'questions' -> 0 ->> 'reason_code') || '|' ||
    (pg_temp.q_as(ph_a, format('select public.pharmacy_prescription_detail(%L)::text', rx_q))::jsonb -> 'questions' -> 0 ->> 'answer_code'));
  perform pg_temp.ck('after the answer the pharmacy sees no open question on its inbox row', 'false',
    (pg_temp.q_as(ph_a, format('select has_open_flag::text from public.pharmacy_inbox() where prescription_id = %L', rx_q))));
  perform pg_temp.ck('the answer was audited', '1',
    (select count(*)::text from public.audit_log where action = 'prescription.pharmacy_question_answered' and entity_id = rx_q));
  perform pg_temp.ck('an answer changes nothing on the signed prescription (INV-02)', 'sent|Ibuprofen',
    (select state::text || '|' || (items -> 0 ->> 'drug_name') from public.prescriptions where id = rx_q));
  perform pg_temp.ck('the other pharmacy sees none of the questions', 'true',
    (pg_temp.q_as(ph_b, format('select public.pharmacy_prescription_detail(%L)::text', rx_q)) like 'ERR:prescription_not_found')::text);
  perform pg_temp.ck('the signer sees where it has got to', 'sent',
    (select e ->> 'state' from jsonb_array_elements(pg_temp.q_as(v_doc, 'select public.prescriber_pharmacy_overview()::text')::jsonb -> 'collection') e where e ->> 'prescription_id' = rx_q::text));

  -- B. Batch and expiry are recorded, never "verified"
  rx_b := pg_temp.mkrx(v_doc, v_pat, 'Salbutamol', 0);
  perform pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_b, pa));
  select collection_code into v_code from public.prescriptions where id = rx_b;
  perform pg_temp.ck('a supply without batch and expiry is refused', 'batch_required', (pg_temp.dispense(pg_temp.f('ph_a2'), rx_b, v_code) ->> 'reason'));
  perform pg_temp.ck('a batch with no expiry is refused', 'batch_required', (pg_temp.dispense(pg_temp.f('ph_a2'), rx_b, v_code, $q$, '1 box', 'X1', null$q$) ->> 'reason'));
  perform pg_temp.ck('an expired batch is refused', 'batch_expired', (pg_temp.dispense(pg_temp.f('ph_a2'), rx_b, v_code, $q$, '1 box', 'X1', '2020-01-01'$q$) ->> 'reason'));
  perform pg_temp.ck('...and nothing was recorded', 'sent|0',
    pg_temp.state_of(rx_b) || '|' || (select count(*)::text from public.pharmacy_order_dispenses d join public.medications m on m.id = d.medication_id where m.prescription_id = rx_b));
  perform pg_temp.ck('with batch and expiry it is recorded', 'true', (pg_temp.dispense(pg_temp.f('ph_a2'), rx_b, v_code, $q$, '1 box', 'X1', '2027-12-31'$q$) ->> 'ok'));
  -- The downloadable form is the medicine record (medications), which collection never touches: after a supply it is still active, unreplaced,
  -- carries the same public token for the QR check, and the patient can still read it, so the form still works at any pharmacy.
  perform pg_temp.ck('after a supply at a partner the medicine is still active and unreplaced (the PDF still downloads)', 'true|true|true',
    (select (is_active and superseded_at is null)::text || '|' || (public_token is not null)::text || '|' || (rx_number is not null)::text from public.medications where prescription_id = rx_b));
  perform pg_temp.ck('...and the patient still reads it through their own access', '1',
    pg_temp.q_as(v_pat, format('select count(*)::text from public.medications where prescription_id = %L', rx_b)));
  perform pg_temp.ck('the supply record carries the batch and expiry', 'X1|2027-12-31',
    (select d.batch_number || '|' || d.expiry_date::text from public.pharmacy_order_dispenses d join public.medications m on m.id = d.medication_id where m.prescription_id = rx_b));

  -- C. A caregiver with the pharmacy permission can send for the patient; nobody else can
  rx_c := pg_temp.mkrx(v_doc, v_pat, 'Metoprolol', 0);
  select count(*) into v_before from public.notifications where recipient_id = v_pat and template = 'pharmacy_collection_update';
  perform pg_temp.ck('a caregiver without the permission cannot list pharmacies', 'true',
    (pg_temp.q_as(cg_no, format('select count(*) from public.pharmacies_for_prescription(%L, %L)', rx_c, v_pat)) like 'ERR:not_permitted_for_this_person')::text);
  perform pg_temp.ck('a stranger cannot send', 'true',
    (pg_temp.q_as(stranger, format('select public.send_prescription_to_pharmacy(%L, %L, true, %L)::text', rx_c, pa, v_pat)) like 'ERR:not_permitted_for_this_person')::text);
  perform pg_temp.ck('a caregiver without the permission cannot send', 'true',
    (pg_temp.q_as(cg_no, format('select public.send_prescription_to_pharmacy(%L, %L, true, %L)::text', rx_c, pa, v_pat)) like 'ERR:not_permitted_for_this_person')::text);
  perform pg_temp.ck('a caregiver acting as themselves cannot touch the patient''s prescription', 'true',
    (pg_temp.q_as(cg_ok, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_c, pa)) like 'ERR:prescription_not_found')::text);
  perform pg_temp.ck('...but still needs the consent tick', 'true',
    (pg_temp.q_as(cg_ok, format('select public.send_prescription_to_pharmacy(%L, %L, false, %L)::text', rx_c, pa, v_pat)) like 'ERR:consent_required')::text);
  perform pg_temp.ck('the caregiver with the permission sees the patient''s prescriptions', 'true',
    ((pg_temp.q_as(cg_ok, format('select count(*) from public.my_collection_prescriptions(%L)', v_pat)))::integer >= 3)::text);
  perform pg_temp.ck('the caregiver with the permission sends', 'true',
    (pg_temp.q_as(cg_ok, format('select public.send_prescription_to_pharmacy(%L, %L, true, %L)::text', rx_c, pa, v_pat)) not like 'ERR:%')::text);
  perform pg_temp.ck('the event names the caregiver, not the patient, as the actor', 'true',
    ((select actor_id from public.prescription_pharmacy_events where prescription_id = rx_c and event_type = 'sent') = cg_ok)::text);
  perform pg_temp.ck('the patient is told, neutrally', '1',
    ((select count(*) from public.notifications where recipient_id = v_pat and template = 'pharmacy_collection_update') - v_before)::text);
  perform pg_temp.ck('the patient''s access log records the caregiver', '1',
    (select count(*)::text from public.care_access_events where patient_id = v_pat and actor_profile_id = cg_ok and kind = 'acted_for' and scope = 'data_shared_pharmacy'));
  perform pg_temp.ck('the pharmacy sees it as any other prescription', 'true',
    (pg_temp.inbox_codes(ph_a) like '%' || (select collection_code from public.prescriptions where id = rx_c) || '%')::text);
  perform pg_temp.ck('the caregiver can take it back', 'true',
    (pg_temp.q_as(cg_ok, format('select public.withdraw_prescription_from_pharmacy(%L, %L)::text', rx_c, v_pat))::jsonb ->> 'ok'));
  perform pg_temp.ck('sending and taking back leave the medicine record and its QR token exactly as they were', 'true|true',
    (select (is_active and superseded_at is null)::text || '|' || (public_token is not null)::text from public.medications where prescription_id = rx_c));
  perform pg_temp.ck('...and the stranger cannot', 'true',
    (pg_temp.q_as(stranger, format('select public.withdraw_prescription_from_pharmacy(%L, %L)::text', rx_c, v_pat)) like 'ERR:not_permitted_for_this_person')::text);
  update public.profile_access set created_at = now() - interval '1 day', expires_at = now() - interval '1 minute' where grantee_user_id = cg_exp;
  perform pg_temp.ck('an expired caregiver grant stops working', 'true',
    (pg_temp.q_as(cg_exp, format('select public.send_prescription_to_pharmacy(%L, %L, true, %L)::text', rx_c, pa, v_pat)) like 'ERR:not_permitted_for_this_person')::text);

  -- D. The S37 guard: the switch needs it, and its conditions are read from the data
  perform pg_temp.guard(false);
  perform pg_temp.ck('with the guard off, a pharmacy sees nothing', 'true',
    (pg_temp.q_as(ph_a, 'select count(*) from public.pharmacy_inbox()') like 'ERR:pharmacy_collection_off')::text);
  perform pg_temp.ck('...and the patient can still take a prescription back', 'true',
    (pg_temp.q_as(v_pat, format('select public.withdraw_prescription_from_pharmacy(%L)::text', rx_q))::jsonb ->> 'ok'));
  v_det := private.go_live_conditions('prescribing_enabled', v_org);
  perform pg_temp.ck('the guard lists the pharmacy conditions', 'clinical_lead_signoff,clinical_safety_case_current,notification_sender_deployed,pharmacy_licence_current,pharmacy_partner_active,pharmacy_quality_confirmed',
    (select string_agg(c ->> 'code', ',' order by c ->> 'code') from jsonb_array_elements(v_det) c));
  perform pg_temp.ck('a current licence is met, the unconfirmed quality rules and the unattested sender are not', 'true|false|false',
    (select max((c ->> 'met')) filter (where c ->> 'code' = 'pharmacy_licence_current') || '|' ||
            max((c ->> 'met')) filter (where c ->> 'code' = 'pharmacy_quality_confirmed') || '|' ||
            max((c ->> 'met')) filter (where c ->> 'code' = 'notification_sender_deployed') from jsonb_array_elements(v_det) c));
  update public.pharmacy_partners set license_expires_at = current_date + 5 where is_active;
  perform pg_temp.ck('with every licence about to lapse, the licence condition is unmet', 'false',
    (select (c ->> 'met') from jsonb_array_elements(private.go_live_conditions('prescribing_enabled', v_org)) c where c ->> 'code' = 'pharmacy_licence_current'));
  update public.pharmacy_partners set license_expires_at = current_date + 365 where is_active;
  perform pg_temp.guard(true);
  -- F. A repeat supply is a new send (OQ-260): collected, then only while a further supply is permitted
  declare rx_r uuid; v_med_r uuid; v_code_r text;
  begin
    rx_r := pg_temp.mkrx(v_doc, v_pat, 'Hydrochlorothiazide', 1);
    select id into v_med_r from public.medications where prescription_id = rx_r;
    perform pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_r, pa));
    select collection_code into v_code_r from public.prescriptions where id = rx_r;
    perform pg_temp.ck('the first supply is recorded', 'true', (pg_temp.dispense(pg_temp.f('ph_a2'), rx_r, v_code_r, $q$, '30 tablets', 'R1', '2027-12-31'$q$) ->> 'ok'));
    perform pg_temp.ck('the prescription is collected', 'dispensed', pg_temp.state_of(rx_r));
    perform pg_temp.ck('no further supply is permitted yet, so it is not offered again', 'true',
      (pg_temp.q_as(v_pat, format('select count(*) from public.pharmacies_for_prescription(%L)', rx_r)) like 'ERR:prescription_not_sendable')::text);
    perform pg_temp.ck('...and sending is refused', 'true',
      (pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_r, pa)) like 'ERR:prescription_not_sendable')::text);
    insert into public.medication_repeat_requests (organisation_id, patient_id, medication_id) values (v_org, v_pat, v_med_r);
    update public.medication_repeat_requests set status = 'approved' where medication_id = v_med_r;
    perform pg_temp.ck('once the clinician approves a repeat, the list says one supply remains', '1',
      pg_temp.q_as(v_pat, format('select supplies_remaining::text from public.my_collection_prescriptions() where prescription_id = %L', rx_r)));
    perform pg_temp.ck('...and it is offered again', 'true', (pg_temp.q_as(v_pat, format('select count(*) from public.pharmacies_for_prescription(%L)', rx_r))::integer >= 1)::text);
    perform pg_temp.ck('the repeat is a new send with a new code', 'true',
      (pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_r, pa)) not like 'ERR:%')::text);
    perform pg_temp.ck('it waits at the pharmacy again with a different code and no old collection time', 'sent|true|true',
      pg_temp.state_of(rx_r) || '|' || (select (collection_code is distinct from v_code_r)::text from public.prescriptions where id = rx_r) || '|'
      || (select (dispensed_at is null)::text from public.prescriptions where id = rx_r));
    perform pg_temp.ck('the old code no longer works', 'code_mismatch',
      (pg_temp.dispense(pg_temp.f('ph_a2'), rx_r, v_code_r, $q$, '30 tablets', 'R2', '2027-12-31'$q$) ->> 'reason'));
    perform pg_temp.ck('the second supply is recorded and uses up the permitted number', 'true',
      (pg_temp.dispense(pg_temp.f('ph_a2'), rx_r, (select collection_code from public.prescriptions where id = rx_r), $q$, '30 tablets', 'R2', '2027-12-31'$q$) ->> 'ok'));
    perform pg_temp.ck('...and then no third send is offered', 'true',
      (pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_r, pa)) like 'ERR:prescription_not_sendable')::text);
    perform pg_temp.ck('only the patient can send a collected prescription again (a stranger is refused)', 'true',
      (pg_temp.q_as(stranger, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_r, pa)) like 'ERR:prescription_not_found')::text);
  end;
  -- E. A question cannot be answered once the prescription has left the pharmacy that asked
  declare rx_z uuid; q_z uuid;
  begin
    rx_z := pg_temp.mkrx(v_doc, v_pat, 'Folic acid', 0);
    perform pg_temp.q_as(v_pat, format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', rx_z, pa));
    perform pg_temp.q_as(ph_a, format($q$select public.pharmacy_flag_prescription(%L, 'query_to_prescriber', 'call_me')::text$q$, rx_z));
    select id into q_z from public.prescription_pharmacy_events where prescription_id = rx_z and event_type = 'flagged_query';
    perform pg_temp.q_as(v_pat, format('select public.withdraw_prescription_from_pharmacy(%L)::text', rx_z));
    perform pg_temp.ck('an answer after the prescription left the pharmacy is refused', 'not_waiting',
      (pg_temp.q_as(v_doc, format($q$select public.answer_pharmacy_question(%L, 'keep_as_written')::text$q$, q_z))::jsonb ->> 'reason'));
  end;
end $$;

-- 7d. S28b: no delivery column for patients, is_test on the older tables, the older pharmacist reads audited, the neutral order alert ------
do $$
declare
  v_pat uuid := pg_temp.f('pat'); ph_a uuid := pg_temp.f('ph_a'); ph_a2 uuid := pg_temp.f('ph_a2'); pa uuid := pg_temp.f('pa'); pb uuid := pg_temp.f('pb');
  v_org uuid := pg_temp.f('org'); v_order uuid; v_before integer; v_rx text; v_code text; v_med uuid;
begin
  perform pg_temp.ck('the patient-facing directory carries no delivery or delivery fee', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'pharmacy_partner_directory' and column_name in ('delivery', 'delivery_fee_kobo')));
  perform pg_temp.ck('...and anon cannot read it', '42501', pg_temp.try_anon('select count(*) from public.pharmacy_partner_directory'));
  perform pg_temp.ck('a test patient''s supply is stamped as test', 'true',
    (select bool_and(d.is_test)::text from public.pharmacy_order_dispenses d where d.patient_id = v_pat));
  insert into public.pharmacy_orders (organisation_id, patient_id, pharmacy_partner_id, items, status, total_kobo) values (v_org, v_pat, pa, jsonb_build_array(jsonb_build_object('drug_name', 'Amlodipine', 'medication_id', (select id from public.pharmacy_medications where pharmacy_partner_id = pa limit 1), 'quantity', 1)), 'requested', 380000) returning id into v_order;
  perform pg_temp.ck('a test patient''s order is stamped as test', 'true', (select is_test::text from public.pharmacy_orders where id = v_order));
  insert into public.pharmacy_order_dispenses (organisation_id, patient_id, pharmacy_order_id, drug_name, source, is_test) values (v_org, v_pat, v_order, 'Probe', 'pharmacy', false);
  perform pg_temp.ck('...and a dispense row is stamped whatever the writer passes (a false is overridden)', 'true',
    (select is_test::text from public.pharmacy_order_dispenses where drug_name = 'Probe' and patient_id = v_pat limit 1));

  select count(*) into v_before from public.audit_log where action = 'pharmacist.orders_read' and actor_id = ph_a;
  perform pg_temp.q_as(ph_a, 'select count(*) from public.pharmacist_orders()');
  perform pg_temp.ck('listing the orders leaves an audit row', '1', ((select count(*) from public.audit_log where action = 'pharmacist.orders_read' and actor_id = ph_a) - v_before)::text);
  perform pg_temp.ck('a pharmacist who is not at A sees nothing of A''s order', '0',
    pg_temp.q_as(pg_temp.f('ph_b'), format('select count(*)::text from public.pharmacist_order_allergies(%L)', v_order)));
  perform pg_temp.ck('...and nothing was audited for the refusal', '0',
    (select count(*)::text from public.audit_log where action = 'pharmacist.order_allergies_read' and actor_id = pg_temp.f('ph_b')));
  perform pg_temp.q_as(ph_a, format('select count(*) from public.pharmacist_order_allergies(%L)', v_order));
  perform pg_temp.q_as(ph_a, format('select count(*) from public.pharmacist_order_medications(%L)', v_order));
  perform pg_temp.ck('reading an order''s allergies and medicines is audited', '1|1',
    (select count(*) filter (where action = 'pharmacist.order_allergies_read')::text || '|' || count(*) filter (where action = 'pharmacist.order_medications_read')::text
       from public.audit_log where entity_id = v_order and actor_id = ph_a));
  perform pg_temp.q_as(ph_a, format($q$select public.pharmacist_record_dispense(%L, 'Probe', '1 box', current_date)::text$q$, v_order));
  perform pg_temp.ck('recording a dispense on an order is audited', '1',
    (select count(*)::text from public.audit_log where action = 'pharmacist.dispense_recorded' and entity_id = v_order));

  select m.rx_number, m.verification_code, m.id into v_rx, v_code, v_med from public.medications m where m.prescription_id = pg_temp.f('rx1');
  perform pg_temp.ck('verifying a prescription still answers a pharmacist', 'true',
    (pg_temp.q_as(ph_a, format('select count(*) from public.verify_prescription(%L, %L)', v_rx, v_code))::integer = 1)::text);
  perform pg_temp.ck('...and is audited', '1',
    (select count(*)::text from public.audit_log where action = 'pharmacist.prescription_verified' and entity_id = v_med and actor_id = ph_a));
  perform pg_temp.ck('a patient still gets nothing from the verify function', '0',
    pg_temp.q_as(v_pat, format('select count(*)::text from public.verify_prescription(%L, %L)', v_rx, v_code)));

  -- the order alert to a pharmacy is the neutral in-app notice: no SMS, no email, no patient name or medicine
  delete from public.notifications where recipient_id in (ph_a, ph_a2);
  -- the commission trigger needs partner commission terms this proof does not set up; it is not what is being proved here
  alter table public.pharmacy_orders disable trigger pharmacy_orders_record_commission;
  update public.pharmacy_orders set status = 'payment_confirmed' where id = v_order;
  alter table public.pharmacy_orders enable trigger pharmacy_orders_record_commission;
  perform pg_temp.ck('the pharmacy gets the neutral in-app notice for a new order', 'true',
    ((select count(*) from public.notifications where recipient_id = ph_a and template = 'pharmacy_collection_waiting' and channel = 'in_app') >= 1)::text);
  -- a partner with no login in the app still hears of a paid order, by a neutral email and never by SMS
  update public.pharmacy_partners set contact_email = 'orders@pharmacy.example' where id = pa;
  update public.profiles set pharmacy_partner_id = null where id in (ph_a, ph_a2);
  alter table public.pharmacy_orders disable trigger pharmacy_orders_record_commission;
  update public.pharmacy_orders set status = 'requested' where id = v_order;
  update public.pharmacy_orders set status = 'payment_confirmed' where id = v_order;
  alter table public.pharmacy_orders enable trigger pharmacy_orders_record_commission;
  perform pg_temp.ck('a partner with no app login gets a neutral email and no SMS', '1|0|0',
    (select count(*) filter (where channel = 'email' and payload ->> 'to_email' = 'orders@pharmacy.example')::text || '|' ||
            count(*) filter (where channel = 'sms')::text || '|' ||
            count(*) filter (where payload::text ilike '%Amlodipine%' or payload::text ilike '%S28 pat%')::text
       from public.notifications where template = 'pharmacy_order_pharmacy_alert' and created_at >= now() - interval '1 minute'));
  update public.profiles set pharmacy_partner_id = pa where id in (ph_a, ph_a2);
  perform pg_temp.ck('no pharmacy alert goes by SMS any more (INV-08)', '0',
    (select count(*)::text from public.notifications where template = 'pharmacy_order_pharmacy_alert' and channel = 'sms' and created_at >= now() - interval '1 minute'));
  perform pg_temp.ck('nothing sent to the pharmacy names the patient or the medicine', '0',
    (select count(*)::text from public.notifications where recipient_id in (ph_a, ph_a2) and (payload::text ilike '%Amlodipine%' or payload::text ilike '%S28 pat%')));
end $$;

-- 8. SABOTAGE: the licence rule opened, a direct partner policy restored, the caregiver gate opened, the go-live guard ignored; every check must flip ----------------------------------------
create or replace function private.pharmacy_choosable(p_partner uuid) returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
create policy prescriptions_select_partner on public.prescriptions for select to authenticated
  using (state in ('sent', 'dispensed') and pharmacy_partner_id = (select p.pharmacy_partner_id from public.profiles p where p.id = (select auth.uid())));
create or replace function private.rx_patient(p_beneficiary uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(p_beneficiary, (select auth.uid())) $$;
do $$
declare v_rx uuid;
begin
  v_rx := pg_temp.mkrx(pg_temp.f('doc'), pg_temp.f('pat'), 'Metformin', 0);
  insert into results values ('sabotaged', 'an expired-licence pharmacy is still refused', 'ERR:pharmacy_not_available',
    pg_temp.q_as(pg_temp.f('pat'), format('select public.send_prescription_to_pharmacy(%L, %L, true)::text', v_rx, pg_temp.f('pc'))));
  insert into results values ('sabotaged', 'a pharmacist still cannot read prescriptions directly', '0',
    pg_temp.q_as(pg_temp.f('ph_b'), 'select count(*)::text from public.prescriptions'));
  insert into results values ('sabotaged', 'a stranger still cannot send for the patient', 'ERR:not_permitted_for_this_person',
    pg_temp.q_as(pg_temp.f('stranger'), format('select public.send_prescription_to_pharmacy(%L, %L, true, %L)::text', v_rx, pg_temp.f('pa'), pg_temp.f('pat'))));
  perform pg_temp.guard(false);
  create or replace function private.pharmacy_collection_on() returns boolean language sql stable security definer set search_path = '' as $f$
    select coalesce((select is_enabled from public.platform_modules where key = 'pharmacy_collection'), false) $f$;
  -- S28b sabotage: the is_test stamp dropped
  drop trigger pharmacy_order_dispenses_stamp_is_test on public.pharmacy_order_dispenses;
  insert into public.pharmacy_order_dispenses (organisation_id, patient_id, pharmacy_order_id, drug_name, source, is_test)
    values (pg_temp.f('org'), pg_temp.f('pat'), (select id from public.pharmacy_orders limit 1), 'Probe2', 'pharmacy', false);
  insert into results values ('sabotaged', 'a test patient''s dispense is still stamped as test', 'true',
    (select is_test::text from public.pharmacy_order_dispenses where drug_name = 'Probe2' limit 1));
  insert into results values ('sabotaged', 'with the go-live guard off a pharmacy still sees nothing', 'ERR:pharmacy_collection_off',
    pg_temp.q_as(pg_temp.f('ph_a2'), 'select count(*)::text from public.pharmacy_inbox()'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S28 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 5 then raise exception 'VACUOUS TEST: the sabotage flipped % of 5 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
