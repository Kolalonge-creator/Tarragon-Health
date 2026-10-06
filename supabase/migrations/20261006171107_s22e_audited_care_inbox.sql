-- S22 part 6: the care-team inbox keeps its breadth and gains an audit (OQ-157, founder decision 2026-10-06: option a).
--
-- The inbox stays shared by every org staff account (coordinators and clinicians answer patients there). What changes is that
-- message BODIES and attachments can no longer be read straight from the tables by staff: a staff member opens a thread through
-- open_care_thread_audited(), which writes an audit_log row (INV-10), and an attachment through open_care_attachment_audited().
-- Thread headers (subject, status, timestamps) stay readable by staff so the inbox list still works. Patients, the people they
-- have given messaging access to, and break-glass emergency access read exactly as before (their branches of the policies stay).
--
-- One audit row per person, per thread (or attachment), per 10 minutes: opening a thread refreshes the view whenever the window
-- regains focus or a reply is sent, and a row per refresh would bury the log. The 10 minutes is a technical de-duplication
-- window, not a clinical value.

-- ---------------------------------------------------------------------------
-- 1. Open a thread: patient (own) or org staff (audited)
-- ---------------------------------------------------------------------------
create function public.open_care_thread_audited(p_thread uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  t public.care_message_threads%rowtype;
  v_staff boolean;
  v_msgs jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from public.care_message_threads where id = p_thread;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if t.patient_id = v_uid then
    v_staff := false;
  elsif private.is_org_staff(t.organisation_id) then
    v_staff := true;
  else
    -- a supporter or break-glass reader: they read the table under its own policy, the caller falls back to that
    raise exception 'not authorised for this thread' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
           to_jsonb(m) || jsonb_build_object('attachments', coalesce((
             select jsonb_agg(to_jsonb(a) order by a.created_at) from public.care_message_attachments a where a.message_id = m.id), '[]'::jsonb))
           order by m.created_at), '[]'::jsonb)
    into v_msgs
    from public.care_messages m where m.thread_id = p_thread;

  if v_staff and not exists (
       select 1 from public.audit_log l
        where l.actor_id = v_uid and l.action = 'care_thread.open' and l.entity_id = p_thread
          and l.created_at > now() - interval '10 minutes') then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
    values (t.organisation_id, v_uid, 'care_thread.open', 'care_message_thread', p_thread,
            jsonb_build_object('basis', 'shared_inbox', 'messages', jsonb_array_length(v_msgs), 'confidential', t.confidential),
            'success', t.patient_id);
  end if;
  return v_msgs;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Open an attachment: patient (own) or org staff (audited); returns the storage path to sign
-- ---------------------------------------------------------------------------
create function public.open_care_attachment_audited(p_attachment uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a public.care_message_attachments%rowtype;
  v_staff boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into a from public.care_message_attachments where id = p_attachment;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if a.patient_id = v_uid then
    v_staff := false;
  elsif private.is_org_staff(a.organisation_id) then
    v_staff := true;
  else
    raise exception 'not authorised for this attachment' using errcode = '42501';
  end if;
  if v_staff and not exists (
       select 1 from public.audit_log l
        where l.actor_id = v_uid and l.action = 'care_attachment.open' and l.entity_id = p_attachment
          and l.created_at > now() - interval '10 minutes') then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
    values (a.organisation_id, v_uid, 'care_attachment.open', 'care_message_attachment', p_attachment,
            jsonb_build_object('basis', 'shared_inbox', 'thread_id', a.thread_id), 'success', a.patient_id);
  end if;
  return a.file_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The scope of a message (no body), so staff can attach a file to a reply without reading message rows
-- ---------------------------------------------------------------------------
create function public.care_message_scope(p_message uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  m record;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select organisation_id, patient_id, thread_id into m from public.care_messages where id = p_message;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if m.patient_id <> v_uid and not private.is_org_staff(m.organisation_id) then
    raise exception 'not authorised for this message' using errcode = '42501';
  end if;
  return jsonb_build_object('organisation_id', m.organisation_id, 'patient_id', m.patient_id, 'thread_id', m.thread_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The staff branch leaves the body and attachment policies (the other branches are unchanged)
-- ---------------------------------------------------------------------------
drop policy if exists care_messages_select on public.care_messages;
create policy care_messages_select on public.care_messages
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or (
      (private.can_read_clinical(patient_id, 'messaging'::public.care_access_category)
        or private.has_emergency_access(patient_id, 'messaging'::public.care_access_category)
        or private.can_read_clinical(patient_id, 'communicate_with_care_team'::public.caregiver_permission))
      and exists (select 1 from public.care_message_threads t where t.id = care_messages.thread_id and not t.confidential)
    )
  );

drop policy if exists care_message_attachments_select on public.care_message_attachments;
create policy care_message_attachments_select on public.care_message_attachments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.can_read_clinical(patient_id, 'messaging'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'messaging'::public.care_access_category)
  );

-- ---------------------------------------------------------------------------
-- 5. The communication log is message metadata only (no body), so it keeps working through an explicit filter that mirrors the message policy
-- ---------------------------------------------------------------------------
create or replace view public.care_message_communication_log as
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
    select count(*) as attachment_count from public.care_message_attachments a where a.message_id = m.id
  ) att on true
  where m.patient_id = (select auth.uid())
     or private.is_org_staff(m.organisation_id)
     or (not t.confidential
         and (private.can_read_clinical(m.patient_id, 'messaging'::public.care_access_category)
              or private.has_emergency_access(m.patient_id, 'messaging'::public.care_access_category)
              or private.can_read_clinical(m.patient_id, 'communicate_with_care_team'::public.caregiver_permission)));
alter view public.care_message_communication_log set (security_invoker = false);
comment on view public.care_message_communication_log is
  '77.15 communication audit trail: message metadata only, never the body. Runs as its owner with an explicit filter (the patient, or org staff) because staff can no longer read message rows directly (S22e, OQ-157).';

-- ---------------------------------------------------------------------------
-- 6. The AI draft's input snapshot holds the last messages verbatim, so it would be a way around the audit
-- ---------------------------------------------------------------------------
-- The snapshot is written by the service role and read by nobody in the app (it is the model's own audit record). Staff keep every
-- other column, including the draft text they review. Table-level select is revoked first because a column revoke alone does
-- nothing under a table-level grant.
revoke select on public.care_message_draft_replies from authenticated;
grant select (id, organisation_id, patient_id, thread_id, status, model_id, draft_text, needs_clinical_review, review_reason,
              error_message, generated_at)
  on public.care_message_draft_replies to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The de-duplication lookup in the open functions needs its own small index (audit_log is large and has only an actor index)
-- ---------------------------------------------------------------------------
create index audit_log_inbox_open_idx on public.audit_log (actor_id, entity_id, created_at desc)
  where action in ('care_thread.open', 'care_attachment.open');

-- ---------------------------------------------------------------------------
-- Grants and self-checks
-- ---------------------------------------------------------------------------
revoke all on function public.open_care_thread_audited(uuid) from public, anon;
revoke all on function public.open_care_attachment_audited(uuid) from public, anon;
revoke all on function public.care_message_scope(uuid) from public, anon;
grant execute on function public.open_care_thread_audited(uuid) to authenticated;
grant execute on function public.open_care_attachment_audited(uuid) to authenticated;
grant execute on function public.care_message_scope(uuid) to authenticated;

do $$
declare v_fn text;
begin
  foreach v_fn in array array['public.open_care_thread_audited(uuid)', 'public.open_care_attachment_audited(uuid)', 'public.care_message_scope(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S22e assertion: anon can execute %', v_fn; end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('care_messages', 'care_message_attachments')
              and cmd = 'SELECT' and qual like '%is_org_staff%') then
    raise exception 'S22e assertion: a select policy on message bodies or attachments still admits org staff directly';
  end if;
  if has_column_privilege('authenticated', 'public.care_message_draft_replies', 'input_snapshot', 'SELECT') then
    raise exception 'S22e assertion: staff can still read the draft input snapshot (the last messages, verbatim)';
  end if;
  if not has_column_privilege('authenticated', 'public.care_message_draft_replies', 'draft_text', 'SELECT') then
    raise exception 'S22e assertion: staff lost the draft text they review';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'care_messages' and cmd = 'SELECT') <> 1 then
    raise exception 'S22e assertion: exactly one select policy on care_messages';
  end if;
end $$;
