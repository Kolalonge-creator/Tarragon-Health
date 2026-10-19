-- Record share extras proof (migration *_record_share_recipient_views_window.sql): recipient label, view cap, date window on the existing S09/S09x share.
-- One rolled-back transaction, is_test data only. SABOTAGE at the end: the view cap and the date window are each broken once; the matching checks must flip.
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
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run one query as a signed-in user, return its single text value, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the same as the anonymous caller
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's09x-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S09x ' || p_label || ' Person', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.open(p_token text, p_pin text, p_client text) returns jsonb
language plpgsql as $f$
declare r text;
begin
  r := pg_temp.q_anon(format('select public.record_share_by_token(%L, %L, %L)::text', p_token, p_pin, p_client));
  return r::jsonb;
end $f$;


create function pg_temp.mk_opt(p_uid uuid, p_label text, p_max integer, p_win integer) returns jsonb
language plpgsql as $f$
declare r text;
begin
  r := pg_temp.q_as(p_uid, format('select public.create_record_share_with_options(array[''vitals'',''emergency_info'']::text[], 24, false, false, %L, %s, %s)::text',
                                  p_label, coalesce(p_max::text, 'null'), coalesce(p_win::text, 'null')));
  if r like 'ERR:%' then return jsonb_build_object('err', r); end if;
  return r::jsonb;
end $f$;

do $$
declare v_org uuid; v_admin uuid; v_p uuid; v_q uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient');  perform pg_temp.setf('p', v_p);
  v_q := pg_temp.mkuser(v_org, 'other', 'patient');    perform pg_temp.setf('q', v_q);
  -- two readings: one inside every window, one 200 days old (outside all three windows). Device source: a manual reading cannot be backdated.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, source, taken_at)
  values (v_org, v_p, 'weight', 71.1, 'device', now() - interval '10 days'),
         (v_org, v_p, 'weight', 69.9, 'device', now() - interval '200 days');
exception when others then
  raise exception 'fixture failed: %', sqlerrm;
end $$;

do $$
declare
  v_p uuid := pg_temp.f('p'); v_q uuid := pg_temp.f('q');
  s jsonb; t text; r jsonb; x text;
begin
  -- 1. the options door: stored and echoed
  s := pg_temp.mk_opt(v_p, 'Dr Okafor, Lagos clinic', 3, 90);
  t := s ->> 'token';
  perform pg_temp.ck('options share is created with a token', 'true', (t is not null and length(t) >= 32)::text);
  perform pg_temp.ck('label stored', 'Dr Okafor, Lagos clinic', pg_temp.q_as(v_p, format('select recipient_label from public.record_shares where id = %L', s ->> 'id')));
  perform pg_temp.ck('max views stored', '3', pg_temp.q_as(v_p, format('select max_views::text from public.record_shares where id = %L', s ->> 'id')));
  perform pg_temp.ck('window stored', '90', pg_temp.q_as(v_p, format('select window_days::text from public.record_shares where id = %L', s ->> 'id')));

  -- 2. who can and cannot use it
  perform pg_temp.ck('another patient cannot see the share row', '0', pg_temp.q_as(v_q, format('select count(*)::text from public.record_shares where id = %L', s ->> 'id')));
  perform pg_temp.ck('anon cannot call the options door', 'ERR:42501', pg_temp.q_anon($q$select public.create_record_share_with_options(array['vitals']::text[], 24, false, false, 'x', 1, 30)::text$q$));
  perform pg_temp.ck('pin_hash stays unreadable', 'false', has_column_privilege('authenticated', 'public.record_shares', 'pin_hash', 'select')::text);

  -- 3. bad inputs are refused, and nothing is created for them
  perform pg_temp.ck('0 views refused', 'true', (pg_temp.mk_opt(v_p, 'x', 0, null) ? 'err')::text);
  perform pg_temp.ck('51 views refused', 'true', (pg_temp.mk_opt(v_p, 'x', 51, null) ? 'err')::text);
  perform pg_temp.ck('a 60 day window refused', 'true', (pg_temp.mk_opt(v_p, 'x', null, 60) ? 'err')::text);
  perform pg_temp.ck('an 81 character label refused', 'true', (pg_temp.mk_opt(v_p, repeat('a', 81), null, null) ? 'err')::text);
  perform pg_temp.ck('refused calls left no extra share behind', '1', (select count(*)::text from public.record_shares where patient_id = v_p));

  -- 4. opening: label, views left, window echoed; the window drops the old reading and keeps the recent one
  r := pg_temp.open(t, null, 'c1');
  perform pg_temp.ck('first open is ok', 'ok', coalesce(r ->> 'status', 'null'));
  perform pg_temp.ck('label shown on the page data', 'Dr Okafor, Lagos clinic', coalesce(r ->> 'recipient_label', 'null'));
  perform pg_temp.ck('views left after the first open', '2', coalesce(r ->> 'views_left', 'null'));
  perform pg_temp.ck('window echoed', '90', coalesce(r ->> 'window_days', 'null'));
  perform pg_temp.ck('window keeps the recent reading', 'true', exists (select 1 from jsonb_array_elements(r -> 'vitals') e where (e ->> 'weight_kg')::numeric = 71.1)::text);
  perform pg_temp.ck('window drops the 200 day old reading', 'false', exists (select 1 from jsonb_array_elements(r -> 'vitals') e where (e ->> 'weight_kg')::numeric = 69.9)::text);

  -- 5. the cap
  perform pg_temp.open(t, null, 'c2');
  perform pg_temp.ck('peek is still ready before the last view', 'ready', pg_temp.q_anon(format('select public.record_share_peek(%L)', t)));
  r := pg_temp.open(t, null, 'c3');
  perform pg_temp.ck('third open is ok', 'ok', coalesce(r ->> 'status', 'null'));
  perform pg_temp.ck('views left is 0 on the last view', '0', coalesce(r ->> 'views_left', 'null'));
  r := pg_temp.open(t, null, 'c4');
  perform pg_temp.ck('the fourth open is refused like any dead link', 'null', coalesce(r ->> 'status', 'null'));
  perform pg_temp.ck('peek says nothing once the cap is used', 'null', coalesce(pg_temp.q_anon(format('select public.record_share_peek(%L)', t)), 'null'));

  -- 6. no cap and no window: unlimited, the full 20, views_left null
  s := pg_temp.mk_opt(v_p, null, null, null);
  r := pg_temp.open(s ->> 'token', null, 'd1');
  perform pg_temp.ck('no cap: views_left is null', 'null', coalesce(r ->> 'views_left', 'null'));
  perform pg_temp.ck('no window: the old reading is still there', 'true', exists (select 1 from jsonb_array_elements(r -> 'vitals') e where (e ->> 'weight_kg')::numeric = 69.9)::text);
  perform pg_temp.ck('no label: label is null', 'null', coalesce(r ->> 'recipient_label', 'null'));

  -- 7. the existing door still works unchanged
  x := pg_temp.q_as(v_p, $q$select (public.create_record_share(array['vitals']::text[], 24, false, false) ->> 'token') is not null$q$);
  perform pg_temp.ck('the original create door still works', 'true', x);
end $$;

-- 8. SABOTAGE: each new protection broken once; the check must flip
do $$
declare v_def text; r jsonb; s jsonb; v_p uuid := pg_temp.f('p');
begin
  v_def := pg_get_functiondef('public.record_share_by_token(text, text, text)'::regprocedure);
  execute replace(v_def, 'if v_share.max_views is not null and v_share.view_count >= v_share.max_views then', 'if false then');
  s := pg_temp.mk_opt(v_p, 'sab', 1, null);
  perform pg_temp.open(s ->> 'token', null, 'sab1');
  r := pg_temp.open(s ->> 'token', null, 'sab2');
  insert into results values ('sabotaged', 'SABOTAGE: with the cap removed a one-view link opens a second time', 'null', coalesce(r ->> 'status', 'null'));

  v_def := pg_get_functiondef('public.record_share_by_token(text, text, text)'::regprocedure);
  execute replace(v_def, 'if v_share.window_days is not null then', 'if false then');
  s := pg_temp.mk_opt(v_p, 'sab', null, 30);
  r := pg_temp.open(s ->> 'token', null, 'sab3');
  insert into results values ('sabotaged', 'SABOTAGE: with the window removed the 200 day old reading shows', 'false',
    exists (select 1 from jsonb_array_elements(r -> 'vitals') e where (e ->> 'weight_kg')::numeric = 69.9)::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'record share extras proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
