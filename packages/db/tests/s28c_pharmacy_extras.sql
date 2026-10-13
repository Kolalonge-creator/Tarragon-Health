-- S28c proof: the founder's additions on top of the live collection-code migration (migration *_s28c_pharmacy_extras.sql and *_s28d_pharmacy_legacy_cleanup.sql).
-- INV-02 (an answer never changes a signed prescription), INV-07 (neutral notices), INV-10 (audited reads), INV-12 (the tie), INV-13 (is_test), INV-14 (go-live guard).
-- One rolled-back transaction. Sections:
--   1. The S37 guard: closed, every patient and pharmacy function refuses and withdrawing still works; its conditions are read from the data.
--   2. Structured questions: six fixed, no free text, a task for the queue, the signer answers from three, tie-checked, not after it left the pharmacy.
--   3. Batch and expiry: required for any supply, an expired batch refused.
--   4. A caregiver with the pharmacy permission chooses and withdraws for the patient; a stranger, a wrong permission and an expired grant are refused.
--   5. A repeat supply is a new send: only while a supply remains, a new code, the old one dies; one supplied elsewhere is not offered.
--   6. Withdrawal: the code dies, the pharmacy loses it, not once a supply has started.
--   7. S28d: no delivery column for patients, is_test stamped, the older reads audited, the neutral order alert.
--   8. SABOTAGE: the caregiver gate opened, the go-live gate removed, the is_test stamp dropped; every one must flip.
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


-- Switch the S37 prescribing guard the way the guard's own trigger allows: a log row in this transaction, then the update.
create function pg_temp.guard(p_on boolean) returns void language plpgsql as $f$
begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
  values ('prescribing_enabled', case when p_on then 'switched_on' else 'switched_off' end, pg_temp.f('admin'), 'admin', 'S28c proof', '[]'::jsonb);
  update public.go_live_guards
     set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then pg_temp.f('admin') end, change_note = case when p_on then 'S28c proof' end
   where key = 'prescribing_enabled';
end $f$;
-- a clinician with a staff row (so the tie and the tier checks have something to read)
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid) returns uuid language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician', 'S28c ' || p_label);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S28c ' || p_label, 'MDCN', 'S28c-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer', 'contracted', 2, true, p_admin, true);
  return v;
end $f$;
-- the live collection code of a prescription (read as the owner; the API roles cannot read the table)
-- the trigger itself, with no route flag: returns the sqlstate of the refusal ('ok' if it was allowed)
create function pg_temp.try_state(p_rx uuid, p_state text) returns text language plpgsql as $f$
begin
  update public.prescriptions set state = p_state::public.prescription_state where id = p_rx;
  return 'ok';
exception when others then return sqlstate;
end $f$;
create function pg_temp.code_of(p_rx uuid) returns text language sql as $$ select code from public.prescription_collection_codes where prescription_id = p_rx $$;
-- an unanswered question first (rows made in one transaction share a timestamp), else any
create function pg_temp.flag_of(p_rx uuid) returns uuid language sql as $$ select f.id from public.prescription_pharmacy_flags f where f.prescription_id = p_rx and f.question_code is not null order by exists (select 1 from public.prescription_flag_answers a where a.flag_id = f.id), f.created_at desc limit 1 $$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_pA uuid; v_pB uuid; v_lA uuid; v_lB uuid; v_doc uuid; v_pat uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', 'S28c Admin');
  perform pg_temp.setf('admin', v_admin);
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, license_expires_at, onboarding_status, state, city, area)
    values ('S28c Pharmacy A', true, now(), now(), current_date + 365, 'activated', 'Lagos', 'Lagos', 'Yaba') returning id into v_pA;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, license_expires_at, onboarding_status, state, city, area)
    values ('S28c Pharmacy B', true, now(), now(), current_date + 365, 'activated', 'Lagos', 'Lagos', 'Ikeja') returning id into v_pB;
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state, address, is_active, verified_at) values (v_pA, 'S28c A Lekki', 'Lagos', '1 Test Road', true, now()) returning id into v_lA;
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state, address, is_active, verified_at) values (v_pB, 'S28c B Ikeja', 'Lagos', '2 Test Road', true, now()) returning id into v_lB;
  perform pg_temp.setf('pA', v_pA); perform pg_temp.setf('pB', v_pB); perform pg_temp.setf('lA', v_lA); perform pg_temp.setf('lB', v_lB);
  perform pg_temp.setf('phA', pg_temp.mkuser(v_org, 'phA', 'pharmacist', 'S28c Pharmacist A'));
  perform pg_temp.setf('phB', pg_temp.mkuser(v_org, 'phB', 'pharmacist', 'S28c Pharmacist B'));
  update public.profiles set pharmacy_partner_id = v_pA where id = pg_temp.f('phA');
  update public.profiles set pharmacy_partner_id = v_pB where id = pg_temp.f('phB');
  v_doc := pg_temp.mkdoc(v_org, 'doc', v_admin);
  perform pg_temp.setf('doc', v_doc);
  perform pg_temp.setf('doc2', pg_temp.mkdoc(v_org, 'doc2', v_admin));
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', 'S28c Patient');
  perform pg_temp.setf('pat', v_pat);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_pat, v_doc, now());
  perform pg_temp.setf('cg_ok', pg_temp.mkuser(v_org, 'cg_ok', 'patient', 'S28c Caregiver'));
  perform pg_temp.setf('cg_no', pg_temp.mkuser(v_org, 'cg_no', 'patient', 'S28c Wrong Permission'));
  perform pg_temp.setf('cg_exp', pg_temp.mkuser(v_org, 'cg_exp', 'patient', 'S28c Expired'));
  perform pg_temp.setf('stranger', pg_temp.mkuser(v_org, 'stranger', 'patient', 'S28c Stranger'));
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions, expires_at) values
    (v_pat, pg_temp.f('cg_ok'), 'manage', v_pat, array['manage_pharmacy']::public.caregiver_permission[], null),
    (v_pat, pg_temp.f('cg_no'), 'manage', v_pat, array['view_medication']::public.caregiver_permission[], null),
    (v_pat, pg_temp.f('cg_exp'), 'manage', v_pat, array['manage_pharmacy']::public.caregiver_permission[], now() + interval '1 hour');
  perform pg_temp.setf('rxG', pg_temp.mkrx(v_org, v_pat, v_doc, 'GuardDrug', 'signed'));
end $$;

-- 1. The S37 guard ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_rx uuid := pg_temp.f('rxG'); v_cond jsonb;
begin
  perform pg_temp.ck('real', '1a the guard starts off', 'false', (select is_on::text from public.go_live_guards where key = 'prescribing_enabled'));
  perform pg_temp.ck('real', '1b while off, the patient list refuses', 'ERR:55000', pg_temp.q_as(v_pat, format($q$select count(*)::text from public.patient_collection_pharmacies(%L)$q$, v_rx)));
  perform pg_temp.ck('real', '1c while off, choosing refuses', 'ERR:55000', pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, v_rx, pg_temp.f('pA'), pg_temp.f('lA'))));
  perform pg_temp.ck('real', '1d while off, the pharmacy list refuses', 'ERR:55000', pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.pharmacist_prescriptions()'));
  perform pg_temp.ck('real', '1e while off, asking a question refuses', 'ERR:55000', pg_temp.q_as(pg_temp.f('phA'), format($q$select public.pharmacist_ask_prescriber(%L, 'call_me')::text$q$, v_rx)));
  v_cond := private.go_live_conditions('prescribing_enabled', pg_temp.f('org'));
  perform pg_temp.ck('real', '1f the guard lists the pharmacy conditions', 'clinical_lead_signoff,clinical_safety_case_current,notification_sender_deployed,pharmacy_licence_current,pharmacy_partner_active,pharmacy_rules_confirmed',
    (select string_agg(c ->> 'code', ',' order by c ->> 'code') from jsonb_array_elements(v_cond) c));
  perform pg_temp.ck('real', '1g a verified licence with a verified location is met; unconfirmed rules and an unattested sender are not', 'true|false|false',
    (select max(c ->> 'met') filter (where c ->> 'code' = 'pharmacy_licence_current') || '|' || max(c ->> 'met') filter (where c ->> 'code' = 'pharmacy_rules_confirmed') || '|' ||
            max(c ->> 'met') filter (where c ->> 'code' = 'notification_sender_deployed') from jsonb_array_elements(v_cond) c));
  perform pg_temp.guard(true);
  perform pg_temp.ck('real', '1h with the guard on, the patient list works', 'true', (pg_temp.q_as(v_pat, format($q$select count(*)::text from public.patient_collection_pharmacies(%L)$q$, v_rx))::integer >= 2)::text);
end $$;

-- 2. Structured questions ---------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); v_doc2 uuid := pg_temp.f('doc2'); pA uuid := pg_temp.f('pA'); lA uuid := pg_temp.f('lA');
  phA uuid := pg_temp.f('phA'); phB uuid := pg_temp.f('phB'); rx uuid; flag uuid; v_ov jsonb;
begin
  rx := pg_temp.mkrx(v_org, v_pat, v_doc, 'QuestionDrug', 'signed');
  perform pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx, pA, lA));
  perform pg_temp.ck('real', '2a a free-text question is refused', 'ERR:22023', pg_temp.q_as(phA, format($q$select public.pharmacist_ask_prescriber(%L, 'Please confirm the strength for Ada')::text$q$, rx)));
  perform pg_temp.ck('real', '2b another pharmacy cannot ask on it', 'ERR:42501', pg_temp.q_as(phB, format($q$select public.pharmacist_ask_prescriber(%L, 'call_me')::text$q$, rx)));
  perform pg_temp.ck('real', '2c the pharmacy asks one of the six', 'true', (pg_temp.q_as(phA, format($q$select public.pharmacist_ask_prescriber(%L, 'dose_unclear')::text$q$, rx)) not like 'ERR:%')::text);
  flag := pg_temp.flag_of(rx);
  perform pg_temp.ck('real', '2d it is stored as a fixed code with the fixed sentence', 'dose_unclear|The dose or directions are unclear',
    (select question_code || '|' || reason from public.prescription_pharmacy_flags where id = flag));
  perform pg_temp.ck('real', '2e the question also reaches the clinical queue as one pharmacy_flag_review task', '1',
    (select count(*)::text from public.clinical_tasks where patient_id = v_pat and type = 'pharmacy_flag_review'));
  perform pg_temp.ck('real', '2f the signer got one neutral notice', '1', (select count(*)::text from public.notifications where recipient_id = v_doc and template = 'pharmacy_flag_notice'));
  v_ov := pg_temp.q_as(v_doc, 'select public.prescriber_pharmacy_overview()::text')::jsonb;
  perform pg_temp.ck('real', '2g the signer sees the question as a fixed reason, with no patient contact detail', 'dose_unclear|false',
    ((select q ->> 'reason_code' from jsonb_array_elements(v_ov -> 'questions') q where q ->> 'question_id' = flag::text)) || '|' || ((v_ov -> 'questions' -> 0) ? 'phone')::text);
  perform pg_temp.ck('real', '2g2 asking the same open question again returns the same one and tells nobody twice', 'true|1',
    ((pg_temp.q_as(phA, format($q$select public.pharmacist_ask_prescriber(%L, 'dose_unclear')::text$q$, rx)) = flag::text)::text) || '|' ||
    (select count(*)::text from public.notifications where recipient_id = v_doc and template = 'pharmacy_flag_notice'));
  perform pg_temp.ck('real', '2h the pharmacy shows one open question', '1', pg_temp.q_as(phA, format($q$select open_flags::text from public.pharmacist_prescriptions() where prescription_id = %L$q$, rx)));
  perform pg_temp.ck('real', '2i the patient cannot read the prescriber overview', 'ERR:42501', pg_temp.q_as(v_pat, 'select public.prescriber_pharmacy_overview()::text'));
  perform pg_temp.ck('real', '2j a clinician who did not sign it cannot answer', 'ERR:42501', pg_temp.q_as(v_doc2, format($q$select public.answer_pharmacy_question(%L, 'keep_as_written')::text$q$, flag)));
  perform pg_temp.ck('real', '2k ...and sees none of it', '0', pg_temp.q_as(v_doc2, 'select jsonb_array_length(public.prescriber_pharmacy_overview() -> ''questions'')::text'));
  perform pg_temp.ck('real', '2l the patient cannot answer it', 'ERR:42501', pg_temp.q_as(v_pat, format($q$select public.answer_pharmacy_question(%L, 'keep_as_written')::text$q$, flag)));
  perform pg_temp.ck('real', '2m the pharmacy cannot answer its own question', 'ERR:42501', pg_temp.q_as(phA, format($q$select public.answer_pharmacy_question(%L, 'keep_as_written')::text$q$, flag)));
  perform pg_temp.ck('real', '2n free text is not an answer', 'ERR:22023', pg_temp.q_as(v_doc, format($q$select public.answer_pharmacy_question(%L, 'Yes that is fine')::text$q$, flag)));
  perform pg_temp.ck('real', '2o the signer answers', 'true', (pg_temp.q_as(v_doc, format($q$select public.answer_pharmacy_question(%L, 'new_prescription_coming')::text$q$, flag))::jsonb ->> 'ok'));
  perform pg_temp.ck('real', '2p a second answer is refused', 'already_answered', (pg_temp.q_as(v_doc, format($q$select public.answer_pharmacy_question(%L, 'keep_as_written')::text$q$, flag))::jsonb ->> 'reason'));
  perform pg_temp.ck('real', '2q the pharmacy sees the answer', 'dose_unclear|new_prescription_coming',
    pg_temp.q_as(phA, format($q$select question_code || '|' || answer_code from public.pharmacist_prescription_questions(%L)$q$, rx)));
  perform pg_temp.ck('real', '2r ...and its open question count drops to 0', '0', pg_temp.q_as(phA, format($q$select open_flags::text from public.pharmacist_prescriptions() where prescription_id = %L$q$, rx)));
  perform pg_temp.ck('real', '2s another pharmacy sees none of its questions', '0', pg_temp.q_as(phB, format($q$select count(*)::text from public.pharmacist_prescription_questions(%L)$q$, rx)));
  perform pg_temp.ck('real', '2t an answer changes nothing on the signed prescription (INV-02)', 'sent|QuestionDrug',
    (select state::text || '|' || (items -> 0 ->> 'drug') from public.prescriptions where id = rx));
  perform pg_temp.ck('real', '2u the answer and the question were audited', '1|1',
    (select count(*) filter (where action = 'prescription.pharmacy_question_answered')::text || '|' || count(*) filter (where action = 'prescription.pharmacy_question')::text from public.audit_log where entity_id = rx));
  perform pg_temp.ck('real', '2v the notices to the pharmacy and the patient name no medicine', '0',
    (select count(*)::text from public.notifications where template in ('pharmacy_question_answered', 'pharmacy_collection_update', 'pharmacy_flag_notice') and payload::text ilike '%QuestionDrug%'));
  -- out of stock: a fixed notice, the patient is told and is shown that she needs another pharmacy
  perform pg_temp.ck('real', '2w out of stock: another pharmacy cannot report it', 'ERR:42501', pg_temp.q_as(phB, format($q$select public.pharmacist_report_out_of_stock(%L)::text$q$, rx)));
  perform pg_temp.ck('real', '2x out of stock is reported without text', 'true', (pg_temp.q_as(phA, format($q$select public.pharmacist_report_out_of_stock(%L)::text$q$, rx)) not like 'ERR:%')::text);
  perform pg_temp.q_as(phA, format($q$select public.pharmacist_report_out_of_stock(%L)::text$q$, rx));
  perform pg_temp.ck('real', '2x2 a second report is not a second flag', '1', (select count(*)::text from public.prescription_pharmacy_flags where prescription_id = rx and kind = 'out_of_stock'));
  perform pg_temp.ck('real', '2y the patient is shown she needs another pharmacy', 'true', pg_temp.q_as(v_pat, format($q$select other_pharmacy_needed::text from public.patient_prescription_collection(%L)$q$, rx)));
  -- a question cannot be answered once the prescription has left the pharmacy that asked
  perform pg_temp.q_as(phA, format($q$select public.pharmacist_ask_prescriber(%L, 'call_me')::text$q$, rx));
  flag := pg_temp.flag_of(rx);
  perform pg_temp.q_as(v_pat, format($q$select public.patient_withdraw_from_pharmacy(%L)::text$q$, rx));
  perform pg_temp.ck('real', '2z an answer after the prescription left the pharmacy is refused', 'not_waiting', (pg_temp.q_as(v_doc, format($q$select public.answer_pharmacy_question(%L, 'keep_as_written')::text$q$, flag))::jsonb ->> 'reason'));
end $$;

-- 3. Batch and expiry ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); pA uuid := pg_temp.f('pA'); lA uuid := pg_temp.f('lA'); phA uuid := pg_temp.f('phA'); rx uuid; code text;
begin
  rx := pg_temp.mkrx(v_org, v_pat, v_doc, 'BatchDrug', 'signed');
  code := pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx, pA, lA));
  perform pg_temp.ck('real', '3a no batch is refused', 'batch_required', pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_dispense_prescription(%L, %L, '30 tablets', false, null, null, %L, 'PCN12345', 'Ada Pharmacist')$q$, rx, code, (current_date + 400)::text)));
  perform pg_temp.ck('real', '3b a batch with no expiry is refused', 'batch_required', pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_dispense_prescription(%L, %L, '30 tablets', false, null, 'B1', null, 'PCN12345', 'Ada Pharmacist')$q$, rx, code)));
  perform pg_temp.ck('real', '3c an expired batch is refused', 'batch_expired', pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_dispense_prescription(%L, %L, '30 tablets', false, null, 'B1', %L, 'PCN12345', 'Ada Pharmacist')$q$, rx, code, (current_date - 5)::text)));
  perform pg_temp.ck('real', '3d a wrong code is still reported as a wrong code (not as a batch problem)', 'wrong_code', pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_dispense_prescription(%L, 'WRONG123', '30 tablets', false, null, null, null, 'PCN12345', 'Ada Pharmacist')$q$, rx)));
  perform pg_temp.ck('real', '3e nothing was recorded by the refusals', 'sent|0',
    pg_temp.rxstate(rx) || '|' || (select count(*)::text from public.pharmacy_order_dispenses d join public.medications m on m.id = d.medication_id where m.prescription_id = rx));
  perform pg_temp.ck('real', '3f with batch and expiry it is recorded', 'recorded', pg_temp.q_as(phA, format($q$select outcome from public.pharmacist_dispense_prescription(%L, %L, '30 tablets', false, null, 'B1', %L, 'PCN12345', 'Ada Pharmacist')$q$, rx, code, (current_date + 400)::text)));
  perform pg_temp.ck('real', '3g the supply record carries the batch', 'B1',
    (select d.batch_number from public.pharmacy_order_dispenses d join public.medications m on m.id = d.medication_id where m.prescription_id = rx));
  perform pg_temp.ck('real', '3h the medicine record and its QR token are untouched, so the downloadable form still works at any pharmacy', 'true|true',
    (select (is_active and superseded_at is null)::text || '|' || (public_token is not null)::text from public.medications where prescription_id = rx));
end $$;

-- 4. A caregiver with the pharmacy permission ----------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); pA uuid := pg_temp.f('pA'); lA uuid := pg_temp.f('lA');
  cg_ok uuid := pg_temp.f('cg_ok'); cg_no uuid := pg_temp.f('cg_no'); cg_exp uuid := pg_temp.f('cg_exp'); st uuid := pg_temp.f('stranger'); rx uuid; v_before integer;
begin
  rx := pg_temp.mkrx(v_org, v_pat, v_doc, 'CaregiverDrug', 'signed');
  select count(*) into v_before from public.notifications where recipient_id = v_pat and template = 'pharmacy_collection_update';
  perform pg_temp.ck('real', '4a a stranger cannot list pharmacies for the patient', 'ERR:42501', pg_temp.q_as(st, format($q$select count(*)::text from public.patient_collection_pharmacies(%L, %L)$q$, rx, v_pat)));
  perform pg_temp.ck('real', '4b a caregiver with another permission cannot choose', 'ERR:42501', pg_temp.q_as(cg_no, format($q$select public.patient_choose_pharmacy(%L, %L, %L, %L)$q$, rx, pA, lA, v_pat)));
  perform pg_temp.ck('real', '4c a caregiver acting as themselves cannot touch the patient''s prescription', 'ERR:42501', pg_temp.q_as(cg_ok, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx, pA, lA)));
  perform pg_temp.ck('real', '4d the caregiver with the permission chooses for the patient', 'true', (pg_temp.q_as(cg_ok, format($q$select public.patient_choose_pharmacy(%L, %L, %L, %L)$q$, rx, pA, lA, v_pat)) ~ '^[0-9A-Z]{8}$')::text);
  perform pg_temp.ck('real', '4e the prescription is sent, and the audit row says it was done for her', 'sent|true',
    pg_temp.rxstate(rx) || '|' || (select (event ->> 'acted_for')::text from public.audit_log where entity_id = rx and action = 'prescription.pharmacy_chosen' order by created_at desc limit 1));
  perform pg_temp.ck('real', '4f the patient''s access log records the caregiver', '1', (select count(*)::text from public.care_access_events where patient_id = v_pat and actor_profile_id = cg_ok and kind = 'acted_for' and scope = 'data_shared_pharmacy'));
  perform pg_temp.ck('real', '4g the patient is told, neutrally', '1', ((select count(*) from public.notifications where recipient_id = v_pat and template = 'pharmacy_collection_update') - v_before)::text);
  perform pg_temp.ck('real', '4h the caregiver can read the collection details', 'true', (pg_temp.q_as(cg_ok, format($q$select code from public.patient_prescription_collection(%L, %L)$q$, rx, v_pat)) ~ '^[0-9A-Z]{8}$')::text);
  perform pg_temp.ck('real', '4i a stranger cannot withdraw it', 'ERR:42501', pg_temp.q_as(st, format($q$select public.patient_withdraw_from_pharmacy(%L, %L)::text$q$, rx, v_pat)));
  update public.profile_access set created_at = now() - interval '1 day', expires_at = now() - interval '1 minute' where grantee_user_id = cg_exp;
  perform pg_temp.ck('real', '4j an expired grant stops working', 'ERR:42501', pg_temp.q_as(cg_exp, format($q$select public.patient_withdraw_from_pharmacy(%L, %L)::text$q$, rx, v_pat)));
  perform pg_temp.ck('real', '4k the caregiver can take it back for her', 'true', (pg_temp.q_as(cg_ok, format($q$select public.patient_withdraw_from_pharmacy(%L, %L)::text$q$, rx, v_pat))::jsonb ->> 'ok'));
  perform pg_temp.ck('real', '4l it is signed again with no pharmacy and no code', 'signed|0|',
    pg_temp.rxstate(rx) || '|' || (select count(*)::text from public.prescription_collection_codes where prescription_id = rx) || '|' || coalesce((select pharmacy_partner_id::text from public.prescriptions where id = rx), ''));
end $$;

-- 5. A repeat supply is a new send ---------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); pA uuid := pg_temp.f('pA'); lA uuid := pg_temp.f('lA'); phA uuid := pg_temp.f('phA');
  st uuid := pg_temp.f('stranger'); rx uuid; v_med uuid; code1 text; code2 text; rx2 uuid;
begin
  rx := pg_temp.mkrx(v_org, v_pat, v_doc, 'RepeatDrug', 'signed');
  v_med := pg_temp.med_of(rx);
  -- fixture only: the confirm-only trigger refuses an owner session with no prescriber, so it is stepped over for this one statement
  set local session_replication_role = replica;
  update public.medications set repeats_allowed = 1 where id = v_med;
  set local session_replication_role = origin;
  code1 := pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx, pA, lA));
  perform pg_temp.ck('real', '5a the first supply is recorded', 'recorded', pg_temp.disp_as(phA, rx, code1, false, null, 'PCN12345'));
  perform pg_temp.ck('real', '5b the prescription is collected', 'dispensed', pg_temp.rxstate(rx));
  perform pg_temp.ck('real', '5c with no repeat approved yet, it cannot be sent again', 'ERR:22023', pg_temp.q_as(v_pat, format($q$select count(*)::text from public.patient_collection_pharmacies(%L)$q$, rx)));
  perform pg_temp.ck('real', '5d ...and choosing is refused', 'ERR:22023', pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx, pA, lA)));
  perform pg_temp.ck('real', '5e ...and the screen is not told it can repeat', 'false', pg_temp.q_as(v_pat, format($q$select can_repeat::text from public.patient_prescription_collection(%L)$q$, rx)));
  insert into public.medication_repeat_requests (organisation_id, patient_id, medication_id) values (v_org, v_pat, v_med);
  update public.medication_repeat_requests set status = 'approved' where medication_id = v_med;
  perform pg_temp.ck('real', '5f once the clinician approves a repeat, the screen is told it can repeat', 'true', pg_temp.q_as(v_pat, format($q$select can_repeat::text from public.patient_prescription_collection(%L)$q$, rx)));
  perform pg_temp.ck('real', '5g a stranger cannot send it again', 'ERR:42501', pg_temp.q_as(st, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx, pA, lA)));
  code2 := pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx, pA, lA));
  perform pg_temp.ck('real', '5h the repeat is a new send with a new code', 'sent|true|true', pg_temp.rxstate(rx) || '|' || (code2 ~ '^[0-9A-Z]{8}$')::text || '|' || (code2 <> code1)::text);
  perform pg_temp.ck('real', '5i it waits at the pharmacy again with no old collection time', 'true', (select (dispensed_at is null)::text from public.prescriptions where id = rx));
  perform pg_temp.ck('real', '5j the old code no longer works', 'wrong_code', pg_temp.verify_as(phA, rx, code1));
  perform pg_temp.ck('real', '5k the second supply is recorded', 'recorded', pg_temp.disp_as(phA, rx, code2, false, null, 'PCN12345'));
  perform pg_temp.ck('real', '5l no third send is offered', 'ERR:22023', pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx, pA, lA)));
  -- the state machine: without the patient's route flag nobody can push a collected prescription back to sent, or a waiting one back to signed
  perform pg_temp.ck('real', '5m0 a collected prescription cannot go back to sent without the route flag', '23514',
    (select pg_temp.try_state(rx, 'sent')));
  -- a prescription already supplied some other way (the QR check or the phone desk) is not offered to a partner at all
  rx2 := pg_temp.mkrx(v_org, v_pat, v_doc, 'ElsewhereDrug', 'signed');
  insert into public.pharmacy_order_dispenses (organisation_id, patient_id, medication_id, drug_name, source, recorded_via, dispensed_on)
    values (v_org, v_pat, pg_temp.med_of(rx2), 'ElsewhereDrug', 'pharmacy', 'public_verification', current_date);
  perform pg_temp.ck('real', '5m supplied elsewhere: not listed', 'ERR:22023', pg_temp.q_as(v_pat, format($q$select count(*)::text from public.patient_collection_pharmacies(%L)$q$, rx2)));
  perform pg_temp.ck('real', '5n supplied elsewhere: not sendable', 'ERR:22023', pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx2, pA, lA)));
end $$;

-- 6. Withdrawal ----------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); pA uuid := pg_temp.f('pA'); lA uuid := pg_temp.f('lA'); phA uuid := pg_temp.f('phA');
  rx uuid; rx2 uuid; code text;
begin
  rx := pg_temp.mkrx(v_org, v_pat, v_doc, 'WithdrawDrug', 'signed');
  code := pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx, pA, lA));
  perform pg_temp.ck('real', '6a the pharmacy sees it', '1', pg_temp.q_as(phA, format($q$select count(*)::text from public.pharmacist_prescriptions() where prescription_id = %L$q$, rx)));
  perform pg_temp.q_as(v_pat, format($q$select public.patient_withdraw_from_pharmacy(%L)::text$q$, rx));
  perform pg_temp.ck('real', '6b after withdrawal the pharmacy no longer sees it', '0', pg_temp.q_as(phA, format($q$select count(*)::text from public.pharmacist_prescriptions() where prescription_id = %L$q$, rx)));
  perform pg_temp.ck('real', '6c ...and the old code is dead', 'not_found', pg_temp.verify_as(phA, rx, code));
  perform pg_temp.ck('real', '6d withdrawing a prescription that is not sent is refused', 'ERR:22023', pg_temp.q_as(v_pat, format($q$select public.patient_withdraw_from_pharmacy(%L)::text$q$, rx)));
  rx2 := pg_temp.mkrx(v_org, v_pat, v_doc, 'PartialDrug', 'signed');
  code := pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx2, pA, lA));
  perform pg_temp.ck('real', '6e a partial supply is recorded', 'partial_recorded', pg_temp.disp_as(phA, rx2, code, true, 'Remainder on Friday', 'PCN12345'));
  perform pg_temp.ck('real', '6f once a supply has started she cannot take it back', 'ERR:22023', pg_temp.q_as(v_pat, format($q$select public.patient_withdraw_from_pharmacy(%L)::text$q$, rx2)));
  -- taking back never depends on the guard: she can always remove sharing
  rx2 := pg_temp.mkrx(v_org, v_pat, v_doc, 'GuardOffDrug', 'signed');
  perform pg_temp.q_as(v_pat, format($q$select public.patient_choose_pharmacy(%L, %L, %L)$q$, rx2, pA, lA));
  perform pg_temp.guard(false);
  perform pg_temp.ck('real', '6g with the guard off she can still take it back', 'true', (pg_temp.q_as(v_pat, format($q$select public.patient_withdraw_from_pharmacy(%L)::text$q$, rx2))::jsonb ->> 'ok'));
  perform pg_temp.guard(true);
end $$;

-- 7. S28d: the older pharmacy gaps ---------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); pA uuid := pg_temp.f('pA'); phA uuid := pg_temp.f('phA'); phB uuid := pg_temp.f('phB'); v_order uuid; v_before integer; v_med uuid;
begin
  perform pg_temp.ck('real', '7a the patient-facing directory carries no delivery or delivery fee', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'pharmacy_partner_directory' and column_name in ('delivery', 'delivery_fee_kobo')));
  perform pg_temp.ck('real', '7b anon cannot read the directory view', 'ERR:42501', pg_temp.anon_q('select count(*)::text from public.pharmacy_partner_directory'));
  insert into public.pharmacy_medications (pharmacy_partner_id, drug_name, pack_size, price_kobo, is_active, stock_status) values (pA, 'GuardDrug', '30', 380000, true, 'in_stock');
  insert into public.pharmacy_orders (organisation_id, patient_id, pharmacy_partner_id, items, status, total_kobo)
    values (v_org, v_pat, pA, jsonb_build_array(jsonb_build_object('drug_name', 'GuardDrug', 'medication_id', (select id from public.pharmacy_medications where pharmacy_partner_id = pA limit 1), 'quantity', 1)), 'requested', 380000) returning id into v_order;
  perform pg_temp.ck('real', '7c a test patient''s order is stamped as test', 'true', (select is_test::text from public.pharmacy_orders where id = v_order));
  insert into public.pharmacy_order_dispenses (organisation_id, patient_id, pharmacy_order_id, drug_name, source, is_test) values (v_org, v_pat, v_order, 'Probe', 'pharmacy', false);
  perform pg_temp.ck('real', '7d ...and so is a dispense row, whatever the writer passes', 'true', (select is_test::text from public.pharmacy_order_dispenses where drug_name = 'Probe' and patient_id = v_pat limit 1));
  select count(*) into v_before from public.audit_log where action = 'pharmacist.orders_read' and actor_id = phA;
  perform pg_temp.q_as(phA, 'select count(*) from public.pharmacist_orders()');
  perform pg_temp.ck('real', '7e listing the orders leaves an audit row', '1', ((select count(*) from public.audit_log where action = 'pharmacist.orders_read' and actor_id = phA) - v_before)::text);
  perform pg_temp.ck('real', '7f another pharmacy sees nothing of the order''s allergies and leaves no audit row', '0|0',
    pg_temp.q_as(phB, format('select count(*)::text from public.pharmacist_order_allergies(%L)', v_order)) || '|' || (select count(*)::text from public.audit_log where action = 'pharmacist.order_allergies_read' and actor_id = phB));
  perform pg_temp.q_as(phA, format('select count(*) from public.pharmacist_order_allergies(%L)', v_order));
  perform pg_temp.q_as(phA, format('select count(*) from public.pharmacist_order_medications(%L)', v_order));
  perform pg_temp.ck('real', '7g reading an order''s allergies and medicines is audited', '1|1',
    (select count(*) filter (where action = 'pharmacist.order_allergies_read')::text || '|' || count(*) filter (where action = 'pharmacist.order_medications_read')::text from public.audit_log where entity_id = v_order and actor_id = phA));
  perform pg_temp.q_as(phA, format($q$select public.pharmacist_record_dispense(%L, 'Probe', '1 box', current_date)::text$q$, v_order));
  perform pg_temp.ck('real', '7h recording a dispense on an order is audited', '1', (select count(*)::text from public.audit_log where action = 'pharmacist.dispense_recorded' and entity_id = v_order));
  select m.id into v_med from public.medications m where m.prescription_id = pg_temp.f('rxG');
  set local session_replication_role = replica;
  update public.medications set rx_number = 'RXS28C1', verification_code = 'ABC123' where id = v_med;
  set local session_replication_role = origin;
  perform pg_temp.ck('real', '7i verifying a prescription still answers a pharmacist', '1', pg_temp.q_as(phA, $q$select count(*)::text from public.verify_prescription('RXS28C1', 'ABC123')$q$));
  perform pg_temp.ck('real', '7i2 ...and is audited', '1', (select count(*)::text from public.audit_log where action = 'pharmacist.prescription_verified' and entity_id = v_med and actor_id = phA));
  perform pg_temp.ck('real', '7i3 a patient gets nothing from the verify function', '0', pg_temp.q_as(v_pat, $q$select count(*)::text from public.verify_prescription('RXS28C1', 'ABC123')$q$));
  -- the pharmacy order alert is the neutral in-app notice: no SMS, nothing about the patient or the medicine
  delete from public.notifications where recipient_id = phA;
  alter table public.pharmacy_orders disable trigger pharmacy_orders_record_commission;
  update public.pharmacy_orders set status = 'payment_confirmed' where id = v_order;
  alter table public.pharmacy_orders enable trigger pharmacy_orders_record_commission;
  perform pg_temp.ck('real', '7j the pharmacy gets the neutral in-app notice for a new order', 'true',
    ((select count(*) from public.notifications where recipient_id = phA and template = 'pharmacy_new_prescription' and channel = 'in_app') >= 1)::text);
  perform pg_temp.ck('real', '7k no pharmacy alert goes by SMS (INV-08) and nothing sent to the pharmacy names the patient or the medicine', '0|0',
    (select count(*) filter (where template = 'pharmacy_order_pharmacy_alert' and channel = 'sms')::text || '|' ||
            count(*) filter (where recipient_id = phA and (payload::text ilike '%GuardDrug%' or payload::text ilike '%S28c Patient%'))::text
       from public.notifications where created_at >= now() - interval '1 minute'));
end $$;

-- 8. SABOTAGE: the caregiver gate opened, the go-live gate removed, the is_test stamp dropped; every one must flip ----------------------------------------
create or replace function private.rx_patient(p_beneficiary uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(p_beneficiary, (select auth.uid())) $$;
do $$
declare v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); rx uuid;
begin
  rx := pg_temp.mkrx(v_org, v_pat, v_doc, 'SabotageDrug', 'signed');
  insert into results values ('sabotaged', 'a stranger still cannot choose for the patient', 'ERR:42501',
    pg_temp.q_as(pg_temp.f('stranger'), format($q$select public.patient_choose_pharmacy(%L, %L, %L, %L)$q$, rx, pg_temp.f('pA'), pg_temp.f('lA'), v_pat)));
  perform pg_temp.guard(false);
  create or replace function private.pharmacy_collection_on() returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$;
  insert into results values ('sabotaged', 'with the go-live guard off a pharmacy still sees nothing', 'ERR:55000',
    pg_temp.q_as(pg_temp.f('phA'), 'select count(*)::text from public.pharmacist_prescriptions()'));
  drop trigger pharmacy_order_dispenses_stamp_is_test on public.pharmacy_order_dispenses;
  insert into public.pharmacy_order_dispenses (organisation_id, patient_id, pharmacy_order_id, drug_name, source, is_test)
    values (v_org, v_pat, (select id from public.pharmacy_orders limit 1), 'Probe2', 'pharmacy', false);
  insert into results values ('sabotaged', 'a test patient''s dispense is still stamped as test', 'true', (select is_test::text from public.pharmacy_order_dispenses where drug_name = 'Probe2' limit 1));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S28c proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), E'\n   ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks (%)', v_caught, (select string_agg(check_name || '=' || coalesce(actual, 'null'), ' | ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;
