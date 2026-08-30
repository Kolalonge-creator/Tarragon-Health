-- Patient Communication Architecture (77.15) — communication audit trail.
--
-- "Record: sender, recipient, timestamp, message category, delivery, read
-- status, attachments." Today that's split across three non-equivalent
-- mechanisms (see the gap analysis): notifications' own delivery/read
-- columns (automated one-way sends only), the generic audit_log (business
-- events, not message metadata), and the row-change audit triggers (column
-- names + a row hash, not content). None of them, alone or together, answer
-- "who sent what to whom, in what category, was it delivered/read, did it
-- carry an attachment" for a care_messages conversation.
--
-- This does NOT add a new audit table — doing so would be a second,
-- independently-driftable record of facts care_messages/care_message_
-- threads/care_message_attachments already hold authoritatively (the same
-- reasoning 20260827203614 gave for not duplicating clinician_alerts into
-- notifications). Instead, same shape as patient_timeline (20260717181349):
-- a security_invoker view joining the existing RLS'd tables. It runs with
-- the CALLER's own privileges, so a patient sees only their own threads and
-- org staff see only their org's — the underlying care_messages_select /
-- care_message_threads_select policies are the real access control; this
-- view adds no new exposure.
create or replace view public.care_message_communication_log
with (security_invoker = true) as
  select
    m.id                        as message_id,
    m.thread_id,
    m.organisation_id,
    m.patient_id,
    m.author_role               as sender_role,
    coalesce(m.author_display, case m.author_role
      when 'care_team' then 'Care team' when 'sponsor' then 'Supporter' else 'Patient' end) as sender_display,
    m.patient_id                as recipient_patient_id,
    t.subject,
    t.category,
    t.status                    as thread_status,
    m.created_at                as sent_at,
    -- "Delivered" has no separate meaning for an in-app conversation (there
    -- is no channel hop to fail) — a row existing IS delivered. Read status
    -- is the real signal 77.15 asks for, taken from whichever side did NOT
    -- author this message (the other side's own message is trivially
    -- "read" by them; what matters is whether the OTHER party has read up
    -- to this point).
    case
      when m.author_role = 'care_team' then t.patient_last_read_at >= m.created_at
      else t.care_team_last_read_at >= m.created_at
    end                          as read_by_recipient,
    case
      when m.author_role = 'care_team' then t.patient_last_read_at
      else t.care_team_last_read_at
    end                          as recipient_read_at,
    coalesce(att.attachment_count, 0) as attachment_count
  from public.care_messages m
  join public.care_message_threads t on t.id = m.thread_id
  left join lateral (
    select count(*) as attachment_count
    from public.care_message_attachments a
    where a.message_id = m.id
  ) att on true;

comment on view public.care_message_communication_log is
  '77.15 communication audit trail. security_invoker read-model over care_messages/care_message_threads/care_message_attachments — no new source of truth, underlying RLS enforces access exactly as it does today. read_by_recipient/recipient_read_at reflect whichever side did not author the message.';

grant select on public.care_message_communication_log to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.views where table_schema = 'public' and table_name = 'care_message_communication_log') then
    raise exception 'FAIL: care_message_communication_log view was not created';
  end if;
  raise notice 'PASS: care_message_communication_log view created (security_invoker)';
end $$;
