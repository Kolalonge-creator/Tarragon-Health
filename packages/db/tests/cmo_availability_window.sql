-- Proof: a Chief Medical Officer can declare their own availability up to 120 days ahead; everyone else stays at 31 (migration *_cmo_declares_own_availability_up_to_120_days_ahead.sql).
--
-- Proves in one rolled-back transaction:
--   1. A senior medical officer can declare a block 30 days ahead but not 100 days ahead (queue_bad_window), as before.
--   2. The Chief Medical Officer can declare 100 days ahead and 119 days ahead, but not 121 days ahead.
--   3. A start more than 5 minutes in the past is still refused for the CMO.
--   4. SABOTAGE: with the old 31 day function put back, the CMO's 100 day block is refused. The matching check must flip.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || coalesce(nullif(substring(sqlerrm from 1 for 40), ''), ''); end $f$;
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
  values (v, 'cw-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'CW ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid language plpgsql as
$f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'CW ' || p_label, 'MDCN', 'CW-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;
create function pg_temp.declare_at(p_days integer) returns text language sql as
$$ select pg_temp.try(format('select public.declare_availability(''queue'', now() + interval ''%s days'', now() + interval ''%s days'' + interval ''4 hours'')', p_days, p_days)) $$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_smo uuid; v_caught integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_smo := pg_temp.mkdoc(v_org, v_admin, 'smo', 'senior_medical_officer');
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');

  perform pg_temp.act(v_smo);
  perform pg_temp.rec('real', '1a a senior medical officer can declare a block 30 days ahead', 'ok', pg_temp.declare_at(30));
  perform pg_temp.rec('real', '1b ... but not 100 days ahead', '22023:queue_bad_window', pg_temp.declare_at(100));
  perform pg_temp.back();

  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('real', '2a the CMO can declare a block 100 days ahead', 'ok', pg_temp.declare_at(100));
  perform pg_temp.rec('real', '2b ... and 119 days ahead', 'ok', pg_temp.declare_at(119));
  perform pg_temp.rec('real', '2c ... but not 121 days ahead', '22023:queue_bad_window', pg_temp.declare_at(121));
  perform pg_temp.rec('real', '3 a start more than 5 minutes in the past is still refused for the CMO', '22023:queue_bad_window',
    pg_temp.try('select public.declare_availability(''queue'', now() - interval ''1 hour'', now() + interval ''3 hours'')'));
  perform pg_temp.back();

  -- 4. SABOTAGE: put the old 31 day function back; the CMO's 100 day block must now be refused
  create or replace function public.declare_availability(p_kind text, p_starts timestamptz, p_ends timestamptz) returns uuid language plpgsql security definer set search_path to '' as
  $f$ declare v_uid uuid := (select auth.uid()); cs public.clinical_staff%rowtype; v_id uuid;
  begin
    select * into cs from public.clinical_staff where profile_id = v_uid;
    if not found or not private.clinician_is_eligible(v_uid) then raise exception 'queue_not_eligible' using errcode = '42501'; end if;
    if p_starts < now() - interval '5 minutes' or p_starts > now() + interval '31 days' then raise exception 'queue_bad_window' using errcode = '22023'; end if;
    insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test) values (cs.organisation_id, v_uid, p_starts, p_ends, p_kind, cs.is_test) returning id into v_id;
    return v_id;
  end $f$;
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('sabotaged', '2a the CMO can declare a block 100 days ahead', 'ok', pg_temp.declare_at(100));
  perform pg_temp.back();

  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 1 then
    raise exception 'VACUOUS TEST: the sabotage step did not change the matching check';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed.

rollback;
