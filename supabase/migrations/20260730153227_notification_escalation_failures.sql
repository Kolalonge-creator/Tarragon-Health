-- Notification delivery-state + forced-channel fallback, part 5/6.
--
-- Surfaces the case the whole feature exists to prevent: a critical alert
-- (e.g. the abnormal-result doctor alert) that ran the entire channel ladder
-- (push -> whatsapp -> sms) with nobody ever confirming it. One row per
-- exhausted chain — the engine also fans out an in_app notification to every
-- admin so it is visible in the NotificationBell, not just this table.
--
-- RLS-on/no-write-policy, same discipline as the analytics governance and
-- finance tables: only private.escalate_unconfirmed_critical_notifications()
-- (SECURITY DEFINER, runs as postgres) ever inserts here.
create table public.notification_escalation_failures (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id) on delete set null,
  -- The terminal (last-hop) notifications row — unique so the engine's
  -- `on conflict do nothing` makes a re-run of the same cron tick safe.
  notification_id uuid not null unique references public.notifications (id) on delete cascade,
  source_table text,
  source_id uuid,
  escalation_pathway text not null,
  escalation_alert_tier public.alert_level not null,
  channel_sequence_exhausted public.notification_channel[] not null,
  created_at timestamptz not null default now()
);

alter table public.notification_escalation_failures enable row level security;

create policy notification_escalation_failures_select on public.notification_escalation_failures
  for select
  using (private.is_org_staff(organisation_id) or private.is_admin());
