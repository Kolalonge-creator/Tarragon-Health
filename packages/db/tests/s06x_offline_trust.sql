-- S06x proof: offline_sync_rejections and offline_device_leases (migration *_s06x_offline_trust.sql).
-- One rolled-back transaction. Proves: a patient inserts and reads only their own rejection row, cannot insert for someone else or for another
-- organisation, cannot update or delete; a second insert of the same entry is refused (one row per entry); anon sees nothing; an admin reads
-- through the audited function (audit_log row written) and a patient or clinician is refused it; the table holds no health value column.
-- Devices: check-in registers a lease, extends it, another account cannot take the device; a lost-phone report by the owner or an
-- admin of the same organisation sets the flag, another patient and another organisation's admin are refused; the next check-in reports
-- revoked and does NOT extend the lease; the wipe confirmation stores a count only; anon cannot call any of it.
-- SABOTAGE: the rejection insert policy loosened to any account (a patient can then write as someone else), and the check-in function
-- made to extend a revoked lease.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's06x-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S06x ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  if p_role = 'clinician' then
    insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
    values (p_org, v, 'S06x ' || p_label, true, now(), 'senior_medical_officer');
  end if;
  return v;
end $f$;

create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.as_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;

do $$
declare v_org uuid; v_org2 uuid; v_p1 uuid; v_p2 uuid; v_ad uuid; v_ad2 uuid; v_cl uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_org2 from public.organisations where id <> v_org order by created_at limit 1;
  if v_org2 is null then insert into public.organisations (name, type) values ('S06x second org', 'clinic') returning id into v_org2; end if;
  v_p1 := pg_temp.mkuser(v_org, 'patient one', 'patient'); v_p2 := pg_temp.mkuser(v_org, 'patient two', 'patient');
  v_ad := pg_temp.mkuser(v_org, 'admin', 'admin'); v_ad2 := pg_temp.mkuser(v_org2, 'other admin', 'admin');
  v_cl := pg_temp.mkuser(v_org, 'clinician', 'clinician');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('org2', v_org2); perform pg_temp.setf('p1', v_p1); perform pg_temp.setf('p2', v_p2);
  perform pg_temp.setf('ad', v_ad); perform pg_temp.setf('ad2', v_ad2); perform pg_temp.setf('cl', v_cl);
  perform pg_temp.setf('dev1', gen_random_uuid()); perform pg_temp.setf('c1', gen_random_uuid()); perform pg_temp.setf('c2', gen_random_uuid());
end $$;

-- A. rejections ---------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'A1 a patient inserts their own rejection', 'ok',
  pg_temp.as_user(pg_temp.f('p1'), format($q$ with i as (insert into public.offline_sync_rejections (organisation_id, account_id, kind, reason_code, http_status, support_code, client_id) values (%L, %L, 'vital', 'refused_constraint', 400, 'ABCD1234', %L) returning 1) select 'ok' from i $q$, pg_temp.f('org'), pg_temp.f('p1'), pg_temp.f('c1'))));
select pg_temp.ck('real', 'A2 the same entry cannot be written twice (one row per entry)', 'ERR 23505',
  pg_temp.as_user(pg_temp.f('p1'), format($q$ with i as (insert into public.offline_sync_rejections (organisation_id, account_id, kind, reason_code, support_code, client_id) values (%L, %L, 'vital', 'refused_other', 'ABCD1234', %L) returning 1) select 'ok' from i $q$, pg_temp.f('org'), pg_temp.f('p1'), pg_temp.f('c1'))));
select pg_temp.ck('real', 'A3 a patient cannot write a rejection as another account', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('p1'), format($q$ with i as (insert into public.offline_sync_rejections (organisation_id, account_id, kind, reason_code, support_code, client_id) values (%L, %L, 'dose', 'refused_other', 'ABCD1235', %L) returning 1) select 'ok' from i $q$, pg_temp.f('org'), pg_temp.f('p2'), pg_temp.f('c2'))));
select pg_temp.ck('real', 'A4 nor into another organisation', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('p1'), format($q$ with i as (insert into public.offline_sync_rejections (organisation_id, account_id, kind, reason_code, support_code, client_id) values (%L, %L, 'dose', 'refused_other', 'ABCD1236', %L) returning 1) select 'ok' from i $q$, pg_temp.f('org2'), pg_temp.f('p1'), gen_random_uuid())));
select pg_temp.ck('real', 'A5 a malformed support code is refused', 'ERR 23514',
  pg_temp.as_user(pg_temp.f('p1'), format($q$ with i as (insert into public.offline_sync_rejections (organisation_id, account_id, kind, reason_code, support_code, client_id) values (%L, %L, 'dose', 'refused_other', 'not-a-code', %L) returning 1) select 'ok' from i $q$, pg_temp.f('org'), pg_temp.f('p1'), gen_random_uuid())));
select pg_temp.ck('real', 'A6 the owner reads their row, another patient reads none', '1/0',
  pg_temp.as_user(pg_temp.f('p1'), 'select count(*)::text from public.offline_sync_rejections') || '/' || pg_temp.as_user(pg_temp.f('p2'), 'select count(*)::text from public.offline_sync_rejections'));
select pg_temp.ck('real', 'A7 a patient cannot update their row (no grant)', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('p1'), $q$ with u as (update public.offline_sync_rejections set reason_code = 'refused_other' returning 1) select count(*)::text from u $q$));
select pg_temp.ck('real', 'A8 ...or delete it (no grant)', 'ERR 42501', pg_temp.as_user(pg_temp.f('p1'), 'delete from public.offline_sync_rejections'));
select pg_temp.ck('real', 'A9 anon sees nothing', 'ERR 42501', pg_temp.as_anon('select count(*)::text from public.offline_sync_rejections'));
select pg_temp.ck('real', 'A10 the table has no free-text or payload column', '0',
  (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'offline_sync_rejections' and data_type in ('jsonb', 'json')));
select pg_temp.ck('real', 'A11 an admin of the same organisation reads it through the function', '1',
  pg_temp.as_user(pg_temp.f('ad'), 'select count(*)::text from public.read_offline_sync_rejections()'));
select pg_temp.ck('real', 'A12 ...and that read is audited', '1',
  (select count(*)::text from public.audit_log where actor_id = pg_temp.f('ad') and action = 'offline_rejections_read'));
select pg_temp.ck('real', 'A13 another organisation''s admin reads none', '0',
  pg_temp.as_user(pg_temp.f('ad2'), 'select count(*)::text from public.read_offline_sync_rejections()'));
select pg_temp.ck('real', 'A14 a clinician and a patient are refused the function', 'ERR 42501/ERR 42501',
  pg_temp.as_user(pg_temp.f('cl'), 'select count(*)::text from public.read_offline_sync_rejections()') || '/' || pg_temp.as_user(pg_temp.f('p1'), 'select count(*)::text from public.read_offline_sync_rejections()'));
select pg_temp.ck('real', 'A15 anon cannot execute the function', 'ERR 42501', pg_temp.as_anon('select count(*)::text from public.read_offline_sync_rejections()'));

-- B. devices ---------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'B1 first check-in registers the phone, not revoked', 'false',
  pg_temp.as_user(pg_temp.f('p1'), format($q$ select (public.offline_device_checkin(%L, 'android')) ->> 'revoked' $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real', 'B2 the lease is 30 days from the config', 'true',
  (select (lease_expires_at > now() + interval '29 days' and lease_expires_at < now() + interval '31 days')::text from public.offline_device_leases where device_id = pg_temp.f('dev1')));
select pg_temp.ck('real', 'B3 another account cannot take over the device id', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('p2'), format($q$ select (public.offline_device_checkin(%L, 'android')) ->> 'revoked' $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real', 'B4 another patient cannot report it lost', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('p2'), format($q$ select public.request_offline_device_wipe(%L, 'lost_phone')::text $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real', 'B5 another organisation''s admin cannot revoke it', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('ad2'), format($q$ select public.request_offline_device_wipe(%L, 'admin')::text $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real', 'B6 a patient cannot use the admin reason', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.request_offline_device_wipe(%L, 'admin')::text $q$, pg_temp.f('dev1'))));
update public.offline_device_leases set lease_expires_at = now() + interval '1 day' where device_id = pg_temp.f('dev1');
select pg_temp.ck('real', 'B7 the owner reports it lost', 'true',
  pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.request_offline_device_wipe(%L, 'lost_phone')::text $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real', 'B8 the next check-in says revoked...', 'true',
  pg_temp.as_user(pg_temp.f('p1'), format($q$ select (public.offline_device_checkin(%L, 'android')) ->> 'revoked' $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real', 'B9 ...and does not extend the lease', 'true',
  (select (lease_expires_at < now() + interval '2 days')::text from public.offline_device_leases where device_id = pg_temp.f('dev1')));
select pg_temp.ck('real', 'B10 the wipe confirmation call succeeds', 'true',
  pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.confirm_offline_device_wipe(%L, 3)::text $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real', 'B10b ...and stores a count only', '3',
  (select unsent_at_wipe::text from public.offline_device_leases where device_id = pg_temp.f('dev1')));
select pg_temp.ck('real', 'B11 a request, a confirmation and no stray rows are audited', '2',
  (select count(*)::text from public.audit_log where entity_type = 'offline_device_leases' and entity_id = pg_temp.f('p1') and action in ('offline_device_wipe_requested', 'offline_device_wiped')));
do $$
begin
  perform pg_temp.ck('real', 'B12a a second patient registers a phone', 'false',
    pg_temp.as_user(pg_temp.f('p2'), format($q$ select (public.offline_device_checkin(%L, 'ios')) ->> 'revoked' $q$, pg_temp.f('c2'))));
  perform pg_temp.ck('real', 'B12b an admin of the same organisation revokes it', 'true',
    pg_temp.as_user(pg_temp.f('ad'), format($q$ select public.request_offline_device_wipe(%L, 'admin')::text $q$, pg_temp.f('c2'))));
  perform pg_temp.ck('real', 'B12c ...with the admin reason recorded', 'admin',
    (select revoke_reason from public.offline_device_leases where device_id = pg_temp.f('c2')));
end $$;
select pg_temp.ck('real', 'B13 anon cannot call check-in', 'ERR 42501', pg_temp.as_anon(format($q$ select public.offline_device_checkin(%L, 'ios')::text $q$, gen_random_uuid())));
select pg_temp.ck('real', 'B14 a patient cannot write the lease table directly', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('p1'), format($q$ update public.offline_device_leases set revoked_at = null where device_id = %L $q$, pg_temp.f('dev1'))));

-- SABOTAGE ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_def text; v_other text;
begin
  -- 1. the insert policy loosened: a patient can write as another account
  drop policy offline_sync_rejections_insert_own on public.offline_sync_rejections;
  create policy offline_sync_rejections_insert_own on public.offline_sync_rejections for insert to authenticated with check (true);
  v_other := pg_temp.as_user(pg_temp.f('p1'), format($q$ with i as (insert into public.offline_sync_rejections (organisation_id, account_id, kind, reason_code, support_code, client_id) values (%L, %L, 'dose', 'refused_other', 'ABCD1239', %L) returning 1) select 'ok' from i $q$, pg_temp.f('org'), pg_temp.f('p2'), gen_random_uuid()));
  insert into results values ('sabotaged', 'SABOTAGE 1: a loosened insert policy lets a patient write as another account', 'ERR 42501', v_other);
  -- 2. check-in extends a revoked lease
  select pg_get_functiondef('public.offline_device_checkin(uuid, text)'::regprocedure) into v_def;
  v_def := replace(v_def, 'elsif v_row.revoked_at is null then', 'elsif true then');
  execute v_def;
  perform pg_temp.as_user(pg_temp.f('p1'), format($q$ select (public.offline_device_checkin(%L, 'android')) ->> 'revoked' $q$, pg_temp.f('dev1')));
  insert into results values ('sabotaged', 'SABOTAGE 2: a check-in that extends a revoked lease', 'true',
    (select (lease_expires_at < now() + interval '2 days')::text from public.offline_device_leases where device_id = pg_temp.f('dev1')));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S06x proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
