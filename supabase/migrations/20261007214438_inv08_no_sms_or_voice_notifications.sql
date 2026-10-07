-- INV-08 / decision D-12, enforced at the sink (S83 audit item 1.20; founder instruction 2026-10-07: rely on push, email and in-app, SMS only
-- for phone verification codes).
--
-- The audit found sms notification rows being created for patients (security.new_device_signin, engagement_alternative_channel_checkin) and for
-- clinicians (ack-timeout escalation hops). Live check on 2026-10-07: 112 such rows, 0 sent (every one failed or was suppressed because no SMS
-- provider key is configured), 0 pending, and 0 profiles prefer sms or voice. So nothing reached a phone; the risk is that the day an SMS provider
-- key is set for verification codes, producers that still queue sms or voice rows would start sending.
--
-- Verification codes do not use public.notifications (the auth SMS hook calls the provider directly), so no legitimate use is affected.
-- A BEFORE INSERT trigger now turns any pending sms or voice row into a suppressed one with the reason recorded, whichever producer made it.
-- Other statuses are left alone so history is never rewritten.

create or replace function private.suppress_sms_voice_notifications() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.channel in ('sms', 'voice') and new.status = 'pending' then
    new.status := 'suppressed';
    new.last_error := 'INV-08: sms and voice are not used for notifications; push, email and in-app only (verification codes use the auth hook)';
  end if;
  return new;
end $$;
revoke all on function private.suppress_sms_voice_notifications() from public, anon, authenticated;

drop trigger if exists notifications_suppress_sms_voice on public.notifications;
create trigger notifications_suppress_sms_voice before insert on public.notifications
  for each row execute function private.suppress_sms_voice_notifications();

-- Anything already pending (0 at write time) is suppressed the same way.
update public.notifications set status = 'suppressed',
  last_error = 'INV-08: sms and voice are not used for notifications; push, email and in-app only (verification codes use the auth hook)'
where channel in ('sms', 'voice') and status = 'pending';
