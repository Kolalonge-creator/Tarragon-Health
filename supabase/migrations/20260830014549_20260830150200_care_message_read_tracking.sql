alter table public.care_message_threads
  add column if not exists patient_last_read_at timestamptz,
  add column if not exists care_team_last_read_at timestamptz,
  add column if not exists last_message_author_role public.care_message_author,
  add column if not exists unread_alert_id uuid references public.clinician_alerts (id) on delete set null;

comment on column public.care_message_threads.patient_last_read_at is
  '77.13/77.15 read tracking. Stamped by mark_care_message_thread_read() when the patient OR a consented sponsor opens the thread — they share one clock, matching how 20260731181318 already treats them as one side of the conversation.';
comment on column public.care_message_threads.care_team_last_read_at is
  '77.13/77.15 read tracking. Stamped by mark_care_message_thread_read() when any org-staff caller opens the thread. Compared against last_message_at by the unread-message alert sweep (20260830150400) to detect a clinical-category patient message nobody on the care team has opened yet.';
comment on column public.care_message_threads.last_message_author_role is
  'Denormalised from the most recent care_messages row, kept in sync by after_care_message_insert. Lets the unread-alert sweep filter "last message was FROM the patient side" with a plain column comparison instead of a per-thread subquery.';
comment on column public.care_message_threads.unread_alert_id is
  'The clinician_alerts row raised for the CURRENT unread period on this thread, if any (private.raise_unread_clinical_message_alerts, 20260830150400). Reset to null on every new care_messages insert so a later unread period can raise its own alert. Not itself read/write from the client.';

create index if not exists care_message_threads_unread_care_team_idx
  on public.care_message_threads (last_message_at)
  where category = 'clinical' and status = 'open' and unread_alert_id is null;

create or replace function public.mark_care_message_thread_read(p_thread_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select organisation_id, patient_id into v_org, v_patient
  from public.care_message_threads where id = p_thread_id;
  if v_org is null then raise exception 'thread not found'; end if;

  if private.is_org_staff(v_org) then
    update public.care_message_threads set care_team_last_read_at = now() where id = p_thread_id;
  elsif v_uid = v_patient or private.can_read_clinical(v_patient) then
    update public.care_message_threads set patient_last_read_at = now() where id = p_thread_id;
  else
    raise exception 'not authorised' using errcode = '42501';
  end if;
end;
$$;

comment on function public.mark_care_message_thread_read(uuid) is
  '77.13. Server-derives which side of the conversation the caller is on (never client-supplied) and stamps that side''s read clock to now(). Called by the UI whenever a thread is opened.';

revoke all on function public.mark_care_message_thread_read(uuid) from public, anon;
grant execute on function public.mark_care_message_thread_read(uuid) to authenticated;

create or replace function private.after_care_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_clinician_id uuid;
begin
  update public.care_message_threads
    set last_message_at = new.created_at,
        updated_at = now(),
        last_message_author_role = new.author_role,
        unread_alert_id = null
    where id = new.thread_id;

  perform private.record_timeline_event(
    new.organisation_id, new.patient_id, 'message_posted',
    'care_messages', new.id,
    'New message',
    case new.author_role
      when 'care_team' then 'Your care team sent you a message'
      when 'sponsor' then coalesce(new.author_display, 'Someone who supports you')
                          || ' messaged your care team'
      else 'You messaged your care team' end,
    new.created_at,
    new.actor_clinical_staff_id,
    jsonb_build_object('thread_id', new.thread_id::text, 'author_role', new.author_role)
  );

  if new.author_role is distinct from 'patient' then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'in_app', 'pending', 'new_care_message',
      jsonb_build_object('thread_id', new.thread_id::text,
                         'author_role', new.author_role,
                         'author_display', new.author_display,
                         'recipient_kind', 'patient')
    );
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  select
    new.organisation_id, pa.grantee_user_id, 'in_app', 'pending', 'new_care_message',
    jsonb_build_object('thread_id', new.thread_id::text,
                       'author_role', new.author_role,
                       'author_display', new.author_display,
                       'recipient_kind', 'supporter')
  from public.profile_access pa
  where pa.profile_id = new.patient_id
    and pa.clinical_access
    and pa.grantee_user_id is distinct from new.author_profile_id;

  if new.author_role is distinct from 'care_team' then
    select clinician_id into v_clinician_id
    from public.care_team_assignment
    where patient_id = new.patient_id;

    if v_clinician_id is not null then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      values (
        new.organisation_id, v_clinician_id, 'in_app', 'pending', 'clinician_new_care_message',
        jsonb_build_object('thread_id', new.thread_id::text,
                           'patient_id', new.patient_id::text,
                           'author_role', new.author_role,
                           'author_display', new.author_display)
      );
    end if;
  end if;

  return new;
end;
$$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'after_care_message_insert' and pronamespace = 'private'::regnamespace;
  if v_def not like '%last_message_author_role = new.author_role%' then
    raise exception 'FAIL: after_care_message_insert is missing the last_message_author_role bookkeeping';
  end if;
  if v_def not like '%unread_alert_id = null%' then
    raise exception 'FAIL: after_care_message_insert is missing the unread_alert_id reset';
  end if;
  if v_def not like '%clinician_new_care_message%' or v_def not like '%record_timeline_event%' then
    raise exception 'FAIL: after_care_message_insert lost a pre-existing branch';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_message_threads' and column_name = 'care_team_last_read_at'
  ) then
    raise exception 'FAIL: care_team_last_read_at was not added';
  end if;
  if has_function_privilege('anon', 'public.mark_care_message_thread_read(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute mark_care_message_thread_read';
  end if;
  raise notice 'PASS: read-tracking columns added, mark_care_message_thread_read() in place, after_care_message_insert carries every prior branch forward';
end $$;
