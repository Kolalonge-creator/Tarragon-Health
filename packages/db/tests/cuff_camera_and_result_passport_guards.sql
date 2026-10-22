-- Proof: cuff display camera reader and result passport (migration *_cuff_camera_and_result_passport_guards.sql). One rolled-back transaction. Proves:
--   1. Both go-live guards exist and start OFF. A REAL patient is refused (the guard answers closed); a TEST patient is let through (the guard's own rule),
--      so the flows can be exercised with a test account before anything is switched on.
--   2. REFUSED ROLES: anon cannot execute the guard question, cannot read go_live_guards, cannot read lab results; another patient cannot read this
--      patient's lab results.
--   3. AI-022 is registered DISABLED, not runtime governed, draft; it has no evaluation run, no prompt version and no knowledge source (nothing a human
--      must judge has been invented), so it is not enableable.
--   4. The database half of the passport's lab safety: a sensitive positive lab row (INV-04) is invisible to the patient who owns it, to another patient and
--      to anon, while the same patient's ordinary row is visible. The passport loader also states sensitive_positive = false in its own query, so this is
--      defence in depth, and this check is the part that would silently disappear if the restrictive policy were ever changed.
--   SABOTAGE A: the guard lookup made to always answer open. A real patient must then read the passport as open (the "closed for a real patient" check flips).
--   SABOTAGE B: the restrictive sensitive-result policy dropped. The owner must then read the sensitive row (the "owner cannot read a sensitive row" check flips).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_phone text := '+23481' || lpad((random() * 99999999)::int::text, 8, '0');
begin
  insert into auth.users (id, email, phone, phone_confirmed_at, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ccp-' || p_label || '-' || v || '@example.invalid', v_phone, now(), 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient', 'CCP ' || p_label || ' Person', v_phone, (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set is_test = excluded.is_test, is_active = true, full_name = excluded.full_name, phone = excluded.phone;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_real uuid; v_test uuid; v_other uuid; v_sys uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_real := pg_temp.mkuser(v_org, 'real', false);
  v_test := pg_temp.mkuser(v_org, 'test', true);
  v_other := pg_temp.mkuser(v_org, 'other', true);
  insert into fx values ('real', v_real), ('test', v_test), ('other', v_other);

  -- 1. the guards start off; a real patient is refused, a test patient is not
  perform pg_temp.ck('cuff_camera_enabled exists and is off', 'false', (select is_on::text from public.go_live_guards where key = 'cuff_camera_enabled'));
  perform pg_temp.ck('result_passport_enabled exists and is off', 'false', (select is_on::text from public.go_live_guards where key = 'result_passport_enabled'));
  perform pg_temp.ck('closed for a real patient: cuff camera', 'false', pg_temp.q_as(v_real, $q$select public.go_live_guard_is_open('cuff_camera_enabled')::text$q$));
  perform pg_temp.ck('closed for a real patient: result passport', 'false', pg_temp.q_as(v_real, $q$select public.go_live_guard_is_open('result_passport_enabled')::text$q$));
  perform pg_temp.ck('open for a test patient: cuff camera', 'true', pg_temp.q_as(v_test, $q$select public.go_live_guard_is_open('cuff_camera_enabled')::text$q$));
  perform pg_temp.ck('open for a test patient: result passport', 'true', pg_temp.q_as(v_test, $q$select public.go_live_guard_is_open('result_passport_enabled')::text$q$));

  -- 2. refused roles
  perform pg_temp.ck('anon cannot execute the guard question', 'false', has_function_privilege('anon', 'public.go_live_guard_is_open(text)', 'EXECUTE')::text);
  perform pg_temp.ck('authenticated can execute the guard question', 'true', has_function_privilege('authenticated', 'public.go_live_guard_is_open(text)', 'EXECUTE')::text);
  perform pg_temp.ck('anon cannot read go_live_guards', 'false', has_table_privilege('anon', 'public.go_live_guards', 'SELECT')::text);
  perform pg_temp.ck('anon cannot read lab results', 'false', has_table_privilege('anon', 'public.lab_analyte_readings', 'SELECT')::text);

  -- 3. AI-022 is registered, disabled and carries no invented human judgement
  select id into v_sys from public.ai_systems where system_code = 'AI-022';
  perform pg_temp.ck('AI-022 is registered', 'true', (v_sys is not null)::text);
  perform pg_temp.ck('AI-022 is disabled, not runtime governed, draft', 'false|false|draft',
    (select is_enabled::text || '|' || runtime_governed::text || '|' || lifecycle_status::text from public.ai_systems where id = v_sys));
  perform pg_temp.ck('AI-022 has no evaluation run', '0', (select count(*)::text from public.ai_evaluation_runs where ai_system_id = v_sys));
  perform pg_temp.ck('AI-022 has no prompt version', '0', (select count(*)::text from public.ai_prompt_versions where ai_system_id = v_sys));
  perform pg_temp.ck('AI-022 has no knowledge source', '0', (select count(*)::text from public.ai_knowledge_sources where ai_system_id = v_sys));
  perform pg_temp.ck('anon cannot read the AI registry', 'false', has_table_privilege('anon', 'public.ai_systems', 'SELECT')::text);

  -- 4. sensitive positive lab rows are invisible to everyone but a treating doctor
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, value_text, unit, taken_at, report_status, sensitive_positive)
  values (v_org, v_test, 'hba1c', 6.9, null, '%', now() - interval '3 days', 'final', false),
         (v_org, v_test, 'hbsag', null, 'Reactive', null, now() - interval '3 days', 'final', true);
  perform pg_temp.ck('the owner reads the ordinary lab row', '1', pg_temp.q_as(v_test, $q$select count(*)::text from public.lab_analyte_readings where code = 'hba1c'$q$));
  perform pg_temp.ck('the owner cannot read a sensitive row', '0', pg_temp.q_as(v_test, $q$select count(*)::text from public.lab_analyte_readings where sensitive_positive$q$));
  perform pg_temp.ck('another patient reads none of the owner''s lab rows', '0', pg_temp.q_as(v_other, $q$select count(*)::text from public.lab_analyte_readings$q$));
end $$;

-- SABOTAGE A: the guard lookup always answering open. A real patient must then see the passport open.
create or replace function private.go_live_open_patient(p_key text, p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;
insert into results values ('sabotaged', 'closed for a real patient: result passport', 'false',
  pg_temp.q_as((select v from fx where k = 'real'), $q$select public.go_live_guard_is_open('result_passport_enabled')::text$q$));

-- SABOTAGE B: the restrictive policy dropped. The owner must then read the sensitive row.
drop policy lab_analyte_readings_hide_sensitive on public.lab_analyte_readings;
insert into results values ('sabotaged', 'the owner cannot read a sensitive row', '0',
  pg_temp.q_as((select v from fx where k = 'test'), $q$select count(*)::text from public.lab_analyte_readings where sensitive_positive$q$));

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'cuff camera and result passport proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
