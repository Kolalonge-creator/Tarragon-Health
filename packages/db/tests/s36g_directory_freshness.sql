-- S36g proof: directory and partner freshness (spec 25.3, 25.9).
--   1. Only the manage permission for a kind of listing may record a verification (ops view alone, a clinician, a patient and anon cannot).
--   2. A note of 10+ characters is required; a refused record writes nothing.
--   3. Recording sets next due from the configured cadence (12 months, 6 for pharmacies), appends history and audits it.
--   4. History is append-only. A never-verified listing shows as never_verified.
--   5. A listing past its date is flagged overdue and marked stale by the sweep, the admin is told once (in-app, neutral), and
--      NOTHING is hidden or switched off (is_active unchanged, still listed).
--   6. Recording again moves next due and clears the stale mark.
--   SABOTAGE: (a) the overdue test in the read removed, (b) the stale marking in the sweep removed; each must flip a check.
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
  values (v, 's36g-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S36g ' || p_label, true)
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
declare v_org uuid; v_admin uuid; v_ops uuid; v_lab uuid; v_pharm uuid; v_doc uuid; v_pat uuid; v_lp uuid; v_pp uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_ops := pg_temp.mkuser(v_org, 'ops', 'finance');
  v_lab := pg_temp.mkuser(v_org, 'labmgr', 'finance');
  v_pharm := pg_temp.mkuser(v_org, 'pharmmgr', 'finance');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values
    (v_ops, 'ops.console.view', v_admin), (v_lab, 'partners.labs.manage', v_admin), (v_pharm, 'partners.pharmacies.manage', v_admin);
  insert into public.lab_providers (name, is_active) values ('S36g Test Lab', true) returning id into v_lp;
  insert into public.pharmacy_partners (name, is_active, onboarding_status) values ('S36g Test Pharmacy', true, 'activated') returning id into v_pp;
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('ops', v_ops); perform pg_temp.setf('labmgr', v_lab);
  perform pg_temp.setf('pharmmgr', v_pharm); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('lp', v_lp); perform pg_temp.setf('pp', v_pp);
end $$;

-- 1. never verified, and who can see
insert into results values ('real', 'a new listing is never_verified', 'never_verified', pg_temp.status_of(pg_temp.f('ops'), 'lab_providers', pg_temp.f('lp')));
insert into results values ('real', 'a clinician cannot read the list', 'ERR:42501', pg_temp.status_of(pg_temp.f('doc'), 'lab_providers', pg_temp.f('lp')));
insert into results values ('real', 'a patient cannot read the list', 'ERR:42501', pg_temp.status_of(pg_temp.f('pat'), 'lab_providers', pg_temp.f('lp')));
insert into results values ('real', 'anon cannot execute the list', 'ERR:42501', pg_temp.sql_anon($q$select * from public.directory_freshness_list()$q$));
insert into results values ('real', 'anon cannot record', 'ERR:42501',
  pg_temp.sql_anon(format($q$select public.record_directory_verification('lab_providers', %L, 'anon tries to record')$q$, pg_temp.f('lp'))));

-- 2. who may record
insert into results values ('real', 'ops with view only cannot record', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('ops'), format($q$select public.record_directory_verification('lab_providers', %L, 'ops tries to record it')$q$, pg_temp.f('lp'))));
insert into results values ('real', 'a clinician cannot record', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_directory_verification('lab_providers', %L, 'clinician tries to record')$q$, pg_temp.f('lp'))));
insert into results values ('real', 'a patient cannot record', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('pat'), format($q$select public.record_directory_verification('lab_providers', %L, 'patient tries to record')$q$, pg_temp.f('lp'))));
insert into results values ('real', 'the lab manager cannot record a pharmacy', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('labmgr'), format($q$select public.record_directory_verification('pharmacy_partners', %L, 'wrong kind of listing')$q$, pg_temp.f('pp'))));
insert into results values ('real', 'a short note is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('labmgr'), format($q$select public.record_directory_verification('lab_providers', %L, 'short')$q$, pg_temp.f('lp'))));
insert into results values ('real', 'an unknown listing is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('labmgr'), $q$select public.record_directory_verification('lab_providers', gen_random_uuid(), 'listing that does not exist')$q$));
insert into results values ('real', 'a refused record wrote no history', '0',
  (select count(*)::text from public.directory_verifications where listing_id in (pg_temp.f('lp'), pg_temp.f('pp'))));

-- 3. record
insert into results values ('real', 'the lab manager records a lab', 'ok',
  pg_temp.sql_as(pg_temp.f('labmgr'), format($q$select public.record_directory_verification('lab_providers', %L, 'phoned the lab and checked the opening hours and contacts')$q$, pg_temp.f('lp'))));
insert into results values ('real', 'the pharmacy manager records a pharmacy', 'ok',
  pg_temp.sql_as(pg_temp.f('pharmmgr'), format($q$select public.record_directory_verification('pharmacy_partners', %L, 'visited the premises and checked the licence on the wall')$q$, pg_temp.f('pp'))));
insert into results values ('real', 'a lab is due in 12 months', '12',
  (select (select m::text from generate_series(1, 24) m where (now() at time zone 'Africa/Lagos')::date + make_interval(months => m) = f.next_verification_due)
     from public.directory_freshness f where f.listing_id = pg_temp.f('lp')));
insert into results values ('real', 'a pharmacy is due in 6 months', '6',
  (select (select m::text from generate_series(1, 12) m where (now() at time zone 'Africa/Lagos')::date + make_interval(months => m) = f.next_verification_due)
     from public.directory_freshness f where f.listing_id = pg_temp.f('pp')));
insert into results values ('real', 'history holds one row per record', '2',
  (select count(*)::text from public.directory_verifications where listing_id in (pg_temp.f('lp'), pg_temp.f('pp'))));
insert into results values ('real', 'the record is audited', '2',
  (select count(*)::text from public.audit_log where action = 'directory.verification_recorded' and entity_id in (pg_temp.f('lp'), pg_temp.f('pp'))));
insert into results values ('real', 'a recorded lab reads as current', 'current', pg_temp.status_of(pg_temp.f('ops'), 'lab_providers', pg_temp.f('lp')));
insert into results values ('real', 'history cannot be changed', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('admin'), format($q$update public.directory_verifications set note = 'edited after the fact' where listing_id = %L$q$, pg_temp.f('lp'))));
do $$ begin
  begin
    delete from public.directory_verifications where listing_id = pg_temp.f('lp');
    insert into results values ('real', 'history cannot be deleted even by the table owner', 'ERR:42501', 'deleted');
  exception when others then
    insert into results values ('real', 'history cannot be deleted even by the table owner', 'ERR:42501', 'ERR:' || sqlstate);
  end;
end $$;

-- 4. overdue: age the lab's date (as the table owner), then the read, the sweep, the notice and the untouched listing
update public.directory_freshness set next_verification_due = current_date - 10 where listing_id = pg_temp.f('lp');
insert into results values ('real', 'a lab past its date reads overdue', 'overdue', pg_temp.status_of(pg_temp.f('ops'), 'lab_providers', pg_temp.f('lp')));
update public.directory_freshness set next_verification_due = current_date + 5 where listing_id = pg_temp.f('pp');
insert into results values ('real', 'a pharmacy due within 30 days reads due_soon', 'due_soon', pg_temp.status_of(pg_temp.f('ops'), 'pharmacy_partners', pg_temp.f('pp')));

delete from public.notifications where recipient_id = pg_temp.f('admin');
select private.directory_freshness_sweep();
insert into results values ('real', 'the sweep marks the overdue lab stale', 'true',
  (select is_stale::text from public.directory_freshness where listing_id = pg_temp.f('lp')));
insert into results values ('real', 'the sweep does not mark a current pharmacy stale', 'false',
  (select is_stale::text from public.directory_freshness where listing_id = pg_temp.f('pp')));
insert into results values ('real', 'ops is told once, in app', '1',
  (select count(*)::text from public.notifications where recipient_id = pg_temp.f('admin') and template = 'directory_freshness_overdue' and channel = 'in_app'));
insert into results values ('real', 'the notice is never SMS or email', '0',
  (select count(*)::text from public.notifications where template = 'directory_freshness_overdue' and channel in ('sms', 'email')));
insert into results values ('real', 'the notice carries no clinical content', 'true',
  (select bool_and(content_class = 'non_clinical' and payload ->> 'message' !~* '(patient|result|reading|diagnos)') from public.notifications where template = 'directory_freshness_overdue' and recipient_id = pg_temp.f('admin')));
select private.directory_freshness_sweep();
insert into results values ('real', 'a second sweep does not tell ops again', '1',
  (select count(*)::text from public.notifications where recipient_id = pg_temp.f('admin') and template = 'directory_freshness_overdue'));
insert into results values ('real', 'nothing was switched off by the sweep', 'true',
  (select is_active::text from public.lab_providers where id = pg_temp.f('lp')));
insert into results values ('real', 'the overdue listing is still listed (not hidden)', 'overdue', pg_temp.status_of(pg_temp.f('ops'), 'lab_providers', pg_temp.f('lp')));

-- 5. recording again moves next due and clears stale
insert into results values ('real', 'the lab manager records again', 'ok',
  pg_temp.sql_as(pg_temp.f('labmgr'), format($q$select public.record_directory_verification('lab_providers', %L, 'rechecked the contacts and the licence number')$q$, pg_temp.f('lp'))));
insert into results values ('real', 'the next due date moved forward', 'true',
  (select (next_verification_due > current_date + 300)::text from public.directory_freshness where listing_id = pg_temp.f('lp')));
insert into results values ('real', 'the stale mark was cleared', 'false',
  (select is_stale::text from public.directory_freshness where listing_id = pg_temp.f('lp')));
insert into results values ('real', 'history now holds both records for the lab', '2',
  (select count(*)::text from public.directory_verifications where listing_id = pg_temp.f('lp')));

-- SABOTAGE (a): the overdue test removed from the read
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('public.directory_freshness_list()'::regprocedure);
  v_def := replace(v_orig, 'when f.next_verification_due < current_date then ''overdue''', 'when false then ''overdue''');
  if v_def = v_orig then raise exception 'SABOTAGE (a) not applied'; end if;
  execute v_def;
  update public.directory_freshness set next_verification_due = current_date - 10 where listing_id = pg_temp.f('lp');
  insert into results values ('sabotaged', 'a lab past its date reads overdue', 'overdue', pg_temp.status_of(pg_temp.f('ops'), 'lab_providers', pg_temp.f('lp')));
  execute v_orig;
end $$;

-- SABOTAGE (b): the stale marking removed from the sweep
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('private.directory_freshness_sweep()'::regprocedure);
  v_def := replace(v_orig, 'set is_stale = (f.next_verification_due is not null and f.next_verification_due < current_date)', 'set is_stale = false');
  if v_def = v_orig then raise exception 'SABOTAGE (b) not applied'; end if;
  execute v_def;
  update public.directory_freshness set is_stale = false, stale_since = null where listing_id = pg_temp.f('lp');
  perform private.directory_freshness_sweep();
  insert into results values ('sabotaged', 'the sweep marks the overdue lab stale', 'true',
    (select is_stale::text from public.directory_freshness where listing_id = pg_temp.f('lp')));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S36g proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
