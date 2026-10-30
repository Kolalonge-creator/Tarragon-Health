-- Proof: public.review_ai_evaluation_run (migration *_ai_evaluation_run_cmo_review.sql).
-- In a rolled-back transaction: only the active CMO can record a review; a doctor, an admin who is not the CMO and anon are refused;
-- a direct write of reviewed_by / reviewed_at (admin included) is refused; the caller must state the outcome they read; an unfinished
-- or already-reviewed run is refused; a review stamps the CMO staff id, never changes the outcome (a fail stays a fail), is audited with
-- the suite and counts, and is cleared when the reviewed result changes. It also proves the review is what satisfies the assistant
-- go-live condition. SABOTAGE: the CMO check is removed, then the trigger is dropped; each must flip a result.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'aier-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'Aier ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_sys uuid; v_staff uuid; v_suite uuid;
  v_pass uuid; v_fail uuid; v_open uuid; v_sab uuid; v_sab2 uuid; v_before text; v_ai001 uuid; v_gl uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_doc := pg_temp.mkuser(v_org, 'doctor', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'Aier CMO', 'MDCN', 'AIER-CMO-1', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true) returning id into v_staff;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_doc, 'Aier Doctor', 'MDCN', 'AIER-DOC-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true);

  insert into public.ai_systems (system_code, name, purpose, owner_role, risk_class, autonomy_level, clinically_meaningful, fallback_behaviour)
    values ('AI-993', 'Aier proof system', 'proof', 'Clinical Director', 'moderate', 'inform_only', false, 'none') returning id into v_sys;
  insert into public.ai_evaluation_suites (ai_system_id, name, kind) values (v_sys, 'Aier proof suite', 'safety') returning id into v_suite;

  -- a finished passing run, a finished failing run, and one still open
  insert into public.ai_evaluation_runs (ai_system_id, suite_id, total_cases, passed_cases, failed_cases, completed_at, outcome)
    values (v_sys, v_suite, 4, 4, 0, now(), 'pass') returning id into v_pass;
  insert into public.ai_evaluation_runs (ai_system_id, suite_id, total_cases, passed_cases, failed_cases, completed_at, outcome)
    values (v_sys, v_suite, 2, 0, 2, now(), 'fail') returning id into v_fail;
  insert into public.ai_evaluation_runs (ai_system_id, suite_id) values (v_sys, v_suite) returning id into v_open;

  perform pg_temp.act(v_doc);
  perform pg_temp.rec('a doctor is refused', '42501', pg_temp.try(format($q$select public.review_ai_evaluation_run(%L, 'pass')$q$, v_pass)));
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin who is not the CMO is refused', '42501', pg_temp.try(format($q$select public.review_ai_evaluation_run(%L, 'pass')$q$, v_pass)));
  perform pg_temp.rec('an admin cannot write a review straight to the table', '42501', pg_temp.try(format($q$update public.ai_evaluation_runs set reviewed_by = %L, reviewed_at = now() where id = %L$q$, v_staff, v_pass)));
  perform pg_temp.rec('an admin cannot insert an already-reviewed run', '42501', pg_temp.try(format($q$insert into public.ai_evaluation_runs (ai_system_id, suite_id, completed_at, outcome, total_cases, passed_cases, reviewed_by, reviewed_at) values (%L, %L, now(), 'pass', 1, 1, %L, now())$q$, v_sys, v_suite, v_staff)));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon is refused', '42501', pg_temp.try(format($q$select public.review_ai_evaluation_run(%L, 'pass')$q$, v_pass)));
  perform pg_temp.back();
  perform pg_temp.rec('nothing was reviewed by the refusals', '0', (select count(*)::text from public.ai_evaluation_runs where reviewed_at is not null and ai_system_id = v_sys));

  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('an unknown run is refused', '22023', pg_temp.try($q$select public.review_ai_evaluation_run(gen_random_uuid(), 'pass')$q$));
  perform pg_temp.rec('an unfinished run is refused', '22023', pg_temp.try(format($q$select public.review_ai_evaluation_run(%L, 'pass')$q$, v_open)));
  perform pg_temp.rec('a wrong stated outcome is refused', '22023', pg_temp.try(format($q$select public.review_ai_evaluation_run(%L, 'fail')$q$, v_pass)));
  perform pg_temp.rec('a null stated outcome is refused', '22023', pg_temp.try(format($q$select public.review_ai_evaluation_run(%L, null)$q$, v_pass)));
  perform pg_temp.back();
  perform pg_temp.rec('...and nothing was stamped by those', '0', (select count(*)::text from public.ai_evaluation_runs where reviewed_at is not null and ai_system_id = v_sys));

  -- not yet reviewed, so the assistant go-live condition does not count it (AI-001 only; this system is AI-993, so test the column directly)
  perform pg_temp.act(v_cmo);
  perform public.review_ai_evaluation_run(v_pass, 'pass', 'read all four cases');
  perform public.review_ai_evaluation_run(v_fail, 'fail', 'read the two failures');
  perform pg_temp.back();
  perform pg_temp.rec('the reviewed run carries the CMO staff id and a time', 'true', (select (reviewed_by = v_staff and reviewed_at is not null)::text from public.ai_evaluation_runs where id = v_pass));
  perform pg_temp.rec('a review never changes the outcome (pass)', 'pass', (select outcome::text from public.ai_evaluation_runs where id = v_pass));
  perform pg_temp.rec('a review never changes the outcome (a fail stays a fail)', 'fail', (select outcome::text from public.ai_evaluation_runs where id = v_fail));
  perform pg_temp.rec('the open run is untouched', 'null', (select coalesce(reviewed_at::text, 'null') from public.ai_evaluation_runs where id = v_open));
  perform pg_temp.rec('the audit row keeps the suite, system, outcome and counts', 'AI-993,Aier proof suite,pass,4,4',
    (select (event ->> 'system_code') || ',' || (event ->> 'suite') || ',' || (event ->> 'outcome') || ',' || (event ->> 'total_cases') || ',' || (event ->> 'passed_cases')
       from public.audit_log where action = 'ai_evaluation_run.reviewed' and entity_id = v_pass and actor_id = v_cmo));
  perform pg_temp.rec('the audit row keeps the note', 'read all four cases', (select event ->> 'note' from public.audit_log where action = 'ai_evaluation_run.reviewed' and entity_id = v_pass));
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('a second review of the same run is refused', '22023', pg_temp.try(format($q$select public.review_ai_evaluation_run(%L, 'pass')$q$, v_pass)));
  perform pg_temp.back();
  perform pg_temp.rec('execute grants: anon none, authenticated yes', 'false,true',
    has_function_privilege('anon', 'public.review_ai_evaluation_run(uuid, text, text)', 'EXECUTE')::text || ',' || has_function_privilege('authenticated', 'public.review_ai_evaluation_run(uuid, text, text)', 'EXECUTE')::text);

  -- a harmless touch keeps the review; a change to the reviewed result clears it
  update public.ai_evaluation_runs set notes = 'tidy' where id = v_pass;
  perform pg_temp.rec('editing the notes keeps the review', 'true', (select (reviewed_at is not null)::text from public.ai_evaluation_runs where id = v_pass));
  update public.ai_evaluation_runs set passed_cases = 3, failed_cases = 1, outcome = 'fail' where id = v_pass;
  perform pg_temp.rec('changing the reviewed result clears the review', 'null', (select coalesce(reviewed_at::text, 'null') from public.ai_evaluation_runs where id = v_pass));
  perform pg_temp.rec('...including the reviewer', 'null', (select coalesce(reviewed_by::text, 'null') from public.ai_evaluation_runs where id = v_pass));

  -- the assistant go-live condition counts a reviewed, passing AI-001 safety run, and only after the CMO has reviewed it
  select id into v_ai001 from public.ai_systems where system_code = 'AI-001';
  insert into public.ai_evaluation_runs (ai_system_id, suite_id, total_cases, passed_cases, failed_cases, completed_at, outcome)
    values (v_ai001, v_suite, 3, 3, 0, now(), 'pass') returning id into v_gl;
  select split_part(elem ->> 'detail', ' ', 1) into v_before from jsonb_array_elements(private.go_live_conditions_assistant(v_org)) elem where elem ->> 'code' = 'red_flag_tests_passing';
  perform pg_temp.act(v_cmo);
  perform public.review_ai_evaluation_run(v_gl, 'pass');
  perform pg_temp.back();
  perform pg_temp.rec('a reviewed passing AI-001 safety run counts toward the assistant go-live condition', (v_before::integer + 1)::text,
    (select split_part(elem ->> 'detail', ' ', 1) from jsonb_array_elements(private.go_live_conditions_assistant(v_org)) elem where elem ->> 'code' = 'red_flag_tests_passing'));

  -- SABOTAGE 1: drop the CMO check; a doctor must now be able to stamp a review
  insert into public.ai_evaluation_runs (ai_system_id, suite_id, total_cases, passed_cases, failed_cases, completed_at, outcome)
    values (v_sys, v_suite, 1, 1, 0, now(), 'pass') returning id into v_sab;
  create or replace function public.review_ai_evaluation_run(p_run_id uuid, p_expected_outcome text, p_note text default null) returns void language plpgsql security definer set search_path = '' as
    $f$ begin
      perform set_config('app.ai_evaluation_review', 'on', true);
      update public.ai_evaluation_runs set reviewed_by = (select id from public.clinical_staff where doctor_tier = 'chief_medical_officer' limit 1), reviewed_at = now() where id = p_run_id;
      perform set_config('app.ai_evaluation_review', '', true);
    end $f$;
  perform pg_temp.act(v_doc);
  insert into results values ('sabotaged', 'a doctor is refused', '42501', pg_temp.try(format($q$select public.review_ai_evaluation_run(%L, 'pass')$q$, v_sab)));
  perform pg_temp.back();

  -- SABOTAGE 2: drop the trigger; an admin must now be able to stamp a review straight onto the table
  insert into public.ai_evaluation_runs (ai_system_id, suite_id, total_cases, passed_cases, failed_cases, completed_at, outcome)
    values (v_sys, v_suite, 1, 1, 0, now(), 'pass') returning id into v_sab2;
  drop trigger ai_evaluation_runs_validate_review on public.ai_evaluation_runs;
  perform pg_temp.act(v_admin);
  insert into results values ('sabotaged', 'an admin write is refused', '42501', pg_temp.try(format($q$update public.ai_evaluation_runs set reviewed_by = %L, reviewed_at = now() where id = %L$q$, v_staff, v_sab2)));
  perform pg_temp.back();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'AI evaluation run review proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: removing the CMO check and the review trigger must each change a result'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
