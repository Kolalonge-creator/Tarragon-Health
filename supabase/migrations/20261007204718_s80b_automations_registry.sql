-- S80b (spec 25.8, data model `automations`): a registry that gives every scheduled job a name, a schedule, an owner and a status.
--
-- Nothing about any job changes. pg_cron jobs are mirrored from cron.job every 15 minutes by a scheduled sync (never on read), with the
-- latest run status; the 23 Vercel cron routes in apps/web/vercel.json are seeded here (a Jest test fails if vercel.json and this
-- list drift). Owner role, owner, runbook and expected interval are set by an admin and are never overwritten by the sync. A job with no
-- owner shows as unowned; a failed latest run shows as failed. Read by admins and operations staff only.

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 200),
  kind text not null check (kind in ('pg_cron', 'vercel_cron', 'edge')),
  schedule text,
  source_ref text,
  enabled boolean not null default true,
  owner_role text check (owner_role in ('admin', 'operations', 'finance', 'clinical_lead', 'engineering')),
  owner_user uuid references public.profiles(id),
  runbook_url text check (runbook_url is null or runbook_url ~ '^https://'),
  expected_interval_minutes integer check (expected_interval_minutes is null or expected_interval_minutes > 0),
  last_run_at timestamptz,
  last_status text check (last_status is null or last_status in ('succeeded', 'failed', 'running', 'unknown')),
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.automations enable row level security;
create policy automations_staff_read on public.automations for select to authenticated
  using (private.is_admin() or private.directory_can_view());
revoke all on public.automations from anon;
grant select on public.automations to authenticated;
comment on table public.automations is 'S80b: owner registry for scheduled jobs. A mirror plus owner fields; it does not run or change any job.';

insert into public.automations (name, kind, schedule, source_ref) values
  ('vercel:fraud-sweep', 'vercel_cron', '10 5 * * *', '/api/cron/fraud-sweep'),
  ('vercel:ai-coach-embed-content', 'vercel_cron', '20 8 * * *', '/api/cron/ai-coach-embed-content'),
  ('vercel:data-quality-scan', 'vercel_cron', '0 2 * * *', '/api/cron/data-quality-scan'),
  ('vercel:generate-quarterly-reports', 'vercel_cron', '0 3 * * *', '/api/cron/generate-quarterly-reports'),
  ('vercel:device-connectivity-check', 'vercel_cron', '0 6 * * *', '/api/cron/device-connectivity-check'),
  ('vercel:integration-health-check', 'vercel_cron', '45 4 * * *', '/api/cron/integration-health-check'),
  ('vercel:credential-document-purge', 'vercel_cron', '40 3 * * *', '/api/cron/credential-document-purge'),
  ('vercel:lab-turnaround-check', 'vercel_cron', '30 9 * * *', '/api/cron/lab-turnaround-check'),
  ('vercel:lifestyle-coaching', 'vercel_cron', '0 7 * * *', '/api/cron/lifestyle-coaching'),
  ('vercel:lpe-embed-content', 'vercel_cron', '0 8 * * *', '/api/cron/lpe-embed-content'),
  ('vercel:patient-duplicate-detection', 'vercel_cron', '0 6 * * 0', '/api/cron/patient-duplicate-detection'),
  ('vercel:pharmacy-order-refunds', 'vercel_cron', '40 5 * * *', '/api/cron/pharmacy-order-refunds'),
  ('vercel:reconcile-payment-providers', 'vercel_cron', '0 9 * * *', '/api/cron/reconcile-payment-providers'),
  ('vercel:risk-reassessment', 'vercel_cron', '45 5 * * *', '/api/cron/risk-reassessment'),
  ('vercel:video-visit-refunds', 'vercel_cron', '30 5 * * *', '/api/cron/video-visit-refunds'),
  ('vercel:voucher-cancellation-refunds', 'vercel_cron', '50 5 * * *', '/api/cron/voucher-cancellation-refunds'),
  ('vercel:service-purchase-guarantee-refunds', 'vercel_cron', '55 5 * * *', '/api/cron/service-purchase-guarantee-refunds'),
  ('vercel:cycle-reminders', 'vercel_cron', '0 6 * * *', '/api/cron/cycle-reminders'),
  ('vercel:wearable-sync', 'vercel_cron', '15 4 * * *', '/api/cron/wearable-sync'),
  ('vercel:clinical-rules', 'vercel_cron', '0 5 * * *', '/api/cron/clinical-rules'),
  ('vercel:entitlement-expiry', 'vercel_cron', '5 4 * * *', '/api/cron/entitlement-expiry'),
  ('vercel:entitlement-reminders', 'vercel_cron', '15 6 * * *', '/api/cron/entitlement-reminders'),
  ('vercel:order-refunds', 'vercel_cron', '25 5 * * *', '/api/cron/order-refunds')
on conflict (name) do nothing;

create or replace function private.sync_automations_from_cron()
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  with latest as (
    select j.jobid, j.jobname, j.schedule, j.active, r.start_time, r.status
    from cron.job j
    left join lateral (
      select d.start_time, d.status from cron.job_run_details d where d.jobid = j.jobid order by d.runid desc limit 1
    ) r on true
  )
  insert into public.automations (name, kind, schedule, source_ref, enabled, last_run_at, last_status, synced_at)
  select 'cron:' || coalesce(l.jobname, l.jobid::text), 'pg_cron', l.schedule, 'cron.job:' || l.jobid, l.active, l.start_time,
         case l.status when 'succeeded' then 'succeeded' when 'failed' then 'failed' when 'running' then 'running' when 'starting' then 'running' else 'unknown' end,
         now()
  from latest l
  on conflict (name) do update set
    schedule = excluded.schedule, source_ref = excluded.source_ref, enabled = excluded.enabled,
    last_run_at = excluded.last_run_at, last_status = excluded.last_status, synced_at = excluded.synced_at, updated_at = now();
  get diagnostics v_n = row_count;
  -- a pg_cron job that no longer exists is disabled in the registry, never deleted (history stays)
  update public.automations a set enabled = false, updated_at = now()
  where a.kind = 'pg_cron' and a.enabled
    and not exists (select 1 from cron.job j where 'cron:' || coalesce(j.jobname, j.jobid::text) = a.name);
  return v_n;
end $$;
revoke all on function private.sync_automations_from_cron() from public, anon, authenticated;
grant execute on function private.sync_automations_from_cron() to service_role;

create or replace function public.automations_overview()
returns table (
  id uuid, name text, kind text, schedule text, enabled boolean, owner_role text, owner_user_name text, runbook_url text,
  last_run_at timestamptz, last_status text, health text, can_edit boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.directory_can_view()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return query
  select a.id, a.name, a.kind, a.schedule, a.enabled, a.owner_role, p.full_name, a.runbook_url, a.last_run_at, a.last_status,
         case
           when not a.enabled then 'disabled'
           when a.last_status = 'failed' then 'failed'
           when a.expected_interval_minutes is not null and a.last_run_at is not null
                and a.last_run_at < now() - make_interval(mins => a.expected_interval_minutes * 3) then 'stale'
           when a.owner_role is null and a.owner_user is null then 'unowned'
           else 'ok'
         end,
         private.is_admin()
  from public.automations a left join public.profiles p on p.id = a.owner_user
  order by case when a.last_status = 'failed' then 0 when a.owner_role is null and a.owner_user is null then 1 else 2 end, a.name;
end $$;

create or replace function public.set_automation_owner(
  p_id uuid, p_owner_role text, p_owner_user uuid, p_runbook_url text, p_expected_interval_minutes integer default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not authorised: only an admin may set an automation owner' using errcode = '42501'; end if;
  if p_owner_role is null and p_owner_user is null then raise exception 'an owner role or an owner user is required'; end if;
  update public.automations set owner_role = p_owner_role, owner_user = p_owner_user, runbook_url = p_runbook_url,
    expected_interval_minutes = p_expected_interval_minutes, updated_at = now() where id = p_id;
  if not found then raise exception 'Unknown automation %', p_id; end if;
end $$;

revoke execute on function public.automations_overview() from public;
revoke execute on function public.set_automation_owner(uuid, text, uuid, text, integer) from public;
grant execute on function public.automations_overview() to authenticated;
grant execute on function public.set_automation_owner(uuid, text, uuid, text, integer) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform private.sync_automations_from_cron();
    if not exists (select 1 from cron.job where jobname = 'automations-registry-sync') then
      perform cron.schedule('automations-registry-sync', '7,22,37,52 * * * *', 'select private.sync_automations_from_cron()');
    end if;
  end if;
  if has_function_privilege('anon', 'public.automations_overview()', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_automation_owner(uuid, text, uuid, text, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'private.sync_automations_from_cron()', 'EXECUTE') then
    raise exception 'anon must not execute the S80b functions';
  end if;
end $$;
