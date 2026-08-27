-- Tarragon Health
-- Closes the last gap in Item 3 of a 2026-08-26 indemnity/liability audit:
-- "automatic further escalation on timeout, logged." Everything else that
-- claim needs was already real -- escalation_slas is genuine config-not-code
-- (v3_port_escalation_sla_config, 20260730105131), clinician_alerts.sla_due_at
-- is computed correctly by every pathway trigger -- but nothing ever ACTED on
-- a breach. sla_due_at passing was only ever surfaced as a passive analytics
-- count (overdue_alerts, analytics_console_phase2_rpcs). A live check before
-- writing this migration found this is not hypothetical: 8+ real OPEN
-- clinician_alerts are currently sitting past sla_due_at, two of them
-- escalation_level=4 (emergency) and breached for over three weeks, with
-- nothing having ever notified anyone.
--
-- Design: a scheduled sweep, not a bigger trigger -- an SLA breach is defined
-- by the CLOCK, not by any write to the row, so nothing short of a periodic
-- check can ever catch it. Escalates the RECIPIENT, not the alert's own
-- level/escalation_level column: a bump to clinician_alerts.level would
-- change what matchRedFlags/case-cockpit and other level-keyed logic sees,
-- which is a bigger, separate, riskier change than "make sure a senior person
-- finds out this is still open." Two tiers, by how overdue:
--   < 24h past due  -> notify the org's active Clinical Director
--   >= 24h past due -> ALSO notify every platform admin (role = 'admin',
--                      matching queue_data_breach_deadline_alerts' own
--                      no-org-filter precedent for "admin" as a platform-wide
--                      role)
-- Deduplicated to one notification per alert per calendar day it stays
-- breached (data_breach_deadline_notifications' own precedent), and every
-- firing is also written to audit_log so "was this actually escalated, and
-- when" is a real, queryable, immutable record -- the "logged" half of the
-- ask -- not just a notification that could be missed.

create table public.clinician_alert_sla_breach_notifications (
  id                  uuid primary key default gen_random_uuid(),
  clinician_alert_id  uuid not null references public.clinician_alerts (id) on delete cascade,
  notified_on         date not null default current_date,
  escalation_tier     smallint not null,
  created_at          timestamptz not null default now(),
  unique (clinician_alert_id, notified_on)
);

comment on table public.clinician_alert_sla_breach_notifications is
  'Dedup + audit trail for private.escalate_overdue_clinician_alerts(): one row per clinician_alerts row per calendar day it is found still open past sla_due_at. escalation_tier: 1 = Clinical Director notified, 2 = all platform admins also notified (>=24h overdue).';

alter table public.clinician_alert_sla_breach_notifications enable row level security;

create policy clinician_alert_sla_breach_notifications_select
  on public.clinician_alert_sla_breach_notifications
  for select to authenticated
  using (private.is_org_staff((select organisation_id from public.clinician_alerts where id = clinician_alert_id)));

grant select on public.clinician_alert_sla_breach_notifications to authenticated;

create or replace function private.escalate_overdue_clinician_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_hours_overdue numeric;
  v_tier smallint;
  v_director record;
  v_admin record;
  v_message text;
begin
  for r in
    select ca.id, ca.organisation_id, ca.patient_id, ca.title, ca.level, ca.escalation_level, ca.sla_due_at
    from public.clinician_alerts ca
    where ca.status = 'open'
      and ca.sla_due_at is not null
      and ca.sla_due_at < now()
  loop
    v_hours_overdue := extract(epoch from (now() - r.sla_due_at)) / 3600;
    v_tier := case when v_hours_overdue >= 24 then 2 else 1 end;

    insert into public.clinician_alert_sla_breach_notifications (clinician_alert_id, escalation_tier)
    values (r.id, v_tier)
    on conflict (clinician_alert_id, notified_on) do nothing;

    if not found then
      continue;
    end if;

    v_message := format(
      'Escalation SLA breached: "%s" (%s) is %s hours past its review deadline and still open.',
      r.title, r.level, round(v_hours_overdue)
    );

    -- Tier 1: the org's own active Clinical Director.
    for v_director in
      select cs.profile_id
      from public.clinical_staff cs
      where cs.organisation_id = r.organisation_id
        and cs.is_clinical_director
        and cs.active
        and cs.profile_id is not null
    loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (v_director.profile_id, r.organisation_id, 'in_app', 'clinician_alert_sla_breach',
        jsonb_build_object('message', v_message, 'clinician_alert_id', r.id, 'hours_overdue', round(v_hours_overdue)),
        'pending', 'clinical');
    end loop;

    -- Tier 2: still open a full day past its deadline -- every platform admin too.
    if v_tier = 2 then
      for v_admin in select id from public.profiles where role = 'admin'
      loop
        insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
        values (v_admin.id, r.organisation_id, 'in_app', 'clinician_alert_sla_breach',
          jsonb_build_object('message', v_message, 'clinician_alert_id', r.id, 'hours_overdue', round(v_hours_overdue)),
          'pending', 'clinical');
      end loop;
    end if;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (r.organisation_id, null, 'clinician_alert.sla_breach_escalated', 'clinician_alerts', r.id,
      jsonb_build_object('escalation_tier', v_tier, 'hours_overdue', round(v_hours_overdue, 1),
        'level', r.level, 'escalation_level', r.escalation_level, 'sla_due_at', r.sla_due_at));
  end loop;
end;
$$;

comment on function private.escalate_overdue_clinician_alerts() is
  'Nightly-plus sweep: any open clinician_alerts row past sla_due_at gets its org Clinical Director notified (and, past 24h overdue, every platform admin too), deduplicated to once per calendar day, and always audit-logged. Never mutates the alert''s own level/escalation_level -- see migration header for why.';

revoke all on function private.escalate_overdue_clinician_alerts() from public;

select cron.schedule(
  'clinician-alert-sla-breach-escalation',
  '0 */4 * * *',
  $$select private.escalate_overdue_clinician_alerts()$$
);

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'clinician_alert_sla_breach_notifications'
  ) then
    raise exception 'clinician_alert_sla_breach_notifications was not created';
  end if;

  if not exists (select 1 from cron.job where jobname = 'clinician-alert-sla-breach-escalation') then
    raise exception 'clinician-alert-sla-breach-escalation cron job was not scheduled';
  end if;

  if has_function_privilege('anon', 'private.escalate_overdue_clinician_alerts()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.escalate_overdue_clinician_alerts';
  end if;

  raise notice 'PASS: SLA breach escalation table + function + cron job all present, anon denied';
end $$;
