-- S80 C4 proof (S-19, 25.3 / 25.9): directory freshness covers branches, patients see "last checked", a complaint can force a re-check.
--   1. Branch tables (lab, pharmacy) are listed with their parent's name; only that kind's manage permission records one; a pharmacy
--      branch is due in 6 months, a lab branch in 12; a branch of an inactive parent is not listed.
--   2. directory_last_checked returns a date and an overdue flag only, refuses anon, a signed-out caller and a non lab/pharmacy table.
--   3. request_directory_recheck needs the manage permission and a reason, marks a verified listing overdue and stale, audits it,
--      is a no-op on a never-verified listing, and never changes is_active (stale is a notice, never deactivation).
--   4. The private re-check function is not executable by authenticated or anon.
--   SABOTAGE: (a) the re-check stops marking the listing stale, (b) the patient read stops reporting overdue; each must flip a check.
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
  values (v, 's80c4-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S80c4 ' || p_label, true)
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
declare v_org uuid; v_admin uuid; v_ops uuid; v_lab uuid; v_pharm uuid; v_pat uuid; v_lp uuid; v_ll uuid; v_pp uuid; v_pl uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation: the proof needs seed.sql'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_ops := pg_temp.mkuser(v_org, 'ops', 'finance');
  v_lab := pg_temp.mkuser(v_org, 'labmgr', 'finance');
  v_pharm := pg_temp.mkuser(v_org, 'pharmmgr', 'finance');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values
    (v_ops, 'ops.console.view', v_admin), (v_lab, 'partners.labs.manage', v_admin), (v_pharm, 'partners.pharmacies.manage', v_admin);
  insert into public.lab_providers (name, is_active) values ('S80c4 Lab', true) returning id into v_lp;
  insert into public.lab_provider_locations (lab_provider_id, name, state, address) values (v_lp, 'Yaba branch', 'Lagos', '1 Test Road') returning id into v_ll;
  insert into public.pharmacy_partners (name, is_active, onboarding_status) values ('S80c4 Pharmacy', true, 'activated') returning id into v_pp;
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state) values (v_pp, 'Ikeja branch', 'Lagos') returning id into v_pl;
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('ops', v_ops); perform pg_temp.setf('labmgr', v_lab);
  perform pg_temp.setf('pharmmgr', v_pharm); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('lp', v_lp); perform pg_temp.setf('ll', v_ll); perform pg_temp.setf('pp', v_pp); perform pg_temp.setf('pl', v_pl);
end $$;

-- as a patient: rows from the last-checked read as json text
create function pg_temp.lc_as(p_uid uuid, p_table text, p_id uuid) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  begin
    select coalesce(json_agg(t)::text, '[]') into r from public.directory_last_checked(p_table, array[p_id]) t;
  exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;

-- 1. branches covered
insert into results values ('real', 'a lab branch is listed, never verified', 'never_verified', pg_temp.status_of(pg_temp.f('ops'), 'lab_provider_locations', pg_temp.f('ll')));
insert into results values ('real', 'a pharmacy branch is listed, never verified', 'never_verified', pg_temp.status_of(pg_temp.f('ops'), 'pharmacy_partner_locations', pg_temp.f('pl')));
insert into results values ('real', 'the branch name carries its parent', 'Yaba branch (S80c4 Lab)',
  (select name from private.directory_listings() where listing_table = 'lab_provider_locations' and listing_id = pg_temp.f('ll')));
insert into results values ('real', 'the pharmacy manager cannot record a lab branch', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('pharmmgr'), format($q$select public.record_directory_verification('lab_provider_locations', %L, 'wrong kind of listing here')$q$, pg_temp.f('ll'))));
insert into results values ('real', 'the ops viewer cannot record a branch', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('ops'), format($q$select public.record_directory_verification('lab_provider_locations', %L, 'view only is not enough')$q$, pg_temp.f('ll'))));
insert into results values ('real', 'a patient cannot record a branch', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('pat'), format($q$select public.record_directory_verification('lab_provider_locations', %L, 'patient tries to record')$q$, pg_temp.f('ll'))));
insert into results values ('real', 'the lab manager records a lab branch', 'ok',
  pg_temp.sql_as(pg_temp.f('labmgr'), format($q$select public.record_directory_verification('lab_provider_locations', %L, 'phoned the branch and confirmed the address and hours')$q$, pg_temp.f('ll'))));
insert into results values ('real', 'the pharmacy manager records a pharmacy branch', 'ok',
  pg_temp.sql_as(pg_temp.f('pharmmgr'), format($q$select public.record_directory_verification('pharmacy_partner_locations', %L, 'visited the branch and saw the premises licence')$q$, pg_temp.f('pl'))));
insert into results values ('real', 'a lab branch is due in 12 months', '12',
  (select (select m::text from generate_series(1, 24) m where (now() at time zone 'Africa/Lagos')::date + make_interval(months => m) = f.next_verification_due)
     from public.directory_freshness f where f.listing_id = pg_temp.f('ll')));
insert into results values ('real', 'a pharmacy branch is due in 6 months', '6',
  (select (select m::text from generate_series(1, 12) m where (now() at time zone 'Africa/Lagos')::date + make_interval(months => m) = f.next_verification_due)
     from public.directory_freshness f where f.listing_id = pg_temp.f('pl')));
update public.lab_providers set is_active = false where id = pg_temp.f('lp');
insert into results values ('real', 'a branch of an inactive parent is not listed', 'absent', pg_temp.status_of(pg_temp.f('ops'), 'lab_provider_locations', pg_temp.f('ll')));
update public.lab_providers set is_active = true where id = pg_temp.f('lp');

-- 2. the patient read
insert into results values ('real', 'a patient reads one row for a checked branch', '1',
  (select json_array_length(pg_temp.lc_as(pg_temp.f('pat'), 'lab_provider_locations', pg_temp.f('ll'))::json)::text));
insert into results values ('real', 'the row carries exactly the date and the flag (no verifier, no note)', 'is_overdue,last_checked,listing_id',
  (select string_agg(k, ',' order by k) from json_object_keys((pg_temp.lc_as(pg_temp.f('pat'), 'lab_provider_locations', pg_temp.f('ll'))::json -> 0)) k));
insert into results values ('real', 'a current branch is not overdue', 'false',
  (pg_temp.lc_as(pg_temp.f('pat'), 'lab_provider_locations', pg_temp.f('ll'))::json -> 0 ->> 'is_overdue'));
insert into results values ('real', 'a never-checked listing returns nothing, not an invented date', '[]',
  pg_temp.lc_as(pg_temp.f('pat'), 'lab_providers', pg_temp.f('lp')));
insert into results values ('real', 'a non lab/pharmacy table is refused', 'ERR:22023', pg_temp.lc_as(pg_temp.f('pat'), 'facilities', pg_temp.f('lp')));
insert into results values ('real', 'anon cannot read it', 'ERR:42501',
  pg_temp.sql_anon(format($q$select * from public.directory_last_checked('lab_provider_locations', array[%L::uuid])$q$, pg_temp.f('ll'))));
insert into results values ('real', 'anon cannot request a re-check', 'ERR:42501',
  pg_temp.sql_anon(format($q$select public.request_directory_recheck('lab_provider_locations', %L, 'anon tries a recheck')$q$, pg_temp.f('ll'))));

-- 3. the re-check
insert into results values ('real', 'a patient cannot request a re-check', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('pat'), format($q$select public.request_directory_recheck('lab_provider_locations', %L, 'patient tries a recheck')$q$, pg_temp.f('ll'))));
insert into results values ('real', 'the ops viewer cannot request a re-check', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('ops'), format($q$select public.request_directory_recheck('lab_provider_locations', %L, 'view only is not enough')$q$, pg_temp.f('ll'))));
insert into results values ('real', 'the pharmacy manager cannot re-check a lab branch', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('pharmmgr'), format($q$select public.request_directory_recheck('lab_provider_locations', %L, 'wrong kind of listing here')$q$, pg_temp.f('ll'))));
insert into results values ('real', 'a short reason is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('labmgr'), format($q$select public.request_directory_recheck('lab_provider_locations', %L, 'short')$q$, pg_temp.f('ll'))));
insert into results values ('real', 'an unknown listing is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('labmgr'), $q$select public.request_directory_recheck('lab_provider_locations', gen_random_uuid(), 'listing that does not exist')$q$));
insert into results values ('real', 'refused requests changed nothing', 'current', pg_temp.status_of(pg_temp.f('ops'), 'lab_provider_locations', pg_temp.f('ll')));
insert into results values ('real', 'the lab manager requests a re-check', 'ok',
  pg_temp.sql_as(pg_temp.f('labmgr'), format($q$select public.request_directory_recheck('lab_provider_locations', %L, 'two patients complained about the opening hours')$q$, pg_temp.f('ll'))));
insert into results values ('real', 'the branch now reads overdue', 'overdue', pg_temp.status_of(pg_temp.f('ops'), 'lab_provider_locations', pg_temp.f('ll')));
insert into results values ('real', 'it is marked stale', 'true', (select is_stale::text from public.directory_freshness where listing_id = pg_temp.f('ll')));
insert into results values ('real', 'the patient read now says overdue', 'true',
  (pg_temp.lc_as(pg_temp.f('pat'), 'lab_provider_locations', pg_temp.f('ll'))::json -> 0 ->> 'is_overdue'));
insert into results values ('real', 'the request is audited with its reason', '1',
  (select count(*)::text from public.audit_log where action = 'directory.recheck_requested' and entity_id = pg_temp.f('ll')
     and event ->> 'reason' like 'two patients%'));
insert into results values ('real', 'the branch is still active and still listed (a notice only)', 'true',
  (select (l.is_active and p.is_active)::text from public.lab_provider_locations l join public.lab_providers p on p.id = l.lab_provider_id where l.id = pg_temp.f('ll')));
insert into results values ('real', 'a re-check on a never-verified listing changes nothing', 'false',
  (select private.directory_request_recheck('lab_providers', pg_temp.f('lp'), 'never verified listing')::text));
insert into results values ('real', 'the private function is not executable by authenticated', 'false',
  (select has_function_privilege('authenticated', 'private.directory_request_recheck(text, uuid, text)', 'EXECUTE')::text));
insert into results values ('real', 'the private function is not executable by anon', 'false',
  (select has_function_privilege('anon', 'private.directory_request_recheck(text, uuid, text)', 'EXECUTE')::text));
insert into results values ('real', 'recording again clears the re-check', 'current', (
  select case when pg_temp.sql_as(pg_temp.f('labmgr'), format($q$select public.record_directory_verification('lab_provider_locations', %L, 'rechecked by phone, all details confirmed')$q$, pg_temp.f('ll'))) = 'ok'
              then pg_temp.status_of(pg_temp.f('ops'), 'lab_provider_locations', pg_temp.f('ll')) else 'record failed' end));

-- SABOTAGE (a): the re-check no longer marks the listing overdue
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('private.directory_request_recheck(text, uuid, text)'::regprocedure);
  v_def := replace(v_orig, 'next_verification_due = current_date - 1', 'next_verification_due = f.next_verification_due');
  if v_def = v_orig then raise exception 'SABOTAGE (a) not applied'; end if;
  execute v_def;
  perform private.directory_request_recheck('lab_provider_locations', pg_temp.f('ll'), 'sabotaged re-check');
  insert into results values ('sabotaged', 'the branch now reads overdue', 'overdue', pg_temp.status_of(pg_temp.f('ops'), 'lab_provider_locations', pg_temp.f('ll')));
  execute v_orig;
end $$;

-- SABOTAGE (b): the patient read stops reporting overdue
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('public.directory_last_checked(text, uuid[])'::regprocedure);
  v_def := replace(v_orig, 'f.next_verification_due < current_date', 'false');
  if v_def = v_orig then raise exception 'SABOTAGE (b) not applied'; end if;
  execute v_def;
  perform private.directory_request_recheck('lab_provider_locations', pg_temp.f('ll'), 'sabotage b setup');
  insert into results values ('sabotaged', 'the patient read now says overdue', 'true',
    (pg_temp.lc_as(pg_temp.f('pat'), 'lab_provider_locations', pg_temp.f('ll'))::json -> 0 ->> 'is_overdue'));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S80 C4 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
