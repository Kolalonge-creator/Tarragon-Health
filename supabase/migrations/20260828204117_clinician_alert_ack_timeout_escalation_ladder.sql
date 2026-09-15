-- Tarragon Health — Alert System infrastructure, part 4/6: the ack-timeout
-- escalation ladder (8.5 routing, 8.7 "escalate unresolved alerts", 8.11
-- configurable escalation timer).
--
-- Distinct from the EXISTING private.escalate_overdue_clinician_alerts()
-- (20260826224739, unchanged by this migration): that sweep fires once
-- sla_due_at (the clinical RESOLUTION deadline) has passed, and only ever
-- notifies the org's Clinical Director/admins. This is a faster, separate
-- clock -- "has anyone even ACKNOWLEDGED this yet" -- routed through the
-- governed owner -> backup -> senior chain alert_rules now carries per
-- type_code, exactly matching the spec's own worked example (alert
-- generated -> 30 minutes -> not acknowledged -> escalate). The two
-- mechanisms can both be active on the same alert without conflict: one
-- escalates OWNERSHIP on an ack timeout, the other escalates NOTIFICATION
-- on a resolution-SLA breach.
--
-- Every hop is deduplicated (fires once per alert, ever, via the unique
-- index below) and audit-logged, matching this project's established
-- config-not-code + audit-everything conventions for exactly this kind of
-- sweep.

create table public.clinician_alert_ack_escalations (
  id                    uuid primary key default gen_random_uuid(),
  clinician_alert_id    uuid not null references public.clinician_alerts (id) on delete cascade,
  hop                   smallint not null check (hop between 1 and 3),
  notified_role         text not null,
  created_at            timestamptz not null default now(),
  unique (clinician_alert_id, hop)
);

comment on table public.clinician_alert_ack_escalations is
  'Dedup + audit trail for private.escalate_unacknowledged_clinician_alerts(): one row per clinician_alerts row per rung of the ack-timeout ladder it has climbed. hop 1 = backup clinician notified (>=1x configured ack_timeout_minutes open), hop 2 = senior tier / Clinical Director notified (>=2x), hop 3 = every platform admin notified (>=3x).';

alter table public.clinician_alert_ack_escalations enable row level security;

create policy clinician_alert_ack_escalations_select on public.clinician_alert_ack_escalations
  for select to authenticated
  using (
    exists (
      select 1 from public.clinician_alerts ca
      where ca.id = clinician_alert_id and private.is_org_staff(ca.organisation_id)
    )
  );

grant select on public.clinician_alert_ack_escalations to authenticated;

create or replace function private.escalate_unacknowledged_clinician_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_rule jsonb;
  v_timeout integer;
  v_minutes_open numeric;
  v_message text;
  v_backup_profile_id uuid;
  v_recipient record;
  v_any_found boolean;
begin
  for r in
    select ca.id, ca.organisation_id, ca.title, ca.type_code, ca.severity,
           ca.backup_clinician_id, ca.created_at
    from public.clinician_alerts ca
    where ca.status = 'open'
  loop
    v_rule := private.alert_rule_config(r.type_code);
    if v_rule is null then
      continue;
    end if;

    v_timeout := nullif(v_rule->>'ack_timeout_minutes', '')::integer;
    if v_timeout is null or v_timeout <= 0 then
      continue;
    end if;

    v_minutes_open := extract(epoch from (now() - r.created_at)) / 60;
    v_message := format(
      'Alert "%s" (severity %s) has been open %s minutes, past its %s-minute acknowledgement target.',
      r.title, r.severity, round(v_minutes_open), v_timeout
    );

    -- Hop 1: the alert's own backup clinician.
    if v_minutes_open >= v_timeout and r.backup_clinician_id is not null
       and not exists (select 1 from public.clinician_alert_ack_escalations where clinician_alert_id = r.id and hop = 1)
    then
      select profile_id into v_backup_profile_id from public.clinical_staff where id = r.backup_clinician_id;
      if v_backup_profile_id is not null then
        perform private.notify_clinician_alert(r.id, v_backup_profile_id, 'clinician_alert_ack_timeout_backup', jsonb_build_object('message', v_message));
        insert into public.clinician_alert_ack_escalations (clinician_alert_id, hop, notified_role)
        values (r.id, 1, 'backup');
        insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (r.organisation_id, null, 'clinician_alert.ack_timeout_escalated', 'clinician_alerts', r.id,
          jsonb_build_object('hop', 1, 'role', 'backup', 'minutes_open', round(v_minutes_open)));
      end if;
    end if;

    -- Hop 2: senior tier / Clinical Director in the org.
    if v_minutes_open >= v_timeout * 2
       and not exists (select 1 from public.clinician_alert_ack_escalations where clinician_alert_id = r.id and hop = 2)
    then
      v_any_found := false;
      for v_recipient in
        select cs.profile_id
        from public.clinical_staff cs
        where cs.organisation_id = r.organisation_id
          and cs.active
          and (cs.is_clinical_director or cs.doctor_tier in ('tier_4_senior_registrar', 'tier_5_partner_specialist'))
          and cs.profile_id is not null
      loop
        v_any_found := true;
        perform private.notify_clinician_alert(r.id, v_recipient.profile_id, 'clinician_alert_ack_timeout_senior', jsonb_build_object('message', v_message));
      end loop;

      if v_any_found then
        insert into public.clinician_alert_ack_escalations (clinician_alert_id, hop, notified_role)
        values (r.id, 2, 'senior');
        insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (r.organisation_id, null, 'clinician_alert.ack_timeout_escalated', 'clinician_alerts', r.id,
          jsonb_build_object('hop', 2, 'role', 'senior', 'minutes_open', round(v_minutes_open)));
      end if;
    end if;

    -- Hop 3: every platform admin -- same platform-wide-admin precedent as
    -- private.escalate_overdue_clinician_alerts.
    if v_minutes_open >= v_timeout * 3
       and not exists (select 1 from public.clinician_alert_ack_escalations where clinician_alert_id = r.id and hop = 3)
    then
      v_any_found := false;
      for v_recipient in select id as profile_id from public.profiles where role = 'admin'
      loop
        v_any_found := true;
        perform private.notify_clinician_alert(r.id, v_recipient.profile_id, 'clinician_alert_ack_timeout_admin', jsonb_build_object('message', v_message));
      end loop;

      if v_any_found then
        insert into public.clinician_alert_ack_escalations (clinician_alert_id, hop, notified_role)
        values (r.id, 3, 'admin');
        insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (r.organisation_id, null, 'clinician_alert.ack_timeout_escalated', 'clinician_alerts', r.id,
          jsonb_build_object('hop', 3, 'role', 'admin', 'minutes_open', round(v_minutes_open)));
      end if;
    end if;
  end loop;
end;
$$;

comment on function private.escalate_unacknowledged_clinician_alerts() is
  'Sweep: any open clinician_alerts row past its governed ack_timeout_minutes (alert_rules) climbs a 3-rung ladder -- backup clinician at 1x, senior tier/Clinical Director at 2x, every platform admin at 3x -- each rung firing at most once per alert (clinician_alert_ack_escalations), always audit-logged, always delivered via private.notify_clinician_alert() so 8.6''s not-solely-email guarantee applies here too.';

revoke all on function private.escalate_unacknowledged_clinician_alerts() from public, anon;

select cron.schedule(
  'clinician-alert-ack-timeout-escalation',
  '*/10 * * * *',
  $$select private.escalate_unacknowledged_clinician_alerts()$$
);

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='clinician_alert_ack_escalations') then
    raise exception 'clinician_alert_ack_escalations was not created';
  end if;
  if not exists (select 1 from cron.job where jobname = 'clinician-alert-ack-timeout-escalation') then
    raise exception 'clinician-alert-ack-timeout-escalation cron job was not scheduled';
  end if;
  if has_function_privilege('anon', 'private.escalate_unacknowledged_clinician_alerts()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.escalate_unacknowledged_clinician_alerts';
  end if;
  raise notice 'PASS: ack-timeout escalation ladder table + function + cron job all present, anon denied';
end $$;
