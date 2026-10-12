-- ===========================================================================
-- Verification: SR2a 20261013003534_sr2a_cron_history_cleanup
--
-- Proves private.cron_history_cleanup():
--   * deletes successful runs older than 7 days and keeps newer ones;
--   * keeps a failed run 20 days old (inside the 30 day window) and deletes one 40 days old;
--   * never deletes a run still marked 'running', however old;
--   * the schedule exists, daily, active, and is not callable by client roles;
--   * a failure inside the job opens exactly one sev3 technical incident, and a second failure does not open another;
--   * SABOTAGE: a clean-up that used the 7 day rule for failed runs too would delete the 20 day old failure,
--     so the "failed run kept" check discriminates.
--
-- Wrapped in BEGIN/ROLLBACK. Fixtures use jobid 999999 so no real job history is touched; the function is also run
-- against the real table, so the proof counts only its own fixture rows.
-- ===========================================================================
begin;
create temporary table p(check_name text, observed text, expected text, verdict text) on commit drop;

-- Fixture: five rows of known age/status. Real rows older than the window will also be removed by the run; that is
-- the function working and is rolled back at the end.
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
select 999999, id, 1, 'postgres', 'postgres', 'select 1', st, '', now() - age, now() - age
from (values
  (990000001::bigint, 'succeeded', interval '10 days'),
  (990000002::bigint, 'succeeded', interval '1 day'),
  (990000003::bigint, 'failed',    interval '20 days'),
  (990000004::bigint, 'failed',    interval '40 days'),
  (990000005::bigint, 'running',   interval '60 days')
) v(id, st, age);

select private.cron_history_cleanup(7, 30) is not null as ran \gset

create or replace function pg_temp.has(p_id bigint) returns boolean language sql as
$$ select exists (select 1 from cron.job_run_details where runid = p_id) $$;

insert into p values
  ('success run 10 days old is deleted',  pg_temp.has(990000001)::text, 'false', case when not pg_temp.has(990000001) then 'PASS' else 'FAIL' end),
  ('success run 1 day old is kept',       pg_temp.has(990000002)::text, 'true',  case when pg_temp.has(990000002) then 'PASS' else 'FAIL' end),
  ('failed run 20 days old is kept',      pg_temp.has(990000003)::text, 'true',  case when pg_temp.has(990000003) then 'PASS' else 'FAIL' end),
  ('failed run 40 days old is deleted',   pg_temp.has(990000004)::text, 'false', case when not pg_temp.has(990000004) then 'PASS' else 'FAIL' end),
  ('a run still marked running is never deleted', pg_temp.has(990000005)::text, 'true', case when pg_temp.has(990000005) then 'PASS' else 'FAIL' end);

-- Schedule and privileges.
insert into p
select 'job is scheduled daily and active', coalesce(schedule, '<none>') || '/' || coalesce(active::text, '<none>'), '17 3 * * */true',
       case when schedule = '17 3 * * *' and active then 'PASS' else 'FAIL' end
from (select 1) x left join cron.job j on j.jobname = 'cron-history-cleanup';

insert into p values
  ('anon cannot execute the clean-up', has_function_privilege('anon', 'private.cron_history_cleanup(integer, integer)', 'EXECUTE')::text, 'false',
   case when not has_function_privilege('anon', 'private.cron_history_cleanup(integer, integer)', 'EXECUTE') then 'PASS' else 'FAIL' end),
  ('authenticated cannot execute the clean-up', has_function_privilege('authenticated', 'private.cron_history_cleanup(integer, integer)', 'EXECUTE')::text, 'false',
   case when not has_function_privilege('authenticated', 'private.cron_history_cleanup(integer, integer)', 'EXECUTE') then 'PASS' else 'FAIL' end);

-- Failure path: invalid arguments raise inside the body; the handler must record one incident and return the error.
create temporary table pf(n_before int, res jsonb) on commit drop;
insert into pf select (select count(*) from public.ops_incidents where title = 'Scheduled clean-up of cron job history failed'),
                      private.cron_history_cleanup(0, 0);
insert into p
select 'a failing run opens one sev3 technical incident',
       (select count(*) from public.ops_incidents where title = 'Scheduled clean-up of cron job history failed' and severity = 'sev3' and category = 'technical')::text,
       '1',
       case when (select count(*) from public.ops_incidents where title = 'Scheduled clean-up of cron job history failed' and severity = 'sev3' and category = 'technical') = 1 then 'PASS' else 'FAIL' end;
insert into p select 'the failing run returns the error instead of raising', (res ? 'error')::text, 'true', case when res ? 'error' then 'PASS' else 'FAIL' end from pf;

select private.cron_history_cleanup(0, 0);
insert into p
select 'a second failure does not open a second incident',
       (select count(*) from public.ops_incidents where title = 'Scheduled clean-up of cron job history failed')::text, '1',
       case when (select count(*) from public.ops_incidents where title = 'Scheduled clean-up of cron job history failed') = 1 then 'PASS' else 'FAIL' end;

-- SABOTAGE: apply the wrong rule (7 days for failed runs too) to a fresh failed fixture; it must be deleted,
-- proving the "failed run 20 days old is kept" check above can fail.
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
values (999999, 990000006, 1, 'postgres', 'postgres', 'select 1', 'failed', '', now() - interval '20 days', now() - interval '20 days');
delete from cron.job_run_details where status is distinct from 'running' and coalesce(end_time, start_time) < now() - interval '7 days' and runid = 990000006;
insert into p values
  ('SABOTAGE: a 7 day rule on failed runs removes the 20 day old failure (test discriminates)',
   pg_temp.has(990000006)::text, 'false', case when not pg_temp.has(990000006) then 'PASS' else 'FAIL' end);

select * from p order by 1;
do $$ begin
  if exists (select 1 from pg_temp.p where verdict <> 'PASS') then
    raise exception 'sr2a_cron_history_cleanup: one or more checks failed';
  end if;
end $$;
rollback;
