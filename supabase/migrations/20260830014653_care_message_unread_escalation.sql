-- Patient Communication Architecture (77.13) — missed-message escalation,
-- part 2/2.
--
--   Sent -> Not opened -> Reminder -> Escalation if clinically important
--
-- Deliberately built on the Alert System (20260828 series) rather than the
-- older escalation_slas/enqueue_critical_notification engine (20260730):
-- this is a care-team RESPONSIVENESS signal, not a clinical-safety reading,
-- so it belongs in the same governed alert_rules/clinician_alerts pipeline
-- as missed_appointment/overdue_monitoring (both also category=
-- care_management, both also auto-assigned from a governed owner_tier) —
-- not bolted onto the abnormal-vitals engine. Reusing this pipeline also
-- means the "reminder" and "escalation" halves of the spec's own diagram
-- are NOT two separate mechanisms this migration has to invent: raising ONE
-- clinician_alerts row here IS the reminder (private.notify_clinician_alert
-- sends it immediately to the auto-assigned owner), and the ALREADY-LIVE
-- private.escalate_unacknowledged_clinician_alerts() ack-timeout ladder
-- (20260828015134) climbs owner -> backup -> senior -> every admin on its
-- own governed timer if nobody acknowledges — exactly the "escalation if
-- clinically important" half, for free, with zero new escalation code.
--
-- Scope: category='clinical' threads only (77.13's own "if clinically
-- important" qualifier) where the LAST message came from the patient side
-- and the care team has not opened the thread since. channel_sequence is
-- in_app only, per current product direction (no WhatsApp/SMS/voice for
-- this platform's notifications).

-- ---------------------------------------------------------------------------
-- 1. alert_rules v3 — copies v2 (live: 17 entries) forward unchanged, adds
--    unread_clinical_care_message. Selected from the active row rather than
--    a hardcoded id — see 20260810033834's own postmortem on why a
--    hardcoded id silently matches zero rows on a from-scratch replay.
-- ---------------------------------------------------------------------------
insert into public.alert_rules (version, config, notes, is_active)
select
  v2.version + 1,
  v2.config || jsonb_build_array(
    jsonb_build_object(
      'category', 'care_management',
      'type_code', 'unread_clinical_care_message',
      'default_severity', 2,
      'severity_meaning', 'Doctor review: a patient (or their supporter) sent a clinical-category care-team message that nobody on the care team has opened yet, past the reminder window.',
      'evidence_basis', 'New: private.raise_unread_clinical_message_alerts() sweep over care_message_threads (77.13 of the patient-communication spec). Not the same signal as message_safety_flag (17.12) — that is a deterministic danger-phrase match on the message TEXT; this is purely about response latency on an ordinary clinical question nobody has read yet.',
      'owner_tier', 'tier_1',
      'backup_tier', 'tier_2',
      'senior_tier', 'tier_3',
      'ack_timeout_minutes', 240,
      'channel_sequence', jsonb_build_array('in_app'),
      'auto_suppress_duplicates', true,
      'suppress_window_minutes', 1440,
      'effective_date', null,
      'review_date', null
    )
  ),
  'v3: adds unread_clinical_care_message (77.13 missed-message escalation) to v2''s 17 entries, otherwise unchanged. Active-but-unsigned, same posture v1/v2 shipped in — flagged for Clinical Director review/sign-off via public.sign_alert_rules().',
  true
from public.alert_rules v2
where v2.is_active;

update public.alert_rules set is_active = false
where is_active and version <> (select max(version) from public.alert_rules);

-- ---------------------------------------------------------------------------
-- 2. The sweep. Raises at most one alert per unread period per thread
--    (guarded by care_message_threads.unread_alert_id, reset to null on
--    every new message by after_care_message_insert) — the ack-timeout
--    ladder and alert_rules' own dedup_key/suppress_window take it from
--    there. REMINDER_MINUTES (120) is intentionally shorter than the
--    type's own ack_timeout_minutes (240): the alert itself IS the
--    reminder, sent 2h after the patient's message; if still unacknowledged
--    4h after THAT (i.e. 6h after the original message), the existing
--    ladder escalates ownership automatically.
-- ---------------------------------------------------------------------------
create or replace function private.raise_unread_clinical_message_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_alert_id uuid;
  v_recipient uuid;
  v_notified boolean;
begin
  for r in
    select t.id as thread_id, t.organisation_id, t.patient_id, t.subject, t.last_message_at, t.last_message_author_role
    from public.care_message_threads t
    where t.status = 'open'
      and t.category = 'clinical'
      and t.last_message_author_role in ('patient', 'sponsor')
      and (t.care_team_last_read_at is null or t.care_team_last_read_at < t.last_message_at)
      and t.unread_alert_id is null
      and now() - t.last_message_at >= interval '120 minutes'
  loop
    v_alert_id := private.raise_clinician_alert(
      r.organisation_id, r.patient_id, 'clinician_review',
      'Unread patient message',
      format(
        'A clinical-category care-team message ("%s") has not been opened by anyone on the care team %s after it was sent. Read and reply in Messages.',
        r.subject,
        case
          when now() - r.last_message_at >= interval '24 hours' then to_char(extract(hours from now() - r.last_message_at)::int / 24, 'FM999') || ' day(s)'
          else to_char(extract(epoch from now() - r.last_message_at)::int / 3600, 'FM999') || ' hour(s)'
        end
      ),
      'care_management', 'unread_clinical_care_message'
    );

    update public.care_message_threads set unread_alert_id = v_alert_id where id = r.thread_id;

    v_notified := false;
    select p.id into v_recipient
    from public.clinician_alerts ca
    join public.clinical_staff cs on cs.id = ca.responsible_clinician_id
    join public.profiles p on p.id = cs.profile_id
    where ca.id = v_alert_id;

    if v_recipient is not null then
      perform private.notify_clinician_alert(
        v_alert_id, v_recipient, 'clinician_unread_care_message_alert',
        jsonb_build_object('thread_id', r.thread_id::text, 'patient_id', r.patient_id::text)
      );
      v_notified := true;
    end if;

    if not v_notified then
      for v_recipient in select id from public.profiles where role = 'admin' and organisation_id = r.organisation_id loop
        perform private.notify_clinician_alert(
          v_alert_id, v_recipient, 'clinician_unread_care_message_alert',
          jsonb_build_object('thread_id', r.thread_id::text, 'patient_id', r.patient_id::text)
        );
        v_notified := true;
      end loop;
    end if;
  end loop;
end;
$$;

comment on function private.raise_unread_clinical_message_alerts() is
  '77.13. Scheduled sweep (every 15 min): raises one clinician_alerts row (type_code=unread_clinical_care_message) per open, category=clinical thread whose last patient/sponsor message has sat unread by the care team for 2h+. private.notify_clinician_alert sends the reminder to the auto-assigned owner (or every org admin if none is active at the governed tier); private.escalate_unacknowledged_clinician_alerts (20260828015134) climbs the ack-timeout ladder from there if still unacknowledged.';

revoke all on function private.raise_unread_clinical_message_alerts() from public, anon;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'raise-unread-clinical-message-alerts') then
    perform cron.unschedule('raise-unread-clinical-message-alerts');
  end if;
end $$;

select cron.schedule(
  'raise-unread-clinical-message-alerts',
  '*/15 * * * *',
  $$ select private.raise_unread_clinical_message_alerts(); $$
);

do $$
begin
  if (select count(*) from public.alert_rules where is_active) <> 1 then
    raise exception 'FAIL: expected exactly one active alert_rules version';
  end if;
  if not exists (
    select 1 from public.alert_rules c, jsonb_array_elements(c.config) e
    where c.is_active and e->>'type_code' = 'unread_clinical_care_message'
  ) then
    raise exception 'FAIL: unread_clinical_care_message was not registered in alert_rules';
  end if;
  if (select jsonb_array_length(config) from public.alert_rules where is_active) <> 18 then
    raise exception 'FAIL: active alert_rules config should have 18 entries (17 carried forward + 1 new)';
  end if;
  if has_function_privilege('anon', 'private.raise_unread_clinical_message_alerts()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute raise_unread_clinical_message_alerts';
  end if;
  if not exists (select 1 from cron.job where jobname = 'raise-unread-clinical-message-alerts') then
    raise exception 'FAIL: cron job was not scheduled';
  end if;
  raise notice 'PASS: alert_rules v3 active (18 entries), unread-message sweep scheduled every 15 min, anon denied';
end $$;
