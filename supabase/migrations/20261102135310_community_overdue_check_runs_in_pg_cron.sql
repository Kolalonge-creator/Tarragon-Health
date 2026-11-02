-- The community "overdue work" check (safety signals, held posts and appeals waiting too long) ran only from a GitHub Actions
-- schedule (.github/workflows/community-overdue.yml, every 10 minutes). GitHub throttles scheduled workflows on busy repositories:
-- on 2026-11-01/02 it ran at 05:54, 12:41, 18:08, 21:58, 01:25 and 07:58 UTC, four to six hours apart, so the community guard's
-- own condition "the overdue-work check has run successfully in the last 45 minutes" was unmet for most of every day while the
-- guard was on, and nobody was told about overdue safety items for hours at a time.
--
-- The check now also runs inside the database every 10 minutes (pg_cron, like every other sweeper), calling the same two
-- functions the route calls and writing the same heartbeat. The GitHub workflow stays as a second, independent layer.

create or replace function private.community_overdue_run()
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_work jsonb;
  v_notified integer;
begin
  begin
    v_work := public.community_overdue_work();
    v_notified := public.community_notify_overdue();
    perform public.community_job_heartbeat('overdue', true);
  exception when others then
    perform public.community_job_heartbeat('overdue', false);
    raise warning 'community overdue check failed: %', sqlerrm;
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'work', v_work, 'notified', coalesce(v_notified, 0));
end $function$;
revoke all on function private.community_overdue_run() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'community-overdue') then
    perform cron.unschedule('community-overdue');
  end if;
  perform cron.schedule('community-overdue', '*/10 * * * *', $c$ select private.community_overdue_run(); $c$);
  if not exists (select 1 from cron.job where jobname = 'community-overdue' and active) then
    raise exception 'FAIL: community-overdue job not scheduled';
  end if;
end $$;
