-- SR2a: scheduled clean-up of pg_cron's own run history.
--
-- COUNT FIRST (read-only, live project koiplnmbgnqnbywhpjlf, 2026-10-12): cron.job_run_details held 377,797 rows
-- (182 MB incl. indexes, oldest 2026-07-06), the largest object in the database. 112 active jobs, 7 of them every
-- minute or faster, so it grows by about 4,000 rows a day and by far more as jobs are added. Nothing in the
-- application reads this table (grep: only a 2026-09-02 migration comment), and the stuck-job alert planned in SR5
-- must be built on a heartbeat of its own, not on this history.
--
-- RULE (founder asked 2026-10-12, plan section 3 Phase 1 item 1): keep 7 days of successful runs and 30 days of
-- failed runs, delete the rest, once a day. Pure operational history, no patient data, no audit_log involvement.
-- Mirrored as PROPOSED config key db.cron_history_retention (packages/shared/src/proposed-config); the function
-- takes the two numbers as arguments so a change of policy is a config edit plus one cron command, not a rewrite.
--
-- net._http_response (pg_net) needs no job: pg_net deletes its own rows after pg_net.ttl (6 hours by default);
-- live shows 1,973 rows, the oldest from today. Documented in docs/design/SR3-table-growth-and-retention.md.
--
-- FAILURE IS NOT SILENT: any error inside the clean-up opens a sev3 technical incident in public.ops_incidents
-- (one open incident at a time, so a daily failure does not pile up rows). It does NOT re-raise: raising would roll
-- back the incident insert with the transaction. The job then reports success to cron with an 'error' key in its
-- result, and the incident is the durable signal.
--
-- ROLLBACK: select cron.unschedule('cron-history-cleanup'); drop function private.cron_history_cleanup(integer, integer);
-- Deleted history is not recoverable and not needed.

create or replace function private.cron_history_cleanup(
  p_keep_days integer default 7,
  p_keep_failed_days integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch constant integer := 20000;
  v_deleted_ok bigint := 0;
  v_deleted_failed bigint := 0;
  v_n bigint;
begin
  if p_keep_days < 1 or p_keep_failed_days < p_keep_days then
    raise exception 'cron_history_cleanup: keep_days must be >= 1 and keep_failed_days >= keep_days (got %, %)',
      p_keep_days, p_keep_failed_days;
  end if;

  -- Successful (and any non-failed, finished) runs.
  loop
    delete from cron.job_run_details
    where runid in (
      select runid from cron.job_run_details
      where status is distinct from 'failed'
        and status is distinct from 'running'
        and coalesce(end_time, start_time) < now() - make_interval(days => p_keep_days)
      limit v_batch
    );
    get diagnostics v_n = row_count;
    v_deleted_ok := v_deleted_ok + v_n;
    exit when v_n < v_batch;
  end loop;

  -- Failed runs are kept longer: they are the evidence an on-call person looks for.
  loop
    delete from cron.job_run_details
    where runid in (
      select runid from cron.job_run_details
      where status = 'failed'
        and coalesce(end_time, start_time) < now() - make_interval(days => p_keep_failed_days)
      limit v_batch
    );
    get diagnostics v_n = row_count;
    v_deleted_failed := v_deleted_failed + v_n;
    exit when v_n < v_batch;
  end loop;

  return jsonb_build_object('deleted_ok', v_deleted_ok, 'deleted_failed', v_deleted_failed);
exception when others then
  -- Record it where operations looks, once. The insert is itself guarded so a broken register cannot hide the
  -- original error: the error is always returned.
  begin
    if not exists (
      select 1 from public.ops_incidents
      where title = 'Scheduled clean-up of cron job history failed'
        and status in ('open', 'investigating')
    ) then
      insert into public.ops_incidents (category, severity, title, summary)
      values ('technical', 'sev3', 'Scheduled clean-up of cron job history failed',
              'private.cron_history_cleanup raised SQLSTATE ' || sqlstate || ': ' || left(sqlerrm, 500)
              || '. cron.job_run_details will keep growing until this is fixed.');
    end if;
  exception when others then
    raise warning 'cron_history_cleanup: could not record incident: %', sqlerrm;
  end;
  return jsonb_build_object('error', sqlstate || ': ' || left(sqlerrm, 200));
end;
$$;

-- Callable by nobody but the owner (the cron worker runs as postgres). PUBLIC is where anon inherits EXECUTE from.
revoke all on function private.cron_history_cleanup(integer, integer) from public, anon, authenticated;

-- Idempotent schedule: replace any earlier job of the same name. 03:17 UTC, off the minute marks the sweeps use.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cron-history-cleanup';
  perform cron.schedule('cron-history-cleanup', '17 3 * * *', $c$select private.cron_history_cleanup(7, 30)$c$);
end $$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'cron-history-cleanup' and schedule = '17 3 * * *' and active) then
    raise exception 'SR2a: cron-history-cleanup is not scheduled';
  end if;
  if has_function_privilege('anon', 'private.cron_history_cleanup(integer, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.cron_history_cleanup(integer, integer)', 'EXECUTE') then
    raise exception 'SR2a: cron_history_cleanup is callable by a client role';
  end if;
end $$;
