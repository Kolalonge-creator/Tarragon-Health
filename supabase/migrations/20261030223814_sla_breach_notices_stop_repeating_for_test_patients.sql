-- Tarragon Health: SLA-breach notices stop repeating for test patients (2026-10-30)
--
-- private.escalate_overdue_clinician_alerts() writes one breach notice per open overdue alert per day, to every Chief Medical
-- Officer and (from 24 hours overdue) every admin of the alert's organisation. An alert for a TEST patient that nobody closes
-- therefore pages the same people every day for as long as it stays open: three test-patient symptom alerts open since 16-17 Sep
-- produced 166 daily notices and 970 unread in-app rows for two clinicians before they were resolved by hand.
--
-- The change: an alert whose patient is a test patient gets its first breach notice and no repeats. Real patients are unchanged
-- (they must keep being chased daily). The first notice is kept so QA and packages/db/tests/events_escalation_admin_notices_scoped.sql,
-- which use test patients to exercise this job, still see the breach.
--
-- Redefined from the LIVE body (pg_get_functiondef on 2026-10-30), which already carries the per-organisation admin filter from
-- 20261030122553. Only the cursor query changed.

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
    left join public.profiles pt on pt.id = ca.patient_id
    where ca.status = 'open'
      and ca.sla_due_at is not null
      and ca.sla_due_at < now()
      -- a test patient's alert is told once, never daily
      and (not coalesce(pt.is_test, false)
           or not exists (select 1 from public.clinician_alert_sla_breach_notifications b where b.clinician_alert_id = ca.id))
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

do $$
begin
  if pg_get_functiondef('private.escalate_overdue_clinician_alerts()'::regprocedure) not like '%is_test%' then
    raise exception 'escalate_overdue_clinician_alerts did not pick up the test-patient rule';
  end if;
end $$;
