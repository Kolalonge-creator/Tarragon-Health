-- S47c proof: the yearly report build does not let one failing patient block the others, and asks before it spends an AI draft
-- (migration *_s47c_report_build_backoff_and_precheck.sql). One rolled-back transaction.
-- Proves:
--   1. Candidates are ordered with failed patients behind clean ones; a failure waits (a day, then two...) and is dropped after 5 attempts; a clean patient
--      is never held up (control: with no failures the original order holds); a patient who got a report is no longer a candidate.
--   2. health_report_build_allowed answers guard_off, settings_unsigned, draft_waiting and ok for the cases the writer refuses, so the route can stop before
--      requesting an AI draft; only the service role can call it or record a failure.
--   3. SABOTAGE: the backoff removed from the candidate list, and the pre-check forced to ok.
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
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.sqlstate_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.state_as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
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
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_sex text default 'female', p_age integer default 45) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's46-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'S46 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => p_age, days => 30))::date, p_sex::public.sex, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone,
     date_of_birth = excluded.date_of_birth, sex = excluded.sex;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician', 'male', 40);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S46 ' || p_label, 'MDCN', 'S46-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (p_org, s, 'result_review', p_admin, true);
  return v;
end $f$;
create function pg_temp.go_real(p_uid uuid) returns void language sql as $$ update public.profiles set is_test = false where id = p_uid $$;
create function pg_temp.guards_on(p_keys text[]) returns void language plpgsql as
$f$ begin
  execute format($q$create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
    as $b$select p_key = any (%L::text[])$b$$q$, p_keys);
end $f$;
create function pg_temp.mkpatient(p_label text, p_with_doc boolean default true) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  v := pg_temp.mkuser(pg_temp.f('org'), p_label, 'patient', 'female', 45);
  if p_with_doc then
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id) values (pg_temp.f('org'), v, pg_temp.f('doc'), pg_temp.f('doc'));
  end if;
  return v;
end $f$;
create function pg_temp.sresult(p_pat uuid, p_code text, p_status text, p_age interval) returns void language sql as
$$ insert into public.screening_results (organisation_id, patient_id, screen_type_code, result_status, created_at)
   values (pg_temp.f('org'), p_pat, p_code, p_status::public.result_status, now() - p_age) $$;
create function pg_temp.scomp(p_pat uuid, p_code text, p_age interval) returns void language sql as
$$ insert into public.screening_completions (organisation_id, patient_id, screen_type_id, performed_date)
   values (pg_temp.f('org'), p_pat, (select id from public.screen_types where code = p_code), (now() - p_age)::date) $$;
create function pg_temp.excl(p_pat uuid, p_code text) returns text language sql as
$$ select coalesce((select e ->> 'reason' from jsonb_array_elements(private.compute_screening_order_exclusions(p_pat, pg_temp.f('org'), array[p_code])) e limit 1), 'none') $$;
-- one released lab result, items as jsonb [{code,num|text,unit,low,high,flag,sens}]
create function pg_temp.mkresult(p_pat uuid, p_released_at timestamptz, p_items jsonb) returns uuid language plpgsql as
$f$ declare v uuid; i jsonb; v_sens boolean;
begin
  v_sens := exists (select 1 from jsonb_array_elements(p_items) x where coalesce((x ->> 'sens')::boolean, false));
  insert into public.lab_results (organisation_id, patient_id, panel_code, panel_version_id, source, submitted_by_kind, release_state, received_at, is_test)
  values (pg_temp.f('org'), p_pat, 'membership_annual', (select id from public.lab_panel_versions where panel_code = 'membership_annual' and is_active),
          'portal_entry', 'partner', case when v_sens then 'clinician_disclosure_required' else 'awaiting_review' end, p_released_at - interval '1 day', true)
  returning id into v;
  for i in select * from jsonb_array_elements(p_items) loop
    insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit, ref_low, ref_high, flag, sensitive_positive, is_test)
    values (v, pg_temp.f('org'), p_pat, i ->> 'code', (i ->> 'num')::numeric, i ->> 'text', coalesce(i ->> 'unit', 'mg/dL'),
            (i ->> 'low')::numeric, (i ->> 'high')::numeric, i ->> 'flag', coalesce((i ->> 'sens')::boolean, false), true);
  end loop;
  update public.lab_results set release_state = 'released', released_at = p_released_at, reviewed_by = pg_temp.f('doc'),
         disclosure_attested = v_sens, disclosure_method = case when v_sens then 'in_person' end
   where id = v;
  return v;
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', 'male', 40);
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin));
  -- S46c: the sign-off task is offered to an employed named doctor first; a contracted one pulls from the pool with an availability block
  update public.clinical_staff set employment_type = 'employed', indemnity_exempt = false, indemnity_exempt_by = null where profile_id = pg_temp.f('doc');
  perform pg_temp.setf('stranger', pg_temp.mkdoc(v_org, 'stranger', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('cc', pg_temp.mkdoc(v_org, 'cc', 'care_coordinator', v_admin));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id, care_coordinator_id)
    select v_org, pg_temp.mkuser(v_org, 'ccpat', 'patient', 'female', 45), pg_temp.f('doc'), pg_temp.f('doc'), pg_temp.f('cc');
  perform pg_temp.setf('pat', pg_temp.mkpatient('pat'));
  perform pg_temp.setf('other', pg_temp.mkpatient('other'));
end $$;


create function pg_temp.with_bp(p_pat uuid) returns void language sql as
$$ insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
   values (pg_temp.f('org'), p_pat, 'blood_pressure', 122, 78, 'device', make_timestamptz(extract(year from now())::integer, 1, 2, 9, 0, 0, 'Africa/Lagos')) $$;
create function pg_temp.cands(p_limit integer) returns text language sql as
$$ select coalesce((select string_agg(c.patient_id::text, ',' order by ord) from (select patient_id, row_number() over () ord from public.health_report_candidates(extract(year from now())::integer, p_limit)) c
        where c.patient_id in (select v from fx where k like 'cand%')), 'none') $$;
create function pg_temp.name_of(p_ids text) returns text language sql as
$$ select coalesce((select string_agg(k, ',' order by position(v::text in p_ids)) from fx where k like 'cand%' and p_ids like '%' || v::text || '%'), 'none') $$;
do $$
declare a uuid := pg_temp.mkpatient('cand_a', false); b uuid := pg_temp.mkpatient('cand_b', false); c uuid := pg_temp.mkpatient('cand_c', false);
        yr integer := extract(year from now())::integer; n integer;
begin
  -- older first: a was created before b before c
  update public.profiles set created_at = now() - interval '3 days' where id = a;
  update public.profiles set created_at = now() - interval '2 days' where id = b;
  update public.profiles set created_at = now() - interval '1 day' where id = c;
  perform pg_temp.setf('cand_a', a); perform pg_temp.setf('cand_b', b); perform pg_temp.setf('cand_c', c);
  perform pg_temp.with_bp(a); perform pg_temp.with_bp(b); perform pg_temp.with_bp(c);
  -- make this proof independent of any other patient in the database: only a, b, c count
  perform pg_temp.ck('control: with no failure the original order holds', 'cand_a,cand_b,cand_c', pg_temp.name_of(pg_temp.cands(100)));
  n := public.record_health_report_build_failure(a, yr, 'writer refused');
  perform pg_temp.ck('a failure is counted', '1', n::text);
  perform pg_temp.ck('the failed patient waits: it is not a candidate straight after the failure', 'cand_b,cand_c', pg_temp.name_of(pg_temp.cands(100)));
  update public.health_report_build_failures set last_attempt_at = now() - interval '25 hours' where patient_id = a;
  perform pg_temp.ck('after a day it is tried again, but BEHIND the clean patients', 'cand_b,cand_c,cand_a', pg_temp.name_of(pg_temp.cands(100)));
  perform pg_temp.ck('with room for two, the failed one does not take a slot from a clean one', 'cand_b,cand_c', pg_temp.name_of(pg_temp.cands(2)));
  n := public.record_health_report_build_failure(a, yr, 'again');
  update public.health_report_build_failures set last_attempt_at = now() - interval '25 hours' where patient_id = a;
  perform pg_temp.ck('the wait doubles: a day is no longer enough after the second failure', 'cand_b,cand_c', pg_temp.name_of(pg_temp.cands(100)));
  update public.health_report_build_failures set attempts = 5, last_attempt_at = now() - interval '400 days' where patient_id = a;
  perform pg_temp.ck('after 5 attempts it is dropped for the year, however long ago', 'cand_b,cand_c', pg_temp.name_of(pg_temp.cands(100)));
  perform pg_temp.ck('...and the failure row says why', 'again', (select last_reason from public.health_report_build_failures where patient_id = a));
  delete from public.health_report_build_failures where patient_id = a;
  perform pg_temp.ck('an operator clearing the row lets it back in', 'cand_a,cand_b,cand_c', pg_temp.name_of(pg_temp.cands(100)));
  -- a patient with a report is no longer a candidate
  insert into public.health_reports (organisation_id, patient_id, year, version, config_version_id, inputs, composed, priorities, status, is_test)
    select pg_temp.f('org'), b, yr, 1, (select id from public.health_report_config_versions order by version desc limit 1), '{}', '{"items":[]}', '[]', 'pending_signature', true;
  perform pg_temp.ck('a patient who already has a report this year is not a candidate', 'cand_a,cand_c', pg_temp.name_of(pg_temp.cands(100)));
end $$;

do $$
declare a uuid := pg_temp.f('cand_a'); b uuid := pg_temp.f('cand_b'); c uuid := pg_temp.f('cand_c'); yr integer := extract(year from now())::integer; real_p uuid;
begin
  -- b has a pending draft; c is a test patient with settings only proposed
  perform pg_temp.ck('allowed: a draft already waiting is reported before any AI call', 'draft_waiting', public.health_report_build_allowed(b, yr));
  perform pg_temp.ck('allowed: a test patient with proposed settings is ok', 'ok', public.health_report_build_allowed(c, yr));
  update public.profiles set is_test = false where id = c;
  perform pg_temp.ck('allowed: a real patient with the guard off is told guard_off', 'guard_off', public.health_report_build_allowed(c, yr));
  perform pg_temp.guards_on(array['health_report_generation_enabled']);
  perform pg_temp.ck('allowed: guard on but the settings unsigned is told settings_unsigned', 'settings_unsigned', public.health_report_build_allowed(c, yr));
  perform pg_temp.guards_on(array[]::text[]);
  perform pg_temp.ck('allowed: an unknown person is patient_not_found', 'patient_not_found', public.health_report_build_allowed(gen_random_uuid(), yr));
  perform pg_temp.ck('only the service role may call the pre-check or record a failure', 'false,false,false,false',
    has_function_privilege('anon', 'public.health_report_build_allowed(uuid,integer)', 'EXECUTE')::text || ',' || has_function_privilege('authenticated', 'public.health_report_build_allowed(uuid,integer)', 'EXECUTE')::text || ',' ||
    has_function_privilege('authenticated', 'public.record_health_report_build_failure(uuid,integer,text)', 'EXECUTE')::text || ',' || has_table_privilege('authenticated', 'public.health_report_build_failures', 'SELECT')::text);
  perform pg_temp.ck('...and the service role can', 'true,true',
    has_function_privilege('service_role', 'public.health_report_build_allowed(uuid,integer)', 'EXECUTE')::text || ',' || has_function_privilege('service_role', 'public.record_health_report_build_failure(uuid,integer,text)', 'EXECUTE')::text);
end $$;

-- Sabotage -------------------------------------------------------------------------------------------------------------------------
-- A: the backoff taken out of the candidate list. The failed patient must then come first again.
do $$
declare a uuid := pg_temp.f('cand_a'); v_def text;
begin
  perform public.record_health_report_build_failure(a, extract(year from now())::integer, 'writer refused');
  v_def := pg_get_functiondef('public.health_report_candidates(integer,integer)'::regprocedure);
  v_def := replace(replace(v_def, 'order by coalesce(f.attempts, 0), p.created_at', 'order by p.created_at'), 'and (f.patient_id is null or (f.attempts < 5', 'and (true or (f.attempts < 5');
  execute v_def;
  insert into results values ('sabotaged', 'the failed patient waits: it is not a candidate straight after the failure', 'cand_b,cand_c', pg_temp.name_of(pg_temp.cands(100)));
end $$;
-- B: the pre-check forced to ok. A draft already waiting must then not be reported.
do $$
begin
  create or replace function public.health_report_build_allowed(p_patient uuid, p_year integer) returns text language sql as $f$ select 'ok'::text $f$;
  insert into results values ('sabotaged', 'allowed: a draft already waiting is reported before any AI call', 'draft_waiting', public.health_report_build_allowed(pg_temp.f('cand_b'), extract(year from now())::integer));
end $$;
do $$
begin
  create or replace function public.health_report_candidates(p_year integer, p_limit integer default 25) returns table (patient_id uuid) language sql as $f$ select id from public.profiles order by created_at limit 1 $f$;
  insert into results values ('sabotaged', 'control: with no failure the original order holds', 'cand_a,cand_b,cand_c', pg_temp.name_of(pg_temp.cands(100)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S47c proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
