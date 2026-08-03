-- English only, no voice channel (founder decision, 2026-08-03).
--
-- "Remove the voice part, let it be strictly english for now. we can explore
-- that in the future."
--
-- WHAT THIS DOES: removes the voice branch from the notification-channel remap,
-- which is the only thing that ever turned a queued reminder into a voice call.
-- With it gone, `notifications.channel = 'voice'` is unreachable, so the voice
-- sender in send-pending-notifications becomes dead code rather than a live
-- path — no Edge Function redeploy needed to make the platform stop calling
-- people. The push-first rule it sat in front of is preserved exactly.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: drop anything. `profiles.language`,
-- `profiles.preferred_reminder_channel`, the `voice` value on
-- `notification_channel`, and `patient_result_explanations.language` all stay.
-- The founder said "we can explore that in the future", and an enum value is
-- the one thing Postgres cannot remove in place — dropping it now would make
-- reopening this a schema rebuild instead of a one-line change. Everything here
-- is reversible by restoring the branch below.
--
-- Measured before deciding, on the live project: 0 patients with a non-English
-- language, 0 with a voice reminder preference, 0 voice notifications ever
-- sent, 0 non-English explanations generated. Nothing to migrate, nobody
-- affected.

create or replace function private.remap_notification_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_push boolean;
begin
  if new.channel = 'whatsapp' and new.recipient_id is not null then
    -- The voice branch that used to sit here (remapping to 'voice' for a
    -- patient with preferred_reminder_channel = 'voice') is intentionally
    -- removed. Restore it here to reopen voice reminders.
    select exists (
      select 1 from public.push_subscriptions
      where profile_id = new.recipient_id and disabled_at is null
    ) into v_has_push;
    if v_has_push then
      new.channel := 'push';
    end if;
  end if;
  return new;
end;
$$;

-- Clear any stale preference so nothing is left pointing at a channel the
-- patient can no longer see or change. (Currently zero rows; written so a
-- replay on another environment is still correct.)
update public.profiles
set preferred_reminder_channel = null
where preferred_reminder_channel = 'voice';

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'remap_notification_channel';

  -- The assertion that matters: no code path may still assign 'voice'.
  if v_def like '%new.channel := ''voice''%' then
    raise exception 'remap_notification_channel still routes to voice';
  end if;
  -- ...and the push-first rule it shared a function with must survive.
  if v_def not like '%new.channel := ''push''%' then
    raise exception 'remap_notification_channel lost its push-first rule';
  end if;

  if exists (select 1 from public.profiles where preferred_reminder_channel = 'voice') then
    raise exception 'a voice reminder preference survived';
  end if;
end $$;
