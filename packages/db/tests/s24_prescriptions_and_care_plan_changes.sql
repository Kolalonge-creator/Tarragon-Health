-- S24 proof: signed prescribing, care plan changes, titration protocols, referral consent
-- (migration *_s24_care_plan_changes_signed_prescribing.sql). Spec 4.5, 6.3, safety case 10; INV-02, 07, 10, 12, 16.
--
-- Proves in one rolled-back transaction:
--   1. Grants: nothing for anon; no direct read or write of care_plan_changes, protocols or the config.
--   2. Signed prescribing: prescribe and amend write a SIGNED prescription stamped as the prescriber and project it; allergy,
--      duplicate and controlled-medicine checks (controlled is a hard stop); a user session cannot write or edit a clinician medicine
--      without a signature.
--   3. Safety case 10: a proposal is invisible to the patient; signing needs a prescriber and a plain-language summary; the patient's
--      medicines do not change until she confirms; confirming applies it as the signer's act and puts the session back; a change to
--      an existing medicine supersedes it; stop; target change; decline and expiry change nothing; a new allergy sends it back.
--   4. An unsigned change cannot be saved as signed; signed content is frozen.
--   5. Titration protocols: an engine proposal needs an approved protocol (a draft only for a test patient), inputs; approved is immutable.
--   6. Referrals: consent before a clinician-initiated referral leaves draft; a chase date.
--   7. SABOTAGE: the medicine signature trigger dropped, and the signature CHECK dropped; both checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- Run as a signed-in API user (role authenticated) with row security switched off on the three tables the S24 triggers guard, so the write reaches the
-- trigger instead of being filtered by RLS first; returns the SQLSTATE or 'ok'. (Staff have no write policy on medications at all, so without this the
-- trigger would never be exercised.)
create function pg_temp.try_claims(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  alter table public.medications disable row level security;
  alter table public.care_plans disable row level security;
  alter table public.specialist_referrals disable row level security;
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  alter table public.medications enable row level security;
  alter table public.care_plans enable row level security;
  alter table public.specialist_referrals enable row level security;
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
  values (v, 's24-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S24 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S24 ' || p_label, 'MDCN', 'S24-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      true, p_admin, true);
  return v;
end $f$;
create function pg_temp.tie(p_org uuid, p_patient uuid, p_doc uuid) returns void language sql as
$$ insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (p_org, p_patient, p_doc, now()) $$;
create function pg_temp.state_of(p_id uuid) returns text language sql as $$ select state from public.care_plan_changes where id = p_id $$;
create function pg_temp.pcount(p_patient uuid, p_drug text) returns integer language sql as
$$ select count(*)::integer from public.medications where patient_id = p_patient and lower(drug_name) = lower(p_drug) and is_active and superseded_at is null $$;
-- confirm and, in the same session, report auth.uid(): the session must be put back as the patient
create function pg_temp.confirm_as(p_uid uuid, p_change uuid) returns text language plpgsql as
$f$ declare r text; v_after text;
begin
  perform pg_temp.act(p_uid);
  begin
    r := (public.confirm_care_plan_change(p_change) ->> 'outcome');
    v_after := (select auth.uid())::text;
    r := r || '|' || (v_after = p_uid::text)::text;
  exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.propose_med(p_doc uuid, p_patient uuid, p_proposal jsonb, p_extra text default '') returns text language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.q_as(p_doc, format($q$select public.propose_care_plan_change(%L, 'medication', %L::jsonb, 'Average home readings are above the agreed target.'%s)::text$q$, p_patient, p_proposal::text, p_extra));
  return r;
end $f$;
create function pg_temp.sign_as(p_doc uuid, p_change uuid, p_summary text, p_conf boolean, p_over text) returns text language sql as
$$ select pg_temp.try_as(p_doc, format($q$select public.sign_care_plan_change(%L, %L, %L, %L)$q$, p_change, p_summary, p_conf, p_over)) $$;

create function pg_temp.try_sql_owner(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.pz(p_patient uuid, p_drug text) returns text language sql as
$$ select pg_temp.pcount(p_patient, p_drug)::text $$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'smo', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('doc2', pg_temp.mkdoc(v_org, 'smo2', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('mo', pg_temp.mkdoc(v_org, 'mo', 'care_coordinator', v_admin));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id, assigned_at)
  values (v_org, pg_temp.f('pat'), pg_temp.f('doc'), pg_temp.f('mo'), now());
  perform pg_temp.tie(v_org, pg_temp.f('pat2'), pg_temp.f('doc'));
end $$;

-- 1. Grants ------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc');
begin
  perform pg_temp.ck('anon cannot propose a change', '42501',
    pg_temp.try_anon($q$select public.propose_care_plan_change(gen_random_uuid(), 'medication', '{"action":"stop"}'::jsonb, 'long enough reason')$q$));
  perform pg_temp.ck('anon cannot read the patient list of changes', '42501', pg_temp.try_anon($q$select public.my_care_plan_changes()$q$));
  perform pg_temp.ck('anon cannot confirm a change', '42501', pg_temp.try_anon($q$select public.confirm_care_plan_change(gen_random_uuid())$q$));
  perform pg_temp.ck('anon cannot read protocols', '42501', pg_temp.try_anon($q$select count(*) from public.protocols$q$));
  perform pg_temp.ck('a patient cannot read care_plan_changes directly', 'true',
    (pg_temp.q_as(v_pat, 'select count(*) from public.care_plan_changes') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('a clinician cannot read care_plan_changes directly', 'true',
    (pg_temp.q_as(v_doc, 'select count(*) from public.care_plan_changes') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('a clinician cannot insert a change directly', 'true',
    (pg_temp.try_as(v_doc, format($q$insert into public.care_plan_changes (organisation_id, patient_id, kind, proposed_by, proposal, rationale) values (%L, %L, 'medication', 'clinician', '{"action":"stop"}', 'x')$q$, pg_temp.f('org'), v_pat)) like 'permission denied%')::text);
  perform pg_temp.ck('nobody can read the config table', 'true',
    (pg_temp.q_as(v_doc, 'select count(*) from public.care_change_config') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('a clinician cannot write a protocol', 'true',
    (pg_temp.try_as(v_doc, $q$insert into public.protocols (code, version, definition) values ('x', 1, '{"code":"x","version":1}')$q$) like 'permission denied%')::text);
  perform pg_temp.ck('the sweep is not callable by a signed-in user', 'true',
    (pg_temp.try_as(v_doc, 'select private.sweep_care_plan_changes()') like 'permission denied%')::text);
end $$;

-- 2. Signed prescribing ------------------------------------------------------------------------------------------------
do $$
declare v_doc uuid := pg_temp.f('doc'); v_mo uuid := pg_temp.f('mo'); v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org');
  r text; med uuid; rx record;
begin
  -- allergies: none recorded and not confirmed
  r := pg_temp.q_as(v_doc, format($q$select public.prescribe_medication(%L, 'Amlodipine', '5 mg', 'once daily', null, null, null, 'oral', 30, '30 tablets', 0, 'Blood pressure', null)::text$q$, v_pat));
  perform pg_temp.ck('no allergy list and no confirmation: refused with the finding', 'true', (r like 'ERR:A safety check needs your attention%')::text);
  perform pg_temp.ck('...nothing was saved', '0', pg_temp.pcount(v_pat, 'Amlodipine')::text);
  perform pg_temp.ck('...nor a prescription', '0', (select count(*)::text from public.prescriptions where patient_id = v_pat));

  r := pg_temp.q_as(v_doc, format($q$select public.prescribe_medication(%L, 'Amlodipine', '5 mg', 'once daily', null, null, null, 'oral', 30, '30 tablets', 0, 'Blood pressure', null, true)::text$q$, v_pat));
  perform pg_temp.ck('with the allergy list confirmed it is saved', 'true', (r !~ '^ERR')::text);
  med := r::uuid;
  perform pg_temp.setf('med1', med);
  select p.* into rx from public.prescriptions p join public.medications m on m.prescription_id = p.id where m.id = med;
  perform pg_temp.ck('a SIGNED prescription exists and is linked', 'signed', rx.state::text);
  perform pg_temp.ck('...signed by the prescriber, not typed by anyone', v_doc::text, rx.signed_by::text);
  perform pg_temp.ck('...with a signing time', 'true', (rx.signed_at is not null)::text);
  perform pg_temp.ck('...and the checks are recorded', 'true', (rx.safety_checks -> 'allergies_confirmed' = 'true'::jsonb)::text);
  perform pg_temp.ck('the medicine row is the prescriber''s', v_doc::text, (select added_by::text from public.medications where id = med));

  -- duplicate
  r := pg_temp.q_as(v_doc, format($q$select public.prescribe_medication(%L, 'amlodipine', '10 mg', 'once daily', null, null, null, 'oral', 30, '30 tablets', 0, null, null, true)::text$q$, v_pat));
  perform pg_temp.ck('the same drug twice needs a stated reason', 'true', (r like 'ERR:A safety check needs your attention%')::text);
  -- controlled: a hard stop, an override does not help
  r := pg_temp.q_as(v_doc, format($q$select public.prescribe_medication(%L, 'Tramadol', '50 mg', 'twice daily', null, null, null, 'oral', 5, '10 capsules', 0, null, null, true, 'I accept the risk')::text$q$, v_pat));
  perform pg_temp.ck('a controlled medicine cannot be signed even with an override', 'true', (r like 'ERR:TarragonHealth does not prescribe controlled medicines%')::text);
  -- an allergy match
  insert into public.patient_allergies (organisation_id, patient_id, allergen, source, recorded_by) values (v_org, v_pat, 'penicillin', 'clinician', v_doc);
  r := pg_temp.q_as(v_doc, format($q$select public.prescribe_medication(%L, 'Penicillin V', '250 mg', 'four times daily', null, null, null, 'oral', 7, '28 tablets', 0, null, null)::text$q$, v_pat));
  perform pg_temp.ck('a drug matching a recorded allergy is refused until the signer says why', 'true', (r like 'ERR:A safety check needs your attention%')::text);

  insert into public.patient_allergies (organisation_id, patient_id, allergen, source, recorded_by) values (v_org, v_pat, '%%%', 'patient', v_pat);
  r := pg_temp.q_as(v_doc, format($q$select public.prescribe_medication(%L, 'Hydrochlorothiazide', '25 mg', 'daily', null, null, null, 'oral', 30, '30 tablets', 0, null, null)::text$q$, v_pat));
  perform pg_temp.ck('an allergen typed as wildcard characters does not match every drug', 'true', (r !~ '^ERR')::text);
  -- who may prescribe
  r := pg_temp.q_as(v_mo, format($q$select public.prescribe_medication(%L, 'Losartan', '50 mg', 'once daily', null, null, null, 'oral', 30, '30 tablets', 0, null, null)::text$q$, v_pat));
  perform pg_temp.ck('a care coordinator cannot prescribe (no authority)', 'true', (r like 'ERR:Not authorised to prescribe%')::text);
  r := pg_temp.q_as(pg_temp.f('doc2'), format($q$select public.prescribe_medication(%L, 'Losartan', '50 mg', 'once daily', null, null, null, 'oral', 30, '30 tablets', 0, null, null)::text$q$, v_pat));
  perform pg_temp.ck('a prescriber with no tie to the patient cannot prescribe', 'true', (r like 'ERR:Not authorised to prescribe%')::text);
  r := pg_temp.q_as(v_pat, format($q$select public.prescribe_medication(%L, 'Losartan', '50 mg', 'once daily', null, null, null, 'oral', 30, '30 tablets', 0, null, null)::text$q$, v_pat));
  perform pg_temp.ck('a patient cannot prescribe', 'true', (r like 'ERR:not authorised%')::text);

  -- the projection cannot be written around the signature (a user session, not RLS-filtered)
  perform pg_temp.ck('a clinician medicine cannot be inserted without a signed prescription', '42501',
    pg_temp.try_claims(v_doc, format($q$insert into public.medications (organisation_id, patient_id, source, drug_name, dose, frequency, quantity, duration_days, repeats_allowed) values (%L, %L, 'clinician', 'Hydrochlorothiazide', '25 mg', 'daily', '30', 30, 0)$q$, v_org, v_pat)));
  perform pg_temp.ck('...nor with an unsigned (draft) prescription', '42501',
    pg_temp.try_claims(v_doc, format($q$insert into public.medications (organisation_id, patient_id, source, drug_name, dose, frequency, quantity, duration_days, repeats_allowed, prescription_id)
        values (%L, %L, 'clinician', 'Hydrochlorothiazide', '25 mg', 'daily', '30', 30, 0, (select id from public.prescriptions limit 0))$q$, v_org, v_pat)));
  perform pg_temp.ck('a signed medicine''s dose cannot be edited in place', '42501',
    pg_temp.try_claims(v_doc, format($q$update public.medications set dose = '20 mg' where id = %L$q$, med)));
  insert into public.medications (organisation_id, patient_id, source, drug_name) values (v_org, v_pat, 'patient', 'Own vitamin');
  perform pg_temp.ck('a medicine cannot be turned into a care-team prescription', '42501',
    pg_temp.try_claims(v_pat, format($q$update public.medications set source = 'clinician' where id = (select id from public.medications where patient_id = %L and source = 'patient' limit 1)$q$, v_pat)) );
  perform pg_temp.ck('a signed prescription cannot be altered', '42501',
    pg_temp.try_sql_owner(format($q$update public.prescriptions set items = '[]'::jsonb where id = %L$q$, rx.id)));

  -- amend writes a new signed prescription and supersedes
  r := pg_temp.q_as(v_doc, format($q$select public.amend_medication(%L, 'Dose raised after review', null, '10 mg', null, null, null, null, null, null, null, null, null, true)::text$q$, med));
  perform pg_temp.ck('amend produces a new version', 'true', (r !~ '^ERR')::text);
  perform pg_temp.ck('...the new version has its own signed prescription superseding the first', 'true',
    ((select p2.state = 'signed' and p2.supersedes_prescription_id = p1.id and p2.amendment_reason = 'Dose raised after review'
        from public.medications m2 join public.prescriptions p2 on p2.id = m2.prescription_id
        join public.medications m1 on m1.id = m2.previous_version_id join public.prescriptions p1 on p1.id = m1.prescription_id
       where m2.id = r::uuid))::text);
  perform pg_temp.setf('med1', r::uuid);
end $$;

-- 3. Safety case 10: a proposal is a draft, signing, confirming ------------------------------------------------------------
do $$
declare v_doc uuid := pg_temp.f('doc'); v_doc2 uuid := pg_temp.f('doc2'); v_mo uuid := pg_temp.f('mo'); v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2');
  c1 uuid; r text; m record;
  item jsonb := '{"drug_name":"Lisinopril","dose":"5 mg","frequency":"once daily","route":"oral","duration_days":30,"quantity":"30 tablets","repeats_allowed":1}';
begin
  r := pg_temp.propose_med(v_mo, v_pat, jsonb_build_object('action', 'start', 'item', item));
  perform pg_temp.ck('a care coordinator cannot propose a change', 'true', (r like 'ERR:Not authorised to propose%')::text);
  r := pg_temp.propose_med(v_doc2, v_pat, jsonb_build_object('action', 'start', 'item', item));
  perform pg_temp.ck('a prescriber with no tie cannot propose', 'true', (r like 'ERR:Not authorised to propose%')::text);
  r := pg_temp.propose_med(v_doc, v_pat, jsonb_build_object('action', 'start', 'item', item - 'quantity'));
  perform pg_temp.ck('a medicine proposal without a quantity is refused', 'true', (r like 'ERR:A medicine needs a name, a quantity%')::text);

  r := pg_temp.propose_med(v_doc, v_pat, jsonb_build_object('action', 'start', 'item', item));
  perform pg_temp.ck('a tied prescriber can propose', 'true', (r !~ '^ERR')::text);
  c1 := r::uuid; perform pg_temp.setf('c1', c1);
  perform pg_temp.ck('...it is a proposal with no signature', 'proposed|', pg_temp.state_of(c1) || '|' || coalesce((select signed_by::text from public.care_plan_changes where id = c1), ''));
  perform pg_temp.ck('the patient cannot see a draft', '[]', pg_temp.q_as(v_pat, 'select public.my_care_plan_changes()::text'));
  perform pg_temp.ck('the patient cannot confirm a draft', 'not_available|true', pg_temp.confirm_as(v_pat, c1));
  perform pg_temp.ck('nothing on the patient''s medicines yet', '0', pg_temp.pz(v_pat, 'Lisinopril'));
  r := pg_temp.sign_as(v_mo, c1, 'Your care team would like to start a new tablet.', true, null);
  perform pg_temp.ck('a care coordinator cannot sign', 'true', (r like 'Not authorised to sign%')::text);
  r := pg_temp.sign_as(v_doc, c1, '  ', true, null);
  perform pg_temp.ck('signing needs a plain-language summary', 'true', (r like 'Write what this change means%')::text);
  r := pg_temp.propose_med(v_doc, v_pat2, jsonb_build_object('action', 'start', 'item', item));
  perform pg_temp.ck('(a patient with no allergy list) signing without confirming the list is refused', 'true',
    (pg_temp.sign_as(v_doc, r::uuid, 'Your care team would like to add a second blood pressure tablet.', false, null) like 'A safety check needs your attention%')::text);
  perform pg_temp.ck('...and the change is still only a proposal', 'proposed', pg_temp.state_of(r::uuid));
  r := pg_temp.sign_as(v_doc, c1, 'Your care team would like to add a second blood pressure tablet.', true, null);
  perform pg_temp.ck('the prescriber signs', 'ok', r);
  select * into m from public.care_plan_changes where id = c1;
  perform pg_temp.ck('...state is signed, stamped as the signer', 'signed|' || v_doc::text, m.state || '|' || m.signed_by::text);
  perform pg_temp.ck('...with a signing time and an expiry', 'true', (m.signed_at is not null and m.expires_at > now())::text);
  perform pg_temp.ck('...and the medicine is still NOT on the patient''s list', '0', pg_temp.pz(v_pat, 'Lisinopril'));
  perform pg_temp.ck('the patient now sees it, with the summary and no clinical rationale', 'true',
    (pg_temp.q_as(v_pat, 'select public.my_care_plan_changes()::text') like '%second blood pressure tablet%'
     and pg_temp.q_as(v_pat, 'select public.my_care_plan_changes()::text') not like '%Average home readings%')::text);
  perform pg_temp.ck('the patient is told, neutrally', 'true',
    ((select count(*) from public.notifications where recipient_id = v_pat and template = 'care_change_ready_patient') = 1)::text);
  perform pg_temp.ck('...the notice carries ids only', 'true',
    ((select payload::text from public.notifications where recipient_id = v_pat and template = 'care_change_ready_patient' limit 1) !~* 'lisinopril|tablet|pressure')::text);
  perform pg_temp.ck('someone else cannot confirm it', 'ERR:Not authorised to confirm this change', pg_temp.confirm_as(v_pat2, c1));
  perform pg_temp.ck('a clinician cannot confirm on the patient''s behalf', 'ERR:Not authorised to confirm this change', pg_temp.confirm_as(v_doc, c1));

  r := pg_temp.confirm_as(v_pat, c1);
  perform pg_temp.ck('the patient confirms and it is applied, and her session is hers again', 'applied|true', r);
  perform pg_temp.ck('...the medicine is on her list now', '1', pg_temp.pz(v_pat, 'Lisinopril'));
  select * into m from public.medications where patient_id = v_pat and drug_name = 'Lisinopril';
  perform pg_temp.ck('...as a clinician prescription attributed to the signer, not the patient', 'clinician|' || v_doc::text, m.source::text || '|' || m.added_by::text);
  perform pg_temp.ck('...backed by a signed prescription that links back to the change', 'signed|' || v_doc::text || '|' || c1::text,
    (select p.state::text || '|' || p.signed_by::text || '|' || p.source_change_id::text from public.prescriptions p where p.id = m.prescription_id));
  perform pg_temp.ck('...with a verification code and a public token so the pharmacy form works', 'true', (m.rx_number is not null and m.verification_code is not null and m.public_token is not null)::text);
  perform pg_temp.ck('the change is confirmed and applied', 'confirmed', pg_temp.state_of(c1));
  perform pg_temp.ck('a second confirm does nothing', 'not_available|true', pg_temp.confirm_as(v_pat, c1));
  perform pg_temp.ck('the audit trail has the signing and the confirmation', '2',
    (select count(*)::text from public.audit_log where entity_id = c1 and action in ('care_plan_change.signed', 'care_plan_change.confirmed')));
end $$;


-- 3b. change, stop, decline, expiry, recheck ------------------------------------------------------------------------------
do $$
declare v_doc uuid := pg_temp.f('doc'); v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org');
  med uuid := pg_temp.f('med1'); c uuid; r text; old_id uuid; new_row record; n_before integer;
begin
  -- change an existing medicine (amlodipine 10 mg -> 5 mg twice a day)
  r := pg_temp.propose_med(v_doc, v_pat, jsonb_build_object('action', 'change', 'medication_id', med,
        'item', '{"drug_name":"Amlodipine","dose":"10 mg","frequency":"twice daily","route":"oral","duration_days":30,"quantity":"60 tablets","repeats_allowed":0}'::jsonb));
  perform pg_temp.ck('a change to a current prescription can be proposed', 'true', (r !~ '^ERR')::text);
  c := r::uuid;
  perform pg_temp.ck('...it records what it was before', 'true', ((select before ->> 'dose' from public.care_plan_changes where id = c) = '10 mg')::text);
  perform pg_temp.ck('...signs', 'ok', pg_temp.sign_as(v_doc, c, 'Your care team would like to change how you take your tablet.', true, null));
  perform pg_temp.ck('...nothing changed before she confirms', '10 mg', (select dose from public.medications where id = med));
  perform pg_temp.ck('...she confirms', 'applied|true', pg_temp.confirm_as(v_pat, c));
  perform pg_temp.ck('...the old row is superseded and inactive', 'false|true', (select is_active::text || '|' || (superseded_at is not null)::text from public.medications where id = med));
  select m.* into new_row from public.medications m where m.previous_version_id = med;
  perform pg_temp.ck('...the new version carries the new dose and is the signer''s', '10 mg|twice daily|' || v_doc::text, new_row.dose || '|' || new_row.frequency || '|' || new_row.added_by::text);
  perform pg_temp.ck('...its prescription supersedes the old one', 'true',
    ((select p2.supersedes_prescription_id = (select prescription_id from public.medications where id = med) from public.prescriptions p2 where p2.id = new_row.prescription_id))::text);
  perform pg_temp.setf('med1', new_row.id);

  -- stop
  r := pg_temp.propose_med(v_doc, v_pat, jsonb_build_object('action', 'stop', 'medication_id', new_row.id, 'reason', 'Side effect reported'));
  c := r::uuid;
  perform pg_temp.ck('a stop signs', 'ok', pg_temp.sign_as(v_doc, c, 'Your care team would like you to stop this tablet.', true, null));
  perform pg_temp.ck('...still active until she confirms', 'true', (select is_active::text from public.medications where id = new_row.id));
  perform pg_temp.ck('...she confirms', 'applied|true', pg_temp.confirm_as(v_pat, c));
  perform pg_temp.ck('...stopped with the reason', 'false|Side effect reported', (select is_active::text || '|' || stopped_reason from public.medications where id = new_row.id));
  perform pg_temp.ck('a stop needs a current prescription', 'true',
    (pg_temp.propose_med(v_doc, v_pat, jsonb_build_object('action', 'stop', 'medication_id', new_row.id)) like 'ERR:That is not a current prescription%')::text);

  -- decline: nothing changes, the signer is told
  r := pg_temp.propose_med(v_doc, v_pat, jsonb_build_object('action', 'start', 'item', '{"drug_name":"Ramipril","dose":"2.5 mg","frequency":"daily","duration_days":30,"quantity":"30 tablets"}'::jsonb));
  c := r::uuid; perform pg_temp.setf('c_decl', c);
  perform pg_temp.sign_as(v_doc, c, 'Your care team would like to start a new tablet.', true, null);
  perform pg_temp.ck('the patient can decline', 'ok', pg_temp.try_as(v_pat, format($q$select public.decline_care_plan_change(%L, 'I would like to talk first')$q$, c)));
  perform pg_temp.ck('...declined, nothing changed', 'declined|0', pg_temp.state_of(c) || '|' || pg_temp.pz(v_pat, 'Ramipril'));
  perform pg_temp.ck('...the signer is told neutrally', 'true',
    ((select count(*) from public.notifications where recipient_id = v_doc and template = 'care_change_declined_staff') = 1)::text);
  perform pg_temp.ck('...a declined change cannot then be confirmed', 'not_available|true', pg_temp.confirm_as(v_pat, c));
  perform pg_temp.ck('someone else cannot decline it', 'true', (pg_temp.try_as(pg_temp.f('pat2'), format($q$select public.decline_care_plan_change(%L)$q$, c)) like 'Not authorised%')::text);

  -- expiry through the sweep
  r := pg_temp.propose_med(v_doc, v_pat, jsonb_build_object('action', 'start', 'item', '{"drug_name":"Perindopril","dose":"4 mg","frequency":"daily","duration_days":30,"quantity":"30 tablets"}'::jsonb));
  c := r::uuid;
  perform pg_temp.sign_as(v_doc, c, 'Your care team would like to start a new tablet.', true, null);
  update public.care_plan_changes set expires_at = now() - interval '1 hour' where id = c;
  perform pg_temp.ck('a signed change past its date: confirming it lapses it and applies nothing', 'expired|true', pg_temp.confirm_as(v_pat, c));
  perform pg_temp.ck('...nothing on the list', '0', pg_temp.pz(v_pat, 'Perindopril'));
  r := pg_temp.propose_med(v_doc, v_pat, jsonb_build_object('action', 'start', 'item', '{"drug_name":"Enalapril","dose":"5 mg","frequency":"daily","duration_days":30,"quantity":"30 tablets"}'::jsonb));
  c := r::uuid;
  perform pg_temp.sign_as(v_doc, c, 'Your care team would like to start a new tablet.', true, null);
  update public.care_plan_changes set expires_at = now() - interval '1 hour' where id = c;
  perform pg_temp.ck('the sweep lapses an unanswered change', '1', private.sweep_care_plan_changes()::text);
  perform pg_temp.ck('...it is expired, the signer is told, and a second sweep does nothing', 'expired|true|0',
    pg_temp.state_of(c) || '|' || ((select count(*) from public.notifications where recipient_id = v_doc and template = 'care_change_expired_staff') >= 2)::text || '|' || private.sweep_care_plan_changes()::text);

  -- something new since signing sends it back
  r := pg_temp.propose_med(v_doc, v_pat, jsonb_build_object('action', 'start', 'item', '{"drug_name":"Sulfasalazine","dose":"500 mg","frequency":"daily","duration_days":30,"quantity":"30 tablets"}'::jsonb));
  c := r::uuid;
  perform pg_temp.sign_as(v_doc, c, 'Your care team would like to start a new tablet.', true, null);
  insert into public.patient_allergies (organisation_id, patient_id, allergen, source, recorded_by) values (v_org, v_pat, 'sulfasalazine', 'patient', v_pat);
  perform pg_temp.ck('a new allergy found at confirm time sends it back to the care team', 'needs_review|true', pg_temp.confirm_as(v_pat, c));
  perform pg_temp.ck('...nothing applied and the change lapsed', '0|expired', pg_temp.pz(v_pat, 'Sulfasalazine') || '|' || pg_temp.state_of(c));

  -- reject
  r := pg_temp.propose_med(v_doc, v_pat, jsonb_build_object('action', 'start', 'item', '{"drug_name":"Bisoprolol","dose":"2.5 mg","frequency":"daily","duration_days":30,"quantity":"30 tablets"}'::jsonb));
  c := r::uuid;
  perform pg_temp.ck('rejecting needs a reason', 'true', (pg_temp.try_as(v_doc, format($q$select public.reject_care_plan_change(%L, '')$q$, c)) like 'A reason is required%')::text);
  perform pg_temp.ck('a draft can be rejected with a reason', 'ok', pg_temp.try_as(v_doc, format($q$select public.reject_care_plan_change(%L, 'Not appropriate for this patient')$q$, c)));
  perform pg_temp.ck('...the patient never sees a rejected draft', 'false', (pg_temp.q_as(v_pat, 'select public.my_care_plan_changes()::text') like '%Bisoprolol%')::text);
end $$;

-- 3c. care plan targets and reading schedule ---------------------------------------------------------------------------------
do $$
declare v_doc uuid := pg_temp.f('doc'); v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); v_plan uuid; c uuid; r text;
begin
  insert into public.care_plans (organisation_id, patient_id, condition, status, target_ranges) values (v_org, v_pat, 'hypertension', 'active', '{"systolic_max":140,"diastolic_max":90}')
  returning id into v_plan;
  perform pg_temp.ck('a user session cannot edit a plan''s targets directly', '42501',
    pg_temp.try_claims(v_doc, format($q$update public.care_plans set target_ranges = '{"systolic_max":200}' where id = %L$q$, v_plan)));
  perform pg_temp.ck('...nor its reading schedule', '42501',
    pg_temp.try_claims(v_doc, format($q$update public.care_plans set reading_schedule = '{"per_week":1}' where id = %L$q$, v_plan)));
  perform pg_temp.ck('...but other plan fields are unaffected', 'ok', pg_temp.try_claims(v_doc, format($q$update public.care_plans set notes = 'reviewed' where id = %L$q$, v_plan)));
  r := pg_temp.q_as(v_doc, format($q$select public.propose_care_plan_change(%L, 'target', '{"target_ranges":{"systolic_max":130,"diastolic_max":80}}', 'Lower target after the review of risk.', %L)::text$q$, v_pat, v_plan));
  c := r::uuid;
  perform pg_temp.ck('a target change is proposed with its before value', '140', (select before -> 'target_ranges' ->> 'systolic_max' from public.care_plan_changes where id = c));
  perform pg_temp.sign_as(v_doc, c, 'Your care team would like to lower your blood pressure target.', true, null);
  perform pg_temp.ck('...unchanged until she confirms', '140', (select target_ranges ->> 'systolic_max' from public.care_plans where id = v_plan));
  perform pg_temp.ck('...she confirms', 'applied|true', pg_temp.confirm_as(v_pat, c));
  perform pg_temp.ck('...the target changed and the other value is kept or replaced as proposed', '130|80', (select (target_ranges ->> 'systolic_max') || '|' || (target_ranges ->> 'diastolic_max') from public.care_plans where id = v_plan));
  r := pg_temp.q_as(v_doc, format($q$select public.propose_care_plan_change(%L, 'reading_schedule', '{"reading_schedule":{"per_week":7}}', 'More readings while we adjust treatment.', %L)::text$q$, v_pat, v_plan));
  c := r::uuid;
  perform pg_temp.sign_as(v_doc, c, 'Your care team would like you to measure your pressure every day.', true, null);
  perform pg_temp.confirm_as(v_pat, c);
  perform pg_temp.ck('a reading schedule change applies the same way', '7', (select reading_schedule ->> 'per_week' from public.care_plans where id = v_plan));
  perform pg_temp.ck('a target change without a care plan is refused', 'true',
    (pg_temp.q_as(v_doc, format($q$select public.propose_care_plan_change(%L, 'target', '{"target_ranges":{"a":1}}', 'Lower target after the review of risk.')::text$q$, v_pat)) like 'ERR:A target change needs a care plan%')::text);
end $$;

-- 4. An unsigned change cannot be saved as signed; signed content is frozen -----------------------------------------------------
do $$
declare v_doc uuid := pg_temp.f('doc'); v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); c uuid; r text;
begin
  r := pg_temp.propose_med(v_doc, v_pat, jsonb_build_object('action', 'start', 'item', '{"drug_name":"Nifedipine","dose":"30 mg","frequency":"daily","duration_days":30,"quantity":"30 tablets"}'::jsonb));
  c := r::uuid; perform pg_temp.setf('c_unsigned', c);
  perform pg_temp.ck('moving a draft to signed with no signer is refused by the database', '23514',
    pg_temp.try_sql_owner(format($q$update public.care_plan_changes set state = 'signed', patient_summary = 'summary text here' where id = %L$q$, c)));
  perform pg_temp.ck('a change cannot be inserted already signed', '23514',
    pg_temp.try_sql_owner(format($q$insert into public.care_plan_changes (organisation_id, patient_id, kind, proposed_by, proposal, rationale, state, signed_by, signed_at, patient_summary)
        values (%L, %L, 'medication', 'clinician', '{"action":"stop"}', 'x', 'signed', %L, now(), 'summary text here')$q$, v_org, v_pat, v_doc)));
  perform pg_temp.ck('a draft cannot jump straight to confirmed', '23514',
    pg_temp.try_sql_owner(format($q$update public.care_plan_changes set state = 'confirmed' where id = %L$q$, c)));
  perform pg_temp.ck('a user session cannot sign by writing the row (no write access)', 'true',
    (pg_temp.try_as(v_doc, format($q$update public.care_plan_changes set state = 'signed' where id = %L$q$, c)) like 'permission denied%')::text);
  perform pg_temp.sign_as(v_doc, c, 'Your care team would like to start a new tablet.', true, null);
  perform pg_temp.ck('signed content is frozen', '42501',
    pg_temp.try_sql_owner(format($q$update public.care_plan_changes set proposal = '{"action":"stop"}' where id = %L$q$, c)));
  perform pg_temp.ck('the signature cannot be moved to someone else', '42501',
    pg_temp.try_sql_owner(format($q$update public.care_plan_changes set signed_by = %L where id = %L$q$, pg_temp.f('doc2'), c)));
  perform pg_temp.ck('a change is never deleted', '42501', pg_temp.try_sql_owner(format($q$delete from public.care_plan_changes where id = %L$q$, c)));
  r := pg_temp.q_as(v_doc, format($q$select public.list_care_plan_changes(%L, 'review')::text$q$, v_pat));
  perform pg_temp.ck('a tied clinician reads the list', 'true', (r like '%Nifedipine%')::text);
  perform pg_temp.ck('...and the read is audited', 'true',
    ((select count(*) from public.audit_log where subject_patient_id = v_pat and actor_id = v_doc and event::text like '%care_plan_changes%') >= 1)::text);
  perform pg_temp.ck('...an untied prescriber is refused', 'true',
    (pg_temp.q_as(pg_temp.f('doc2'), format($q$select public.list_care_plan_changes(%L)::text$q$, v_pat)) like 'ERR:Not authorised%')::text);
end $$;

-- 5. Protocols and engine proposals -----------------------------------------------------------------------------------------
do $$
declare v_doc uuid := pg_temp.f('doc'); v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); v_admin uuid; v_proto uuid; v_pa uuid; r text; c uuid;
  item jsonb := '{"drug_name":"Indapamide","dose":"1.5 mg","frequency":"daily","duration_days":30,"quantity":"30 tablets"}';
begin
  insert into public.protocols (code, version, status, definition) values ('htn_test_only', 1, 'draft', '{"code":"htn_test_only","version":1,"status":"draft","steps":[]}') returning id into v_proto;
  perform pg_temp.ck('protocol code and version must match the definition', '23514',
    pg_temp.try_sql_owner($q$insert into public.protocols (code, version, definition) values ('a', 1, '{"code":"b","version":1}')$q$));
  r := pg_temp.q_as(v_doc, format($q$select public.propose_care_plan_change(%L, 'medication', %L::jsonb, 'Step 2 of the test protocol applies.', null, 'engine', %L, '{"avg_sbp":152}'::jsonb)::text$q$, v_pat, jsonb_build_object('action', 'start', 'item', item)::text, v_proto));
  perform pg_temp.ck('an engine proposal on a DRAFT protocol is allowed for a test patient', 'true', (r !~ '^ERR')::text);
  c := r::uuid;
  perform pg_temp.ck('...it records the protocol version and the exact inputs', '1|152', (select protocol_version::text || '|' || (engine_inputs ->> 'avg_sbp') from public.care_plan_changes where id = c));
  update public.profiles set is_test = false where id = v_pat;
  r := pg_temp.q_as(v_doc, format($q$select public.propose_care_plan_change(%L, 'medication', %L::jsonb, 'Step 2 of the test protocol applies.', null, 'engine', %L, '{"avg_sbp":152}'::jsonb)::text$q$, v_pat, jsonb_build_object('action', 'start', 'item', item)::text, v_proto));
  perform pg_temp.ck('...but never for a real patient while it is a draft', 'true', (r like 'ERR:An engine proposal needs an approved protocol%')::text);
  r := pg_temp.q_as(v_doc, format($q$select public.propose_care_plan_change(%L, 'medication', %L::jsonb, 'Step 2 of the test protocol applies.', null, 'engine', %L, null)::text$q$, v_pat, jsonb_build_object('action', 'start', 'item', item)::text, v_proto));
  perform pg_temp.ck('...and never without its inputs', 'true', (r like 'ERR:An engine proposal needs an approved protocol%')::text);
  update public.profiles set is_test = true where id = v_pat;

  v_admin := pg_temp.f('admin');
  update public.protocols set status = 'approved', approved_by = v_admin, approved_at = now() where id = v_proto;
  perform pg_temp.ck('an approved protocol cannot be edited', '42501', pg_temp.try_sql_owner(format($q$update public.protocols set definition = '{"code":"htn_test_only","version":1,"steps":[1]}' where id = %L$q$, v_proto)));
  perform pg_temp.ck('...or deleted', '42501', pg_temp.try_sql_owner(format($q$delete from public.protocols where id = %L$q$, v_proto)));
  perform pg_temp.ck('the server can fetch the approved protocol', 'htn_test_only', (pg_temp.q_as(v_doc, $q$select (public.get_approved_protocol('htn_test_only') ->> 'code')$q$)));
  update public.profiles set is_test = false where id = v_pat;
  r := pg_temp.q_as(v_doc, format($q$select public.propose_care_plan_change(%L, 'medication', %L::jsonb, 'Step 2 of the test protocol applies.', null, 'engine', %L, '{"avg_sbp":152}'::jsonb)::text$q$, v_pat, jsonb_build_object('action', 'start', 'item', item)::text, v_proto));
  perform pg_temp.ck('a real patient can be proposed to from an APPROVED protocol', 'true', (r !~ '^ERR')::text);
  update public.profiles set is_test = true where id = v_pat;
end $$;

-- 6. Referrals ---------------------------------------------------------------------------------------------------------------
do $$
declare v_doc uuid := pg_temp.f('doc'); v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); rid uuid;
begin
  perform pg_temp.ck('a clinician-initiated referral cannot leave draft without the patient''s consent', '23514',
    pg_temp.try_claims(v_doc, format($q$insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason, status, origin, referral_source)
        values (%L, %L, 'cardiology', 'Resistant hypertension', 'pending', 'clinically_triggered', 'clinician_initiated')$q$, v_org, v_pat)));
  perform pg_temp.ck('a draft can be saved first', 'ok',
    pg_temp.try_claims(v_doc, format($q$insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason, status, origin, referral_source)
        values (%L, %L, 'cardiology', 'Resistant hypertension', 'draft', 'clinically_triggered', 'clinician_initiated')$q$, v_org, v_pat)));
  perform pg_temp.ck('with consent recorded it is sent', 'ok',
    pg_temp.try_claims(v_doc, format($q$insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason, status, origin, referral_source, patient_consent_at)
        values (%L, %L, 'cardiology', 'Resistant hypertension', 'pending', 'clinically_triggered', 'clinician_initiated', now())$q$, v_org, v_pat)));
  perform pg_temp.ck('...and is given a chase date', 'true',
    ((select chase_due_at from public.specialist_referrals where patient_id = v_pat and status = 'pending' limit 1) > now())::text);
  -- through the real functions
  perform pg_temp.ck('create_specialist_referral for sending, without consent, is refused', 'true',
    (pg_temp.try_as(v_doc, format($q$select public.create_specialist_referral(%L, 'nephrology', 'clinician_initiated', 'routine', 'Raised creatinine', 'review', '[]'::jsonb, false)$q$, v_pat)) like 'The patient must agree%')::text);
  perform pg_temp.ck('...with consent it is created and given a chase date', 'ok', 
    pg_temp.try_as(v_doc, format($q$select public.create_specialist_referral(%L, 'nephrology', 'clinician_initiated', 'routine', 'Raised creatinine', 'review', '[]'::jsonb, false, now())$q$, v_pat)));
  select id into rid from public.specialist_referrals where patient_id = v_pat and status = 'draft' limit 1;
  perform pg_temp.ck('a draft submitted without consent is refused', 'true',
    (pg_temp.try_as(v_doc, format($q$select public.submit_draft_referral(%L)$q$, rid)) like 'The patient must agree%')::text);
  perform pg_temp.ck('...with consent it is submitted', 'ok',
    pg_temp.try_as(v_doc, format($q$select public.submit_draft_referral(%L, now())$q$, rid)));
  -- an older referral with no recorded consent can still be worked on (status moves, urgency) by the clinician
  set local session_replication_role = replica;
  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason, status, origin, referral_source, signed_by, signed_at)
    values (v_org, v_pat, 'nephrology', 'Legacy row', 'pending', 'clinically_triggered', 'clinician_initiated', v_doc, now()) returning id into rid;
  set local session_replication_role = origin;
  perform pg_temp.ck('an older referral without consent can still be updated by a clinician', 'ok',
    pg_temp.try_claims(v_doc, format($q$update public.specialist_referrals set referral_reason = 'Legacy row, reviewed' where id = %L$q$, rid)));
  select id into rid from public.specialist_referrals where patient_id = v_pat and status = 'pending' limit 1;
  update public.specialist_referrals set chase_due_at = now() - interval '1 day' where id = rid;
  perform pg_temp.ck('an open referral past its chase date is chased', '1', private.sweep_referral_chasers()::text);
  perform pg_temp.ck('...once', '0', private.sweep_referral_chasers()::text);
end $$;

-- 7. SABOTAGE: the medicine signature trigger dropped, and the signature CHECK dropped ------------------------------------------
drop trigger medications_b_require_signed_prescription on public.medications;
alter table public.care_plan_changes drop constraint care_plan_changes_signed_by_signed_at;

do $$
declare v_doc uuid := pg_temp.f('doc'); v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); c uuid := pg_temp.f('c_unsigned');
  c2 uuid;
begin
  insert into results values ('sabotaged', 'a clinician medicine without a signature is refused', 'refused',
    case when pg_temp.try_claims(v_doc, format($q$insert into public.medications (organisation_id, patient_id, source, drug_name, dose, frequency, quantity, duration_days, repeats_allowed) values (%L, %L, 'clinician', 'Sabotage drug', '1 mg', 'daily', '30', 30, 0)$q$, v_org, v_pat)) = '42501' then 'refused' else 'accepted' end);
end $$;

do $$
declare v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); c2 uuid;
begin
  insert into public.care_plan_changes (organisation_id, patient_id, kind, proposed_by, proposal, rationale) values
    (v_org, v_pat, 'medication', 'clinician', '{"action":"stop"}', 'sabotage row') returning id into c2;
  insert into results values ('sabotaged', 'an unsigned change cannot be saved as signed', 'refused',
    case when pg_temp.try_sql_owner(format($q$update public.care_plan_changes set state = 'signed', patient_summary = 'summary text here' where id = %L$q$, c2)) = '23514' then 'refused' else 'accepted' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S24 proof FAILED on the real migrations: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
