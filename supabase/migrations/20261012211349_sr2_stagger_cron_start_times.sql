-- SR2 (scale-readiness plan, Phase 1 item 2, corrected). The plan assumed the web app's connections were the first limit. They are not:
-- the app and edge functions reach Postgres only through PostgREST over HTTPS (no direct connection string anywhere in apps/, packages/
-- or supabase/functions), and only 7 client connections were open when checked. The real pressure is pg_cron: with
-- cron.use_background_workers off, every job it starts opens its own connection, cron.max_running_jobs is 32, and 35 to 37 jobs start
-- in the same second at :00 and :30 (every */5, */10, */15 and */30 job, the minute jobs, and the daily 06:00/06:30/06:45 groups).
-- That is above the limit: "job startup timeout" failures hit the paging sweeps at 2026-10-12 18:30 and 20:00 UTC, and earlier on
-- 2026-09-22 and 2026-09-24.
-- Fix: spread the start times. The 15-second sweeps, the every-minute jobs and */2 are left alone. Jobs that share the same */N schedule or
-- the same daily time get a different minute (rank within the group; the first job in each group keeps its time). No job moves by more than
-- 14 minutes and every job keeps its period. Reapplying changes nothing (the schedules are no longer shared).

create or replace function private.stagger_cron_schedules()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_new text;
  v_n integer := 0;
  v_min integer;
  v_rest text;
begin
  for r in
    select jobid, schedule,
           row_number() over (partition by schedule order by jobid) - 1 as rnk
      from cron.job
     where active and schedule !~ 'seconds'
       and (schedule in ('*/5 * * * *', '*/10 * * * *', '*/15 * * * *', '0 */4 * * *')
            or schedule ~ '^[0-9]+ [0-9]+ \* \* \*$')
  loop
    v_new := null;
    if r.rnk = 0 then continue; end if;
    if r.schedule = '*/5 * * * *' then v_new := (r.rnk % 5) || '-59/5 * * * *';
    elsif r.schedule = '*/10 * * * *' then v_new := (r.rnk % 10) || '-59/10 * * * *';
    elsif r.schedule = '*/15 * * * *' then v_new := (r.rnk % 15) || '-59/15 * * * *';
    elsif r.schedule = '0 */4 * * *' then v_new := (r.rnk % 60) || ' */4 * * *';
    else
      v_min := split_part(r.schedule, ' ', 1)::integer;
      v_rest := substr(r.schedule, length(split_part(r.schedule, ' ', 1)) + 1);
      if v_min + r.rnk <= 59 then v_new := (v_min + r.rnk) || v_rest; end if;
    end if;
    if v_new is not null and v_new <> r.schedule then
      perform cron.alter_job(r.jobid, schedule := v_new);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

revoke all on function private.stagger_cron_schedules() from public, anon, authenticated;

select private.stagger_cron_schedules();

do $$
begin
  if (select count(*) from cron.job where active and schedule = '*/5 * * * *') > 1 then raise exception 'SR2: more than one */5 job still shares a start'; end if;
  if (select count(*) from cron.job where active and schedule = '*/15 * * * *') > 1 then raise exception 'SR2: more than one */15 job still shares a start'; end if;
  if has_function_privilege('anon', 'private.stagger_cron_schedules()', 'EXECUTE') or has_function_privilege('authenticated', 'private.stagger_cron_schedules()', 'EXECUTE') then
    raise exception 'SR2: stagger function must not be callable by anon or authenticated';
  end if;
end $$;
