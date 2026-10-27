-- W-10 proof: AI-001 restricted advisory mode, CMO risk acceptance, 30 day automatic switch-off (migration *_w10_ai_restricted_advisory_mode.sql).
-- NOT EXECUTED LOCALLY when written (Docker was down); the CI replay is its first run. Nothing is signed or restricted for real: it all rolls back.
--   1. The migration restricts nothing; ai_runtime_config carries restricted_mode and keeps the enabled flag.
--   2. set_ai_restricted_mode: CMO or admin only, reason required, re-evaluation 30 days out.
--   3. sign_ai_risk_acceptance: CMO only, bounded window, append-only.
--   4. The sweep switches off a system restricted 30+ days with no acceptance signed since, and leaves one with a valid acceptance on.
--   5. SABOTAGE: the acceptance test removed from the sweep, and the CMO check removed from the signing function; both must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

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
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
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
  values (v, 'w10-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'W10 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
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
  values (p_org, v, 'W10 ' || p_label, 'MDCN', 'W01-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true);
  return v;
end $f$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_cmo uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_doc := pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('admin', v_admin);
end $$;

-- 1. Nothing is restricted by the migration; the runtime config carries the new keys ----------------------------------------
do $$
begin
  insert into results values ('real', 'no system is restricted after the migration', '0', (select count(*)::text from public.ai_systems where restricted_mode <> 'none'));
  insert into results values ('real', 'ai_runtime_config reports restricted_mode none for AI-001', 'none', public.ai_runtime_config('AI-001')->>'restricted_mode');
  insert into results values ('real', 'ai_runtime_config still reports the enabled flag', 'true',
    ((public.ai_runtime_config('AI-001')->>'enabled')::boolean is not distinct from (select is_enabled from public.ai_systems where system_code = 'AI-001'))::text);
end $$;

-- 2. Setting the mode ---------------------------------------------------------------------------------------------------
do $$
declare r text;
begin
  r := pg_temp.q_as(pg_temp.f('doc'), $q$select public.set_ai_restricted_mode('AI-001', 'advisory_only', 'Restricted per D-08 proof')::text$q$);
  insert into results values ('real', 'a doctor who is not the CMO or an admin cannot restrict', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select public.set_ai_restricted_mode('AI-001', 'advisory_only', 'short')::text$q$);
  insert into results values ('real', 'a reason under 10 characters is refused', 'ERR:22023', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select public.set_ai_restricted_mode('AI-001', 'advisory_only', 'Restricted per D-08 proof')::text$q$);
  insert into results values ('real', 'the CMO restricts AI-001', 'true', (r !~ '^ERR')::text);
  insert into results values ('real', 'the re-evaluation date is 30 days out', '30',
    (select (reevaluation_due - current_date)::text from public.ai_systems where system_code = 'AI-001'));
  insert into results values ('real', 'ai_runtime_config now reports advisory_only', 'advisory_only', public.ai_runtime_config('AI-001')->>'restricted_mode');
  r := pg_temp.try_anon($q$select public.set_ai_restricted_mode('AI-001', 'none', 'anon should fail here')$q$);
  insert into results values ('real', 'anon is refused', '42501', r);
end $$;

-- 3. Acceptance ----------------------------------------------------------------------------------------------------------
do $$
declare r text;
begin
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L)::text$q$, (current_date + 30)::text));
  insert into results values ('real', 'only the CMO can sign an acceptance', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L)::text$q$, (current_date + 400)::text));
  insert into results values ('real', 'an acceptance longer than 180 days is refused by the table check', 'ERR:23514', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.ai_restriction_status('AI-001')->>'restricted_mode'$q$));
  insert into results values ('real', 'the CMO reads the status', 'advisory_only', r);
  r := pg_temp.q_as(pg_temp.f('doc'), $q$select (public.ai_restriction_status('AI-001'))::text$q$);
  insert into results values ('real', 'a doctor cannot read the status', 'ERR:42501', r);
end $$;

-- 4. The 30 day switch-off ----------------------------------------------------------------------------------------------
do $$
declare r text; v_n integer; v_acc uuid;
begin
  -- restricted today: the sweep does nothing
  v_n := private.sweep_ai_restriction_expiry();
  insert into results values ('real', 'the sweep leaves a recently restricted system on', 'true', (select is_enabled::text from public.ai_systems where system_code = 'AI-001'));

  -- 31 days on with no acceptance: switched off
  update public.ai_systems set restricted_since = now() - interval '31 days' where system_code = 'AI-001';
  v_n := private.sweep_ai_restriction_expiry();
  insert into results values ('real', 'after 30 days with no acceptance the system is switched off', 'false', (select is_enabled::text from public.ai_systems where system_code = 'AI-001'));
  insert into results values ('real', 'the switch-off records why', 'true', (select (disabled_reason like '%W-10%')::text from public.ai_systems where system_code = 'AI-001'));

  -- a signed acceptance after the restriction keeps it on
  set local session_replication_role = replica;
  update public.ai_systems set is_enabled = true, disabled_at = null, disabled_reason = null where system_code = 'AI-001';
  set local session_replication_role = origin;
  r := pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L)::text$q$, (current_date + 30)::text));
  insert into results values ('real', 'the CMO signs a valid acceptance', 'true', (r !~ '^ERR')::text);
  v_n := private.sweep_ai_restriction_expiry();
  insert into results values ('real', 'with a valid signed acceptance the system stays on', 'true', (select is_enabled::text from public.ai_systems where system_code = 'AI-001'));

  begin
    update public.ai_risk_acceptances set summary = 'edited after signing, should fail';
    insert into results values ('real', 'an acceptance cannot be edited', 'raised', 'no error');
  exception when others then
    insert into results values ('real', 'an acceptance cannot be edited', 'raised', 'raised');
  end;
end $$;

-- 5. SABOTAGE ------------------------------------------------------------------------------------------------------------
do $$
declare v_orig text; v_def text; v_n integer;
begin
  -- the acceptance check removed from the sweep: a system with a valid acceptance is wrongly switched off
  v_orig := pg_get_functiondef('private.sweep_ai_restriction_expiry()'::regprocedure);
  v_def := replace(v_orig, 'a.accepted_at >= s.restricted_since', 'false');
  if v_def = v_orig then raise exception 'SABOTAGE 1 not applied'; end if;
  execute v_def;
  v_n := private.sweep_ai_restriction_expiry();
  insert into results values ('sabotaged', 'with a valid signed acceptance the system stays on', 'true', (select is_enabled::text from public.ai_systems where system_code = 'AI-001'));
end $$;

do $$
declare r text; v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('public.sign_ai_risk_acceptance(text,text,date)'::regprocedure);
  v_def := replace(v_orig, 'if v_uid is null or not private.credential_is_cmo() then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L)::text$q$, (current_date + 30)::text));
  insert into results values ('sabotaged', 'only the CMO can sign an acceptance', 'ERR:42501', case when r like 'ERR:%' then r else 'ERR:none' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'W10 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
