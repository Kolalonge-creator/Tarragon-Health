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
