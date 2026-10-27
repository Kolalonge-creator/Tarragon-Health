-- S80 gap closure proof (25.9 / 25.3): directory freshness score that decays daily, chase list, partner email notice, hide-from-routing guard.
--   1. The score is 0 never verified, 100 today, 50 on the due date, 0 at twice the cadence.
--   2. The chase list is readable by ops, refused to a patient and anon, orders the stalest first, and says who can be contacted.
--   3. With directory_partner_stale_email OFF the sweep queues nothing; ON it queues ONE non-clinical email to the stale partner's contact (not to a
--      fresh partner, not to one with no contact), and a second run inside the repeat window queues nothing. It never changes is_active.
--   4. With directory_hide_stale_partners OFF nothing is hidden; ON a previously verified, stale lab disappears from the patient lab picker while a
--      never-verified lab and a fresh lab stay.
--   SABOTAGE: (a) the hide predicate always false, (b) the score always 100; each must flip a check.
-- Not run against any database when written (no local Supabase stack was available); run it on the CI replay stack.
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
  values (v, 's80dsc-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S80dsc ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
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
-- names of the proof labs shown to a patient in the lab picker, comma separated, ordered
create function pg_temp.picker_as(p_uid uuid) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  select coalesce(string_agg(provider_name, ',' order by provider_name), '') into r from public.list_lab_test_locations(null, null) where provider_name like 'S80dsc %';
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.guard(p_key text, p_on boolean) returns void language plpgsql as $f$
begin
  set local session_replication_role = replica;
  update public.go_live_guards set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then pg_temp.f('admin') end,
         change_note = case when p_on then 'S80 proof run' end where key = p_key;
  set local session_replication_role = origin;
end $f$;

do $$
declare v_org uuid; v_admin uuid; v_ops uuid; v_pat uuid; v_a uuid; v_b uuid; v_c uuid; v_pp uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation: the proof needs seed.sql'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_ops := pg_temp.mkuser(v_org, 'ops', 'finance');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_ops, 'ops.console.view', v_admin);
  -- A: stale (verified 800 days ago), has a contact. B: never verified. C: fresh (verified today).
  insert into public.lab_providers (name, is_active, license_number, license_verified_at, license_expires_at, accreditation, contact_email)
    values ('S80dsc Lab A stale', true, 'S80DSC-A', now(), now() + interval '1 year', 'ISO 15189', 'lab-a@s80dsc-labs.test') returning id into v_a;
  insert into public.lab_providers (name, is_active, license_number, license_verified_at, license_expires_at, accreditation, contact_email)
    values ('S80dsc Lab B never', true, 'S80DSC-B', now(), now() + interval '1 year', 'ISO 15189', 'lab-b@s80dsc-labs.test') returning id into v_b;
  insert into public.lab_providers (name, is_active, license_number, license_verified_at, license_expires_at, accreditation, contact_email)
    values ('S80dsc Lab C fresh', true, 'S80DSC-C', now(), now() + interval '1 year', 'ISO 15189', 'lab-c@s80dsc-labs.test') returning id into v_c;
  insert into public.lab_provider_locations (lab_provider_id, name, state, town, address) values
    (v_a, 'A branch', 'Lagos', 'Yaba', '1 Test Road'), (v_b, 'B branch', 'Lagos', 'Yaba', '2 Test Road'), (v_c, 'C branch', 'Lagos', 'Yaba', '3 Test Road');
  insert into public.pharmacy_partners (name, is_active, onboarding_status) values ('S80dsc Pharmacy no contact', true, 'activated') returning id into v_pp;
  insert into public.directory_freshness (listing_table, listing_id, organisation_id, last_verified_at, verified_by, next_verification_due) values
    ('lab_providers', v_a, v_org, now() - interval '800 days', v_admin, (current_date - 800 + 365)),
    ('lab_providers', v_c, v_org, now(), v_admin, current_date + 365),
    ('pharmacy_partners', v_pp, v_org, now(), v_admin, current_date + 180);
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('ops', v_ops); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('a', v_a); perform pg_temp.setf('b', v_b); perform pg_temp.setf('c', v_c); perform pg_temp.setf('pp', v_pp);
end $$;

-- 1. score arithmetic
insert into results values ('real', 'never verified scores 0', '0', private.directory_freshness_score(null, 12)::text);
insert into results values ('real', 'verified today scores 100', '100', private.directory_freshness_score(now(), 12)::text);
insert into results values ('real', 'on the due date it scores 50', '50', private.directory_freshness_score(now() - interval '360 days', 12)::text);
insert into results values ('real', 'at twice the cadence it scores 0', '0', private.directory_freshness_score(now() - interval '720 days', 12)::text);
insert into results values ('real', 'it decays day by day', 'true', (private.directory_freshness_score(now() - interval '100 days', 12) > private.directory_freshness_score(now() - interval '200 days', 12))::text);

-- 2. chase list
create function pg_temp.chase_as(p_uid uuid, p_name text, p_col text) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  begin
    execute format('select %I::text from public.directory_chase_list() where name = %L', p_col, p_name) into r;
  exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return coalesce(r, 'absent');
end $f$;
insert into results values ('real', 'ops sees the stale lab with its score', '0', pg_temp.chase_as(pg_temp.f('ops'), 'S80dsc Lab A stale', 'freshness_score'));
insert into results values ('real', 'ops sees the fresh lab with its score', '100', pg_temp.chase_as(pg_temp.f('ops'), 'S80dsc Lab C fresh', 'freshness_score'));
insert into results values ('real', 'a never-verified lab scores 0 and is listed', '0', pg_temp.chase_as(pg_temp.f('ops'), 'S80dsc Lab B never', 'freshness_score'));
insert into results values ('real', 'a lab with a contact can be notified', 'true', pg_temp.chase_as(pg_temp.f('ops'), 'S80dsc Lab A stale', 'can_notify'));
insert into results values ('real', 'a pharmacy with no contact cannot', 'false', pg_temp.chase_as(pg_temp.f('ops'), 'S80dsc Pharmacy no contact', 'can_notify'));
create function pg_temp.chase_order_as(p_uid uuid) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  select string_agg(q.name, '|' order by q.ord) into r
    from (select name, row_number() over () as ord from public.directory_chase_list()) q where q.name like 'S80dsc Lab%';
  perform pg_temp.back();
  return r;
end $f$;
insert into results values ('real', 'stalest first: verified-long-ago, then never verified, then fresh', 'S80dsc Lab A stale|S80dsc Lab B never|S80dsc Lab C fresh', pg_temp.chase_order_as(pg_temp.f('ops')));
insert into results values ('real', 'a patient is refused the chase list', 'ERR:42501', pg_temp.sql_as(pg_temp.f('pat'), 'select * from public.directory_chase_list()'));
insert into results values ('real', 'anon is refused the chase list', 'ERR:42501', pg_temp.sql_anon('select * from public.directory_chase_list()'));
insert into results values ('real', 'anon cannot run the sweep', 'ERR:42501', pg_temp.sql_anon('select private.directory_chase_notices()'));

-- 3. notices
select pg_temp.guard('directory_partner_stale_email', false);
insert into results values ('real', 'guard off: the sweep queues nothing', '0', private.directory_chase_notices()::text);
insert into results values ('real', 'guard off: no email row exists', '0', (select count(*)::text from public.notifications where template = 'directory_partner_recheck_notice' and payload ->> 'to_email' like '%@example.invalid'));
select pg_temp.guard('directory_partner_stale_email', true);
do $$ declare n integer; begin n := private.directory_chase_notices(); insert into results values ('real', 'guard on: stale and never-verified labs with a contact are noticed (at least 2)', 'true', (n >= 2)::text); end $$;
insert into results values ('real', 'the stale lab is emailed at its contact', '1',
  (select count(*)::text from public.notifications where template = 'directory_partner_recheck_notice' and payload ->> 'to_email' = 'lab-a@s80dsc-labs.test' and channel = 'email'));
insert into results values ('real', 'the notice is non-clinical and pending', 'non_clinical,pending',
  (select content_class::text || ',' || status::text from public.notifications where template = 'directory_partner_recheck_notice' and payload ->> 'to_email' = 'lab-a@s80dsc-labs.test'));
insert into results values ('real', 'the notice carries no patient detail (only listing, date, audience, address)', 'audience,last_checked,listing_name,to_email',
  (select string_agg(k, ',' order by k) from (select jsonb_object_keys(payload) k from public.notifications where template = 'directory_partner_recheck_notice' and payload ->> 'to_email' = 'lab-a@s80dsc-labs.test') z));
insert into results values ('real', 'the fresh lab is not emailed', '0',
  (select count(*)::text from public.notifications where template = 'directory_partner_recheck_notice' and payload ->> 'to_email' = 'lab-c@s80dsc-labs.test'));
do $$
declare c1 bigint; c2 bigint;
begin
  select count(*) into c1 from public.notifications where payload ->> 'to_email' = 'lab-a@s80dsc-labs.test';
  perform private.directory_chase_notices();
  select count(*) into c2 from public.notifications where payload ->> 'to_email' = 'lab-a@s80dsc-labs.test';
  insert into results values ('real', 'a second run inside the repeat window queues nothing for the stale lab', '0', (c2 - c1)::text);
end $$;
insert into results values ('real', 'noticing a lab never deactivates it', 'true', (select is_active::text from public.lab_providers where id = pg_temp.f('a')));
select pg_temp.guard('directory_partner_stale_email', false);

-- 4. hide
select pg_temp.guard('directory_hide_stale_partners', false);
insert into results values ('real', 'guard off: all three labs are in the patient picker', 'S80dsc Lab A stale,S80dsc Lab B never,S80dsc Lab C fresh', pg_temp.picker_as(pg_temp.f('pat')));
select pg_temp.guard('directory_hide_stale_partners', true);
insert into results values ('real', 'guard on: the stale verified lab leaves the picker; never-verified and fresh stay', 'S80dsc Lab B never,S80dsc Lab C fresh', pg_temp.picker_as(pg_temp.f('pat')));
insert into results values ('real', 'hiding never deactivates the lab', 'true', (select is_active::text from public.lab_providers where id = pg_temp.f('a')));

-- SABOTAGE (a): the hide predicate is always false -> the stale lab comes back with the guard on
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('private.directory_hidden_by_staleness(text, uuid)'::regprocedure);
  v_def := replace(v_orig, 'select private.go_live_guard_on(''directory_hide_stale_partners'')', 'select false and private.go_live_guard_on(''directory_hide_stale_partners'')');
  if v_def = v_orig then raise exception 'SABOTAGE (a) not applied'; end if;
  execute v_def;
  insert into results values ('sabotaged', 'with the predicate broken the stale lab is in the picker again', 'S80dsc Lab B never,S80dsc Lab C fresh', pg_temp.picker_as(pg_temp.f('pat')));
  execute v_orig;
end $$;

-- SABOTAGE (b): the score is always 100 -> nobody is stale, no notice
select pg_temp.guard('directory_partner_stale_email', true);
update public.directory_freshness set last_partner_notice_on = null where listing_table = 'lab_providers' and listing_id = pg_temp.f('a');
do $$
declare v_orig text; v_def text; n integer;
begin
  v_orig := pg_get_functiondef('private.directory_freshness_score(timestamptz, integer)'::regprocedure);
  v_def := replace(v_orig, 'when p_last_verified_at is null or coalesce(p_cadence_months, 0) <= 0 then 0', 'when true then 100');
  if v_def = v_orig then raise exception 'SABOTAGE (b) not applied'; end if;
  execute v_def;
  delete from public.notifications where template = 'directory_partner_recheck_notice' and payload ->> 'to_email' = 'lab-a@s80dsc-labs.test';
  n := private.directory_chase_notices();
  insert into results values ('sabotaged', 'with the score broken nothing is noticed', '0', n::text);
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S80 directory staleness proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  -- a sabotage "flips" a check when the broken code gives a different answer from the intact one (the expected column)
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
