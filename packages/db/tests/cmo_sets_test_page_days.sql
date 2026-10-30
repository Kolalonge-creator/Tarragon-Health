-- Proof: the CMO chooses the test page window (migration *_cmo_sets_test_page_days.sql, public.set_paging_test_page_days).
--
-- Proves in one rolled-back transaction:
--   1. Only the Chief Medical Officer may call it (a clinician and an admin are refused with 42501).
--   2. Bad input is refused: days outside 1..365, a reason under 10 characters, the number already in force, an unsigned newer draft waiting.
--   3. The CMO's change writes ONE new signed active version whose rules differ from the old only in readiness_test_page_days, the old version
--      stays on record inactive, and the change is audited with the reason.
--   4. A window that leaves a non-test on-call clinician without a push subscription is refused with the reasons and writes no version.
--   5. SABOTAGE: with the CMO made inactive the same call is refused, so check 3a must flip.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  -- a leftover sub makes auth.uid() non-null and the is_test guard then treats the owner as a person
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'cg-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'CG ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid language plpgsql as
$f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'CG ' || p_label, 'MDCN', 'CG-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_smo uuid; v_txt text; v_live integer; v_new integer; v_before integer; v_caught integer; v_gap uuid; v_old jsonb;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_smo := pg_temp.mkdoc(v_org, v_admin, 'smo', 'senior_medical_officer');
  -- deterministic: one active version, no waiting draft
  delete from public.paging_delivery_config where not is_active and approved_at is null;
  select version, rules into v_live, v_old from public.paging_delivery_config where is_active;

  -- 1. who -------------------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_smo);
  perform pg_temp.rec('real', '1a a clinician who is not the CMO is refused', '42501', left(pg_temp.msg('select public.set_paging_test_page_days(30, ''three months is enough'')'), 5));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('real', '1b an admin is refused', '42501', left(pg_temp.msg('select public.set_paging_test_page_days(30, ''three months is enough'')'), 5));
  perform pg_temp.back();

  -- 2. bad input -------------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('real', '2a zero days is refused', '22023', left(pg_temp.msg('select public.set_paging_test_page_days(0, ''three months is enough'')'), 5));
  perform pg_temp.rec('real', '2b 366 days is refused', '22023', left(pg_temp.msg('select public.set_paging_test_page_days(366, ''three months is enough'')'), 5));
  perform pg_temp.rec('real', '2c a short reason is refused', '22023', left(pg_temp.msg('select public.set_paging_test_page_days(30, ''short'')'), 5));
  perform pg_temp.rec('real', '2d the number already in force is refused', '23514',
    left(pg_temp.msg(format('select public.set_paging_test_page_days(%s, ''no change needed here'')', (v_old ->> 'readiness_test_page_days')::integer)), 5));
  perform pg_temp.back();
  insert into public.paging_delivery_config (version, is_active, effective_from, rules) values (v_live + 50, false, current_date, v_old);
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('real', '2e an unsigned newer draft waiting blocks it', '23514', left(pg_temp.msg('select public.set_paging_test_page_days(33, ''three months is enough'')'), 5));
  perform pg_temp.back();
  delete from public.paging_delivery_config where version = v_live + 50;

  -- 3. the change ------------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_cmo);
  v_txt := (public.set_paging_test_page_days(30, 'three months is enough')) ->> 'changed';
  perform pg_temp.back();
  perform pg_temp.rec('real', '3a the CMO changes it', 'true', v_txt);
  select version into v_new from public.paging_delivery_config where is_active;
  perform pg_temp.rec('real', '3b the new version is the next number', (v_live + 1)::text, v_new::text);
  perform pg_temp.rec('real', '3c it is signed by the CMO', v_cmo::text, (select approved_by::text from public.paging_delivery_config where version = v_new));
  perform pg_temp.rec('real', '3d it has the new number of days', '30', (select rules ->> 'readiness_test_page_days' from public.paging_delivery_config where version = v_new));
  perform pg_temp.rec('real', '3e nothing else in the rules changed', 'true',
    ((select rules - 'readiness_test_page_days' from public.paging_delivery_config where version = v_new) = (v_old - 'readiness_test_page_days'))::text);
  perform pg_temp.rec('real', '3f exactly one version is in force', '1', (select count(*)::text from public.paging_delivery_config where is_active));
  perform pg_temp.rec('real', '3g the old version stays on record', 'true', (select (count(*) = 1 and bool_and(not is_active))::text from public.paging_delivery_config where version = v_live));
  perform pg_temp.rec('real', '3h the change is audited with the reason', '1',
    (select count(*)::text from public.audit_log where action = 'paging_delivery_config.test_page_days_set' and event ->> 'reason' = 'three months is enough' and (event ->> 'to_days')::integer = 30));

  -- 4. a window the on-call team is not ready for -------------------------------------------------------------------------
  v_gap := pg_temp.mkdoc(v_org, v_admin, 'gap', 'senior_medical_officer');
  update public.profiles set is_test = false where id = v_gap;
  update public.clinical_staff set is_test = false where profile_id = v_gap;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by)
    select v_org, id, 'on_call', v_admin from public.clinical_staff where profile_id = v_gap;
  select count(*) into v_before from public.paging_delivery_config;
  perform pg_temp.act(v_cmo);
  v_txt := (public.set_paging_test_page_days(45, 'a longer window for now'))::text;
  perform pg_temp.back();
  perform pg_temp.rec('real', '4a not changed while someone on call is missing a push subscription', 'false', (v_txt::jsonb ->> 'changed'));
  perform pg_temp.rec('real', '4b the reasons name them', 'true', ((v_txt::jsonb -> 'reasons') @> jsonb_build_array(jsonb_build_object('clinician_id', v_gap)))::text);
  perform pg_temp.rec('real', '4c no version was written', v_before::text, (select count(*)::text from public.paging_delivery_config));

  -- 5. SABOTAGE: with the CMO inactive the same change must be refused, so check 3a must flip ---------------------------------
  update public.clinical_staff set active = false where profile_id = v_gap;
  update public.clinical_staff set active = false where profile_id = v_cmo;
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg('select (public.set_paging_test_page_days(40, ''three months is enough'')) ->> ''changed''');
  perform pg_temp.back();
  perform pg_temp.rec('sabotaged', '3a the CMO changes it', 'true', v_txt);

  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage step did not change the matching check'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed.

rollback;
