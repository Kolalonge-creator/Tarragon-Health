-- S80 (25.8): the automations registry and a guarded pause.
--
-- Reconciled first. Scheduled work already runs: pg_cron jobs defined across the migrations (each `cron.schedule`, net of every
-- `cron.unschedule`; read from the live `cron.job` at the moment this migration runs, so only jobs that exist are seeded) and the
-- Vercel crons in apps/web/vercel.json (listed below; a Jest test compares this list with that file). Nothing recorded who owns a job, what
-- it is for, or let an admin stop one.
--
--   public.automations              one row per scheduled job. Owner is 'unassigned' and purpose is empty everywhere: nobody has
--                                   recorded them, and inventing either would be worse than saying so.
--   public.set_automation_paused()  admin only. For a pg_cron job it calls cron.alter_job(active := not paused). A job flagged
--                                   safety_critical (paging, triage, escalation, emergency, clinical task claims, notification delivery,
--                                   credential, quality and breach-deadline sweeps) can NEVER be paused here. A Vercel cron cannot be
--                                   paused from the database, so that is refused plainly rather than recording a pause that does nothing.
--   public.automations_list()       the screen's read: every registry row plus every pg_cron job NOT in the registry ("unregistered"),
--                                   with the last run read from cron.job_run_details (SECURITY DEFINER, so the screen never sees the cron schema).
-- No organisation_id: these are platform-wide settings like platform_modules. Counts at write time: no existing data is changed.

create table public.automations (
  id              uuid primary key default gen_random_uuid(),
  job_name        text not null unique check (char_length(btrim(job_name)) > 0),
  purpose         text,
  owner           text not null default 'unassigned' check (char_length(btrim(owner)) > 0),
  schedule        text,
  source          text not null check (source in ('pg_cron', 'vercel')),
  safety_critical boolean not null default false,
  is_paused       boolean not null default false,
  paused_by       uuid references public.profiles (id) on delete set null,
  paused_at       timestamptz,
  reason          text,
  last_run_at     timestamptz,
  last_status     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (not (safety_critical and is_paused)),
  check (not (is_paused and source <> 'pg_cron'))
);
alter table public.automations enable row level security;
create policy automations_read on public.automations for select to authenticated using (private.is_admin() or private.has_permission('ops.console.view'));
revoke all on public.automations from anon, authenticated;
grant select on public.automations to authenticated;
-- No write grant: set_automation_paused is the only door.

-- pg_cron jobs as they exist now
insert into public.automations (job_name, schedule, source, safety_critical)
select j.jobname, j.schedule, 'pg_cron',
       j.jobname = any (array[
         'sweep-pages', 'sweep-page-followups', 'sweep-unpaged-red-events', 'process-events', 'sweep-clinical-tasks', 'expire-task-claims',
         'send-pending-notifications', 'credential-expiry-sweep', 'quality-audit-sweep', 'data-breach-deadline-alerts-daily',
         'triage-recheck-sweep', 'triage-recheck-backup-push', 'sweep-response-time-breaches', 'escalate-critical-notifications',
         'clinician-alert-ack-timeout-escalation', 'clinician-alert-sla-breach-escalation', 'emergency-contact-notify',
         'emergency-followup-daily', 'raise-unread-clinical-message-alerts', 'sweep-clinical-follow-ups', 'safety-concern-sweep',
         'raise-stale-urgent-referral-alerts', 'diagnostic-follow-up-non-completion-escalation', 'care-management-deterioration-sweep',
         'push-email-fallback', 'expo-push-receipts'])
from cron.job j where j.jobname is not null
on conflict (job_name) do nothing;

-- Vercel crons (apps/web/vercel.json). Not pausable from the database.
insert into public.automations (job_name, schedule, source)
select v.job_name, v.schedule, 'vercel' from (values
  ('/api/cron/fraud-sweep', '10 5 * * *'), ('/api/cron/ai-coach-embed-content', '20 8 * * *'), ('/api/cron/data-quality-scan', '0 2 * * *'),
  ('/api/cron/generate-quarterly-reports', '0 3 * * *'), ('/api/cron/device-connectivity-check', '0 6 * * *'),
  ('/api/cron/integration-health-check', '45 4 * * *'), ('/api/cron/credential-document-purge', '40 3 * * *'),
  ('/api/cron/lab-turnaround-check', '30 9 * * *'), ('/api/cron/lifestyle-coaching', '0 7 * * *'), ('/api/cron/lpe-embed-content', '0 8 * * *'),
  ('/api/cron/patient-duplicate-detection', '0 6 * * 0'), ('/api/cron/pharmacy-order-refunds', '40 5 * * *'),
  ('/api/cron/reconcile-payment-providers', '0 9 * * *'), ('/api/cron/risk-reassessment', '45 5 * * *'),
  ('/api/cron/video-visit-refunds', '30 5 * * *'), ('/api/cron/voucher-cancellation-refunds', '50 5 * * *'),
  ('/api/cron/service-purchase-guarantee-refunds', '55 5 * * *'), ('/api/cron/cycle-reminders', '0 6 * * *'),
  ('/api/cron/wearable-sync', '15 4 * * *'), ('/api/cron/clinical-rules', '0 5 * * *'), ('/api/cron/entitlement-expiry', '5 4 * * *'),
  ('/api/cron/entitlement-reminders', '15 6 * * *'), ('/api/cron/order-refunds', '25 5 * * *'),
  ('/api/cron/community-housekeeping', '50 3 * * *'),
  ('/api/cron/testing-day-reminders', '35 6 * * *'),
  ('/api/cron/assistant-nudges', '30 7 * * *')
) v (job_name, schedule)
on conflict (job_name) do nothing;
-- vercel-crons-end

create function public.set_automation_paused(p_job_name text, p_paused boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row   public.automations%rowtype;
  v_jobid bigint;
  v_why   text := btrim(coalesce(p_reason, ''));
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'only an admin can pause or resume an automation' using errcode = '42501';
  end if;
  select * into v_row from public.automations where job_name = p_job_name for update;
  if not found then raise exception 'that job is not in the automations registry' using errcode = '22023'; end if;
  if p_paused and char_length(v_why) < 10 then
    raise exception 'say why you are pausing it (10 characters or more)' using errcode = '22023';
  end if;
  if p_paused and v_row.safety_critical then
    raise exception '% is safety critical and cannot be paused here', p_job_name using errcode = '23514';
  end if;
  if p_paused and v_row.source <> 'pg_cron' then
    raise exception '% is scheduled by Vercel and cannot be paused from the database', p_job_name using errcode = '0A000';
  end if;

  if v_row.source = 'pg_cron' then
    select jobid into v_jobid from cron.job where jobname = p_job_name;
    if v_jobid is null then raise exception 'that job is no longer scheduled' using errcode = '22023'; end if;
    perform cron.alter_job(v_jobid, active := not p_paused);
  end if;

  update public.automations
     set is_paused = p_paused,
         paused_by = case when p_paused then (select auth.uid()) else null end,
         paused_at = case when p_paused then now() else null end,
         reason = case when p_paused then v_why else nullif(v_why, '') end,
         updated_at = now()
   where id = v_row.id;

  perform private.log_audit(case when p_paused then 'automation.paused' else 'automation.resumed' end, 'automations', v_row.id,
    jsonb_build_object('job_name', p_job_name, 'source', v_row.source, 'reason', left(v_why, 300)));
  return jsonb_build_object('job_name', p_job_name, 'is_paused', p_paused);
end $$;
revoke all on function public.set_automation_paused(text, boolean, text) from public, anon;
grant execute on function public.set_automation_paused(text, boolean, text) to authenticated;

create function public.automations_list() returns table (
  job_name text, purpose text, owner text, schedule text, source text, safety_critical boolean, is_paused boolean,
  paused_at timestamptz, reason text, last_run_at timestamptz, last_status text, registered boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.has_permission('ops.console.view')) then
    raise exception 'only an admin or an operations user can see automations' using errcode = '42501';
  end if;
  return query
    select a.job_name, a.purpose, a.owner, a.schedule, a.source, a.safety_critical,
           case when a.source = 'pg_cron' and j.jobid is not null then not j.active else a.is_paused end,
           a.paused_at, a.reason,
           coalesce(r.start_time, a.last_run_at), coalesce(r.status, a.last_status), true
      from public.automations a
      left join cron.job j on a.source = 'pg_cron' and j.jobname = a.job_name
      left join lateral (select d.start_time, d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) r on true
    union all
    select j.jobname, null, 'unassigned', j.schedule, 'pg_cron', false, not j.active, null, null, r.start_time, r.status, false
      from cron.job j
      left join lateral (select d.start_time, d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) r on true
     where j.jobname is not null and not exists (select 1 from public.automations a where a.job_name = j.jobname)
    order by 12 desc, 6 desc, 1;
end $$;
revoke all on function public.automations_list() from public, anon;
grant execute on function public.automations_list() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.set_automation_paused(text, boolean, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.automations_list()', 'EXECUTE') then
    raise exception 'automation functions are executable by anon';
  end if;
  if has_table_privilege('authenticated', 'public.automations', 'INSERT') or has_table_privilege('authenticated', 'public.automations', 'UPDATE')
     or has_table_privilege('anon', 'public.automations', 'SELECT') then
    raise exception 'automations has a grant it must not have';
  end if;
  if (select count(*) from public.automations where source = 'vercel') < 25 then raise exception 'expected at least 25 vercel crons'; end if;
  if exists (select 1 from public.automations a where a.source = 'pg_cron' and not exists (select 1 from cron.job j where j.jobname = a.job_name)) then
    raise exception 'a seeded pg_cron job does not exist';
  end if;
  if (select count(*) from public.automations where safety_critical) < 8 then raise exception 'safety_critical flags missing'; end if;
  if exists (select 1 from public.automations where owner <> 'unassigned' or purpose is not null) then raise exception 'owners and purposes must not be invented'; end if;
end $$;
