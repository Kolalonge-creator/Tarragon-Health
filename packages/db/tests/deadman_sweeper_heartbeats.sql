-- ===========================================================================
-- Verification: 20261027083719_deadman_status_safety_sweeper_heartbeats
-- Proves, on a freshly replayed stack, what does not depend on pg_cron's run history (a fresh stack has none):
--   * public.deadman_status() still returns the four OQ-436 keys and now also the three counts and the problems object;
--   * it stays service_role only, and public.critical_cron_jobs is not readable by a client role;
--   * the allow-list is seeded; which names are not active cron jobs on this stack is printed for information only;
--   * adding a name that is not a cron job raises the missing count by exactly one and names it.
-- The stale and failing rules need run history and are proved separately on a scratch Postgres with stand-in cron tables
-- (14 checks including "an unknown slice is not stale"); that script is described in the PR, it cannot run here.
-- SABOTAGE: the function is replaced inside the transaction by one that omits the new keys; the key checks must then flip.
-- BEGIN/ROLLBACK.
-- ===========================================================================
begin;
create temporary table p(check_name text, observed text, expected text, verdict text) on commit drop;

create temporary table base as select public.deadman_status(300) s;

insert into p select 'original four keys still present',
  (s ? 'process_events_heartbeat_age_seconds' and s ? 'due_unclaimed_deliveries' and s ? 'dead_letter_deliveries' and s ? 'open_sev1_sev2_incidents')::text, 'true',
  case when s ? 'process_events_heartbeat_age_seconds' and s ? 'due_unclaimed_deliveries' and s ? 'dead_letter_deliveries' and s ? 'open_sev1_sev2_incidents' then 'PASS' else 'FAIL' end from base;
insert into p select 'the three counts and the problems object are present',
  (s ? 'stale_critical_cron_jobs' and s ? 'failing_critical_cron_jobs' and s ? 'missing_critical_cron_jobs' and s ? 'critical_cron_job_problems')::text, 'true',
  case when s ? 'stale_critical_cron_jobs' and s ? 'failing_critical_cron_jobs' and s ? 'missing_critical_cron_jobs' and s ? 'critical_cron_job_problems' then 'PASS' else 'FAIL' end from base;
insert into p select 'the counts are non-negative integers',
  (s ->> 'stale_critical_cron_jobs') || '/' || (s ->> 'failing_critical_cron_jobs') || '/' || (s ->> 'missing_critical_cron_jobs'), '>= 0 each',
  case when (s ->> 'stale_critical_cron_jobs')::int >= 0 and (s ->> 'failing_critical_cron_jobs')::int >= 0 and (s ->> 'missing_critical_cron_jobs')::int >= 0 then 'PASS' else 'FAIL' end from base;

insert into p values
 ('anon cannot call', has_function_privilege('anon', 'public.deadman_status(integer)', 'EXECUTE')::text, 'false',
  case when not has_function_privilege('anon', 'public.deadman_status(integer)', 'EXECUTE') then 'PASS' else 'FAIL' end),
 ('authenticated cannot call', has_function_privilege('authenticated', 'public.deadman_status(integer)', 'EXECUTE')::text, 'false',
  case when not has_function_privilege('authenticated', 'public.deadman_status(integer)', 'EXECUTE') then 'PASS' else 'FAIL' end),
 ('service_role can call', has_function_privilege('service_role', 'public.deadman_status(integer)', 'EXECUTE')::text, 'true',
  case when has_function_privilege('service_role', 'public.deadman_status(integer)', 'EXECUTE') then 'PASS' else 'FAIL' end),
 ('anon cannot read the allow-list', has_table_privilege('anon', 'public.critical_cron_jobs', 'SELECT')::text, 'false',
  case when not has_table_privilege('anon', 'public.critical_cron_jobs', 'SELECT') then 'PASS' else 'FAIL' end),
 ('authenticated cannot read the allow-list', has_table_privilege('authenticated', 'public.critical_cron_jobs', 'SELECT')::text, 'false',
  case when not has_table_privilege('authenticated', 'public.critical_cron_jobs', 'SELECT') then 'PASS' else 'FAIL' end),
 ('row level security is on', (select relrowsecurity from pg_class where oid = 'public.critical_cron_jobs'::regclass)::text, 'true',
  case when (select relrowsecurity from pg_class where oid = 'public.critical_cron_jobs'::regclass) then 'PASS' else 'FAIL' end);

insert into p select 'the allow-list is seeded with the eleven fast sweepers', count(*)::text, '>= 11', case when count(*) >= 11 then 'PASS' else 'FAIL' end
  from public.critical_cron_jobs;
insert into p select 'no listed allowance exceeds what the 6000 row slice can cover (170 minutes)', max(max_silence_minutes)::text, '<= 170',
  case when max(max_silence_minutes) <= 170 then 'PASS' else 'FAIL' end from public.critical_cron_jobs;

-- Which listed names are not an active cron.job on this stack. Informational only (a fresh stack may schedule jobs conditionally, so this
-- cannot fail the replay); on production an unknown name shows as a degraded "missing" check, which is the real signal.
insert into p select 'info: listed jobs with no active cron.job on this stack (' || coalesce(string_agg(c.job_name, ', ' order by c.job_name), 'none') || ')',
  count(*)::text, 'any', 'PASS'
  from public.critical_cron_jobs c where not exists (select 1 from cron.job j where j.jobname = c.job_name and j.active);

-- a job added to the allow-list that does not exist is reported missing (the function does see the allow-list)
insert into public.critical_cron_jobs (job_name, max_silence_minutes, why) values ('proof-job-that-does-not-exist', 10, 'proof fixture');
insert into p select 'a listed job with no cron.job is counted missing (+1 over the baseline) and named',
  ((public.deadman_status(300) ->> 'missing_critical_cron_jobs')::int - (b.s ->> 'missing_critical_cron_jobs')::int)::text, '1',
  case when (public.deadman_status(300) ->> 'missing_critical_cron_jobs')::int - (b.s ->> 'missing_critical_cron_jobs')::int = 1
        and (public.deadman_status(300) -> 'critical_cron_job_problems' -> 'missing') ? 'proof-job-that-does-not-exist' then 'PASS' else 'FAIL' end from base b;

-- SABOTAGE: a function without the new keys; the key checks must then fail (the test discriminates)
create or replace function public.deadman_status(p_due_older_than_seconds integer default 300)
returns jsonb language sql stable security definer set search_path = ''
as $f$ select jsonb_build_object('due_unclaimed_deliveries', 0) $f$;
create temporary table sab as select public.deadman_status(300) s;
insert into p select 'SABOTAGE: without the new keys the presence check fails (test discriminates)',
  (s ? 'missing_critical_cron_jobs')::text, 'false', case when not (s ? 'missing_critical_cron_jobs') then 'PASS' else 'FAIL' end from sab;

select * from p order by 1;
do $$ begin
  if exists (select 1 from pg_temp.p where verdict <> 'PASS') then raise exception 'deadman_sweeper_heartbeats: one or more checks failed'; end if;
end $$;
rollback;
