-- ===========================================================================
-- Proof: 20260930235724_s04_proxy_setup.sql (v5 8.2 "Set up for my parent", function 1.19, SAFETY CASE 23).
--
-- Proves, against the real migrated schema, with simulated sessions:
--   1. Creating a setup: validation (name, E.164, ttl 1 to 72, cap), own number refused, idempotent for the same number,
--      per-day cap, audit row with no phone or name in it.
--   2. SAFETY CASE 23: until the parent confirms, the proxy has NO profile_access row, sees none of the parent's
--      profile, vitals or medications, and confirm cannot be done by the proxy, by another signed-in person, by the
--      holder of an UNVERIFIED matching number, or after expiry; every refusal is the same message.
--   3. The parent (verified number) sees the pending setup (first name and expiry only), confirms with chosen
--      categories; the proxy then reads exactly those categories and nothing else; clinical_access stays false.
--   4. Decline is terminal; a declined or expired setup cannot be confirmed; expiry sweep marks lapsed rows.
--   5. anon has no EXECUTE on any function and no table access; the private sweep is not callable by an API role.
--   6. SABOTAGE x4, each proving its check can fail: drop the phone match, drop the verified-phone requirement, grant
--      the proxy access at creation, grant EXECUTE to PUBLIC.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create function pg_temp.call_as(p_uid uuid, p_sql text) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into j;
  execute 'reset role';
  return j;
end $$;

create temp table s04_orig as
  select pg_get_functiondef('public.confirm_proxy_setup(uuid,public.care_access_category[],public.caregiver_permission[])'::regprocedure) as confirm_def,
         pg_get_functiondef('public.create_proxy_setup(text,text,integer,integer)'::regprocedure) as create_def;
grant select on s04_orig to public;

create function pg_temp.fails_as(p_uid uuid, p_sql text) returns boolean language plpgsql as $$
begin
  perform pg_temp.call_as(p_uid, p_sql);
  return false;
exception when others then
  execute 'reset role';
  return true;
end $$;

do $$
declare
  v_org uuid;
  proxy uuid := gen_random_uuid();
  parent uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  unver uuid := gen_random_uuid();   -- holds the matching number but it is not verified
  sid uuid; sid2 uuid; sid3 uuid; gid uuid;
  r jsonb; v_n integer; v_state text; v_msg text; v_count integer;
  PARENT_PHONE constant text := '+2348011140001';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (proxy,  's04p-proxy@example.invalid',  'x', now(), null, null, now() - interval '30 days', '{}', '{}'),
    (parent, null, 'x', null, '2348011140001', now(), now() - interval '1 day', '{}', '{}'),
    (other,  's04p-other@example.invalid',  'x', now(), null, null, now() - interval '30 days', '{}', '{}'),
    (unver,  null, 'x', null, '2348011140002', null, now() - interval '1 day', '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth) values
    (proxy,  v_org, 'patient', 'Adaeze Proxy', '+2348011140010', '1990-01-01'),
    (parent, v_org, 'patient', 'Ngozi Parent', '+2348011140001', '1955-05-05'),
    (other,  v_org, 'patient', 'Other Person', '+2348011140011', '1991-02-02'),
    (unver,  v_org, 'patient', 'Unverified Holder', '+2348011140002', '1960-06-06')
  on conflict (id) do update set organisation_id = excluded.organisation_id, full_name = excluded.full_name, phone = excluded.phone;

  -- a clinical row for the parent, so "sees nothing" is tested against something real
  insert into public.vitals_readings (patient_id, organisation_id, vital_type, systolic, diastolic, source)
  values (parent, v_org, 'blood_pressure', 120, 80, 'manual');

  -- ===== 1. create
  if not pg_temp.fails_as(proxy, format('select to_jsonb(public.create_proxy_setup(%L, %L, 72, 5))', '', PARENT_PHONE)) then raise exception 'FAIL 1a: empty name accepted'; end if;
  if not pg_temp.fails_as(proxy, format('select to_jsonb(public.create_proxy_setup(%L, %L, 72, 5))', 'Ngozi', '08011140001')) then raise exception 'FAIL 1b: non-E.164 accepted'; end if;
  if not pg_temp.fails_as(proxy, format('select to_jsonb(public.create_proxy_setup(%L, %L, 73, 5))', 'Ngozi', PARENT_PHONE)) then raise exception 'FAIL 1c: ttl above 72 accepted'; end if;
  if not pg_temp.fails_as(proxy, format('select to_jsonb(public.create_proxy_setup(%L, %L, 0, 5))', 'Ngozi', PARENT_PHONE)) then raise exception 'FAIL 1d: ttl 0 accepted'; end if;
  if not pg_temp.fails_as(proxy, format('select to_jsonb(public.create_proxy_setup(%L, %L, 72, 50))', 'Ngozi', PARENT_PHONE)) then raise exception 'FAIL 1e: cap above 20 accepted'; end if;
  if not pg_temp.fails_as(proxy, format('select to_jsonb(public.create_proxy_setup(%L, %L, 72, 5))', 'Self', '+2348011140010')) then raise exception 'FAIL 1f: own number accepted'; end if;
  if (select count(*) from public.proxy_setups where created_by_profile_id = proxy) <> 0 then raise exception 'FAIL 1: a refused call created a row'; end if;

  sid := (pg_temp.call_as(proxy, format('select to_jsonb(public.create_proxy_setup(%L, %L, 72, 5))', 'Ngozi Parent', PARENT_PHONE)) #>> '{}')::uuid;
  sid2 := (pg_temp.call_as(proxy, format('select to_jsonb(public.create_proxy_setup(%L, %L, 72, 5))', 'Ngozi Parent', PARENT_PHONE)) #>> '{}')::uuid;
  if sid2 <> sid then raise exception 'FAIL 1g: same number again was not idempotent'; end if;
  if (select count(*) from public.proxy_setups where created_by_profile_id = proxy) <> 1 then raise exception 'FAIL 1g: duplicate pending rows'; end if;
  if (select expires_at - created_at from public.proxy_setups where id = sid) > interval '72 hours' then raise exception 'FAIL 1: expiry beyond 72 hours'; end if;
  select count(*) into v_n from public.audit_log where action = 'proxy_setup.created' and entity_id = sid and actor_id = proxy
     and event::text not like '%Ngozi%' and event::text not like '%2348011%';
  if v_n <> 1 then raise exception 'FAIL 1h: create not audited cleanly (%)', v_n; end if;
  -- the daily cap: a cap of 1 refuses a second, different number
  if not pg_temp.fails_as(proxy, format('select to_jsonb(public.create_proxy_setup(%L, %L, 72, 1))', 'Another', '+2348011140099')) then raise exception 'FAIL 1i: daily cap not enforced'; end if;

  -- ===== 2. SAFETY CASE 23: nothing for the proxy before confirmation
  if exists (select 1 from public.profile_access where profile_id = parent) then raise exception 'FAIL 23a: a grant exists before confirmation'; end if;
  r := pg_temp.call_as(proxy, format('select jsonb_build_object(''profiles'', (select count(*) from public.profiles where id = %L), ''vitals'', (select count(*) from public.vitals_readings where patient_id = %L), ''meds'', (select count(*) from public.medications where patient_id = %L))', parent, parent, parent));
  if (r->>'profiles')::int <> 0 or (r->>'vitals')::int <> 0 or (r->>'meds')::int <> 0 then raise exception 'FAIL 23b: proxy can see the parent before confirmation: %', r; end if;
  -- the proxy cannot confirm, nor can another signed-in person, nor the holder of an unverified matching number
  v_msg := null;
  for gid in select unnest(array[proxy, other, unver]) loop
    if not pg_temp.fails_as(gid, format('select to_jsonb(public.confirm_proxy_setup(%L, array[''vitals_readings'']::public.care_access_category[], ''{}''))', sid)) then
      raise exception 'FAIL 23c: % could confirm a setup that is not theirs to confirm', gid;
    end if;
  end loop;
  if exists (select 1 from public.profile_access where profile_id = parent) then raise exception 'FAIL 23d: a refused confirm left a grant'; end if;
  -- one identical message for every refusal reason
  begin
    perform pg_temp.call_as(other, format('select to_jsonb(public.confirm_proxy_setup(%L, ''{}'', ''{}''))', sid));
  exception when others then execute 'reset role'; v_msg := sqlerrm; end;
  if v_msg is distinct from 'this setup cannot be confirmed' then raise exception 'FAIL 23e: refusal message differs: %', v_msg; end if;
  v_msg := null;
  begin
    perform pg_temp.call_as(other, format('select to_jsonb(public.confirm_proxy_setup(%L, ''{}'', ''{}''))', gen_random_uuid()));
  exception when others then execute 'reset role'; v_msg := sqlerrm; end;
  if v_msg is distinct from 'this setup cannot be confirmed' then raise exception 'FAIL 23f: unknown-id refusal differs from wrong-person refusal: %', v_msg; end if;
  -- the proxy's own view of the setup holds only what they typed plus state
  r := pg_temp.call_as(proxy, format('select to_jsonb(s) from public.proxy_setups s where id = %L', sid));
  if r->>'state' <> 'pending_confirmation' or r->>'confirmed_profile_id' is not null then raise exception 'FAIL 23g: %', r; end if;
  -- other people cannot read the proxy's row
  if (pg_temp.call_as(other, format('select to_jsonb((select count(*) from public.proxy_setups where id = %L))', sid)) #>> '{}')::int <> 0 then raise exception 'FAIL 23h: another patient read the setup row'; end if;

  -- ===== 3. the parent sees the request and confirms
  r := pg_temp.call_as(parent, 'select coalesce(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) from public.my_pending_proxy_setups() p');
  if jsonb_array_length(r) <> 1 or r->0->>'requester_first_name' <> 'Adaeze' or (r->0) ? 'target_phone_e164' or r::text like '%Proxy%' then raise exception 'FAIL 3a: parent view wrong or over-shared: %', r; end if;
  r := pg_temp.call_as(other, 'select coalesce(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) from public.my_pending_proxy_setups() p');
  if jsonb_array_length(r) <> 0 then raise exception 'FAIL 3b: someone else sees the setup'; end if;
  r := pg_temp.call_as(unver, 'select coalesce(jsonb_agg(to_jsonb(p)), ''[]''::jsonb) from public.my_pending_proxy_setups() p');
  if jsonb_array_length(r) <> 0 then raise exception 'FAIL 3c: unverified holder sees the setup'; end if;

  gid := (pg_temp.call_as(parent, format('select to_jsonb(public.confirm_proxy_setup(%L, array[''vitals_readings'',''appointments_care_plan'']::public.care_access_category[], ''{}''))', sid)) #>> '{}')::uuid;
  select state into v_state from public.proxy_setups where id = sid;
  if v_state <> 'confirmed' then raise exception 'FAIL 3d: state is %', v_state; end if;
  if (select count(*) from public.profile_access_categories where profile_access_id = gid) <> 2 then raise exception 'FAIL 3e: wrong category count'; end if;
  if (select clinical_access from public.profile_access where id = gid) then raise exception 'FAIL 3f: legacy clinical_access flag was set'; end if;
  if (select permission_level from public.profile_access where id = gid) <> 'view' then raise exception 'FAIL 3g: proxy got more than view'; end if;
  r := pg_temp.call_as(proxy, format('select jsonb_build_object(''vitals'', (select count(*) from public.vitals_readings where patient_id = %L), ''meds'', (select count(*) from public.medications where patient_id = %L))', parent, parent));
  if (r->>'vitals')::int <> 1 then raise exception 'FAIL 3h: proxy cannot see the vitals the parent chose to share: %', r; end if;
  if (pg_temp.call_as(proxy, format('select to_jsonb(private.can_read_clinical(%L, ''reproductive_health''::public.care_access_category))', parent)) #>> '{}')::boolean then raise exception 'FAIL 3i: proxy can read a category the parent did not choose'; end if;
  if not (pg_temp.call_as(proxy, format('select to_jsonb(private.can_read_clinical(%L, ''vitals_readings''::public.care_access_category))', parent)) #>> '{}')::boolean then raise exception 'FAIL 3i: proxy cannot read the category the parent chose'; end if;
  if not pg_temp.fails_as(parent, format('select to_jsonb(public.confirm_proxy_setup(%L, ''{}'', ''{}''))', sid)) then raise exception 'FAIL 3j: a confirmed setup confirmed again'; end if;
  select count(*) into v_n from public.audit_log where action = 'proxy_setup.confirmed' and entity_id = sid and actor_id = parent and subject_patient_id = parent;
  if v_n <> 1 then raise exception 'FAIL 3k: confirm not audited'; end if;

  -- ===== 4. decline, expiry
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
    values (gen_random_uuid(), null, 'x', null, '2348011140003', now(), now(), '{}', '{}') returning id into gid;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values (gid, v_org, 'patient', 'Decliner', '+2348011140003')
    on conflict (id) do nothing;
  sid3 := (pg_temp.call_as(proxy, format('select to_jsonb(public.create_proxy_setup(%L, %L, 24, 5))', 'Decliner', '+2348011140003')) #>> '{}')::uuid;
  if pg_temp.fails_as(gid, format('select to_jsonb(public.decline_proxy_setup(%L))', sid3)) then raise exception 'FAIL 4a: holder could not decline'; end if;
  if (select state from public.proxy_setups where id = sid3) <> 'declined' then raise exception 'FAIL 4a: not declined'; end if;
  if not pg_temp.fails_as(gid, format('select to_jsonb(public.confirm_proxy_setup(%L, ''{}'', ''{}''))', sid3)) then raise exception 'FAIL 4b: declined setup confirmed'; end if;
  if not pg_temp.fails_as(other, format('select to_jsonb(public.decline_proxy_setup(%L))', sid)) then raise exception 'FAIL 4c: a stranger declined a setup'; end if;
  -- an expired setup cannot be confirmed, and the sweep marks it
  insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, expires_at, created_at)
    values (v_org, other, 'Late Parent', '+2348011140003', now() - interval '1 hour', now() - interval '2 days') returning id into sid2;
  if not pg_temp.fails_as(gid, format('select to_jsonb(public.confirm_proxy_setup(%L, ''{}'', ''{}''))', sid2)) then raise exception 'FAIL 4d: expired setup confirmed'; end if;
  select private.expire_proxy_setups() into v_count;
  if (select state from public.proxy_setups where id = sid2) <> 'expired' or v_count < 1 then raise exception 'FAIL 4e: sweep did not expire the lapsed row'; end if;
  -- a lapsed pending row does not block a fresh setup for the same number
  insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, expires_at, created_at)
    values (v_org, proxy, 'Old Setup', '+2348011140077', now() - interval '1 hour', now() - interval '2 days');
  perform pg_temp.call_as(proxy, format('select to_jsonb(public.create_proxy_setup(%L, %L, 72, 9))', 'New Setup', '+2348011140077'));
  if (select count(*) from public.proxy_setups where created_by_profile_id = proxy and target_phone_e164 = '+2348011140077' and state = 'pending_confirmation') <> 1 then raise exception 'FAIL 4f: lapsed row blocked a fresh setup'; end if;

  -- ===== 5. anon and private
  if exists (select 1 from information_schema.role_table_grants where table_name = 'proxy_setups' and grantee = 'anon') then raise exception 'FAIL 5a: anon has table access'; end if;
  foreach v_msg in array array['public.create_proxy_setup(text,text,integer,integer)','public.my_pending_proxy_setups()','public.decline_proxy_setup(uuid)'] loop
    if has_function_privilege('anon', v_msg, 'EXECUTE') then raise exception 'FAIL 5b: anon can execute %', v_msg; end if;
  end loop;
  if has_function_privilege('authenticated', 'private.expire_proxy_setups()', 'EXECUTE') then raise exception 'FAIL 5c: API role can run the sweep'; end if;

  raise notice 'S04 proxy: sections 1 to 5 pass';
end $$;

-- ===========================================================================
-- 6. SABOTAGE. Each block reverts one guard and proves a matching check could fail.
-- ===========================================================================

-- 6a. drop the phone match: a stranger can now confirm
do $$
declare
  v_org uuid; proxy uuid := gen_random_uuid(); stranger uuid := gen_random_uuid(); sid uuid; ok boolean := false;
  src text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (proxy, 's04s-a@example.invalid', 'x', now(), null, null, now(), '{}', '{}'),
    (stranger, null, 'x', null, '2348011149991', now(), now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (proxy, v_org, 'patient', 'Sab Proxy', '+2348011149990'), (stranger, v_org, 'patient', 'Sab Stranger', '+2348011149991')
  on conflict (id) do nothing;
  insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, expires_at)
    values (v_org, proxy, 'Sab Parent', '+2348011149992', now() + interval '1 hour') returning id into sid;
  select confirm_def into src from s04_orig;
  src := replace(src, $q$     or regexp_replace(coalesce(v_phone, ''), '\D', '', 'g') <> regexp_replace(v_setup.target_phone_e164, '\D', '', 'g')$q$, '');
  if src like '%<> regexp_replace(v_setup.target_phone_e164%' then raise exception 'sabotage 6a did not apply'; end if;
  execute src;
  begin
    perform pg_temp.call_as(stranger, format('select to_jsonb(public.confirm_proxy_setup(%L, array[''vitals_readings'']::public.care_access_category[], ''{}''))', sid));
    ok := true;
  exception when others then execute 'reset role'; end;
  if not ok then raise exception 'SABOTAGE 6a: the phone-match check is not load-bearing (a stranger was still refused)'; end if;
end $$;

-- 6b. drop the verified-phone requirement: the holder of an UNVERIFIED matching number can now confirm
do $$
declare
  v_org uuid; proxy uuid := gen_random_uuid(); unver uuid := gen_random_uuid(); sid uuid; ok boolean := false; src text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (proxy, 's04s-b@example.invalid', 'x', now(), null, null, now(), '{}', '{}'),
    (unver, null, 'x', null, '2348011149993', null, now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (proxy, v_org, 'patient', 'Sab Proxy B', '+2348011149994'), (unver, v_org, 'patient', 'Sab Unverified', '+2348011149993')
  on conflict (id) do nothing;
  insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, expires_at)
    values (v_org, proxy, 'Sab Parent B', '+2348011149993', now() + interval '1 hour') returning id into sid;
  select confirm_def into src from s04_orig;
  src := replace(src, $q$     or v_confirmed is null$q$, '');
  if src like '%or v_confirmed is null%' then raise exception 'sabotage 6b did not apply'; end if;
  execute src;
  begin
    perform pg_temp.call_as(unver, format('select to_jsonb(public.confirm_proxy_setup(%L, array[''vitals_readings'']::public.care_access_category[], ''{}''))', sid));
    ok := true;
  exception when others then execute 'reset role'; end;
  if not ok then raise exception 'SABOTAGE 6b: the verified-phone requirement is not load-bearing'; end if;
end $$;

-- 6c. grant the proxy access at creation (the safety case 23 failure): the "nothing before confirmation" check must see it
do $$
declare
  v_org uuid; proxy uuid := gen_random_uuid(); parent uuid := gen_random_uuid(); sid uuid; src text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (proxy, 's04s-c@example.invalid', 'x', now(), null, null, now(), '{}', '{}'),
    (parent, null, 'x', null, '2348011149995', now(), now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (proxy, v_org, 'patient', 'Sab Proxy C', '+2348011149996'), (parent, v_org, 'patient', 'Sab Parent C', '+2348011149995')
  on conflict (id) do nothing;
  select create_def into src from s04_orig;
  src := replace(src, $q$  return v_id;
end;$q$, $q$  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  select pr.id, v_uid, 'view', pr.id from public.profiles pr where regexp_replace(coalesce(pr.phone,''), '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g');
  return v_id;
end;$q$);
  if src not like '%insert into public.profile_access%' then raise exception 'sabotage 6c did not apply'; end if;
  execute src;
  perform pg_temp.call_as(proxy, format('select to_jsonb(public.create_proxy_setup(%L, %L, 72, 5))', 'Sab Parent C', '+2348011149995'));
  if not exists (select 1 from public.profile_access where profile_id = parent) then
    raise exception 'SABOTAGE 6c: the sabotage did not create a pre-confirmation grant, so check 23a could not have caught it';
  end if;
end $$;

-- 6d. PUBLIC execute: the anon-privilege check must be able to fail
do $$
begin
  grant execute on function public.my_pending_proxy_setups() to public;
  if not has_function_privilege('anon', 'public.my_pending_proxy_setups()', 'EXECUTE') then
    raise exception 'SABOTAGE 6d: granting PUBLIC did not reach anon, so check 5b could not have caught it';
  end if;
end $$;

rollback;
