-- S80 C5 proof (25.8): the automations registry and the guarded pause.
--   1. Only an admin or an ops viewer reads the list (clinician, patient, anon refused); only an admin pauses (ops viewer refused).
--   2. Pausing a pg_cron job really sets cron.job.active = false, records who/when/why, audits it; resuming reverses it.
--   3. The eight mandated safety jobs (and every job flagged safety_critical) cannot be paused; a short reason, an unknown job and a
--      Vercel cron are refused; nothing changed after a refusal.
--   4. A pg_cron job missing from the registry shows as unregistered; owners are 'unassigned' (none invented); no direct table write.
--   SABOTAGE: (a) the safety_critical refusal removed, (b) the cron.alter_job call removed; each must flip a check.
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
  values (v, 's80c5-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S80c5 ' || p_label, true)
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
declare v_org uuid; v_admin uuid; v_ops uuid; v_doc uuid; v_pat uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation: the proof needs seed.sql'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_ops := pg_temp.mkuser(v_org, 'ops', 'finance');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_ops, 'ops.console.view', v_admin);
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('ops', v_ops); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('pat', v_pat);
end $$;

create function pg_temp.pause_as(p_uid uuid, p_job text, p_paused boolean, p_reason text) returns text language plpgsql as $f$
begin
  return pg_temp.sql_as(p_uid, format('select public.set_automation_paused(%L, %L, %L)', p_job, p_paused, p_reason));
end $f$;
create function pg_temp.active_of(p_job text) returns text language sql as $$ select active::text from cron.job where jobname = p_job $$;
create function pg_temp.list_as(p_uid uuid, p_job text) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  begin
    select case when l.is_paused then 'paused' else 'running' end || '/' || case when l.registered then 'registered' else 'unregistered' end into r
      from public.automations_list() l where l.job_name = p_job;
  exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return coalesce(r, 'absent');
end $f$;

-- 1. who reads, who pauses
insert into results values ('real', 'admin reads the list', 'running/registered', pg_temp.list_as(pg_temp.f('admin'), 'care-circle-expiry'));
insert into results values ('real', 'ops viewer reads the list', 'running/registered', pg_temp.list_as(pg_temp.f('ops'), 'care-circle-expiry'));
insert into results values ('real', 'a clinician cannot read the list', 'ERR:42501', pg_temp.list_as(pg_temp.f('doc'), 'care-circle-expiry'));
insert into results values ('real', 'a patient cannot read the list', 'ERR:42501', pg_temp.list_as(pg_temp.f('pat'), 'care-circle-expiry'));
insert into results values ('real', 'anon cannot read the list', 'ERR:42501', pg_temp.sql_anon($q$select * from public.automations_list()$q$));
insert into results values ('real', 'ops viewer cannot pause', 'ERR:42501', pg_temp.pause_as(pg_temp.f('ops'), 'care-circle-expiry', true, 'ops viewer tries to pause'));
insert into results values ('real', 'a clinician cannot pause', 'ERR:42501', pg_temp.pause_as(pg_temp.f('doc'), 'care-circle-expiry', true, 'clinician tries to pause'));
insert into results values ('real', 'a patient cannot pause', 'ERR:42501', pg_temp.pause_as(pg_temp.f('pat'), 'care-circle-expiry', true, 'patient tries to pause'));
insert into results values ('real', 'anon cannot pause', 'ERR:42501', pg_temp.sql_anon($q$select public.set_automation_paused('care-circle-expiry', true, 'anon tries to pause')$q$));
insert into results values ('real', 'authenticated cannot write the table directly', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('admin'), $q$update public.automations set is_paused = true where job_name = 'care-circle-expiry'$q$));
insert into results values ('real', 'refusals left the job running', 'true', pg_temp.active_of('care-circle-expiry'));

-- 2. a real pause and resume
-- review fix 2 (20261007160301): default-deny. A job nobody has marked pausable cannot be paused; a person marks it. The proof marks the two routine jobs it pauses.
insert into results values ('real', 'a job nobody has marked pausable is refused (default-deny)', 'ERR:23514', pg_temp.pause_as(pg_temp.f('admin'), 'care-circle-expiry', true, 'paused while the circle copy is reviewed'));
update public.automations set pausable = true where job_name in ('care-circle-expiry', 'care-circle-gift-expiry', '/api/cron/fraud-sweep');
insert into results values ('real', 'a short reason is refused', 'ERR:22023', pg_temp.pause_as(pg_temp.f('admin'), 'care-circle-expiry', true, 'short'));
insert into results values ('real', 'admin pauses a routine job', 'ok', pg_temp.pause_as(pg_temp.f('admin'), 'care-circle-expiry', true, 'paused while the circle copy is reviewed'));
insert into results values ('real', 'the cron job is really inactive', 'false', pg_temp.active_of('care-circle-expiry'));
insert into results values ('real', 'the list shows it paused', 'paused/registered', pg_temp.list_as(pg_temp.f('admin'), 'care-circle-expiry'));
insert into results values ('real', 'who, when and why are recorded', 'true',
  (select (paused_by = pg_temp.f('admin') and paused_at is not null and reason like 'paused while%')::text from public.automations where job_name = 'care-circle-expiry'));
insert into results values ('real', 'the pause is audited', '1', (select count(*)::text from public.audit_log where action = 'automation.paused' and event ->> 'job_name' = 'care-circle-expiry'));
insert into results values ('real', 'admin resumes it', 'ok', pg_temp.pause_as(pg_temp.f('admin'), 'care-circle-expiry', false, ''));
insert into results values ('real', 'the cron job is active again', 'true', pg_temp.active_of('care-circle-expiry'));
insert into results values ('real', 'the resume is audited', '1', (select count(*)::text from public.audit_log where action = 'automation.resumed' and event ->> 'job_name' = 'care-circle-expiry'));

-- 3. refusals
insert into results values ('real', 'every one of the eight mandated safety jobs is flagged', '8',
  (select count(*)::text from public.automations where safety_critical and job_name in ('sweep-pages', 'process-events', 'sweep-clinical-tasks', 'expire-task-claims',
     'send-pending-notifications', 'credential-expiry-sweep', 'quality-audit-sweep', 'data-breach-deadline-alerts-daily')));
insert into results values ('real', 'the safety-critical jobs cannot be paused', '0',
  (select count(*)::text from public.automations a where a.safety_critical and a.source = 'pg_cron'
     and pg_temp.pause_as(pg_temp.f('admin'), a.job_name, true, 'trying to pause a safety job') = 'ok'));
insert into results values ('real', 'safety-critical refusal is a check violation', 'ERR:23514', pg_temp.pause_as(pg_temp.f('admin'), 'sweep-pages', true, 'trying to pause paging'));
insert into results values ('real', 'safety-critical jobs are all still active', '0', (select count(*)::text from public.automations a join cron.job j on j.jobname = a.job_name where a.safety_critical and not j.active));
insert into results values ('real', 'a Vercel cron cannot be paused here', 'ERR:0A000', pg_temp.pause_as(pg_temp.f('admin'), '/api/cron/fraud-sweep', true, 'trying to pause a vercel job'));
insert into results values ('real', 'an unknown job is refused', 'ERR:22023', pg_temp.pause_as(pg_temp.f('admin'), 'no-such-job', true, 'trying to pause nothing at all'));

-- 4. registry honesty
do $$ begin perform cron.schedule('s80c5-unregistered', '0 0 1 1 *', 'select 1'); end $$;
insert into results values ('real', 'a cron job outside the registry shows as unregistered', 'running/unregistered', pg_temp.list_as(pg_temp.f('admin'), 's80c5-unregistered'));
insert into results values ('real', 'an unregistered job cannot be paused until it is registered', 'ERR:22023', pg_temp.pause_as(pg_temp.f('admin'), 's80c5-unregistered', true, 'trying to pause an unregistered job'));
insert into results values ('real', 'no owner or purpose was invented', '0', (select count(*)::text from public.automations where owner <> 'unassigned' or purpose is not null));

-- SABOTAGE (a): the safety_critical refusal removed (both the function guard and the table CHECK behind it)
do $$
declare v_orig text; v_def text; v_c name;
begin
  v_orig := pg_get_functiondef('public.set_automation_paused(text, boolean, text)'::regprocedure);
  v_def := replace(v_orig, 'if p_paused and (v_row.safety_critical or not v_row.pausable) then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE (a) not applied'; end if;
  execute v_def;
  -- the table CHECK is a second layer; remove it too so the sabotage tests the function guard on its own merits
  for v_c in select conname from pg_constraint where conrelid = 'public.automations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%safety_critical%is_paused%' loop
    execute format('alter table public.automations drop constraint %I', v_c);
  end loop;
  insert into results values ('sabotaged', 'the safety-critical jobs cannot be paused', 'ERR:23514', pg_temp.pause_as(pg_temp.f('admin'), 'sweep-pages', true, 'sabotaged: pausing paging'));
  execute v_orig;
end $$;

-- SABOTAGE (b): the cron.alter_job call removed
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('public.set_automation_paused(text, boolean, text)'::regprocedure);
  v_def := replace(v_orig, 'perform cron.alter_job(v_jobid, active := not p_paused);', 'null;');
  if v_def = v_orig then raise exception 'SABOTAGE (b) not applied'; end if;
  execute v_def;
  insert into results values ('sabotaged', 'the cron job is really inactive', 'ok/false', pg_temp.pause_as(pg_temp.f('admin'), 'care-circle-gift-expiry', true, 'sabotaged: pause without cron') || '/' || pg_temp.active_of('care-circle-gift-expiry'));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S80 C5 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotages flipped a check: %', v_caught, (select string_agg(check_name || ' expected ' || expected || ' got ' || coalesce(actual,'null'), '; ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
