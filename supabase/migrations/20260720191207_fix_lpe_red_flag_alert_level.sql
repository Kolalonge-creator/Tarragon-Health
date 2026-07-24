-- Fix: private.handle_lpe_red_flag() mapped severities to DEAD enum literals.
-- 20260719122000 used 'doctor_escalation'/'nurse_review', renamed away on
-- 2026-07-05 to 'urgent_escalation'/'clinician_review'. plpgsql doesn't validate
-- enum literals at CREATE time, so amber/red flags failed only at runtime and
-- rolled back the escalation. Re-create with valid literals only.
create or replace function private.handle_lpe_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level  public.alert_level;
  v_sla    timestamptz;
  v_alert  uuid;
begin
  -- Map clinical severity → alert level + contact SLA (spec §9.2).
  if new.severity = 'emergency' then
    v_level := 'emergency';         v_sla := now() + interval '15 minutes';
  elsif new.severity = 'red' then
    v_level := 'urgent_escalation'; v_sla := now() + interval '1 hour';
  else
    v_level := 'clinician_review';  v_sla := now() + interval '72 hours';
  end if;

  if new.clinician_alert_id is null then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
    values (
      new.organisation_id, new.patient_id, v_level, 'open',
      format('Lifestyle red flag (%s): %s', new.severity, new.rule_key),
      format('Rule %s fired for a logged reading. Action: %s.', new.rule_key, new.action),
      v_sla, new.escalation_level)
    returning id into v_alert;
    new.clinician_alert_id := v_alert;
  end if;

  -- ED / self-harm ⇒ pause weight-loss in the SAME transaction (spec §9.3).
  if new.action = 'auto_pause_weightloss' and new.enrollment_id is not null then
    update public.lpe_enrollments
      set status = 'paused',
          paused_reason = coalesce(paused_reason,
            'Auto-paused: safety flag ' || new.rule_key)
      where id = new.enrollment_id
        and status <> 'paused';
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'lpe_red_flag.opened',
    'lpe_red_flag_events', new.id,
    jsonb_build_object('rule_key', new.rule_key, 'severity', new.severity,
                       'action', new.action, 'clinician_alert_id', new.clinician_alert_id));

  return new;
end;
$$;
