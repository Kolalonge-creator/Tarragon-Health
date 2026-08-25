-- Doctor-app PWA follow-up, part 1: a mute switch for the patient-message
-- alert (20260825142107_clinician_alert_on_patient_care_message.sql), plus
-- a correctness fix on the same fan-out found while adding it.
--
-- Every clinician/care coordinator in the org gets pushed on every patient
-- message with no way to tune it — real alert-fatigue risk as message
-- volume grows. notify_on_patient_message is a per-clinical_staff-record,
-- self-service opt-out (default true, so nobody goes silently dark just
-- because this column now exists) — set only through
-- set_notify_on_patient_message() below, never a direct table write:
-- clinical_staff is otherwise admin-managed (CLAUDE.md's Clinical Tier
-- Ladder), and clinical_staff_update's RLS is row-level only (any org staff
-- may update any org member's row, not just their own) — a narrow RPC that
-- touches exactly this one column on the caller's own row is the only safe
-- way to let a clinician self-serve here without opening a write path onto
-- doctor_tier/indemnity/credential fields.
--
-- Also folds in a fix this change surfaced: the original fan-out
-- (20260825142107) matched on profiles.role alone, so a deactivated
-- clinical_staff record whose profiles.role hadn't been changed yet would
-- still get paged. Joining to clinical_staff and requiring active closes
-- that gap while it's already being touched.

alter table public.clinical_staff
  add column notify_on_patient_message boolean not null default true;

create or replace function public.set_notify_on_patient_message(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.clinical_staff
    set notify_on_patient_message = p_enabled
    where profile_id = v_uid;
end;
$$;

revoke all on function public.set_notify_on_patient_message(boolean) from public, anon;
grant execute on function public.set_notify_on_patient_message(boolean) to authenticated;

create or replace function private.after_care_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.care_message_threads
    set last_message_at = new.created_at, updated_at = now()
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

  if new.author_role is distinct from 'care_team' then
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

  -- Alert the org's care team when the message came from outside it —
  -- skips anyone who has muted this alert (notify_on_patient_message) or
  -- whose clinical_staff record is no longer active.
  if new.author_role is distinct from 'care_team' then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    select
      new.organisation_id, p.id, 'whatsapp', 'pending', 'new_patient_message_clinician_alert',
      jsonb_build_object(
        'thread_id', new.thread_id::text,
        'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
        'author_role', new.author_role
      )
    from public.profiles p
    join public.clinical_staff cs on cs.profile_id = p.id and cs.organisation_id = p.organisation_id
    where p.organisation_id = new.organisation_id
      and p.role in ('clinician', 'care_coordinator')
      and cs.active
      and coalesce(cs.notify_on_patient_message, true);

    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    select
      new.organisation_id, p.id, 'in_app', 'pending', 'new_patient_message_clinician_alert',
      jsonb_build_object(
        'thread_id', new.thread_id::text,
        'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
        'author_role', new.author_role
      )
    from public.profiles p
    join public.clinical_staff cs on cs.profile_id = p.id and cs.organisation_id = p.organisation_id
    where p.organisation_id = new.organisation_id
      and p.role in ('clinician', 'care_coordinator')
      and cs.active
      and coalesce(cs.notify_on_patient_message, true);
  end if;

  return new;
end;
$$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('private.after_care_message_insert()'::regprocedure) into v_def;
  if v_def not like '%notify_on_patient_message%' then
    raise exception 'private.after_care_message_insert() is missing the notify_on_patient_message gate';
  end if;
end $$;
