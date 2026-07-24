-- Voice-call reminders (for elders) + per-patient reminder language.
-- Founder-directed 2026-07-23.
--
-- ParentCare's real end user is often a 68-year-old who doesn't read
-- WhatsApp: preferred_reminder_channel='voice' remaps their queued WhatsApp
-- reminders to a voice call at INSERT time via one trigger — none of the
-- dozen queue functions/crons change. Reminder language (English, Pidgin,
-- Yoruba, Hausa, Igbo) is resolved at send time from the profile.
--
-- DELIVERY CAVEAT (deliberate): the deployed send-pending-notifications
-- function does not yet fetch 'voice' rows or read `language` — those rows
-- queue as pending until the function's next catch-up deploy (this branch
-- edits the SOURCE but does not deploy, because the deployed function is
-- ahead of this branch via PR #113). Voice/language are additive: WhatsApp/
-- SMS behaviour for everyone else is unchanged.

alter type public.notification_channel add value if not exists 'voice';

alter table public.profiles
  add column if not exists preferred_reminder_channel text
    check (preferred_reminder_channel in ('whatsapp', 'voice')),
  add column if not exists language text not null default 'en'
    check (language in ('en', 'pcm', 'yo', 'ha', 'ig'));

comment on column public.profiles.preferred_reminder_channel is
  'NULL = default (WhatsApp with SMS fallback). voice = queued WhatsApp reminders are remapped to a phone call at insert time — built for elders on ParentCare.';
comment on column public.profiles.language is
  'Reminder/notification language (en, pcm=Pidgin, yo, ha, ig). Resolved at send time; in-app UI stays English for now.';

create or replace function private.remap_notification_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pref text;
begin
  if new.channel = 'whatsapp' and new.recipient_id is not null then
    select preferred_reminder_channel into v_pref
    from public.profiles where id = new.recipient_id;
    if v_pref = 'voice' then
      new.channel := 'voice';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_remap_channel on public.notifications;
create trigger notifications_remap_channel
  before insert on public.notifications
  for each row execute function private.remap_notification_channel();
