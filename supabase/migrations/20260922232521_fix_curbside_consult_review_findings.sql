-- Tarragon Health — fixes from /code-review high on
-- 20260922230142_curbside_consults.sql / 20260922230221_..._notification_template.sql,
-- caught before the PR opened rather than by a later audit (CLAUDE.md's own
-- Definition of Done: "a bug ships, works in the author's own testing, and
-- is only found weeks later" — this is the fast-follow this rule exists to
-- produce).
--
-- 1. count_curbside_consults_awaiting_reply() never got the per-function
--    `revoke execute ... from public, anon` its three sibling RPCs in the
--    same migration all received — confirmed live via has_function_privilege
--    that anon could execute it. Same recurring class of bug as
--    20260902174504_default_privileges_never_grant_anon_or_authenticated_execute_on_public_functions.sql:
--    Supabase's bootstrap event triggers re-grant PUBLIC/anon EXECUTE on any
--    newly created function regardless of ALTER DEFAULT PRIVILEGES, so this
--    needs a per-object revoke every time, not a one-off fix.
--
-- 2. curbside_consult_threads.last_message_at/last_message_sender_id were
--    left directly client-writable via a raw PATCH: the BEFORE UPDATE
--    trigger's immutable-column check covered organisation_id/initiator/
--    recipient/patient_id/subject/created_at but deliberately skipped these
--    two (the original migration's own comment called this "cosmetic" —
--    wrong: both isAwaitingMyReply() and count_curbside_consults_awaiting_reply()
--    key off exactly this column with no corroborating message row, so a
--    participant could spoof "awaiting reply" state, or clear their own
--    "your turn" badge, without ever posting a message). Fixed by having
--    private.after_curbside_consult_message_insert() mark its own UPDATE
--    with a transaction-local flag (set_config, is_local = true — resets
--    automatically at commit/rollback and is explicitly cleared right after
--    use besides) that private.enforce_curbside_consult_thread_update()
--    checks before allowing either column to move; a client can never set
--    this flag itself (no dynamic SQL/arbitrary SET is exposed through any
--    granted RPC or table grant).
--
-- 3. The notification_template_locales row for curbside_consult_new_message
--    interpolated {{sender_display}}, a key the trigger's payload never
--    sets (only thread_id/subject/sender_clinical_staff_id/patient_id).
--    Currently dead (send-pending-notifications/index.ts excludes channel=
--    'in_app' from the rows it renders, so notification-bell.tsx's own
--    describe() is what actually shows today) but wrong content sitting in
--    a table whose own header calls it authoritative is worse than leaving
--    it consistent with the real payload shape.

-- --- Fix 1: close the anon-execute gap -------------------------------------
revoke execute on function public.count_curbside_consults_awaiting_reply() from public, anon;

-- --- Fix 2: last_message_at/last_message_sender_id become trigger-only ----
create or replace function private.enforce_curbside_consult_thread_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_caller_staff_id uuid;
begin
  if new.organisation_id is distinct from old.organisation_id
    or new.initiator_clinical_staff_id is distinct from old.initiator_clinical_staff_id
    or new.recipient_clinical_staff_id is distinct from old.recipient_clinical_staff_id
    or new.patient_id is distinct from old.patient_id
    or new.subject is distinct from old.subject
    or new.created_at is distinct from old.created_at
  then
    raise exception 'this field cannot be changed after the consult is created';
  end if;

  -- last_message_at/last_message_sender_id may only move via the trusted
  -- system update in private.after_curbside_consult_message_insert(), which
  -- marks its own UPDATE with this transaction-local flag. Never via a raw
  -- client PATCH, which would let a participant spoof "awaiting reply"
  -- state (or clear it) without an actual message.
  if (new.last_message_at is distinct from old.last_message_at
      or new.last_message_sender_id is distinct from old.last_message_sender_id)
    and coalesce(current_setting('curbside_consult.internal_update', true), '') is distinct from 'true'
  then
    raise exception 'last_message_at/last_message_sender_id can only be set by posting a message';
  end if;

  v_caller_staff_id := private.timeline_staff_from_profile(v_uid, old.organisation_id);
  if v_caller_staff_id is null
    or v_caller_staff_id not in (old.initiator_clinical_staff_id, old.recipient_clinical_staff_id)
  then
    raise exception 'not authorised';
  end if;

  if old.status = 'closed' and new.status is distinct from old.status then
    raise exception 'a closed curbside consult cannot be reopened — start a new one instead';
  end if;

  if new.status = 'closed' and old.status is distinct from new.status then
    new.closed_at := now();
    new.closed_by := v_caller_staff_id;
  else
    new.closed_at := old.closed_at;
    new.closed_by := old.closed_by;
  end if;

  return new;
end;
$$;

create or replace function private.after_curbside_consult_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_initiator uuid;
  v_recipient uuid;
  v_initiator_profile uuid;
  v_recipient_profile uuid;
  v_subject text;
  v_patient_id uuid;
  v_notify_profile uuid;
  v_notify_staff_id uuid;
begin
  -- Marks this specific UPDATE as trigger-driven so
  -- enforce_curbside_consult_thread_update() allows the last_message_*
  -- bump. is_local = true: transaction-scoped, resets automatically at
  -- commit/rollback; cleared explicitly right after regardless.
  perform set_config('curbside_consult.internal_update', 'true', true);
  update public.curbside_consult_threads
    set last_message_at = new.created_at,
        last_message_sender_id = new.sender_clinical_staff_id,
        updated_at = now()
    where id = new.thread_id
    returning initiator_clinical_staff_id, recipient_clinical_staff_id, subject, patient_id
    into v_initiator, v_recipient, v_subject, v_patient_id;
  perform set_config('curbside_consult.internal_update', 'false', true);

  -- Only the OTHER party's profile_id is ever needed for the notification
  -- (new.sender_clinical_staff_id already tells us which side sent) — one
  -- lookup instead of two.
  v_notify_staff_id := case when new.sender_clinical_staff_id = v_initiator then v_recipient else v_initiator end;
  select profile_id into v_notify_profile from public.clinical_staff where id = v_notify_staff_id;

  if v_notify_profile is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, v_notify_profile, 'in_app', 'pending', 'curbside_consult_new_message',
      jsonb_build_object(
        'thread_id', new.thread_id::text,
        'subject', v_subject,
        'sender_clinical_staff_id', new.sender_clinical_staff_id::text,
        'patient_id', v_patient_id::text
      )
    );
  end if;

  return new;
end;
$$;

-- --- Fix 3: notification copy matches the payload the trigger actually sends ---
update public.notification_template_locales
set body = 'New reply in your curbside consult: "{{subject}}"'
where template_key = 'curbside_consult_new_message' and locale = 'en' and channel = 'in_app';

do $$
begin
  if has_function_privilege('anon', 'public.count_curbside_consults_awaiting_reply()', 'EXECUTE') then
    raise exception 'FAIL: anon can still execute count_curbside_consults_awaiting_reply';
  end if;
  if (select body from public.notification_template_locales
      where template_key = 'curbside_consult_new_message' and locale = 'en' and channel = 'in_app') like '%sender_display%' then
    raise exception 'FAIL: curbside_consult_new_message locale still references sender_display';
  end if;
  if pg_get_functiondef('private.enforce_curbside_consult_thread_update'::regproc)
      not like '%curbside_consult.internal_update%' then
    raise exception 'FAIL: enforce_curbside_consult_thread_update was not updated';
  end if;
  if pg_get_functiondef('private.after_curbside_consult_message_insert'::regproc)
      not like '%curbside_consult.internal_update%' then
    raise exception 'FAIL: after_curbside_consult_message_insert was not updated';
  end if;
end $$;
