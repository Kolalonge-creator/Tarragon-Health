-- S15 proof: clinician credentialing (migration *_s15_clinician_credentialing.sql).
--
-- Proves in one rolled-back transaction:
--   1. Applicant: only a confirmed, plain person account can start; one open application; the
--      path, type and size of a document are checked; an incomplete application cannot submit.
--   2. State machine: state moves only through the credentialing functions (a direct update is
--      refused for authenticated and for the owner role), only valid transitions exist, every
--      change is logged and emits an event.
--   3. Checks: reviewer only, never the applicant; evidence is required; the licence needs a
--      future expiry; practice years and referee rules; all six passed moves to training.
--   4. Training and test: the answer key never reaches the applicant; 80 percent AND every red
--      scenario right; a red miss fails a high score; cooldown, attempt cap, CMO-only extra attempt.
--   5. Approval: CMO only, not the verifier, not the applicant; creates an inactive clinician at
--      the right level; competencies respect the level; activation flips the role, nothing earlier.
--   6. Expiry: notices at 90, 30 and 0 days exactly once each, suspension after expiry removes the
--      role, a missing date never suspends, an audited grace period holds suspension, an
--      exempt indemnity is honoured, reinstatement needs renewed documents.
--   7. RLS: another applicant, a clinician, a patient and anon see nothing; documents open only for
--      the owner or a reviewer and every open is logged; logs are append only; no direct writes.
--   8. SABOTAGE: with the state guard trigger dropped, a direct state update must succeed (so the
--      "refused" check above would have failed). A vacuous test raises.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;

create function pg_temp.reg(p_app uuid, p_kind public.clinician_document_kind, p_path text, p_mime text, p_size bigint, p_hash text, p_exp timestamptz default null)
returns uuid language plpgsql security definer as
$f$ begin
  -- the web route stores the vetted file with the service role first; this stands in for that step
  insert into storage.objects (bucket_id, name, metadata) values ('clinician-documents', p_path, jsonb_build_object('size', p_size, 'mimetype', p_mime));
  return public.register_clinician_document(p_app, p_kind, p_path, p_mime, p_size, p_hash, p_exp);
end $f$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_confirmed boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's15-' || p_label || '-' || v || '@example.invalid', 'x', case when p_confirmed then now() end, '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S15 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '35 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

create function pg_temp.complete_app(p_uid uuid, p_org uuid, p_folio text) returns uuid language plpgsql as $f$
declare v_app uuid; v_k text;
begin
  perform pg_temp.act(p_uid);
  v_app := public.start_clinician_application('employed');
  perform pg_temp.back();
  update public.clinician_applications set employment_type = 'employed' where id = v_app;  -- a reviewer's act in real life
  perform pg_temp.act(p_uid);
  foreach v_k in array array['mdcn_practising_licence', 'mdcn_portal_screenshot', 'graduation_certificate', 'nysc_certificate', 'government_id', 'cv'] loop
    perform pg_temp.reg(v_app, v_k::public.clinician_document_kind, p_org || '/' || p_uid || '/' || v_k || '.pdf', 'application/pdf', 1000, repeat('a', 64));
  end loop;
  perform public.save_clinician_application(v_app, jsonb_build_object(
    'mdcn_folio', p_folio, 'qualification', 'MBBS', 'years_since_house_job', 4,
    'languages', jsonb_build_array('English'),
    'referees', jsonb_build_array(jsonb_build_object('name', 'R1', 'institution', 'H1', 'phone', '+2348000000000'), jsonb_build_object('name', 'R2', 'institution', 'H2', 'email', 'r2@h2.example')),
    'conflicts_declaration', jsonb_build_object('none', true)));
  perform pg_temp.back();
  return v_app;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_cmo_staff uuid; v_c2 uuid; v_c2_staff uuid; v_patient uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_p5 uuid; v_p6 uuid; v_p7 uuid; v_p8 uuid; v_p9 uuid; v_app9 uuid; v_app9b uuid; v_staff9 uuid; v_noemail uuid; v_p5_staff uuid;
  v_app uuid; v_app2 uuid; v_app3 uuid; v_app4 uuid; v_app_again uuid; v_staff uuid;
  v_k text; v_doc uuid; v_docs uuid[] := '{}';
  v_res jsonb; v_n integer; v_t text; v_attempt uuid; v_cases jsonb; v_answers jsonb; v_cid uuid;
  v_path text; v_state text; v_status jsonb; v_rows integer; v_ev integer; v_sweep jsonb;
  v_mod uuid; v_red1 uuid; v_red2 uuid; v_n1 uuid; v_n2 uuid; v_n3 uuid; v_grace uuid; v_renew uuid;
  v_noon_today timestamptz := (((now() at time zone 'Africa/Lagos')::date + time '12:00') at time zone 'Africa/Lagos');
  v_details jsonb;
  v_hash text := repeat('a', 64);
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_c2 := pg_temp.mkuser(v_org, 'legacy-clinician', 'clinician');
  v_patient := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_p1 := pg_temp.mkuser(v_org, 'applicant-1', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'applicant-2', 'patient');
  v_p3 := pg_temp.mkuser(v_org, 'applicant-3', 'patient');
  v_p4 := pg_temp.mkuser(v_org, 'applicant-4', 'patient');
  v_p5 := pg_temp.mkuser(v_org, 'grace-clinician', 'clinician');
  v_p6 := pg_temp.mkuser(v_org, 'applicant-6', 'patient');
  v_p7 := pg_temp.mkuser(v_org, 'applicant-7', 'patient');
  v_p8 := pg_temp.mkuser(v_org, 'applicant-8', 'patient');
  v_p9 := pg_temp.mkuser(v_org, 'applicant-9', 'patient');
  v_noemail := pg_temp.mkuser(v_org, 'unconfirmed', 'patient', false);

  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'S15 CMO', 'MDCN', 'S15-CMO-1', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true)
    returning id into v_cmo_staff;
  -- a pre-existing style row: no licence or indemnity dates on file at all
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_c2, 'S15 Legacy', 'MDCN', 'S15-LEGACY-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true)
    returning id into v_c2_staff;

  -- trusted-role helper content: one approved training module, three more test cases below
  insert into public.training_modules (organisation_id, code, title, status, approved_by, approved_at, is_test)
    values (v_org, 's15-mod', 'S15 module', 'approved', v_cmo, now(), true) returning id into v_mod;
  insert into public.training_modules (organisation_id, code, title, status, is_test)
    values (v_org, 's15-draft', 'S15 draft module', 'draft', true);

  -- 1. Applicant start ---------------------------------------------------------------------------
  perform pg_temp.act(v_noemail);
  perform pg_temp.rec('an unconfirmed email cannot start', '42501', pg_temp.try('select public.start_clinician_application()'));
  perform pg_temp.back();
  perform pg_temp.act(v_c2);
  perform pg_temp.rec('an existing clinician cannot start an application', '42501', pg_temp.try('select public.start_clinician_application()'));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot start an application', '42501', pg_temp.try('select public.start_clinician_application()'));
  perform pg_temp.back();

  perform pg_temp.act(v_p1);
  v_app := public.start_clinician_application('contracted');
  v_app_again := public.start_clinician_application('contracted');
  perform pg_temp.back();
  perform pg_temp.rec('start returns the same open application the second time', 'true', (v_app = v_app_again)::text);
  perform pg_temp.rec('starting logs a transition', '1', (select count(*)::text from public.clinician_application_transitions where application_id = v_app));

  perform pg_temp.act(v_p1);
  perform pg_temp.rec('an incomplete application cannot be submitted', '23514', pg_temp.try(format('select public.submit_clinician_application(%L)', v_app)));
  -- documents: path, type, size
  perform pg_temp.rec('a document outside your own folder is refused', '42501',
    pg_temp.try(format('select pg_temp.reg(%L, ''cv'', %L, ''application/pdf'', 100, %L)', v_app, v_org || '/' || v_p2 || '/x.pdf', v_hash)));
  perform pg_temp.rec('an executable type is refused', '23514',
    pg_temp.try(format('select pg_temp.reg(%L, ''cv'', %L, ''application/x-msdownload'', 100, %L)', v_app, v_org || '/' || v_p1 || '/x.exe', v_hash)));
  perform pg_temp.rec('an oversize file is refused', '23514',
    pg_temp.try(format('select pg_temp.reg(%L, ''cv'', %L, ''application/pdf'', 99999999, %L)', v_app, v_org || '/' || v_p1 || '/x.pdf', v_hash)));
  foreach v_k in array array['mdcn_practising_licence', 'mdcn_portal_screenshot', 'graduation_certificate', 'nysc_certificate', 'government_id', 'cv', 'indemnity_certificate'] loop
    v_doc := pg_temp.reg(v_app, v_k::public.clinician_document_kind, v_org || '/' || v_p1 || '/' || v_k || '.pdf', 'application/pdf', 1000, v_hash);
    v_docs := v_docs || v_doc;
  end loop;
  -- replace one document: the old one is superseded
  v_doc := pg_temp.reg(v_app, 'cv', v_org || '/' || v_p1 || '/cv2.pdf', 'application/pdf', 1000, v_hash);
  perform pg_temp.rec('re-uploading a kind supersedes the old file', '1',
    (select count(*)::text from public.clinician_documents where application_id = v_app and kind = 'cv' and superseded_at is null));
  perform public.save_clinician_application(v_app, jsonb_build_object(
    'mdcn_folio', 'MDCN-S15-001', 'qualification', 'MBBS', 'graduation_year', 2018, 'nysc_year', 2020, 'years_since_house_job', 3,
    'specialties', jsonb_build_array('general practice'), 'languages', jsonb_build_array('English', 'Yoruba'),
    'referees', jsonb_build_array(
      jsonb_build_object('name', 'Dr A', 'institution', 'LUTH', 'phone', '+2348011111111'),
      jsonb_build_object('name', 'Dr B', 'institution', 'UCH', 'email', 'b@uch.example')),
    'conflicts_declaration', jsonb_build_object('pharmacy', false, 'lab', false, 'hmo', false, 'referee_relationship', false),
    'indemnity_insurer', 'S15 Insurer', 'indemnity_policy_number', 'POL-1', 'indemnity_expires_at', (now() + interval '400 days')));
  perform pg_temp.back();
  perform pg_temp.act(v_p1);
  perform public.submit_clinician_application(v_app);
  perform pg_temp.back();
  select state::text into v_state from public.clinician_applications where id = v_app;
  perform pg_temp.rec('submit moves to documents_submitted', 'documents_submitted', v_state);
  perform pg_temp.rec('every change is logged (started, submitted)', '2', (select count(*)::text from public.clinician_application_transitions where application_id = v_app));
  perform pg_temp.rec('a state change emits an event', 'true', ((select count(*) from public.domain_events where event_type = 'clinician.application_state_changed' and payload ->> 'application_id' = v_app::text) >= 1)::text);

  perform pg_temp.act(v_p1);
  perform pg_temp.rec('the applicant cannot edit after submitting', '23514', pg_temp.try(format('select public.save_clinician_application(%L, ''{}''::jsonb)', v_app)));
  perform pg_temp.rec('the applicant cannot start checks', '42501', pg_temp.try(format('select public.begin_credential_checks(%L)', v_app)));
  perform pg_temp.rec('authenticated cannot update state directly', '42501', pg_temp.try(format('update public.clinician_applications set state = ''active'' where id = %L', v_app)));
  perform pg_temp.rec('authenticated cannot insert an application directly', '42501',
    pg_temp.try(format('insert into public.clinician_applications (organisation_id, profile_id) values (%L, %L)', v_org, v_p2)));
  perform pg_temp.back();
  -- the owner role is stopped too (the guard trigger, sabotaged at the end)
  perform pg_temp.rec('a direct state update is refused even for the owner role', '42501', pg_temp.try(format('update public.clinician_applications set state = ''active'' where id = %L', v_app)));
  perform pg_temp.rec('a skipped state is not a valid transition', '23514', pg_temp.try(format('select private.apply_application_transition(%L, ''active'', null, ''x'')', v_app)));

  -- 3. Checks -------------------------------------------------------------------------------------
  perform pg_temp.act(v_admin);
  perform public.begin_credential_checks(v_app);
  perform pg_temp.back();
  perform pg_temp.rec('begin creates the six checks', '6', (select count(*)::text from public.clinician_checks where application_id = v_app and result = 'pending'));

  perform pg_temp.act(v_c2);
  perform pg_temp.rec('another clinician cannot begin checks', '42501', pg_temp.try(format('select public.begin_credential_checks(%L)', v_app)));
  perform pg_temp.rec('another clinician cannot record a check', '42501', pg_temp.try(format('select public.record_credential_check(%L, ''identity'', ''passed'')', v_app)));
  perform pg_temp.back();
  perform pg_temp.act(v_p1);
  perform pg_temp.rec('the applicant cannot verify their own check', '42501', pg_temp.try(format('select public.record_credential_check(%L, ''identity'', ''passed'')', v_app)));
  perform pg_temp.back();

  perform pg_temp.act(v_admin);
  perform pg_temp.rec('the licence check needs an expiry date', '23514', pg_temp.try(format('select public.record_credential_check(%L, ''licence'', ''passed'')', v_app)));
  perform pg_temp.rec('an expired licence date is refused', '23514',
    pg_temp.try(format('select public.record_credential_check(%L, ''licence'', ''passed'', null, ''{}''::jsonb, now() - interval ''1 day'')', v_app)));
  perform pg_temp.rec('a referee check needs confirmation back', '23514', pg_temp.try(format('select public.record_credential_check(%L, ''referee_1'', ''passed'')', v_app)));
  perform pg_temp.rec('an applicant-supplied referee contact is refused', '23514',
    pg_temp.try(format('select public.record_credential_check(%L, ''referee_1'', ''passed'', null, %L::jsonb)', v_app, '{"confirmed_back":true,"contact_source":"applicant_supplied"}')));
  perform public.record_credential_check(v_app, 'licence', 'passed', 'verified', '{}'::jsonb, now() + interval '200 days');
  perform public.record_credential_check(v_app, 'qualifications', 'passed');
  perform public.record_credential_check(v_app, 'identity', 'passed');
  perform public.record_credential_check(v_app, 'practice_years', 'passed');
  perform public.record_credential_check(v_app, 'referee_1', 'passed', null, '{"confirmed_back":true,"contact_source":"independent_institution","called_on":"2026-10-05"}'::jsonb);
  perform pg_temp.back();
  select state::text into v_state from public.clinician_applications where id = v_app;
  perform pg_temp.rec('five of six checks passed stays in checks', 'checks_in_progress', v_state);
  perform pg_temp.act(v_admin);
  perform public.record_credential_check(v_app, 'referee_2', 'passed', null, '{"confirmed_back":true,"contact_source":"independent_institution","called_on":"2026-10-05"}'::jsonb);
  perform pg_temp.back();
  select state::text into v_state from public.clinician_applications where id = v_app;
  perform pg_temp.rec('all six passed moves to training on its own', 'training', v_state);
  perform pg_temp.rec('the licence evidence document was stamped verified', 'true',
    (select (verified_by = v_admin and verified_at is not null)::text from public.clinician_documents where application_id = v_app and kind = 'mdcn_practising_licence'));
  perform pg_temp.rec('the licence expiry was kept on the application', 'true', (select (licence_expires_at > now() + interval '190 days')::text from public.clinician_applications where id = v_app));

  -- 3b. Practice years, folio rules ------------------------------------------------------------------
  perform pg_temp.act(v_p2);
  v_app2 := public.start_clinician_application('contracted');
  perform pg_temp.rec('a live MDCN folio cannot be reused on another application', '23505',
    pg_temp.try(format('select public.save_clinician_application(%L, jsonb_build_object(''mdcn_folio'', ''mdcn-s15-001''))', v_app2)));
  perform pg_temp.back();

  -- 4. Training and test --------------------------------------------------------------------------
  perform pg_temp.act(v_p1);
  perform pg_temp.rec('a draft module cannot be completed', 'P0002', pg_temp.try(format('select public.complete_training_module(%L, (select id from public.training_modules where code = ''s15-draft''))', v_app)));
  perform pg_temp.rec('the test needs the training first', '23514', pg_temp.try(format('select public.start_credential_test(%L)', v_app)));
  perform public.complete_training_module(v_app, v_mod);
  perform pg_temp.rec('with no approved test content the test cannot start', '23514', pg_temp.try(format('select public.start_credential_test(%L)', v_app)));
  perform pg_temp.rec('the applicant cannot write test content', '42501',
    pg_temp.try('select public.save_credential_test_case(null, ''x'', ''s'', ''[{"id":"a"},{"id":"b"}]''::jsonb, ''a'', true, '''')'));
  perform pg_temp.back();

  perform pg_temp.act(v_cmo);
  v_red1 := public.save_credential_test_case(null, 's15-red1', 'Red scenario one', '[{"id":"a","text":"Right"},{"id":"b","text":"Wrong"}]'::jsonb, 'a', true, 'why');
  v_red2 := public.save_credential_test_case(null, 's15-red2', 'Red scenario two', '[{"id":"a","text":"Wrong"},{"id":"b","text":"Right"}]'::jsonb, 'b', true, 'why');
  v_n1 := public.save_credential_test_case(null, 's15-n1', 'Normal one', '[{"id":"a","text":"Right"},{"id":"b","text":"Wrong"}]'::jsonb, 'a', false, 'why');
  v_n2 := public.save_credential_test_case(null, 's15-n2', 'Normal two', '[{"id":"a","text":"Right"},{"id":"b","text":"Wrong"}]'::jsonb, 'a', false, 'why');
  v_n3 := public.save_credential_test_case(null, 's15-n3', 'Normal three', '[{"id":"a","text":"Right"},{"id":"b","text":"Wrong"}]'::jsonb, 'a', false, 'why');
  perform pg_temp.rec('a draft test case is not yet usable', '0', (select count(*)::text from public.credential_test_cases where status = 'approved' and code like 's15-%'));
  perform public.approve_credential_content('test_case', v_red1);
  perform public.approve_credential_content('test_case', v_red2);
  perform public.approve_credential_content('test_case', v_n1);
  perform public.approve_credential_content('test_case', v_n2);
  perform public.approve_credential_content('test_case', v_n3);
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot approve clinical content', '42501', pg_temp.try(format('select public.approve_credential_content(''test_case'', %L)', v_n1)));
  perform pg_temp.back();

  perform pg_temp.act(v_p1);
  v_res := public.start_credential_test(v_app);
  v_attempt := (v_res ->> 'attempt_id')::uuid;
  perform pg_temp.rec('the test returns 5 scenarios (every red plus fill)', '5', jsonb_array_length(v_res -> 'cases')::text);
  perform pg_temp.rec('the answer key is never returned', 'false', (v_res::text like '%correct_option_id%' or v_res::text like '%rationale%')::text);
  perform pg_temp.rec('the applicant cannot read the answer key table', '0', (select count(*)::text from public.credential_test_cases));
  perform pg_temp.rec('resuming returns the same attempt', 'true', ((public.start_credential_test(v_app) ->> 'attempt_id')::uuid = v_attempt)::text);
  -- attempt 1: both red right but only 2 of 5 (40 percent)
  v_answers := jsonb_build_object(v_red1::text, 'a', v_red2::text, 'b', v_n1::text, 'a', v_n2::text, 'b', v_n3::text, 'b');
  v_res := public.submit_credential_test(v_attempt, v_answers);
  perform pg_temp.back();
  perform pg_temp.rec('60 percent with every red right does not pass', 'false', v_res ->> 'passed');
  perform pg_temp.rec('the score is stored', '60.00', (select score_percent::text from public.credential_test_attempts where id = v_attempt));
  perform pg_temp.act(v_p1);
  perform pg_temp.rec('a retake is held back by the cooldown', '23514', pg_temp.try(format('select public.start_credential_test(%L)', v_app)));
  perform pg_temp.back();
  update public.credential_test_attempts set submitted_at = now() - interval '2 days' where id = v_attempt;
  -- attempt 2: 4 of 5 (80 percent) but one red wrong: must fail
  perform pg_temp.act(v_p1);
  v_res := public.start_credential_test(v_app);
  v_attempt := (v_res ->> 'attempt_id')::uuid;
  v_res := public.submit_credential_test(v_attempt, jsonb_build_object(v_red1::text, 'b', v_red2::text, 'b', v_n1::text, 'a', v_n2::text, 'a', v_n3::text, 'a'));
  perform pg_temp.back();
  perform pg_temp.rec('80 percent with a red scenario wrong still fails', 'false', v_res ->> 'passed');
  perform pg_temp.rec('the red miss is counted without naming it', '1', v_res ->> 'safety_critical_missed');
  perform pg_temp.rec('the red miss is kept for audit', '1', (select jsonb_array_length(red_misses)::text from public.credential_test_attempts where id = v_attempt));
  select state::text into v_state from public.clinician_applications where id = v_app;
  perform pg_temp.rec('a failed attempt leaves the application in training', 'training', v_state);
  update public.credential_test_attempts set submitted_at = now() - interval '2 days' where id = v_attempt;
  -- attempt 3: exactly 80 percent, all red right: passes
  perform pg_temp.act(v_p1);
  v_res := public.start_credential_test(v_app);
  v_attempt := (v_res ->> 'attempt_id')::uuid;
  v_res := public.submit_credential_test(v_attempt, jsonb_build_object(v_red1::text, 'a', v_red2::text, 'b', v_n1::text, 'a', v_n2::text, 'a', v_n3::text, 'b'));
  perform pg_temp.back();
  perform pg_temp.rec('exactly the pass mark with every red right passes', 'true', v_res ->> 'passed');
  select state::text into v_state from public.clinician_applications where id = v_app;
  perform pg_temp.rec('passing moves to test_passed', 'test_passed', v_state);
  update public.credential_test_attempts set submitted_at = now() - interval '2 days' where id = v_attempt;
  perform pg_temp.rec('three attempts were recorded', '3', (select count(*)::text from public.credential_test_attempts where application_id = v_app));

  -- 4b. attempt cap and CMO-only extra attempt, on a fixture application ---------------------------------
  insert into public.clinician_applications (organisation_id, profile_id, state, employment_type, is_test)
    values (v_org, v_p3, 'started', 'contracted', true) returning id into v_app3;
  perform set_config('tarragon.credential_transition', 'on', true);
  update public.clinician_applications set state = 'training' where id = v_app3;
  perform set_config('tarragon.credential_transition', 'off', true);
  insert into public.training_progress (organisation_id, application_id, module_id, is_test) values (v_org, v_app3, v_mod, true);
  insert into public.credential_test_attempts (organisation_id, application_id, attempt_number, case_ids, submitted_at, passed, score_percent, is_test)
    select v_org, v_app3, g, array[v_red1], now() - interval '3 days', false, 0, true from generate_series(1, 3) g;
  perform pg_temp.act(v_p3);
  perform pg_temp.rec('all attempts used blocks another try', '23514', pg_temp.try(format('select public.start_credential_test(%L)', v_app3)));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot grant an extra attempt', '42501', pg_temp.try(format('select public.grant_test_retake(%L, ''a fair reason here'')', v_app3)));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform public.grant_test_retake(v_app3, 'extra attempt after review');
  perform pg_temp.back();
  perform pg_temp.act(v_p3);
  perform pg_temp.rec('the CMO can allow one more', 'ok', pg_temp.try(format('select public.start_credential_test(%L)', v_app3)));
  perform pg_temp.back();

  -- 5. Approval and activation ----------------------------------------------------------------------
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot approve', '42501', pg_temp.try(format('select public.approve_clinician_application(%L)', v_app)));
  perform pg_temp.back();
  perform pg_temp.act(v_c2);
  perform pg_temp.rec('a non-CMO clinician cannot approve', '42501', pg_temp.try(format('select public.approve_clinician_application(%L)', v_app)));
  perform pg_temp.back();
  perform pg_temp.act(v_p1);
  perform pg_temp.rec('an applicant cannot approve themselves', '42501', pg_temp.try(format('select public.approve_clinician_application(%L)', v_app)));
  perform pg_temp.back();
  -- maker-checker: a CMO who verified a check cannot approve
  insert into public.clinician_applications (organisation_id, profile_id, state, employment_type, licence_expires_at, is_test)
    values (v_org, v_p4, 'started', 'employed', now() + interval '300 days', true) returning id into v_app4;
  perform set_config('tarragon.credential_transition', 'on', true);
  update public.clinician_applications set state = 'test_passed' where id = v_app4;
  perform set_config('tarragon.credential_transition', 'off', true);
  insert into public.clinician_checks (organisation_id, application_id, kind, result, performed_by, performed_at, is_test)
    values (v_org, v_app4, 'licence', 'passed', v_cmo, now(), true);
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the verifier cannot also approve', '42501', pg_temp.try(format('select public.approve_clinician_application(%L)', v_app4)));
  perform pg_temp.rec('on_call needs level 2', '23514', pg_temp.try(format('select public.approve_clinician_application(%L, 1::smallint, array[''on_call''])', v_app)));
  v_staff := public.approve_clinician_application(v_app, 1::smallint, array['adult_general', 'hypertension']);
  perform pg_temp.back();
  select state::text into v_state from public.clinician_applications where id = v_app;
  perform pg_temp.rec('approval moves to approved_tier1', 'approved_tier1', v_state);
  perform pg_temp.rec('approval creates an inactive clinician at level 1', 'false,1,senior_medical_officer,contracted,active',
    (select active::text || ',' || credentialing_level || ',' || doctor_tier || ',' || employment_type || ',' || status from public.clinical_staff where id = v_staff));
  perform pg_temp.rec('approving a test applicant keeps the test flag (OQ-103)', 'true', (select is_test::text from public.clinical_staff where id = v_staff));
  perform pg_temp.rec('the test-flag carry does not outlive the approval', 'true', (coalesce(nullif(current_setting('tarragon.credential_carry_test_flag', true), ''), '') = '')::text);
  perform pg_temp.rec('the role is still patient until activation', 'patient', (select role::text from public.profiles where id = v_p1));
  perform pg_temp.rec('two competencies were granted', '2', (select count(*)::text from public.clinician_competencies where clinical_staff_id = v_staff and revoked_at is null));
  perform pg_temp.rec('an approved but inactive clinician is not eligible', 'false', private.clinician_is_eligible(v_p1)::text);

  perform pg_temp.act(v_p1);
  perform pg_temp.rec('the applicant cannot activate themselves', '42501', pg_temp.try(format('select public.activate_clinician(%L)', v_app)));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform public.activate_clinician(v_app);
  perform pg_temp.back();
  perform pg_temp.rec('activation flips the role to clinician', 'clinician', (select role::text from public.profiles where id = v_p1));
  select state::text into v_state from public.clinician_applications where id = v_app;
  perform pg_temp.rec('activation moves the application to active', 'active', v_state);
  perform pg_temp.rec('an active, in-date clinician is eligible', 'true', private.clinician_is_eligible(v_p1)::text);
  perform pg_temp.rec('a clinician with no dates on file is eligible', 'true', private.clinician_is_eligible(v_c2)::text);
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('level 2 is needed for on_call', '23514', pg_temp.try(format('select public.grant_clinician_competency(%L, ''on_call'')', v_staff)));
  perform public.set_clinician_level(v_staff, 2::smallint, 'reviewed first tasks');
  perform pg_temp.rec('on_call works at level 2', 'ok', pg_temp.try(format('select public.grant_clinician_competency(%L, ''on_call'')', v_staff)));
  perform public.set_clinician_level(v_staff, 1::smallint, 'back to level one for audit');
  perform pg_temp.back();
  perform pg_temp.rec('dropping to level 1 revokes on_call', '0', (select count(*)::text from public.clinician_competencies where clinical_staff_id = v_staff and competency_code = 'on_call' and revoked_at is null));
  perform pg_temp.act(v_p1);
  v_status := public.my_credential_status();
  perform pg_temp.back();
  perform pg_temp.rec('my status shows eligible and no blockers', 'true,0', (v_status ->> 'eligible') || ',' || jsonb_array_length(v_status -> 'blockers'));

  -- 6. Expiry ------------------------------------------------------------------------------------------
  update public.clinical_staff set license_expires_at = now() + interval '60 days' where id = v_staff;
  v_sweep := private.credential_expiry_sweep();
  v_n := (select count(*) from public.notifications where recipient_id = v_p1 and template = 'credential_notice' and payload ->> 'kind' = 'licence' and channel = 'in_app');
  perform pg_temp.rec('at 60 days the 90 day notice goes out once (in app)', '1', v_n::text);
  perform pg_temp.rec('and once by email', '1', (select count(*)::text from public.notifications where recipient_id = v_p1 and template = 'credential_notice' and payload ->> 'kind' = 'licence' and channel = 'email'));
  perform private.credential_expiry_sweep();
  perform pg_temp.rec('a second run the same day sends nothing new', '1', (select count(*)::text from public.notifications where recipient_id = v_p1 and template = 'credential_notice' and payload ->> 'kind' = 'licence' and channel = 'in_app'));
  update public.clinical_staff set license_expires_at = now() + interval '20 days' where id = v_staff;
  perform private.credential_expiry_sweep();
  perform pg_temp.rec('a month before: the 30 day notice goes out', '2', (select count(*)::text from public.notifications where recipient_id = v_p1 and template = 'credential_notice' and payload ->> 'kind' = 'licence' and channel = 'in_app'));
  perform pg_temp.rec('reviewers hear about it at 30 days', 'true', ((select count(*) from public.notifications where recipient_id = v_admin and template = 'credential_notice' and payload ->> 'kind' = 'licence') >= 1)::text);
  update public.clinical_staff set license_expires_at = v_noon_today where id = v_staff;
  perform private.credential_expiry_sweep();
  perform pg_temp.rec('on the expiry day: a third notice goes out', '3', (select count(*)::text from public.notifications where recipient_id = v_p1 and template = 'credential_notice' and payload ->> 'kind' = 'licence' and channel = 'in_app'));
  perform pg_temp.rec('the day-of notice says so', 'true', (exists (select 1 from public.notifications where recipient_id = v_p1 and template = 'credential_notice' and channel = 'in_app' and payload ->> 'message' like '%expires today%'))::text);
  perform pg_temp.rec('and they are not suspended on the day', 'active', (select status::text from public.clinical_staff where id = v_staff));
  perform pg_temp.rec('the expiring event was emitted', 'true', ((select count(*) from public.domain_events where event_type = 'clinician.credential_expiring' and payload ->> 'clinical_staff_id' = v_staff::text) >= 1)::text);

  update public.clinical_staff set license_expires_at = v_noon_today - interval '1 day' where id = v_staff;
  v_sweep := private.credential_expiry_sweep();
  perform pg_temp.rec('the day after expiry, with no grace, they are suspended', 'suspended,false', (select status::text || ',' || active::text from public.clinical_staff where id = v_staff));
  perform pg_temp.rec('suspension removes the clinician role', 'patient', (select role::text from public.profiles where id = v_p1));
  select state::text into v_state from public.clinician_applications where id = v_app;
  perform pg_temp.rec('the application records the suspension', 'suspended', v_state);
  perform pg_temp.rec('a suspended clinician is not eligible', 'false', private.clinician_is_eligible(v_p1)::text);
  perform pg_temp.rec('suspension emits an event', 'true', ((select count(*) from public.domain_events where event_type = 'clinician.suspended' and payload ->> 'clinical_staff_id' = v_staff::text) >= 1)::text);
  perform pg_temp.rec('the legacy row with no dates was not touched', 'active', (select status::text from public.clinical_staff where id = v_c2_staff));
  perform pg_temp.rec('the sweep reports missing dates, not errors', 'true', ((v_sweep ->> 'missing_dates')::int >= 1 and (v_sweep ->> 'errors')::int = 0)::text);
  perform pg_temp.rec('the CMO (indemnity exempt) is never suspended', 'active', (select status::text from public.clinical_staff where id = v_cmo_staff));
  perform pg_temp.rec('a suspended clinician cannot be set active directly', '23514', pg_temp.try(format('update public.clinical_staff set active = true where id = %L', v_staff)));

  -- reinstatement needs the renewal recorded
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('reinstating without a renewed licence is refused', '23514', pg_temp.try(format('select public.reinstate_clinician(%L, ''renewed and checked'')', v_staff)));
  perform pg_temp.back();
  perform pg_temp.act(v_p1);
  v_renew := pg_temp.reg(null, 'mdcn_practising_licence', v_org || '/' || v_p1 || '/renewal.pdf', 'application/pdf', 1000, v_hash);
  perform pg_temp.rec('a suspended clinician can upload a renewal', 'true', (v_renew is not null)::text);
  perform pg_temp.rec('but not an unrelated document type', '23514', pg_temp.try(format('select pg_temp.reg(null, ''cv'', %L, ''application/pdf'', 10, %L)', v_org || '/' || v_p1 || '/cv3.pdf', v_hash)));
  perform pg_temp.rec('and cannot verify their own renewal', '42501', pg_temp.try(format('select public.renew_clinician_credential(%L, ''licence'', now() + interval ''300 days'', %L)', v_staff, v_renew)));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform public.renew_clinician_credential(v_staff, 'licence', now() + interval '350 days', v_renew);
  perform public.reinstate_clinician(v_staff, 'renewed licence checked');
  perform pg_temp.back();
  perform pg_temp.rec('reinstated: active again with the role back', 'active,true,clinician', (select status::text || ',' || active::text || ',' || (select role::text from public.profiles where id = v_p1) from public.clinical_staff where id = v_staff));
  perform pg_temp.rec('reinstatement is audited', 'true', ((select count(*) from public.audit_log where action = 'clinical_staff.reinstated' and entity_id = v_staff) = 1)::text);

  -- grace period: a licence expired yesterday is held for 5 audited days, then suspended
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, license_expires_at, is_test)
    values (v_org, v_p5, 'S15 Grace', 'MDCN', 'S15-GRACE-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, v_noon_today - interval '1 day', true)
    returning id into v_p5_staff;
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('a grace period needs a real reason', '23514', pg_temp.try(format('select public.grant_credential_grace(%L, ''licence'', 5, ''short'')', v_p5_staff)));
  perform pg_temp.rec('a grace period is capped', '23514', pg_temp.try(format('select public.grant_credential_grace(%L, ''licence'', 60, ''a long enough reason'')', v_p5_staff)));
  v_grace := public.grant_credential_grace(v_p5_staff, 'licence', 5, 'MDCN renewal portal outage, evidence on file');
  perform pg_temp.back();
  perform pg_temp.act(v_p5);
  perform pg_temp.rec('a clinician cannot grant themselves grace', '42501', pg_temp.try(format('select public.grant_credential_grace(%L, ''licence'', 5, ''a long enough reason'')', v_p5_staff)));
  perform pg_temp.back();
  perform private.credential_expiry_sweep();
  perform pg_temp.rec('inside the grace period the sweep does not suspend', 'active', (select status::text from public.clinical_staff where id = v_p5_staff));
  perform pg_temp.rec('and they stay eligible, on the record', 'true', private.clinician_is_eligible(v_p5)::text);
  perform pg_temp.rec('the grace was audited with its reason', 'true', ((select count(*) from public.audit_log where action = 'credential_grace.granted' and entity_id = v_p5_staff and event ->> 'reason' like 'MDCN renewal%') = 1)::text);
  perform pg_temp.rec('the clinician was told about the grace', 'true', ((select count(*) from public.notifications where recipient_id = v_p5 and template = 'credential_notice' and channel = 'email') >= 1)::text);
  update public.credential_grace_periods set ends_at = now() - interval '1 minute', starts_at = now() - interval '6 days' where id = v_grace;
  perform private.credential_expiry_sweep();
  perform pg_temp.rec('when the grace ends the clinician is suspended', 'suspended', (select status::text from public.clinical_staff where id = v_p5_staff));

  -- 7. Folio flags, rejection ---------------------------------------------------------------------------
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('rejecting needs a reason', '23514', pg_temp.try(format('select public.reject_clinician_application(%L, ''no'')', v_app2)));
  perform public.reject_clinician_application(v_app2, 'documents did not match the folio number');
  perform pg_temp.back();
  select state::text into v_state from public.clinician_applications where id = v_app2;
  perform pg_temp.rec('rejection records the state', 'rejected', v_state);
  perform pg_temp.rec('the reason is kept', 'documents did not match the folio number', (select rejected_reason from public.clinician_applications where id = v_app2));
  perform pg_temp.rec('a rejected application cannot move on', '23514', pg_temp.try(format('select private.apply_application_transition(%L, ''training'', null, ''x'')', v_app2)));

  -- 7b. RLS and the document door ------------------------------------------------------------------------
  perform pg_temp.act(v_p2);
  perform pg_temp.rec('another applicant sees no one else''s application', '0', (select count(*)::text from public.clinician_applications where id = v_app));
  perform pg_temp.rec('nor their documents', '0', (select count(*)::text from public.clinician_documents where application_id = v_app));
  perform pg_temp.rec('nor their transitions', '0', (select count(*)::text from public.clinician_application_transitions where application_id = v_app));
  perform pg_temp.rec('nor the checks', '0', (select count(*)::text from public.clinician_checks));
  perform pg_temp.rec('opening someone else''s document looks like not found', 'P0002', pg_temp.try(format('select public.open_clinician_document(%L)', v_docs[1])));
  perform pg_temp.back();
  perform pg_temp.act(v_c2);
  perform pg_temp.rec('a legacy clinician sees no applications', '0', (select count(*)::text from public.clinician_applications));
  perform pg_temp.rec('and no documents', '0', (select count(*)::text from public.clinician_documents));
  perform pg_temp.rec('and cannot open a document', 'P0002', pg_temp.try(format('select public.open_clinician_document(%L)', v_docs[1])));
  perform pg_temp.back();
  perform pg_temp.act(v_patient);
  perform pg_temp.rec('a patient sees none of it', '0', (select (count(*))::text from public.clinician_applications));
  perform pg_temp.rec('and no grace periods', '0', (select count(*)::text from public.credential_grace_periods));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot read applications', '42501', pg_temp.try('select count(*) from public.clinician_applications'));
  perform pg_temp.rec('anon cannot open a document', '42501', pg_temp.try(format('select public.open_clinician_document(%L)', v_docs[1])));
  perform pg_temp.back();

  perform pg_temp.act(v_p1);
  v_path := public.open_clinician_document(v_docs[1]);
  perform pg_temp.back();
  perform pg_temp.rec('the owner can open their own document', 'true', (v_path like v_org || '/' || v_p1 || '/%')::text);
  perform pg_temp.act(v_admin);
  v_path := public.open_clinician_document(v_docs[2]);
  perform pg_temp.rec('a reviewer can open a document', 'true', (v_path is not null)::text);
  perform pg_temp.rec('a reviewer can verify an applicant document', 'ok', pg_temp.try(format('select public.verify_clinician_document(%L, ''seen'')', v_docs[2])));
  perform pg_temp.back();
  perform pg_temp.rec('every open is logged (owner and reviewer)', '2', (select count(*)::text from public.clinician_document_access_log where document_id in (v_docs[1], v_docs[2])));
  perform pg_temp.rec('the access log records who and whether owner', 'true,false', (select string_agg(is_owner::text, ',' order by is_owner desc) from public.clinician_document_access_log where document_id in (v_docs[1], v_docs[2])));
  perform pg_temp.rec('the access log is append only', 'true', (pg_temp.try('update public.clinician_document_access_log set is_owner = not is_owner') = '23514')::text);
  perform pg_temp.rec('transitions are append only', 'true', (pg_temp.try('delete from public.clinician_application_transitions') = '23514')::text);

  -- folio flags: a folio held by a live clinician (no application) and a previously rejected folio
  update public.clinician_applications set mdcn_folio = 'S15-REJ-1' where id = v_app2;
  v_app3 := pg_temp.complete_app(v_p6, v_org, 'S15-LEGACY-1');
  perform pg_temp.act(v_p6);
  perform public.submit_clinician_application(v_app3);
  perform pg_temp.back();
  perform pg_temp.rec('a folio held by a live clinician is flagged in_use', 'in_use', (select folio_flag from public.clinician_applications where id = v_app3));
  perform pg_temp.act(v_admin);
  perform public.begin_credential_checks(v_app3);
  perform pg_temp.rec('the licence check cannot pass while the folio is in use', '23514',
    pg_temp.try(format('select public.record_credential_check(%L, ''licence'', ''passed'', null, ''{}''::jsonb, now() + interval ''100 days'')', v_app3)));
  perform pg_temp.back();
  v_app4 := pg_temp.complete_app(v_p7, v_org, 'S15-REJ-1');
  perform pg_temp.act(v_p7);
  perform public.submit_clinician_application(v_app4);
  perform pg_temp.back();
  perform pg_temp.rec('a previously rejected folio is flagged', 'previously_rejected', (select folio_flag from public.clinician_applications where id = v_app4));
  update public.clinician_applications set years_since_house_job = 1 where id = v_app4;
  perform pg_temp.act(v_admin);
  perform public.begin_credential_checks(v_app4);
  perform pg_temp.rec('practice after house job below the minimum cannot pass', '23514', pg_temp.try(format('select public.record_credential_check(%L, ''practice_years'', ''passed'')', v_app4)));
  perform pg_temp.back();

  -- read functions for the screens: each checks who is asking
  perform pg_temp.act(v_p7);
  v_status := public.my_clinician_application();
  perform pg_temp.rec('an applicant reads their own overview', 'checks_in_progress', v_status ->> 'state');
  perform pg_temp.rec('the overview carries no reviewer notes or other people', 'false', (v_status::text like '%reason%' or v_status::text like '%folio_flag%')::text);
  perform pg_temp.rec('an applicant cannot read the review queue', '42501', pg_temp.try('select public.credentialing_queue()'));
  perform pg_temp.rec('an applicant cannot read an application detail', '42501', pg_temp.try(format('select public.credentialing_application_detail(%L)', v_app4)));
  perform pg_temp.rec('an applicant cannot read the content with the answer key', '42501', pg_temp.try('select public.credentialing_content()'));
  perform pg_temp.rec('an applicant cannot read the expiry overview', '42501', pg_temp.try('select public.credentialing_expiry_overview()'));
  perform pg_temp.back();
  perform pg_temp.act(v_c2);
  perform pg_temp.rec('a plain clinician cannot read the review queue', '42501', pg_temp.try('select public.credentialing_queue()'));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('a reviewer reads the queue', 'true', ((public.credentialing_queue()) @> jsonb_build_array(jsonb_build_object('id', v_app4)))::text);
  v_status := public.credentialing_application_detail(v_app4);
  perform pg_temp.rec('a reviewer sees the folio flag and the applicant contact', 'previously_rejected,true',
    (v_status -> 'application' ->> 'folio_flag') || ',' || ((v_status -> 'applicant' ->> 'email') is not null)::text);
  perform pg_temp.rec('the expiry overview lists clinicians with eligibility', 'true', (jsonb_array_length(public.credentialing_expiry_overview()) >= 2)::text);
  perform pg_temp.rec('the content list includes the answer key for a reviewer', 'true', (public.credentialing_content()::text like '%correct_option_id%')::text);
  perform pg_temp.back();

  -- employment type is the organisation's fact, not the applicant's claim
  perform pg_temp.act(v_p6);
  perform pg_temp.rec('an applicant cannot set their own employment type', '42501', pg_temp.try(format('select public.set_application_employment_type(%L, ''employed'')', v_app3)));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform public.set_application_employment_type(v_app3, 'contracted');
  perform pg_temp.back();
  perform pg_temp.rec('a reviewer sets the employment type', 'contracted', (select employment_type::text from public.clinician_applications where id = v_app3));

  -- the older quality ladder can only tighten eligibility
  insert into public.provider_restrictions (organisation_id, clinical_staff_id, stage, reason) values (v_org, v_c2_staff, 'suspension', 'governance_directive');
  perform pg_temp.rec('a live restriction from the older ladder makes a clinician ineligible', 'false', private.clinician_is_eligible(v_c2)::text);
  update public.provider_restrictions set lifted_at = now(), lift_reason = 'cleared' where clinical_staff_id = v_c2_staff;
  perform pg_temp.rec('and lifting it restores eligibility', 'true', private.clinician_is_eligible(v_c2)::text);

  -- review fixes: employment type, evidence swaps, the storage door, a rejected approval, eligibility exposure
  perform pg_temp.act(v_p8);
  v_app9 := public.start_clinician_application('employed');
  perform pg_temp.back();
  perform pg_temp.rec('a self-started application is freelance whatever the caller passes', 'contracted', (select employment_type::text from public.clinician_applications where id = v_app9));

  perform pg_temp.act(v_admin);
  perform public.record_credential_check(v_app4, 'identity', 'passed');
  perform pg_temp.back();
  perform pg_temp.rec('identity passed before the swap', 'passed', (select result::text from public.clinician_checks where application_id = v_app4 and kind = 'identity'));
  perform pg_temp.act(v_p7);
  perform pg_temp.reg(v_app4, 'government_id', v_org || '/' || v_p7 || '/swapped-id.pdf', 'application/pdf', 1000, v_hash);
  perform pg_temp.back();
  perform pg_temp.rec('replacing a verified document sends its check back to pending', 'pending,true',
    (select c.result::text || ',' || (c.performed_by is null)::text from public.clinician_checks c where c.application_id = v_app4 and c.kind = 'identity'));
  insert into storage.objects (bucket_id, name, metadata) values ('clinician-documents', v_org || '/' || v_p7 || '/size-lie.pdf', jsonb_build_object('size', 10, 'mimetype', 'application/pdf'));
  perform pg_temp.act(v_p7);
  perform pg_temp.rec('a document with no file in storage is refused', '23514',
    pg_temp.try(format('select public.register_clinician_document(%L, ''cv'', %L, ''application/pdf'', 1000, %L)', v_app4, v_org || '/' || v_p7 || '/never-uploaded.pdf', v_hash)));
  perform pg_temp.rec('a declared size that does not match the stored file is refused', '23514',
    pg_temp.try(format('select public.register_clinician_document(%L, ''cv'', %L, ''application/pdf'', 11, %L)', v_app4, v_org || '/' || v_p7 || '/size-lie.pdf', v_hash)));
  perform pg_temp.back();
  perform pg_temp.rec('signed-in users have no storage policy on the documents bucket', '0',
    (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) like '%clinician-documents%'));
  perform pg_temp.rec('a signed-in user cannot call the eligibility function', 'false', has_function_privilege('authenticated', (select p.oid from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'clinician_is_eligible'), 'EXECUTE')::text);

  -- rejecting after approval removes the switched-off clinician record, so the person can apply again
  insert into public.clinician_applications (organisation_id, profile_id, state, employment_type, licence_expires_at, mdcn_folio, years_since_house_job, is_test)
    values (v_org, v_p9, 'started', 'employed', now() + interval '300 days', 'S15-REJAPPR-1', 5, true) returning id into v_app9b;
  perform set_config('tarragon.credential_transition', 'on', true);
  update public.clinician_applications set state = 'test_passed' where id = v_app9b;
  perform set_config('tarragon.credential_transition', 'off', true);
  insert into public.clinician_checks (organisation_id, application_id, kind, result, performed_by, performed_at, is_test)
    values (v_org, v_app9b, 'licence', 'passed', v_admin, now(), true);
  perform pg_temp.act(v_cmo);
  v_staff9 := public.approve_clinician_application(v_app9b);
  perform pg_temp.back();
  perform pg_temp.rec('approval created a clinician record', 'true', (exists (select 1 from public.clinical_staff where id = v_staff9))::text);
  perform pg_temp.act(v_admin);
  perform public.reject_clinician_application(v_app9b, 'changed our mind after approval');
  perform pg_temp.back();
  perform pg_temp.rec('rejecting after approval removes the switched-off record', 'false', (exists (select 1 from public.clinical_staff where id = v_staff9))::text);
  perform pg_temp.act(v_p9);
  perform pg_temp.rec('and the person can apply again', 'ok', pg_temp.try('select public.start_clinician_application()'));
  perform pg_temp.back();

  -- 8. Whole-surface checks -------------------------------------------------------------------------------
  perform pg_temp.rec('exactly one active credentialing config row', '1', (select count(*)::text from public.credentialing_config where is_active));
  perform pg_temp.rec('seven competencies are seeded', '7', (select count(*)::text from public.competencies));
  perform pg_temp.rec('the old notify-only sweeps are retired and the new one is scheduled', 'true,false,false',
    (exists (select 1 from cron.job where jobname = 'credential-expiry-sweep'))::text || ',' ||
    (exists (select 1 from cron.job where jobname = 'clinical-staff-license-lapse-notify'))::text || ',' ||
    (exists (select 1 from cron.job where jobname = 'clinical-staff-indemnity-lapse-notify'))::text);
  perform pg_temp.rec('every new table has row security', '14',
    (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
      and relname in ('clinician_applications', 'clinician_application_transition_rules', 'clinician_application_transitions', 'clinician_documents',
        'clinician_document_access_log', 'clinician_checks', 'competencies', 'clinician_competencies', 'training_modules', 'training_progress',
        'credential_test_cases', 'credential_test_attempts', 'credential_grace_periods', 'credential_expiry_notices')));
  perform pg_temp.rec('no credentialing function runs for anon', '0',
    (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('start_clinician_application', 'save_clinician_application', 'submit_clinician_application', 'register_clinician_document', 'open_clinician_document',
        'verify_clinician_document', 'begin_credential_checks', 'record_credential_check', 'reject_clinician_application', 'complete_training_module', 'start_credential_test',
        'submit_credential_test', 'grant_test_retake', 'save_credential_test_case', 'approve_credential_content', 'save_training_module', 'approve_clinician_application',
        'activate_clinician', 'suspend_clinician', 'reinstate_clinician', 'offboard_clinician', 'renew_clinician_credential', 'grant_clinician_competency',
        'revoke_clinician_competency', 'set_clinician_level', 'grant_credential_grace', 'revoke_credential_grace', 'my_credential_status')
      and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.rec('the private sweep is not callable by authenticated', 'false', (select has_function_privilege('authenticated', 'private.credential_expiry_sweep()', 'EXECUTE')::text));

  -- offboarding keeps the documents with a retention date
  perform pg_temp.act(v_admin);
  perform public.offboard_clinician(v_staff, 'left the network at their own request');
  perform pg_temp.back();
  perform pg_temp.rec('offboarded: status, role and application', 'offboarded,false,patient,offboarded',
    (select cs.status::text || ',' || cs.active::text || ',' || (select role::text from public.profiles where id = v_p1) || ',' || (select state::text from public.clinician_applications where id = v_app) from public.clinical_staff cs where cs.id = v_staff));
  perform pg_temp.rec('their documents now carry a retention date', 'true', (select (count(*) > 0 and bool_and(retain_until is not null))::text from public.clinician_documents where owner_profile_id = v_p1));

  -- 8b. Verified phone rule (OQ-104) and document purge (OQ-108) -------------------------------------------------
  declare
    v_ph uuid; v_phtest uuid; v_rj uuid; v_rjapp uuid; v_pu uuid; v_puapp uuid; v_d1 uuid; v_d3 uuid; v_d4 uuid; v_sab text;
  begin
    perform set_config('request.jwt.claims', '', true);  -- act as the migration connection again: these fixtures set is_test
    update public.credentialing_config set rules = rules || '{"require_verified_phone": true}'::jsonb where is_active;
    v_ph := pg_temp.mkuser(v_org, 'phone', 'patient');
    update public.profiles set is_test = false where id = v_ph;
    perform pg_temp.act(v_ph);
    perform pg_temp.rec('a real applicant with no verified phone cannot start', '42501', pg_temp.try('select public.start_clinician_application(''employed'')'));
    perform pg_temp.back();
    update auth.users set phone_confirmed_at = now() where id = v_ph;
    perform pg_temp.act(v_ph);
    perform pg_temp.rec('the same applicant can start once the phone is verified', 'ok', pg_temp.try('select public.start_clinician_application(''employed'')'));
    perform pg_temp.back();
    perform set_config('request.jwt.claims', '', true);
    v_phtest := pg_temp.mkuser(v_org, 'phonetest', 'patient');
    perform pg_temp.act(v_phtest);
    perform pg_temp.rec('a QA account is not held back by the phone rule', 'ok', pg_temp.try('select public.start_clinician_application(''employed'')'));
    perform pg_temp.back();
    update public.credentialing_config set rules = rules || '{"require_verified_phone": false}'::jsonb where is_active;

    perform set_config('request.jwt.claims', '', true);
    -- documents: one of a rejected application past the period, one past its retention date, one not due
    v_rj := pg_temp.mkuser(v_org, 'rejectedold', 'patient');
    insert into public.clinician_applications (organisation_id, profile_id, state, employment_type, is_test) values (v_org, v_rj, 'rejected', 'contracted', true) returning id into v_rjapp;
    insert into public.clinician_application_transitions (organisation_id, application_id, from_state, to_state, actor_id, reason, is_test, created_at)
      values (v_org, v_rjapp, 'checks_in_progress', 'rejected', null, 'purge proof', true, now() - interval '25 months');
    insert into public.clinician_documents (organisation_id, owner_profile_id, application_id, kind, storage_path, mime_type, size_bytes, sha256, is_test)
      values (v_org, v_rj, v_rjapp, 'mdcn_practising_licence', 'purge-proof/' || v_rj || '/a.pdf', 'application/pdf', 100, v_hash, true) returning id into v_d1;
    v_pu := pg_temp.mkuser(v_org, 'retained', 'patient');
    insert into public.clinician_applications (organisation_id, profile_id, state, employment_type, is_test) values (v_org, v_pu, 'started', 'contracted', true) returning id into v_puapp;
    insert into public.clinician_documents (organisation_id, owner_profile_id, application_id, kind, storage_path, mime_type, size_bytes, sha256, retain_until, is_test)
      values (v_org, v_pu, v_puapp, 'mdcn_practising_licence', 'purge-proof/' || v_pu || '/b.pdf', 'application/pdf', 100, v_hash, current_date - 1, true) returning id into v_d3;
    insert into public.clinician_documents (organisation_id, owner_profile_id, application_id, kind, storage_path, mime_type, size_bytes, sha256, is_test)
      values (v_org, v_pu, v_puapp, 'government_id', 'purge-proof/' || v_pu || '/c.pdf', 'application/pdf', 100, v_hash, true) returning id into v_d4;

    perform pg_temp.act(v_admin);
    perform pg_temp.rec('an admin cannot list or purge documents', '42501', pg_temp.try('select * from public.credential_documents_due_for_purge()'));
    perform pg_temp.back();
    perform pg_temp.act_anon();
    perform pg_temp.rec('anon cannot list documents due for purge', '42501', pg_temp.try('select * from public.credential_documents_due_for_purge()'));
    perform pg_temp.back();

    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    set local role service_role;
    perform pg_temp.rec('while the purge is switched off nothing is listed', '0', (select count(*)::text from public.credential_documents_due_for_purge()));
    perform pg_temp.rec('while the purge is switched off a purge is refused', '23514', pg_temp.try(format('select public.purge_credential_document(%L)', v_d1)));
    perform pg_temp.back();

    update public.credentialing_config set rules = rules || '{"document_purge_enabled": true}'::jsonb where is_active;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    set local role service_role;
    perform pg_temp.rec('past retention and rejected-past-period documents are due', '2', (select count(*)::text from public.credential_documents_due_for_purge() where document_id in (v_d1, v_d3)));
    perform pg_temp.rec('a document that is not due is not listed', '0', (select count(*)::text from public.credential_documents_due_for_purge() where document_id = v_d4));
    perform pg_temp.rec('a document that is not due cannot be purged', '23514', pg_temp.try(format('select public.purge_credential_document(%L)', v_d4)));
    perform public.purge_credential_document(v_d1);
    perform pg_temp.back();
    perform pg_temp.rec('a purged document is gone', '0', (select count(*)::text from public.clinician_documents where id = v_d1));
    perform pg_temp.rec('the purge left one audit entry', '1', (select count(*)::text from public.audit_log where action = 'clinician_document.purged' and entity_id = v_d1));
    perform pg_temp.rec('the other documents were left alone', '2', (select count(*)::text from public.clinician_documents where id in (v_d3, v_d4)));

    -- sabotage: a purge check that always says "due" must make the not-due refusal change
    create or replace function private.credential_purge_reason(d public.clinician_documents) returns text
      language sql stable set search_path = '' as $f$ select 'retention_elapsed'::text $f$;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform set_config('request.jwt.claim.role', 'service_role', true);
    set local role service_role;
    v_sab := pg_temp.try(format('select public.purge_credential_document(%L)', v_d4));
    perform pg_temp.back();
    if v_sab = '23514' then
      raise exception 'VACUOUS TEST: a purge check that is always due did not change the not-due refusal';
    end if;
  end;

  -- 9. SABOTAGE: drop the state guard; a direct state update must now succeed -----------------------------------
  drop trigger clinician_applications_guard_state on public.clinician_applications;
  insert into results values ('sabotaged', 'a direct state update is refused', '42501',
    pg_temp.try(format('update public.clinician_applications set state = ''active'' where id = %L', v_app3)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S15 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then
    raise exception 'VACUOUS TEST: dropping the state guard did not change the direct-update check';
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged row is asserted to FAIL inside the DO block above (a vacuous test raises). It is
-- deliberately not printed: the runner treats any FAIL verdict in the output as a failed proof.

rollback;
