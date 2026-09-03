-- Health Communication Engine — communication preferences (17.15, part 2).
--
-- Extends private.remap_notification_channel() (last redefined
-- 20260803160544_english_only_no_voice_channel.sql) to consult the new
-- profiles.notification_channel_preference. Same insert-time-remap shape
-- this function has used for both of its previous purposes (voice-for-
-- elders, then push-first) — no new trigger, no new call sites to update.
--
-- Critical-priority rows return immediately, untouched: a personal channel
-- preference must never weaken the first hop of a clinical-safety
-- escalation ladder (critical_notification_engine.sql already owns that
-- ladder's channel sequencing end to end). Only a routine row queued as
-- 'whatsapp' (the default reminder channel every queue_*/enqueue_*
-- function already uses) is eligible to remap — exactly the same scope the
-- push-first rule already had.
create or replace function private.remap_notification_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_push boolean;
  v_pref public.notification_channel;
begin
  if new.priority = 'critical' then
    return new;
  end if;

  if new.channel = 'whatsapp' and new.recipient_id is not null then
    select notification_channel_preference into v_pref
    from public.profiles where id = new.recipient_id;

    -- An explicit sms/email preference wins outright — the patient asked
    -- for a specific channel, so the push-availability check below is
    -- skipped entirely for those two. (A 'whatsapp' preference needs no
    -- branch: it just falls through unchanged. A 'push' preference is
    -- handled by the existing push-availability check, same as no
    -- preference at all.)
    if v_pref in ('sms', 'email') then
      new.channel := v_pref;
      return new;
    end if;

    select exists (
      select 1 from public.push_subscriptions
      where profile_id = new.recipient_id and disabled_at is null
    ) into v_has_push;
    if v_has_push and (v_pref is null or v_pref = 'push') then
      new.channel := 'push';
    end if;
  end if;
  return new;
end;
$$;

comment on function private.remap_notification_channel() is
  'BEFORE INSERT on notifications. Critical rows are left untouched (the escalation ladder owns their channel sequencing). Routine rows queued as whatsapp: an explicit profiles.notification_channel_preference of sms/email wins outright; otherwise remaps to push when the recipient has an active push subscription (2026-07-30 push-first default) and has not explicitly preferred a different channel. No voice remap (retired 2026-08-03, see english_only_no_voice_channel.sql for how to reopen it).';

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'remap_notification_channel';

  if v_def like '%new.channel := ''voice''%' then
    raise exception 'remap_notification_channel must not route to voice (founder decision 2026-08-03)';
  end if;
  if v_def not like '%new.channel := ''push''%' then
    raise exception 'remap_notification_channel lost its push-first rule';
  end if;
  if v_def not like '%notification_channel_preference%' then
    raise exception 'remap_notification_channel does not consult notification_channel_preference';
  end if;
  if v_def not like '%new.priority = ''critical''%' then
    raise exception 'remap_notification_channel does not exempt critical rows';
  end if;
end $$;
