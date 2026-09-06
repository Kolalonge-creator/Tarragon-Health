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
  if has_function_privilege('anon', 'private.raise_unread_clinical_message_alerts()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute raise_unread_clinical_message_alerts';
  end if;
  if not exists (select 1 from cron.job where jobname = 'raise-unread-clinical-message-alerts') then
    raise exception 'FAIL: cron job was not scheduled';
  end if;
  raise notice 'PASS: alert_rules new version active, unread-message sweep scheduled every 15 min, anon denied';
end $$;
