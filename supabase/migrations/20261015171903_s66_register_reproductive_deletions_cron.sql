-- S66 added the vercel cron /api/cron/reproductive-deletions (the grace-window processor for the cycle tracker's deletion on request). The S80 automations
-- registry migration was already applied when S66 merged, so the new cron is registered here. Idempotent; the registry is the list the dashboard reads.
insert into public.automation_jobs (job_name, schedule, source)
select '/api/cron/reproductive-deletions', '30 6 * * *', 'vercel'
where to_regclass('public.automation_jobs') is not null
on conflict (job_name) do nothing;
