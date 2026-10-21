-- LSI-1 proof: the emergency card lock-screen picture audit door (migration 20261021000142_emergency_card_image_audit.sql). One rolled-back transaction. Proves:
--   1. the option is off by default and the door refuses (and writes nothing) while it is off, including for a person with no card row
--   2. opted in, one audit row holding only include_qr and minimum (no field names, no values, no name); switching off closes the door again
--   3. only the caller's own switch counts; the function has no patient argument
--   4. refused roles: clinician (even with the switch on in their own row), admin, signed-out, anon; none writes an audit row
--   5. SABOTAGE: the opt-in check, the audit call and the role gate each removed; each must flip its check.
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
-- run a statement as a signed-in user; returns 'ok' or the error message
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.try_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; r := coalesce(r, 'ok'); exception when others then r := sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_sql_owner(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'lsi-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'LSI ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_a uuid; v_b uuid; v_clin uuid; v_n integer; v_j jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_a := pg_temp.mkuser(v_org, 'a', 'patient');
  v_b := pg_temp.mkuser(v_org, 'b', 'patient');
  v_clin := pg_temp.mkuser(v_org, 'clin', 'clinician');

  -- ===== 1. off by default ============================================================================================================
  insert into public.emergency_card_fields (patient_id, organisation_id) values (v_a, v_org), (v_b, v_org);
  perform pg_temp.ck('1a the lock-screen option is off by default', 'false',
    (select lock_screen_opt_in::text from public.emergency_card_fields where patient_id = v_a));
  perform pg_temp.ck('1b with it off the audit door refuses, and writes nothing', 'true:0',
    (pg_temp.try_as(v_a, $q$select public.record_emergency_card_image(true, true)$q$) like '%card_image_not_opted_in%')::text || ':' ||
    (select count(*)::text from public.audit_log where actor_id = v_a and action = 'emergency_card.image_generated'));
  perform pg_temp.ck('1c a person with no card row at all is refused too', 'true',
    (pg_temp.try_as(pg_temp.mkuser(v_org, 'norow', 'patient'), $q$select public.record_emergency_card_image()$q$) like '%card_image_not_opted_in%')::text);

  -- ===== 2. opted in ===================================================================================================================
  update public.emergency_card_fields set lock_screen_opt_in = true where patient_id = v_a;
  perform pg_temp.ck('2a opted in, the door answers ok', 'true',
    pg_temp.q_as(v_a, $q$select (public.record_emergency_card_image(true, false) ->> 'ok')$q$));
  perform pg_temp.ck('2b exactly one audit row', '1',
    (select count(*)::text from public.audit_log where actor_id = v_a and action = 'emergency_card.image_generated'));
  perform pg_temp.ck('2c the audit event holds only the two choices, no field names, no value, no name', 'include_qr,minimum',
    (select string_agg(k, ',' order by k) from public.audit_log l, jsonb_object_keys(l.event) k where l.actor_id = v_a and l.action = 'emergency_card.image_generated'));
  perform pg_temp.ck('2d the audit row carries the choices as given', 'true:false',
    (select (event ->> 'include_qr') || ':' || (event ->> 'minimum') from public.audit_log where actor_id = v_a and action = 'emergency_card.image_generated'));
  update public.emergency_card_fields set lock_screen_opt_in = false where patient_id = v_a;
  perform pg_temp.ck('2e switching the option back off closes the door again', 'true',
    (pg_temp.try_as(v_a, $q$select public.record_emergency_card_image()$q$) like '%card_image_not_opted_in%')::text);
  update public.emergency_card_fields set lock_screen_opt_in = true where patient_id = v_a;

  -- ===== 3. only the caller's own switch counts ======================================================================================
  perform pg_temp.ck('3a B has not opted in, so A''s switch does not open B''s door', 'true',
    (pg_temp.try_as(v_b, $q$select public.record_emergency_card_image()$q$) like '%card_image_not_opted_in%')::text);
  perform pg_temp.ck('3b the function takes no patient argument', '2',
    (select pronargs::text from pg_proc where proname = 'record_emergency_card_image' and pronamespace = 'public'::regnamespace));

  -- ===== 4. refused roles ==============================================================================================================
  update public.emergency_card_fields set lock_screen_opt_in = true where patient_id = v_a;
  perform pg_temp.ck('4a a clinician is refused', 'true',
    (pg_temp.try_as(v_clin, $q$select public.record_emergency_card_image()$q$) like '%card_image_not_authorised%')::text);
  perform pg_temp.ck('4b an admin is refused', 'true',
    (pg_temp.try_as(v_admin, $q$select public.record_emergency_card_image()$q$) like '%card_image_not_authorised%')::text);
  perform pg_temp.ck('4c a signed-out caller is refused', 'true',
    (pg_temp.try_sql_owner($q$select public.record_emergency_card_image()$q$) like '%card_image_not_authorised%')::text);
  perform pg_temp.ck('4d anon cannot call it', 'true',
    (pg_temp.q_anon($q$select public.record_emergency_card_image()$q$) like '%permission denied%')::text);
  perform pg_temp.ck('4e refused roles wrote no audit rows', '0',
    (select count(*)::text from public.audit_log where actor_id in (v_clin, v_admin, v_b) and action = 'emergency_card.image_generated'));
  -- a clinician with the option switched on in a row of their own is still refused (role gate, not just the switch)
  insert into public.emergency_card_fields (patient_id, organisation_id, lock_screen_opt_in) values (v_clin, v_org, true);
  perform pg_temp.ck('4f ...even with the switch on in their own row', 'true',
    (pg_temp.try_as(v_clin, $q$select public.record_emergency_card_image()$q$) like '%card_image_not_authorised%')::text);

  -- ===== 5. sabotage ===================================================================================================================
  -- A. the opt-in check removed: B (not opted in) must then get through (3a flips)
  execute replace(pg_get_functiondef('public.record_emergency_card_image(boolean, boolean)'::regprocedure),
    'if not exists (select 1 from public.emergency_card_fields where patient_id = v_uid and lock_screen_opt_in) then', 'if false then');
  insert into results values ('sabotaged', '3a B has not opted in, so A''s switch does not open B''s door', 'true',
    (pg_temp.try_as(v_b, $q$select public.record_emergency_card_image()$q$) like '%card_image_not_opted_in%')::text);
  -- B. the audit call removed: an image must not exist without a row (2b-style count)
  select count(*) into v_n from public.audit_log where actor_id = v_a and action = 'emergency_card.image_generated';
  execute replace(pg_get_functiondef('public.record_emergency_card_image(boolean, boolean)'::regprocedure), 'perform private.log_audit(', 'perform (select 1); -- ');
  perform pg_temp.q_as(v_a, $q$select public.record_emergency_card_image()$q$);
  insert into results values ('sabotaged', 'a picture writes exactly one audit row', '1',
    ((select count(*) from public.audit_log where actor_id = v_a and action = 'emergency_card.image_generated') - v_n)::text);
  -- C. the role gate removed: a clinician with the switch on must then be let through (4f flips)
  execute replace(pg_get_functiondef('public.record_emergency_card_image(boolean, boolean)'::regprocedure), 'and role = ''patient'' and is_active) then', ') then');
  insert into results values ('sabotaged', '4f ...even with the switch on in their own row', 'true',
    (pg_temp.try_as(v_clin, $q$select public.record_emergency_card_image()$q$) like '%card_image_not_authorised%')::text);
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FLIPPED' end as result
from results where phase = 'sabotaged'
union all
select 'real', count(*)::text || ' checks', 'all pass', 'all pass', 'PASS' from results where phase = 'real';

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'LSI-1 proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), E'\n  ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

rollback;
