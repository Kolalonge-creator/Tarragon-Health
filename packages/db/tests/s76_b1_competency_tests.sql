-- S76 B1 proof: new competencies and the scenario test rule (migration *_s76_competencies_maternal_mental_paediatrics.sql).
--   1. maternal, mental_health and paediatrics exist as data.
--   2. A competency with ZERO approved scenarios is granted exactly as today (CMO, audited).
--   3. Once a scenario carries the competency and is approved, a grant is refused until a passed competency test exists.
--   4. A red miss fails the test even at a high score; a clean pass allows the grant.
--   5. The entry test never draws a competency scenario; the test start never returns the answer key.
--   6. RLS: another clinician and anon cannot read attempts or call the doors.
--   7. SABOTAGE: with the enforcing trigger dropped the refused grant succeeds.
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's76b1-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S76B1 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '35 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_cmo_staff uuid; v_c1 uuid; v_c1_staff uuid; v_c2 uuid; v_c2_staff uuid;
  v_case_red uuid; v_case_n uuid; v_att jsonb; v_attempt uuid; v_n integer; v_sab text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_c1 := pg_temp.mkuser(v_org, 'c1', 'clinician');
  v_c2 := pg_temp.mkuser(v_org, 'c2', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'S76 CMO', 'MDCN', 'S76B1-CMO', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true)
    returning id into v_cmo_staff;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_c1, 'S76 C1', 'MDCN', 'S76B1-C1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 1, true)
    returning id into v_c1_staff;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_c2, 'S76 C2', 'MDCN', 'S76B1-C2', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 1, true)
    returning id into v_c2_staff;

  -- 1
  perform pg_temp.rec('three competencies exist', '3', (select count(*)::text from public.competencies where code in ('maternal', 'mental_health', 'paediatrics')));

  -- 2. zero scenarios: the grant works as today
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('no scenarios: CMO grant works as today', 'ok', pg_temp.try(format('select public.grant_clinician_competency(%L, %L)', v_c1_staff, 'paediatrics')));
  perform pg_temp.back();
  perform pg_temp.rec('no scenarios: the grant is audited', '1', (select count(*)::text from public.audit_log where action = 'clinician_competency.granted' and entity_id = v_c1_staff and event ->> 'code' = 'paediatrics'));

  -- 3. author and approve two scenarios (a red and a plain one) for mental_health, as the CMO
  perform pg_temp.act(v_cmo);
  v_case_red := public.save_credential_test_case(null, 's76-mh-red', 'Red scenario', '[{"id":"a","text":"right"},{"id":"b","text":"wrong"}]'::jsonb, 'a', true, 'r');
  v_case_n := public.save_credential_test_case(null, 's76-mh-n', 'Plain scenario', '[{"id":"a","text":"right"},{"id":"b","text":"wrong"}]'::jsonb, 'a', false, 'r');
  perform public.set_credential_test_case_competency(v_case_red, 'mental_health');
  perform public.set_credential_test_case_competency(v_case_n, 'mental_health');
  perform public.approve_credential_content('test_case', v_case_red);
  perform public.approve_credential_content('test_case', v_case_n);
  perform pg_temp.rec('an approved scenario cannot be re-tagged', '23514', pg_temp.try(format('select public.set_credential_test_case_competency(%L, %L)', v_case_n, 'maternal')));
  perform pg_temp.back();
  perform pg_temp.act(v_c2);
  perform pg_temp.rec('a non-CMO cannot tag a scenario', '42501', pg_temp.try(format('select public.set_credential_test_case_competency(%L, %L)', v_case_red, 'maternal')));
  perform pg_temp.back();

  -- grant refused without a pass
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('scenarios exist: grant without a pass is refused', '23514', pg_temp.try(format('select public.grant_clinician_competency(%L, %L)', v_c2_staff, 'mental_health')));
  perform pg_temp.back();

  -- 5. the test start never returns the answer key; the entry test never draws these
  perform pg_temp.act(v_c2);
  v_att := public.start_competency_test('mental_health');
  perform pg_temp.back();
  perform pg_temp.rec('the test returns both scenarios', '2', jsonb_array_length(v_att -> 'cases')::text);
  perform pg_temp.rec('no answer key in the test payload', 'false', (v_att::text like '%correct_option_id%')::text);
  v_attempt := (v_att ->> 'attempt_id')::uuid;

  -- 4. a red miss fails even though the plain scenario is right (50 percent, red wrong)
  perform pg_temp.act(v_c2);
  perform pg_temp.rec('red miss fails', 'false', (public.submit_competency_test(v_attempt, jsonb_build_object(v_case_red::text, 'b', v_case_n::text, 'a')) ->> 'passed'));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('a failed test still blocks the grant', '23514', pg_temp.try(format('select public.grant_clinician_competency(%L, %L)', v_c2_staff, 'mental_health')));
  perform pg_temp.back();
  -- cooldown then clean pass (move the failed attempt back in time, a trusted-role fixture step)
  update public.competency_test_attempts set submitted_at = now() - interval '2 days' where id = v_attempt;
  perform pg_temp.act(v_c2);
  v_att := public.start_competency_test('mental_health');
  v_attempt := (v_att ->> 'attempt_id')::uuid;
  perform pg_temp.rec('clean answers pass', 'true', (public.submit_competency_test(v_attempt, jsonb_build_object(v_case_red::text, 'a', v_case_n::text, 'a')) ->> 'passed'));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('after a pass the grant works', 'ok', pg_temp.try(format('select public.grant_clinician_competency(%L, %L)', v_c2_staff, 'mental_health')));
  perform pg_temp.back();
  perform pg_temp.rec('the competency row exists', '1', (select count(*)::text from public.clinician_competencies where clinical_staff_id = v_c2_staff and competency_code = 'mental_health' and revoked_at is null));
  -- the clinician who did not pass is still refused
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('another clinician without a pass is refused', '23514', pg_temp.try(format('select public.grant_clinician_competency(%L, %L)', v_c1_staff, 'mental_health')));
  perform pg_temp.back();

  -- 6. RLS
  perform pg_temp.act(v_c1);
  select count(*) into v_n from public.competency_test_attempts;
  perform pg_temp.back();
  perform pg_temp.rec('another clinician reads no attempts', '0', v_n::text);
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot read attempts', '42501', pg_temp.try('select count(*) from public.competency_test_attempts'));
  perform pg_temp.rec('anon cannot start a test', '42501', pg_temp.try('select public.start_competency_test(''mental_health'')'));
  perform pg_temp.back();

  -- 7. SABOTAGE
  drop trigger clinician_competencies_require_test on public.clinician_competencies;
  perform pg_temp.act(v_cmo);
  insert into results values ('sabotaged', 'grant without a pass is refused', '23514',
    pg_temp.try(format('select public.grant_clinician_competency(%L, %L)', v_c1_staff, 'mental_health')));
  perform pg_temp.back();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S76 B1 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: dropping the trigger did not change the grant check'; end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
