-- S42 proof: proxy coercion safeguards (migration *_s42_proxy_coercion_safeguards.sql). One rolled-back transaction. Proves:
--   1. The parent sees who set the arrangement up (first name only), since when, and what was given; nobody else sees it (proxy, stranger, anon).
--   2. The parent ends the access in one call: the grant and its categories are gone and the proxy reads nothing (control: they read before).
--   3. Only the parent can end it (the proxy, a stranger and anon are refused); ending twice is refused.
--   4. After an ending the same proxy cannot start a new setup for that number until blocks_until (control: a different proxy can; the block lapses).
--   5. The proxy cannot read the endings table.
--   SABOTAGE A: the cooling-off trigger removed, a new setup must then be accepted. SABOTAGE B: end_proxy_access deletes nothing, the proxy must then still read.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
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
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
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
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_phone text := '+23481' || lpad((random() * 99999999)::int::text, 8, '0');
begin
  insert into auth.users (id, email, phone, phone_confirmed_at, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's42-' || p_label || '-' || v || '@example.invalid', v_phone, now(), 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient', 'S42 ' || p_label || ' Person', v_phone, (current_date - interval '60 years')::date, true)
  on conflict (id) do update set is_test = true, is_active = true, full_name = excluded.full_name, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.setup(p_org uuid, p_proxy uuid, p_parent uuid) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, expires_at)
    select p_org, p_proxy, 'Parent', phone, now() + interval '2 days' from auth.users where id = p_parent returning id into v;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_pa uuid; v_px uuid; v_other uuid; v_stranger uuid; v_set uuid; v_grant uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pa := pg_temp.mkuser(v_org, 'parent'); v_px := pg_temp.mkuser(v_org, 'proxy'); v_other := pg_temp.mkuser(v_org, 'other-proxy'); v_stranger := pg_temp.mkuser(v_org, 'stranger');
  insert into fx values ('pa', v_pa), ('px', v_px), ('other', v_other), ('stranger', v_stranger);
  v_set := pg_temp.setup(v_org, v_px, v_pa);
  perform pg_temp.ck('parent confirms', 'ok', pg_temp.try_as(v_pa, format($q$select public.confirm_proxy_setup(%L, array['vitals_readings','medications']::public.care_access_category[])$q$, v_set)));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg) values (v_org, v_pa, 'weight', 65);
  select id into v_grant from public.profile_access where profile_id = v_pa and grantee_user_id = v_px;
  insert into fx values ('grant', v_grant);

  -- 1. what the parent sees
  perform pg_temp.ck('parent sees who set it up, first name only', 'S42', pg_temp.q_as(v_pa, $q$select public.my_proxy_arrangements() -> 0 ->> 'set_up_by'$q$));
  perform pg_temp.ck('parent sees the categories given', '2', pg_temp.q_as(v_pa, $q$select jsonb_array_length(public.my_proxy_arrangements() -> 0 -> 'categories')::text$q$));
  perform pg_temp.ck('the proxy sees no arrangement as a parent', '0', pg_temp.q_as(v_px, $q$select jsonb_array_length(public.my_proxy_arrangements())::text$q$));
  perform pg_temp.ck('a stranger sees none', '0', pg_temp.q_as(v_stranger, $q$select jsonb_array_length(public.my_proxy_arrangements())::text$q$));
  perform pg_temp.ck('anon cannot call it', '42501', pg_temp.try_anon('select public.my_proxy_arrangements()'));
  perform pg_temp.ck('control: the proxy reads the parent''s readings before', '1', pg_temp.q_as(v_px, format('select count(*)::text from public.vitals_readings where patient_id = %L', v_pa)));

  -- 3. who can end it
  perform pg_temp.ck('the proxy cannot end it', 'P0002', pg_temp.try_as(v_px, format('select public.end_proxy_access(%L)', v_grant)));
  perform pg_temp.ck('a stranger cannot end it', 'P0002', pg_temp.try_as(v_stranger, format('select public.end_proxy_access(%L)', v_grant)));
  perform pg_temp.ck('anon cannot end it', '42501', pg_temp.try_anon(format('select public.end_proxy_access(%L)', v_grant)));
  perform pg_temp.ck('nothing changed by the refusals', '1', (select count(*)::text from public.profile_access where id = v_grant));

  -- 2. the parent ends it
  perform pg_temp.ck('the parent ends it in one call', 'ok', pg_temp.try_as(v_pa, format('select public.end_proxy_access(%L, 30)', v_grant)));
  perform pg_temp.ck('the grant and its categories are gone', '0|0', (select (select count(*) from public.profile_access where id = v_grant)::text || '|' || (select count(*) from public.profile_access_categories where profile_access_id = v_grant)::text));
  perform pg_temp.ck('the proxy now reads nothing', '0', pg_temp.q_as(v_px, format('select count(*)::text from public.vitals_readings where patient_id = %L', v_pa)));
  perform pg_temp.ck('ending twice is refused', 'P0002', pg_temp.try_as(v_pa, format('select public.end_proxy_access(%L)', v_grant)));
  perform pg_temp.ck('the ending is recorded for the parent', '1', pg_temp.q_as(v_pa, 'select count(*)::text from public.proxy_access_endings'));
  perform pg_temp.ck('the proxy cannot read the endings', '0', pg_temp.q_as(v_px, 'select count(*)::text from public.proxy_access_endings'));
  perform pg_temp.ck('audit row written', '1', (select count(*)::text from public.audit_log where action = 'proxy_access.ended' and actor_id = v_pa));

  -- 4. cooling-off
  perform pg_temp.ck('the same proxy cannot start a new setup for that number', 'P0001',
    pg_temp.try_as(v_px, format($q$select public.create_proxy_setup('Parent', %L, 72, 5)$q$, (select phone from auth.users where id = v_pa))));
  perform pg_temp.ck('control: a different proxy can', 'ok',
    pg_temp.try_as(v_other, format($q$select public.create_proxy_setup('Parent', %L, 72, 5)$q$, (select phone from auth.users where id = v_pa))));
  update public.proxy_access_endings set ended_at = now() - interval '2 days', blocks_until = now() - interval '1 second' where parent_id = v_pa;
  perform pg_temp.ck('control: the block lapses', 'ok',
    pg_temp.try_as(v_px, format($q$select public.create_proxy_setup('Parent', %L, 72, 5)$q$, (select phone from auth.users where id = v_pa))));
end $$;

-- SABOTAGE A: no cooling-off trigger. A fresh arrangement is ended, and the same proxy must then be able to start again (the real check flips).
drop trigger proxy_setups_cooling_off on public.proxy_setups;
do $$
declare v_org uuid; v_pa uuid; v_px uuid; v_set uuid; v_grant uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pa := pg_temp.mkuser(v_org, 'sab-parent'); v_px := pg_temp.mkuser(v_org, 'sab-proxy');
  v_set := pg_temp.setup(v_org, v_px, v_pa);
  perform pg_temp.try_as(v_pa, format($q$select public.confirm_proxy_setup(%L, array['vitals_readings']::public.care_access_category[])$q$, v_set));
  select id into v_grant from public.profile_access where profile_id = v_pa and grantee_user_id = v_px;
  perform pg_temp.try_as(v_pa, format('select public.end_proxy_access(%L, 30)', v_grant));
  insert into results values ('sabotaged', 'new setup blocked after an ending', 'P0001',
    pg_temp.try_as(v_px, format($q$select public.create_proxy_setup('Parent', %L, 72, 5)$q$, (select phone from auth.users where id = v_pa))));
end $$;

-- SABOTAGE B: end_proxy_access deletes nothing. The proxy must then still read the parent's readings.
create or replace function public.end_proxy_access(p_grant uuid, p_block_days integer default 30) returns jsonb
language plpgsql security definer set search_path = '' as $$ begin return jsonb_build_object('ok', true); end $$;
do $$
declare v_org uuid; v_pa uuid; v_px uuid; v_set uuid; v_grant uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pa := pg_temp.mkuser(v_org, 'sab2-parent'); v_px := pg_temp.mkuser(v_org, 'sab2-proxy');
  v_set := pg_temp.setup(v_org, v_px, v_pa);
  perform pg_temp.try_as(v_pa, format($q$select public.confirm_proxy_setup(%L, array['vitals_readings']::public.care_access_category[])$q$, v_set));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg) values (v_org, v_pa, 'weight', 70);
  select id into v_grant from public.profile_access where profile_id = v_pa and grantee_user_id = v_px;
  perform pg_temp.try_as(v_pa, format('select public.end_proxy_access(%L, 30)', v_grant));
  insert into results values ('sabotaged', 'proxy reads nothing after ending', '0',
    pg_temp.q_as(v_px, format('select count(*)::text from public.vitals_readings where patient_id = %L', v_pa)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S42 proxy safeguards proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
