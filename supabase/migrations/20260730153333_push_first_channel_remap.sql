-- Notification delivery-state + forced-channel fallback — channel-priority
-- policy change: push is the default first channel platform-wide, WhatsApp
-- is fallback only. Extends the existing
-- private.remap_notification_channel() BEFORE INSERT trigger (added
-- 2026-07-23 for the voice-preference remap) rather than adding a second
-- trigger — same touch point, same "producer functions never need to know
-- this exists" contract.
--
-- Precedence, most specific first:
--   1. profiles.preferred_reminder_channel = 'voice' (an explicit patient
--      accessibility choice) still wins outright — unchanged from today.
--   2. otherwise, a queued 'whatsapp' row is remapped to 'push' when the
--      recipient has at least one active (not disabled_at) push
--      subscription. send-pending-notifications' push sender falls back
--      inline to whatsapp -> sms on a transmission-level failure for
--      routine rows (critical rows deliberately do NOT get this inline
--      fallback — they go through the tracked, confirmation-gated
--      escalation ladder instead; see critical_notification_engine.sql).
--   3. no subscription on file -> unchanged, stays 'whatsapp' as today.
create or replace function private.remap_notification_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pref text;
  v_has_push boolean;
begin
  if new.channel = 'whatsapp' and new.recipient_id is not null then
    select preferred_reminder_channel into v_pref
    from public.profiles where id = new.recipient_id;
    if v_pref = 'voice' then
      new.channel := 'voice';
      return new;
    end if;

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
$function$;
