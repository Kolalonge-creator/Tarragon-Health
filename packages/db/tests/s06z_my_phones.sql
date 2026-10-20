-- S06z proof: public.update_my_offline_device (migration *_s06z_my_phones_label_and_shared.sql) and the patient's own wipe request.
-- One rolled-back transaction. Proves: a patient names and marks THEIR OWN phone; another patient and an admin of the same organisation cannot;
-- a control-character or over-long name is refused; a removed (revoked) phone cannot be edited; the audit row never carries the name; anon is
-- refused; no direct table write; a patient can ask to remove their own phone but not another patient's; a patient reads only their own phones.
-- SABOTAGE: owner check removed, revoked-phone guard removed, control-character check removed. Each must flip.
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


do $$ begin perform pg_temp.setf('dev1', gen_random_uuid()); perform pg_temp.setf('dev2', gen_random_uuid()); end $$;
select pg_temp.ck('real','C1 owner registers a phone','false',pg_temp.as_user(pg_temp.f('p1'), format($q$ select (public.offline_device_checkin(%L,'android'))->>'revoked' $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real','C2 owner registers a second phone','false',pg_temp.as_user(pg_temp.f('p1'), format($q$ select (public.offline_device_checkin(%L,'ios'))->>'revoked' $q$, pg_temp.f('dev2'))));
select pg_temp.ck('real','C3 owner names and marks a phone shared','true',pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.update_my_offline_device(%L,'  Mum''s Tecno ',true)::text $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real','C4 the name is trimmed, shared is set','Mum''s Tecno/true',
  (select device_label||'/'||shared_phone from public.offline_device_leases where device_id=pg_temp.f('dev1')));
select pg_temp.ck('real','C5 unmarking sharing alone succeeds','true',pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.update_my_offline_device(%L,null,false)::text $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real','C5b ...and keeps the name','Mum''s Tecno/false',(select device_label||'/'||shared_phone from public.offline_device_leases where device_id=pg_temp.f('dev1')));
select pg_temp.ck('real','C6 another patient cannot rename it (control)','ERR P0002',pg_temp.as_user(pg_temp.f('p2'), format($q$ select public.update_my_offline_device(%L,'Mine now',true)::text $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real','C7 nor can an admin of the same organisation','ERR P0002',pg_temp.as_user(pg_temp.f('ad'), format($q$ select public.update_my_offline_device(%L,'Admin',true)::text $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real','C8 the name was not changed by them','Mum''s Tecno',(select device_label from public.offline_device_leases where device_id=pg_temp.f('dev1')));
select pg_temp.ck('real','C9 a name with a control character is refused','ERR 22023',pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.update_my_offline_device(%L,E'bad\nname')::text $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real','C10 a 41 character name is refused','ERR 22023',pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.update_my_offline_device(%L,%L)::text $q$, pg_temp.f('dev1'), repeat('a',41))));
select pg_temp.ck('real','C11 clear_label succeeds','true',pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.update_my_offline_device(%L,null,null,true)::text $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real','C11b ...and removes the name','',coalesce((select device_label from public.offline_device_leases where device_id=pg_temp.f('dev1')),''));
select pg_temp.ck('real','C12 the audit row never carries the name','0',
  (select count(*)::text from public.audit_log where action='offline_device_details_updated' and event::text like '%Tecno%'));
select pg_temp.ck('real','C13 anon cannot call it','ERR 42501',pg_temp.as_anon(format($q$ select public.update_my_offline_device(%L,'x')::text $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real','C14 no direct write to the table','ERR 42501',pg_temp.as_user(pg_temp.f('p1'), format($q$ update public.offline_device_leases set device_label='x' where device_id=%L $q$, pg_temp.f('dev1'))));
select pg_temp.ck('real','C15 another patient cannot ask to remove it (control)','ERR 42501',pg_temp.as_user(pg_temp.f('p2'), format($q$ select public.request_offline_device_wipe(%L,'lost_phone')::text $q$, pg_temp.f('dev2'))));
select pg_temp.ck('real','C16 the owner can ask to remove their own phone','true',pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.request_offline_device_wipe(%L,'lost_phone')::text $q$, pg_temp.f('dev2'))));
select pg_temp.ck('real','C17 a removed phone can no longer be edited','ERR 42501',pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.update_my_offline_device(%L,'x')::text $q$, pg_temp.f('dev2'))));
select pg_temp.ck('real','C18 owner sees two phones, another patient sees none','2/0',
  pg_temp.as_user(pg_temp.f('p1'),'select count(*)::text from public.offline_device_leases')||'/'||pg_temp.as_user(pg_temp.f('p2'),'select count(*)::text from public.offline_device_leases'));

-- SABOTAGE
do $$
declare v_def text; v_orig text;
begin
  select pg_get_functiondef('public.update_my_offline_device(uuid, text, boolean, boolean)'::regprocedure) into v_orig;
  v_def := replace(v_orig, 'where device_id = p_device and account_id = v_me;
  if not found', 'where device_id = p_device;
  if not found');
  execute v_def;
  insert into results values ('sabotaged','SABOTAGE 1: owner check removed lets another patient rename','ERR P0002',
    pg_temp.as_user(pg_temp.f('p2'), format($q$ select public.update_my_offline_device(%L,'Mine now')::text $q$, pg_temp.f('dev1'))));
  v_def := replace(v_orig, 'if v_row.revoked_at is not null then', 'if false then');
  execute v_def;
  insert into results values ('sabotaged','SABOTAGE 2: revoked guard removed lets a removed phone be edited','ERR 42501',
    pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.update_my_offline_device(%L,'x')::text $q$, pg_temp.f('dev2'))));
  v_def := replace(v_orig, '~ ''[[:cntrl:]]''', '~ ''^$''');
  execute v_def;
  insert into results values ('sabotaged','SABOTAGE 3: control check removed accepts a control character','ERR 22023',
    pg_temp.as_user(pg_temp.f('p1'), format($q$ select public.update_my_offline_device(%L,E'bad\nname')::text $q$, pg_temp.f('dev1'))));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S06z proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
