-- S36b proof: go_live_guard_status is readable by a holder of ops.console.view and by nobody else outside admin and the CMO (spec 9.4:
-- go-live dashboard read-only for ops). The write doors stay closed to ops.
--   1. An ops holder reads all the guards.  2. The same ops holder cannot switch a guard or attest a condition (42501).
--   3. A plain clinician and a patient cannot read (42501).  4. Admin still reads.
--   5. Revoking the permission closes the read again.
--   SABOTAGE: the permission clause removed from the read gate; the ops read must then be denied (flips the first check).
begin;
-- S62: the ten pathway guards (seeded off) are proved in s61_s62_pathway_engine.sql; this proof is about the seven it was written for.
delete from public.pathway_definitions;
alter table public.go_live_guards disable trigger go_live_guards_guard;
delete from public.go_live_guards where key like 'pathway\_%';
alter table public.go_live_guards enable trigger go_live_guards_guard;

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
  values (v, 's36b-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S36b ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
-- number of guards read, or ERR:sqlstate
create function pg_temp.status_as(p_uid uuid) returns text language plpgsql as $f$
declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.go_live_guard_status(); exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return jsonb_array_length(r)::text;
end $f$;
create function pg_temp.sql_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return 'ok';
end $f$;

do $$
declare v_org uuid; v_ops uuid; v_admin uuid; v_doc uuid; v_pat uuid; v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_ops := pg_temp.mkuser(v_org, 'ops', 'finance');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_ops, 'ops.console.view', v_admin);
  perform pg_temp.setf('ops', v_ops); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('pat', v_pat);
  select count(*) into v_n from public.go_live_guards;
  perform pg_temp.setf('n', gen_random_uuid());
  insert into results values ('real', 'guards exist to be read', '7', v_n::text);
end $$;

insert into results values ('real', 'an ops holder reads all seven guards', '7', pg_temp.status_as(pg_temp.f('ops')));
insert into results values ('real', 'admin still reads', '7', pg_temp.status_as(pg_temp.f('admin')));
insert into results values ('real', 'a plain clinician cannot read', 'ERR:42501', pg_temp.status_as(pg_temp.f('doc')));
insert into results values ('real', 'a patient cannot read', 'ERR:42501', pg_temp.status_as(pg_temp.f('pat')));
insert into results values ('real', 'ops cannot switch a guard on', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('ops'), $q$select public.set_go_live_guard('scribe_enabled', true, 'ops tries to switch it on')$q$));
insert into results values ('real', 'ops cannot switch a guard off', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('ops'), $q$select public.set_go_live_guard('scribe_enabled', false, 'ops tries to switch it off')$q$));
insert into results values ('real', 'ops cannot attest a condition', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('ops'), $q$select public.attest_go_live_condition('scribe_enabled', 'legal_review', true, 'ops tries to attest')$q$));

delete from public.user_permission_grants where profile_id = pg_temp.f('ops');
insert into results values ('real', 'revoking the permission closes the read', 'ERR:42501', pg_temp.status_as(pg_temp.f('ops')));
insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (pg_temp.f('ops'), 'ops.console.view', pg_temp.f('admin'));

do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('public.go_live_guard_status()'::regprocedure);
  v_def := replace(v_orig, 'and not private.has_permission(''ops.console.view'')', 'and true');
  if v_def = v_orig then raise exception 'SABOTAGE not applied'; end if;
  execute v_def;
  insert into results values ('sabotaged', 'an ops holder reads all seven guards', '7', pg_temp.status_as(pg_temp.f('ops')));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S36b proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage did not flip the ops read'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
