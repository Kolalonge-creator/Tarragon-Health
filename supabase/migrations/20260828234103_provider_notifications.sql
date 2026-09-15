-- Tarragon Health — provider-facing in-app notifications (Care Team / Provider
-- Workspace §5.17: new referral, patient message, care-plan task).
--
-- No new UI, no new hook, no new bell: NotificationBell (components/shell/
-- notification-bell.tsx) already renders unconditionally in app-shell.tsx for
-- every role, already polls `notifications` for `recipient_id = auth.uid()
-- and channel = 'in_app'` (lib/queries/notifications.ts), and already has
-- mark-read/mark-all-read wired up. It has simply never received a row whose
-- recipient was a clinician — every existing in_app template targets a
-- patient or a sponsor. This migration is backend-only: three new triggers
-- that insert an in_app row for the patient's assigned clinician
-- (care_team_assignment.clinician_id), plus matching describe() cases added
-- to notification-bell.tsx in the same change.
--
-- Deliberately not attempted here: an urgent/routine distinction (the other
-- half of §5.17). None of these three events carries a real urgency signal
-- today — specialist_referrals.urgency is typically null until a clinician
-- triages it (that's the point of the existing "Referrals to triage"
-- worklist tile), and neither care_plan_review_prompts nor care_messages has
-- one at all. Inventing one would be exactly the kind of fabricated signal
-- this codebase's own drug-safety/wearable-adapter comments warn against —
-- left as a follow-up for whenever a real per-event urgency exists.
--
-- Skipped entirely: clinician_alerts already has its own severity/SLA/ack
-- machinery (useClinicianAlerts, 60s poll) — that is the correct "results to
-- review / urgent" surface and duplicating it into `notifications` would
-- give the same event two independently-driftable read states.

-- ---------------------------------------------------------------------------
-- 1. New referral -> assigned clinician
-- ---------------------------------------------------------------------------
create or replace function private.notify_clinician_new_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinician_id uuid;
begin
  select clinician_id into v_clinician_id
  from public.care_team_assignment
  where patient_id = new.patient_id;

  if v_clinician_id is null then
    return new;
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, v_clinician_id, 'in_app', 'pending', 'clinician_new_referral',
    jsonb_build_object(
      'referral_id', new.id::text,
      'patient_id', new.patient_id::text,
      'specialist_type', new.specialist_type
    )
  );

  return new;
end;
$$;

drop trigger if exists specialist_referrals_notify_clinician on public.specialist_referrals;
create trigger specialist_referrals_notify_clinician
  after insert on public.specialist_referrals
  for each row execute function private.notify_clinician_new_referral();

-- ---------------------------------------------------------------------------
-- 2. Care-plan task -> assigned clinician
--
-- "Care-plan task" has no dedicated table (confirmed by grep: no
-- care_plan_task/care_plan_goal/care_plan_intervention table exists anywhere
-- in this schema) — care_plan_review_prompts (20260717223000) is the closest
-- real analog: a system-raised item requiring a clinician to look at a
-- patient's care plan, which is exactly what this spec line describes.
-- ---------------------------------------------------------------------------
create or replace function private.notify_clinician_care_plan_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinician_id uuid;
begin
  select clinician_id into v_clinician_id
  from public.care_team_assignment
  where patient_id = new.patient_id;

  if v_clinician_id is null then
    return new;
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, v_clinician_id, 'in_app', 'pending', 'clinician_care_plan_task',
    jsonb_build_object(
      'prompt_id', new.id::text,
      'patient_id', new.patient_id::text,
      'reason', new.reason
    )
  );

  return new;
end;
$$;

drop trigger if exists care_plan_review_prompts_notify_clinician on public.care_plan_review_prompts;
create trigger care_plan_review_prompts_notify_clinician
  after insert on public.care_plan_review_prompts
  for each row execute function private.notify_clinician_care_plan_task();

-- ---------------------------------------------------------------------------
-- 3. Patient (or sponsor) message -> assigned clinician
--
-- Byte-identical to the live definition (20260731182348_care_message_
-- notification_recipient_kind.sql) apart from the new block at the end. The
-- existing "surfaces in the staff worklist, so it needs no push" comment on
-- the original 20260719110000 version was true in intent but not in fact —
-- there was never a worklist tile or notification for an unread patient
-- message; this closes that gap via the notification the bell already knows
-- how to show, rather than adding a fifteenth worklist tile.
-- ---------------------------------------------------------------------------
create or replace function private.after_care_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_clinician_id uuid;
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

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'specialist_referrals' and tg.tgname = 'specialist_referrals_notify_clinician'
      and not tg.tgisinternal
  ) then
    raise exception 'specialist_referrals_notify_clinician trigger was not created';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'care_plan_review_prompts' and tg.tgname = 'care_plan_review_prompts_notify_clinician'
      and not tg.tgisinternal
  ) then
    raise exception 'care_plan_review_prompts_notify_clinician trigger was not created';
  end if;

  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'after_care_message_insert' and pronamespace = 'private'::regnamespace;
  if v_def not like '%clinician_new_care_message%' then
    raise exception 'after_care_message_insert is missing the clinician-notify branch';
  end if;
  -- Every pre-existing branch must survive the rewrite.
  if v_def not like '%recipient_kind%, ''supporter''%'
     and v_def not like '%''recipient_kind'', ''supporter''%' then
    raise exception 'after_care_message_insert lost the supporter notification branch';
  end if;
  if v_def not like '%record_timeline_event%' then
    raise exception 'after_care_message_insert lost the timeline-event branch';
  end if;
end $$;
