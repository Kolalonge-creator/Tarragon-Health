-- Tarragon Health — reconciliation, not a new feature.
--
-- private.queue_health_check_due_reminders() and its
-- 'health-check-due-reminders-daily' cron job (11-month advance notice
-- before a patient's next annual Health Check is due) have been live on
-- this project since 2026-08-10, but were never recorded by a tracked
-- migration — the local file that was meant to (20260810005533_health_
-- check_due_reminder.sql) was untracked/uncommitted and, on inspection
-- 2026-08-12, described an OLDER shape than what's actually live: it only
-- queued a 'whatsapp' notification, while the live function also queues an
-- 'in_app' companion (added by the later 20260811235133_guarantee_in_app_
-- notification_companions.sql sweep, applied directly to this function
-- rather than by editing that stale local file). Applying the stale file
-- would have silently reverted the in_app companion. This migration
-- captures the CURRENT live definition byte-for-byte (confirmed via
-- pg_get_functiondef against project koiplnmbgnqnbywhpjlf, 2026-08-12) so a
-- fresh `supabase db reset` reproduces what is actually running, and
-- schema_migrations finally has a record of it. The stale file was deleted.

create or replace function private.queue_health_check_due_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with last_result as (
    select distinct on (lo.patient_id)
      lo.patient_id, lo.organisation_id, lo.resulted_at, pb.name as bundle_name
    from public.lab_orders lo
    join public.panel_bundles pb on pb.id = lo.panel_bundle_id
    where lo.status = 'resulted'
      and lo.resulted_at is not null
      and (pb.code like 'screen_%' or pb.code like 'health_check%')
    order by lo.patient_id, lo.resulted_at desc
  ),
  due as (
    select lr.*
    from last_result lr
    where (lr.resulted_at + interval '11 months')::date = current_date
      and not exists (
        select 1
        from public.lab_orders lo2
        join public.panel_bundles pb2 on pb2.id = lo2.panel_bundle_id
        where lo2.patient_id = lr.patient_id
          and (pb2.code like 'screen_%' or pb2.code like 'health_check%')
          and lo2.status in ('pending_payment', 'payment_confirmed', 'ordered', 'sample_collected', 'processing')
      )
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id,
      patient_id,
      'whatsapp',
      'pending',
      'health_check_due_soon',
      jsonb_build_object(
        'bundle_name', bundle_name,
        'due_date', to_char((resulted_at + interval '12 months')::date, 'DD Mon YYYY')
      )
    from due
    returning recipient_id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    organisation_id,
    patient_id,
    'in_app',
    'pending',
    'health_check_due_soon',
    jsonb_build_object(
      'bundle_name', bundle_name,
      'due_date', to_char((resulted_at + interval '12 months')::date, 'DD Mon YYYY')
    )
  from due;
$$;

select cron.schedule(
  'health-check-due-reminders-daily',
  '45 6 * * *',
  $$select private.queue_health_check_due_reminders();$$
);

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'queue_health_check_due_reminders'
  ) then
    raise exception 'queue_health_check_due_reminders was not created';
  end if;

  if not exists (
    select 1 from cron.job where jobname = 'health-check-due-reminders-daily'
  ) then
    raise exception 'health-check-due-reminders-daily cron job was not registered';
  end if;

  if not exists (
    select 1 from pg_proc where proname = 'queue_health_check_due_reminders' and pronamespace = 'private'::regnamespace
      and pg_get_functiondef(oid) like '%''in_app''%'
  ) then
    raise exception 'FAIL: queue_health_check_due_reminders is missing its in_app notification companion';
  end if;
end $$;
