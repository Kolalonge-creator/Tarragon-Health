-- S80 C7 proof (25.10): AI cost by feature, prices ship empty and are never guessed.
--   1. The price table ships empty; with no price every cost is NULL (not zero) and the call counts are still right.
--   2. Only admin / ai_governance.manage read cost or add a price (clinician without the permission, patient, anon refused).
--   3. The price valid when a call was made is used (older price for older calls, newer for newer, none before the first price),
--      cost is exact integer arithmetic (tokens x price per million), a call with no token counts is not priced.
--   4. A permission holder who is not an admin sees only their own organisation's calls; an admin sees all.
--   5. Every read is audited; prices are append-only; a bad currency or a short source note is refused.
--   SABOTAGE: (a) the price-valid-at-time rule replaced by "latest price", (b) the organisation filter removed; each must flip a check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's80c7-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S80c7 ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
-- run a statement as a user: 'ok' or 'ERR:sqlstate'
create function pg_temp.sql_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return 'ok';
end $f$;
create function pg_temp.sql_anon(p_sql text) returns text language plpgsql as $f$
begin
  set local role anon;
  begin execute p_sql; exception when others then reset role; return 'ERR:' || sqlstate; end;
  reset role;
  return 'ok';
end $f$;
create function pg_temp.status_of(p_uid uuid, p_table text, p_id uuid) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  begin
    select l.status into r from public.directory_freshness_list() l where l.listing_table = p_table and l.listing_id = p_id;
  exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return coalesce(r, 'absent');
end $f$;

do $$
declare v_org uuid; v_org2 uuid; v_admin uuid; v_mgr uuid; v_doc uuid; v_pat uuid; v_sys uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation: the proof needs seed.sql'; end if;
  insert into public.organisations (name, type) values ('S80c7 other org', (select type from public.organisations where id = v_org)) returning id into v_org2;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_mgr := pg_temp.mkuser(v_org, 'mgr', 'clinician');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_mgr, 'ai_governance.manage', v_admin);
  select id into v_sys from public.ai_systems order by system_code limit 1;
  -- m-test: three calls; m-other: one call without token counts; one call in another organisation
  insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, input_category, status, input_token_count, output_token_count, created_at) values
    (v_org, v_sys, 's80c7-model', 'test', 'completed', 10, 10, '2025-12-01'),
    (v_org, v_sys, 's80c7-model', 'test', 'completed', 1000, 500, '2026-03-01'),
    (v_org, v_sys, 's80c7-model', 'test', 'completed', 2000, 1000, '2026-07-01'),
    (v_org, v_sys, 's80c7-nocount', 'test', 'completed', null, null, '2026-03-02'),
    (v_org2, v_sys, 's80c7-model', 'test', 'completed', 5000, 5000, '2026-07-02');
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('mgr', v_mgr); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('sys', v_sys);
end $$;

-- cost rows for one model as 'currency:interactions:priced:cost' joined, run as a user
create function pg_temp.cost_as(p_uid uuid, p_model text) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  begin
    select coalesce(string_agg(coalesce(c.currency, 'none') || ':' || c.interactions || ':' || c.priced_interactions || ':' || coalesce(c.cost_millionths_minor::text, 'null'), ' | ' order by c.currency nulls last), 'no rows') into r
      from public.ai_cost_by_feature('2025-11-01', '2026-12-01') c where c.model_identifier = p_model;
  exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;

-- 1. no prices at all
insert into results values ('real', 'the price table ships empty', '0', (select count(*)::text from public.ai_model_prices));
insert into results values ('real', 'with no price the cost is NULL, not zero, and the calls are counted (admin sees both organisations)', 'none:4:0:null',
  pg_temp.cost_as(pg_temp.f('admin'), 's80c7-model'));
insert into results values ('real', 'a call with no token counts is unpriced even with no price', 'none:1:0:null', pg_temp.cost_as(pg_temp.f('admin'), 's80c7-nocount'));

-- 2. who
insert into results values ('real', 'a clinician without the permission cannot read cost', 'ERR:42501', pg_temp.cost_as(pg_temp.f('doc'), 's80c7-model'));
insert into results values ('real', 'a patient cannot read cost', 'ERR:42501', pg_temp.cost_as(pg_temp.f('pat'), 's80c7-model'));
insert into results values ('real', 'anon cannot read cost', 'ERR:42501', pg_temp.sql_anon($q$select * from public.ai_cost_by_feature('2026-01-01', '2026-02-01')$q$));
insert into results values ('real', 'a clinician cannot add a price', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), $q$select public.add_ai_model_price('s80c7-model', 300, 1500, 'USD', '2026-01-01', 'price page checked on the vendor site')$q$));
insert into results values ('real', 'anon cannot add a price', 'ERR:42501',
  pg_temp.sql_anon($q$select public.add_ai_model_price('s80c7-model', 300, 1500, 'USD', '2026-01-01', 'price page checked on the vendor site')$q$));
insert into results values ('real', 'direct insert into the table is refused', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('admin'), $q$insert into public.ai_model_prices (model_identifier, input_per_million_minor, output_per_million_minor, currency, valid_from, source_note) values ('x', 1, 1, 'USD', now(), 'a long enough note')$q$));
insert into results values ('real', 'a bad range is refused', 'ERR:22023', pg_temp.sql_as(pg_temp.f('mgr'), $q$select * from public.ai_cost_by_feature('2026-02-01', '2026-01-01')$q$));

-- 3. prices
insert into results values ('real', 'the permission holder adds the first price', 'ok',
  pg_temp.sql_as(pg_temp.f('mgr'), $q$select public.add_ai_model_price('s80c7-model', 300, 1500, 'USD', '2026-01-01', 'vendor price page read on 7 Oct 2026')$q$));
insert into results values ('real', 'and a later price', 'ok',
  pg_temp.sql_as(pg_temp.f('mgr'), $q$select public.add_ai_model_price('s80c7-model', 600, 3000, 'USD', '2026-06-01', 'vendor price page read on 7 Oct 2026')$q$));
insert into results values ('real', 'a lowercase or wrong currency is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('mgr'), $q$select public.add_ai_model_price('s80c7-model', 1, 1, 'US', '2026-08-01', 'vendor price page read on 7 Oct 2026')$q$));
insert into results values ('real', 'a short source note is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('mgr'), $q$select public.add_ai_model_price('s80c7-model', 1, 1, 'USD', '2026-08-01', 'short')$q$));
insert into results values ('real', 'the same model and date twice is refused', 'ERR:23505',
  pg_temp.sql_as(pg_temp.f('mgr'), $q$select public.add_ai_model_price('s80c7-model', 1, 1, 'USD', '2026-06-01', 'vendor price page read on 7 Oct 2026')$q$));
insert into results values ('real', 'prices are PROPOSED and unsigned', 'PROPOSED/true',
  (select min(config_status) || '/' || bool_and(signed_by is null and signed_at is null)::text from public.ai_model_prices));
insert into results values ('real', 'each price is audited', '2', (select count(*)::text from public.audit_log where action = 'ai.model_price_added'));
-- the cost: older call before the first price is unpriced; 1000x300 + 500x1500 = 1,050,000; 2000x600 + 1000x3000 = 4,200,000
insert into results values ('real', 'the price valid at the time is used (admin, both orgs: one unpriced, 1050000 + 4200000 + 5000x600 + 5000x3000)', 'USD:3:3:23250000 | none:1:0:null',
  pg_temp.cost_as(pg_temp.f('admin'), 's80c7-model'));
insert into results values ('real', 'a permission holder sees only their own organisation', 'USD:2:2:5250000 | none:1:0:null', pg_temp.cost_as(pg_temp.f('mgr'), 's80c7-model'));
insert into results values ('real', 'the no-count call stays unpriced', 'none:1:0:null', pg_temp.cost_as(pg_temp.f('mgr'), 's80c7-nocount'));
insert into results values ('real', 'the reads were audited', 'true', (select (count(*) >= 5)::text from public.audit_log where action = 'ai.cost_viewed'));

-- 5. append only
insert into results values ('real', 'a price cannot be changed', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('admin'), $q$update public.ai_model_prices set input_per_million_minor = 1$q$));
do $$ begin
  begin delete from public.ai_model_prices; insert into results values ('real', 'a price cannot be deleted even by the owner', 'ERR:42501', 'deleted');
  exception when others then insert into results values ('real', 'a price cannot be deleted even by the owner', 'ERR:42501', 'ERR:' || sqlstate); end;
end $$;

-- SABOTAGE (a): "latest price" instead of the price valid at the time
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('public.ai_cost_by_feature(timestamptz, timestamptz)'::regprocedure);
  v_def := replace(v_orig, 'p.valid_from <= l.created_at', 'true');
  if v_def = v_orig then raise exception 'SABOTAGE (a) not applied'; end if;
  execute v_def;
  insert into results values ('sabotaged', 'the price valid at the time is used (admin, both orgs: one unpriced, 1050000 + 4200000 + 5000x600 + 5000x3000)', 'USD:3:3:23250000 | none:1:0:null',
    pg_temp.cost_as(pg_temp.f('admin'), 's80c7-model'));
  execute v_orig;
end $$;

-- SABOTAGE (b): the organisation filter removed
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('public.ai_cost_by_feature(timestamptz, timestamptz)'::regprocedure);
  v_def := replace(v_orig, '(v_all or l.organisation_id = v_org)', 'true');
  if v_def = v_orig then raise exception 'SABOTAGE (b) not applied'; end if;
  execute v_def;
  insert into results values ('sabotaged', 'a permission holder sees only their own organisation', 'USD:2:2:5250000 | none:1:0:null', pg_temp.cost_as(pg_temp.f('mgr'), 's80c7-model'));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S80 C7 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotages flipped a check: %', v_caught, (select string_agg(check_name || ' expected ' || expected || ' got ' || coalesce(actual,'null'), '; ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
