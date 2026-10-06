-- S19b proof: on-call readiness (migration *_s19b_on_call_readiness.sql).
--
-- Proves in one rolled-back transaction:
--   1. Shape: RLS on, anon cannot read, authenticated cannot write directly.
--   2. A clinician who has not confirmed the phone checklist cannot be put on the rota, as primary or as backup.
--   3. Confirming needs every item, a clinician account, and never works for anon or a patient.
--   4. After confirming, the shift can be built; confirming again keeps one row; the confirmation is audited.
--   5. Reviewers see who has and has not confirmed; a clinician cannot read that list.
--   6. A swap cannot hand a shift to a colleague who has not confirmed.
--   7. A new checklist version makes everyone unconfirmed again.
--   8. SABOTAGE: the rota check removed; the matching check must flip.
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
  values (v, 's19b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S19b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S19b ' || p_label, 'MDCN', 'S19b-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_staff, 'on_call', p_admin, true);
  return v;
end $f$;

create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_p uuid; v_b uuid; v_c uuid; v_pat uuid; v_all text[] := array['notifications_on','battery_saving_off','data_and_power','email_opens','cover_plan'];
  t1 timestamptz := date_trunc('hour', now()) + interval '2 days'; v_r uuid; v_swap uuid; v_txt text; v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_p := pg_temp.mkdoc(v_org, v_admin, 'primary', 'senior_medical_officer');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'backup', 'senior_medical_officer');
  v_c := pg_temp.mkdoc(v_org, v_admin, 'colleague', 'senior_medical_officer');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');

  -- 1. Shape
  perform pg_temp.rec('readiness has RLS on', 'true', (select relrowsecurity::text from pg_class where oid = 'public.on_call_readiness'::regclass));
  perform pg_temp.rec('anon cannot read readiness', 'false', has_table_privilege('anon', 'public.on_call_readiness', 'SELECT')::text);
  perform pg_temp.rec('authenticated cannot write readiness directly', 'false', (has_table_privilege('authenticated', 'public.on_call_readiness', 'INSERT') or has_table_privilege('authenticated', 'public.on_call_readiness', 'UPDATE'))::text);

  -- 2. Unconfirmed clinicians are refused
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.set_on_call_rota(%L, %L, %L, %L)', t1, t1 + interval '12 hours', v_p, v_b));
  perform pg_temp.rec('an unconfirmed primary cannot be put on call', 'true', (v_txt like '22023:%phone checklist%')::text);
  perform pg_temp.back();
  perform pg_temp.act(v_p); perform public.confirm_on_call_readiness(v_all); perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.set_on_call_rota(%L, %L, %L, %L)', t1, t1 + interval '12 hours', v_p, v_b));
  perform pg_temp.rec('an unconfirmed backup cannot be put on call either', 'true', (v_txt like '22023:%phone checklist%')::text);
  perform pg_temp.back();

  -- 3. Confirming
  perform pg_temp.act(v_b);
  perform pg_temp.rec('confirming with an item missing is refused', '22023', pg_temp.try(format('select public.confirm_on_call_readiness(%L)', array['notifications_on','email_opens'])));
  perform pg_temp.rec('confirming with an unknown extra item is refused', '22023', pg_temp.try(format('select public.confirm_on_call_readiness(%L)', v_all || array['other'])));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a patient cannot confirm', '42501', pg_temp.try(format('select public.confirm_on_call_readiness(%L)', v_all)));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot confirm', '42501', pg_temp.try(format('select public.confirm_on_call_readiness(%L)', v_all)));
  perform pg_temp.back();

  -- 4. Confirmed clinicians can be rostered
  perform pg_temp.act(v_b); perform public.confirm_on_call_readiness(v_all); perform public.confirm_on_call_readiness(v_all); perform pg_temp.back();
  perform pg_temp.rec('confirming twice keeps one row', '1', (select count(*)::text from public.on_call_readiness where clinician_id = v_b));
  perform pg_temp.rec('the confirmation is audited', '2', (select count(*)::text from public.audit_log where action = 'rota.readiness_confirmed' and actor_id = v_b));
  perform pg_temp.act(v_cmo);
  v_r := (public.set_on_call_rota(t1, t1 + interval '12 hours', v_p, v_b) ->> 'id')::uuid;
  perform pg_temp.back();
  perform pg_temp.rec('two confirmed clinicians can be rostered', '1', (select count(*)::text from public.on_call_rota where id = v_r and cancelled_at is null));
  perform pg_temp.act(v_p);
  perform pg_temp.rec('my readiness says confirmed', 'true', (public.my_on_call_readiness() ->> 'confirmed_at' is not null)::text);
  perform pg_temp.rec('...and that I am an on-call clinician', 'true', (public.my_on_call_readiness() ->> 'on_call_clinician')::text);
  perform pg_temp.back();

  -- 5. Reviewer overview
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the reviewer sees the confirmed and the unconfirmed', 'true,true',
    (select (bool_or((e ->> 'ready')::boolean and e ->> 'name' = 'S19b primary')::text) || ',' || (bool_or(not (e ->> 'ready')::boolean and e ->> 'name' = 'S19b colleague'))::text
       from jsonb_array_elements(public.on_call_readiness_overview()) e));
  perform pg_temp.back();
  perform pg_temp.act(v_p);
  perform pg_temp.rec('a clinician cannot read the overview', '42501', pg_temp.try('select public.on_call_readiness_overview()'));
  perform pg_temp.back();

  -- 6. A swap cannot go to an unconfirmed colleague
  perform pg_temp.act(v_p);
  v_txt := pg_temp.msg(format('select public.request_rota_swap(%L, ''primary'', %L, ''family event'')', v_r, v_c));
  perform pg_temp.rec('a swap to an unconfirmed colleague is refused', 'true', (v_txt like '22023:%phone checklist%')::text);
  perform pg_temp.back();

  -- 7. A new checklist version makes everyone unconfirmed again
  create or replace function private.readiness_version() returns integer language sql immutable set search_path = '' as $f$ select 2 $f$;
  perform pg_temp.rec('a new checklist version clears the confirmations', 'false', private.on_call_ready(v_p)::text);
  create or replace function private.readiness_version() returns integer language sql immutable set search_path = '' as $f$ select 1 $f$;
  perform pg_temp.rec('...and the old confirmation counts again under version 1', 'true', private.on_call_ready(v_p)::text);

  -- 8. SABOTAGE: the rota check removed; an unconfirmed clinician must now be accepted (so check 2 would fail)
  create or replace function private.on_call_ready(p_profile uuid) returns boolean language sql as $f$ select true $f$;
  perform pg_temp.act(v_cmo);
  insert into results values ('sabotaged', 'an unconfirmed clinician cannot be put on call', 'true',
    (pg_temp.msg(format('select public.set_on_call_rota(%L, %L, %L, %L)', t1 + interval '3 days', t1 + interval '3 days 12 hours', v_c, v_p)) like '22023:%phone checklist%')::text);
  perform pg_temp.back();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S19b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then
    raise exception 'VACUOUS TEST: the sabotage step did not change the matching check';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed.

rollback;
