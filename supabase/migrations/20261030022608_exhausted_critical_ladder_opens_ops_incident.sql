-- OQ-731: a clinician's critical notice whose delivery ladder ran out reaches the ops desk's phone call, not only an in-app alarm.
--
-- When every step of a critical notice's ladder (push, then email) fails or goes unopened, private.escalate_unconfirmed_critical_notifications()
-- writes notification_escalation_failures and one in-app notice to every admin, and stops. For a red-event page the ops desk's named person
-- is told to phone the on-call clinician and the chief medical officer (CMO decision of 2026-10-07, S16-S20 decision 10), but a screening-result
-- alert or any other critical clinician notice whose ladder ran out had no such last step: an admin looking at an in-app list is the only alarm.
--
-- The exhausted branch now also opens an ops incident through private.page_incident, which the ops desk assigns to its named on-duty person
-- (the trigger on ops_incidents inserts). It is only opened when the recipient is NOT a patient: a patient's ladder ends in the in-app inbox by
-- CMO decision Q10, and a patient's missed notice is not a reason to phone a clinician. The reference is unique per notice, so the cron running
-- again changes nothing (page_incident updates the open incident, and the loop skips a notice that already has a failure row).
--
-- A test account is skipped as well (test clinicians receive about 1,350 critical notices a week in QA traffic, and none of them is a person to phone).
-- The summary carries no patient name and no clinical label (INV-07), only the notice id. If opening the incident itself fails, an audit row and
-- a database warning say so, never silence, and the loop carries on: one failing incident must not stop the escalation of every other notice.
--
-- The live body (about 90 lines) is patched by guarded text replacement, not re-typed. The migration stops if the anchor is missing or appears
-- more than once. Nothing in the data changes; no conversion step exists.

do $$
declare
  v_def text := pg_get_functiondef('private.escalate_unconfirmed_critical_notifications()'::regprocedure);
  v_old text := $q$      from public.profiles p
      where p.role = 'admin';

      continue;$q$;
  v_new text := $q$      from public.profiles p
      where p.role = 'admin';

      -- OQ-731: a clinician's notice that nothing could deliver also reaches the ops desk's phone call. A patient's ladder ends in the inbox.
      if not private.recipient_is_patient(r.recipient_id)
         and not coalesce((select pr.is_test from public.profiles pr where pr.id = r.recipient_id), false) then
        begin
          perform private.page_incident(r.organisation_id, 'critical_notice_exhausted:' || r.id::text,
            'A critical notice to a clinician reached nobody: phone the on-call clinician now',
            'Every delivery step for a critical notice to a clinician (push, then email) failed or went unopened. Phone the on-call clinician and the chief medical officer now, and record who you reached. Notice ' || r.id::text || '.');
        exception when others then
          -- the audit row is guarded too: if it also fails the engine must carry on, never stop escalating every other notice
          begin
            insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
              values (r.organisation_id, 'critical_notification.exhausted_incident_error', 'notification', r.id, jsonb_build_object('error', sqlerrm));
          exception when others then
            null;
          end;
          raise warning 'critical notice %: opening the ops incident for an exhausted ladder failed: %', r.id, sqlerrm;
        end;
      end if;

      continue;$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'escalate_unconfirmed_critical_notifications: the exhausted-branch anchor was not found; the live body has moved on, stop and read it';
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then
    raise exception 'escalate_unconfirmed_critical_notifications: the exhausted-branch anchor appears more than once';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- Self-check: the live body now opens the incident.
do $$
begin
  if pg_get_functiondef('private.escalate_unconfirmed_critical_notifications()'::regprocedure) not like '%critical_notice_exhausted:%' then
    raise exception 'exhausted ladder self-check: the incident is not in the live body';
  end if;
end $$;
