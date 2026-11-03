-- Proof: the CMO signs the blood pressure targets (D-09, migration *_bp_target_config_cmo_signing.sql).
--
--   a. Before signing: v1 is unsigned and inactive, and a patient with no personal target is judged against the 140/90 outcome default.
--   b. A senior doctor, an admin and a patient cannot sign (42501); anon cannot execute; nothing becomes active.
--   c. The hub reader: the CMO and an admin see v1 as pending; a senior doctor and a patient are refused.
--   d. A version with an out-of-range value or a context mapped to an unknown target is refused (22023).
--   e. The CMO signs v1: active, approved_by is the CMO's clinical_staff id, an audit row is written, a second signing is refused (23514),
--      and the hub reader shows it live with nothing pending.
--   f. After signing, the monthly report judges a patient with no personal target against the signed home target 135/85; a personal target
--      still wins; risk scoring and the Membership offer (private.patient_bp_target) keep their 140/90 baseline.
--   g. SABOTAGE: the CMO check made always true; the senior doctor's refusal must flip to a successful signature.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    execute p_sql into r;
    r := coalesce(nullif(r, ''), 'ok');   -- a void function reads back as an empty string
  exception when others then r := sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'bptarget-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'BPTarget ' || p_label, '+23481' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'BPTarget ' || p_label, 'MDCN', 'BPTarget-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true);
  return v;
end $f$;
-- the target the monthly report (the patient's own and the Care Circle's monthly block) judges a home average against
create function pg_temp.target(p_patient uuid) returns text language sql as
$$ select (r #>> '{target,systolic}') || '/' || (r #>> '{target,diastolic}') || '/' || (r #>> '{target,source}')
     from (select private.monthly_report_payload(p_patient, date_trunc('month', now() at time zone 'Africa/Lagos')::date) as r) x $$;
-- the baseline risk scoring and the Membership offer use, which signing must NOT move
create function pg_temp.baseline(p_patient uuid) returns text language sql as
$$ select sys || '/' || dia || '/' || source from private.patient_bp_target(p_patient) $$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_smo uuid; v_pat uuid; v_pat2 uuid; v_staff uuid; v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_smo := pg_temp.mkdoc(v_org, v_admin, 'smo', 'senior_medical_officer');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');

  -- a. before signing
  -- the CMO login is the one active CMO in this transaction (credential_is_cmo is per-login, so other CMOs do not interfere)
  perform pg_temp.rec('a1 v1 is unsigned and inactive', 'false/null',
    (select is_active::text || '/' || coalesce(approved_by::text, 'null') from public.bp_target_config where version = 1));
  perform pg_temp.rec('a2 unsigned: a monthly home average is judged against the 140/90 default', '140/90/default', pg_temp.target(v_pat));
  perform pg_temp.rec('a3 unsigned: the hub reader reports 140/90 as the current default', '140/90',
    pg_temp.as_user(v_cmo, $q$select (public.bp_target_config_for_signoff() #>> '{current_default,systolic}') || '/' || (public.bp_target_config_for_signoff() #>> '{current_default,diastolic}')$q$));

  -- b. not the CMO
  perform pg_temp.rec('b1 a senior doctor cannot sign', '42501', pg_temp.as_user(v_smo, 'select public.sign_bp_target_config(1)::text'));
  perform pg_temp.rec('b2 an admin cannot sign', '42501', pg_temp.as_user(v_admin, 'select public.sign_bp_target_config(1)::text'));
  perform pg_temp.rec('b3 a patient cannot sign', '42501', pg_temp.as_user(v_pat, 'select public.sign_bp_target_config(1)::text'));
  perform pg_temp.rec('b4 anon cannot execute the sign function', 'false', has_function_privilege('anon', 'public.sign_bp_target_config(integer)', 'EXECUTE')::text);
  perform pg_temp.rec('b5 anon cannot execute the hub reader', 'false', has_function_privilege('anon', 'public.bp_target_config_for_signoff()', 'EXECUTE')::text);
  perform pg_temp.rec('b6 nothing is active after the refusals', '0', (select count(*)::text from public.bp_target_config where is_active));

  -- c. the hub reader
  perform pg_temp.rec('c1 the CMO sees v1 pending', '1', pg_temp.as_user(v_cmo, $q$select public.bp_target_config_for_signoff() #>> '{pending,version}'$q$));
  perform pg_temp.rec('c2 an admin sees v1 pending', '1', pg_temp.as_user(v_admin, $q$select public.bp_target_config_for_signoff() #>> '{pending,version}'$q$));
  perform pg_temp.rec('c3 a senior doctor is refused', '42501', pg_temp.as_user(v_smo, 'select public.bp_target_config_for_signoff()::text'));
  perform pg_temp.rec('c4 a patient is refused', '42501', pg_temp.as_user(v_pat, 'select public.bp_target_config_for_signoff()::text'));

  -- d. a broken draft is refused (inserted as v98 and v99, unsigned)
  insert into public.bp_target_config (version, is_active, config, notes)
    select 98, false, jsonb_set(config, '{targets,home,systolic}', '400'), 'proof: out of range' from public.bp_target_config where version = 1;
  insert into public.bp_target_config (version, is_active, config, notes)
    select 99, false, jsonb_set(config, '{contextToTarget,diary}', '"ward"'), 'proof: unknown target' from public.bp_target_config where version = 1;
  perform pg_temp.rec('d1 an out-of-range target is refused', '22023', pg_temp.as_user(v_cmo, 'select public.sign_bp_target_config(98)::text'));
  perform pg_temp.rec('d2 a context mapped to an unknown target is refused', '22023', pg_temp.as_user(v_cmo, 'select public.sign_bp_target_config(99)::text'));
  delete from public.bp_target_config where version in (98, 99);

  -- e. the CMO signs v1
  select id into v_staff from public.clinical_staff where profile_id = v_cmo;
  select count(*) into v_n from public.audit_log where action = 'bp_target_config.signed';
  perform pg_temp.rec('e1 the CMO signs v1', 'ok', pg_temp.as_user(v_cmo, 'select public.sign_bp_target_config(1)::text'));
  perform pg_temp.rec('e2 v1 is active and signed by the CMO''s clinical_staff row', 'true/true',
    (select is_active::text || '/' || (approved_by = v_staff)::text from public.bp_target_config where version = 1));
  perform pg_temp.rec('e3 one audit row is written', (v_n + 1)::text, (select count(*)::text from public.audit_log where action = 'bp_target_config.signed'));
  perform pg_temp.rec('e4 a second signing is refused', '23514', pg_temp.as_user(v_cmo, 'select public.sign_bp_target_config(1)::text'));
  perform pg_temp.rec('e5 the hub reader shows v1 live and nothing pending', '1/null',
    pg_temp.as_user(v_cmo, $q$select (public.bp_target_config_for_signoff() #>> '{live,version}') || '/' || coalesce(public.bp_target_config_for_signoff() #>> '{pending,version}', 'null')$q$));

  -- f. after signing
  perform pg_temp.rec('f1 signed: a monthly home average is judged against the signed home target', '135/85/default', pg_temp.target(v_pat));
  perform pg_temp.rec('f3 signed: risk scoring and the Membership offer keep their baseline', '140/90/default', pg_temp.baseline(v_pat));
  perform pg_temp.rec('f4 the hub reader reports the signed home target as the current default', '135/85',
    pg_temp.as_user(v_cmo, $q$select (public.bp_target_config_for_signoff() #>> '{current_default,systolic}') || '/' || (public.bp_target_config_for_signoff() #>> '{current_default,diastolic}')$q$));
  insert into public.patient_bp_targets (organisation_id, patient_id, home_systolic, home_diastolic, office_systolic, office_diastolic)
    values (v_org, v_pat2, 130, 80, 135, 85);
  perform pg_temp.rec('f2 a personal target still wins', '130/80/patient', pg_temp.target(v_pat2));
end $$;

-- g. SABOTAGE: the CMO check removed; a senior doctor signing a fresh draft must now succeed
do $$
declare v_smo uuid; v_r text;
begin
  select profile_id into v_smo from public.clinical_staff where full_name = 'BPTarget smo' and is_test;
  insert into public.bp_target_config (version, is_active, config, notes)
    select 97, false, config, 'proof: sabotage' from public.bp_target_config where version = 1;
  create or replace function private.credential_is_cmo() returns boolean language sql stable security definer set search_path = '' as $s$ select true $s$;
  v_r := pg_temp.as_user(v_smo, 'select public.sign_bp_target_config(97)::text');
  insert into results values ('sabotaged', 'a senior doctor cannot sign', '42501', v_r);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'BP target signing proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage step did not change the refusal check'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;   -- the sabotage row differs on purpose; the runner treats any printed FAIL as a failure

rollback;
