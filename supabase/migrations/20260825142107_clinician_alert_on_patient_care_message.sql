-- Clinician-facing alert when a patient/sponsor posts a care message.
--
-- 20260719110000_care_messages.sql deliberately skipped this direction
-- ("Patient→team posts surface in the staff worklist, so they need no
-- push") — correct at the time, since no push channel existed yet at all.
-- It still doesn't: push_first_channel_remap.sql (2026-07-30) made push the
-- default first channel for every 'whatsapp' row with an active
-- subscription, and the vitals-red-flag/emergency clinician alerts already
-- rely on exactly that to reach a doctor off the dashboard
-- (vitals_red_flag_notification_wiring.sql). A patient writing in has had
-- no equivalent signal at all — a clinician only finds out by opening
-- /clinician/messages and looking. This closes that gap the same way:
-- queue 'whatsapp' (auto-upgraded to 'push' by remap_notification_channel
-- when a subscription exists) plus the mandatory 'in_app' companion
-- (guarantee_in_app_notification_companions.sql's convention) so it also
-- shows in the NotificationBell with no external provider dependency.
--
-- Routine priority, not the critical escalation ladder
-- (enqueue_critical_notification): a message is not a clinical emergency,
-- so a missed alert must never force-escalate to voice/SMS or page an
-- admin — the worklist itself remains the durable safety net, same as
-- before this migration.
--
-- Recipients are every clinician AND care_coordinator in the thread's org,
-- not a single assigned owner — care_message_threads has no per-thread
-- assignee (any org staff may read/reply, per care_messages_select/
-- care_message_threads_select), and Care Coordinators are the platform's
-- designed first-line triage for exactly this kind of inbound contact (see
-- CLAUDE.md's Clinical Tier Ladder: "Care Coordinator... logistics only:
-- check-ins... routes anything needing judgment to Tier 1"). This mirrors,
-- but intentionally does not reuse, the clinician-only fan-out the
-- vitals-red-flag pathway uses for actual medical escalations.
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

  -- New: alert the org's care team when the message came from outside it.
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
    where p.organisation_id = new.organisation_id
      and p.role in ('clinician', 'care_coordinator');

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
    where p.organisation_id = new.organisation_id
      and p.role in ('clinician', 'care_coordinator');
  end if;

  return new;
end;
$$;

-- Fail loud rather than silently regress: confirms the new clinician-facing
-- branch is actually present in the live function body.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('private.after_care_message_insert()'::regprocedure) into v_def;
  if v_def not like '%new_patient_message_clinician_alert%' then
    raise exception 'private.after_care_message_insert() is missing the clinician-alert branch';
  end if;
end $$;
