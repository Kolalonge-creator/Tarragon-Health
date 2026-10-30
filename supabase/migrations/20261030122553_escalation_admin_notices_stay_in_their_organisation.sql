-- Events harness sweep: the admin hop of two escalation jobs notified admins of EVERY organisation.
--
--   private.escalate_unacknowledged_clinician_alerts  hop 3: `select id from public.profiles where role = 'admin'`
--   private.escalate_overdue_clinician_alerts         tier 2: `select id from public.profiles where role = 'admin'`
--
-- Neither filtered by the alert's organisation (private.raise_unread_clinical_message_alerts does). Production has two organisations, the
-- real one and a synthetic canary, and it happened both ways: 130 notices about the real organisation's alerts (SLA breach, escalation
-- exhausted, AI system disabled) reached the canary organisation's admin, and 25 canary notices reached the real admin. The text carries
-- the alert title, not a patient name, but a notice about one tenant's alerts must not reach another tenant's admin.
--
-- The canary does not depend on this: it reports its own failures through private.page_incident (the ops incident system), not through
-- these ladders. Both bodies below are the live bodies (compared by checksum with production on 2026-10-30) with only the added
-- `and organisation_id = r.organisation_id`. Notices already sent are history and are not touched.
-- Proof: packages/db/tests/events_escalation_admin_notices_scoped.sql.

create or replace function private.escalate_unacknowledged_clinician_alerts()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
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

    if v_minutes_open >= v_timeout * 2
       and not exists (select 1 from public.clinician_alert_ack_escalations where clinician_alert_id = r.id and hop = 2)
    then
      v_any_found := false;
      for v_recipient in
        select cs.profile_id
        from public.clinical_staff cs
        where cs.organisation_id = r.organisation_id
          and cs.active
          and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
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

    if v_minutes_open >= v_timeout * 3
       and not exists (select 1 from public.clinician_alert_ack_escalations where clinician_alert_id = r.id and hop = 3)
    then
      v_any_found := false;
      for v_recipient in select id as profile_id from public.profiles where role = 'admin' and organisation_id = r.organisation_id
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
$function$;

create or replace function private.escalate_overdue_clinician_alerts()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
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

    for v_director in
      select cs.profile_id
      from public.clinical_staff cs
      where cs.organisation_id = r.organisation_id
        and cs.doctor_tier = 'chief_medical_officer'
        and cs.active
        and cs.profile_id is not null
    loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (v_director.profile_id, r.organisation_id, 'in_app', 'clinician_alert_sla_breach',
        jsonb_build_object('message', v_message, 'clinician_alert_id', r.id, 'hours_overdue', round(v_hours_overdue)),
        'pending', 'clinical');
    end loop;

    if v_tier = 2 then
      for v_admin in select id from public.profiles where role = 'admin' and organisation_id = r.organisation_id
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
$function$;

-- Proof that the live functions now carry the filter (a replay that silently kept the old bodies would fail here).
do $$
begin
  if position('role = ''admin'' and organisation_id = r.organisation_id' in pg_get_functiondef('private.escalate_unacknowledged_clinician_alerts()'::regprocedure)) = 0 then
    raise exception 'escalate_unacknowledged_clinician_alerts was not updated';
  end if;
  if position('role = ''admin'' and organisation_id = r.organisation_id' in pg_get_functiondef('private.escalate_overdue_clinician_alerts()'::regprocedure)) = 0 then
    raise exception 'escalate_overdue_clinician_alerts was not updated';
  end if;
end $$;
