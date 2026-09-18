-- private.remap_notification_channel() previously honoured an explicit
-- 'whatsapp' or 'sms' notification_channel_preference by locking a
-- reminder to that exact channel -- but both are structurally dead right
-- now: Meta WABA template approval and Termii sender-ID approval are both
-- "off the founder's near-term plan" (CLAUDE.md, 2026-09-15), and live data
-- confirms it -- 100% failure on both (whatsapp: 382 failed/0 sent; sms:
-- 337 failed/0 sent, zero successes ever). A patient with NO preference at
-- least got a push fallback when they had a subscription; a patient who
-- explicitly chose "WhatsApp" or "SMS" in Communication preferences was
-- worse off than doing nothing -- locked onto a channel guaranteed to fail,
-- with no visible signal anywhere they'd see it (the in_app companion still
-- reaches them regardless, so nothing was ever silently lost, but the
-- *chosen* channel itself never once worked).
--
-- Fixed: only 'email' (48.1% live success) is still honoured as a direct
-- channel pick. 'whatsapp'/'sms'/null preference now all fall through to
-- the same push-if-subscribed-else-whatsapp-fallback ladder null already
-- used. Zero live profiles currently carry a whatsapp/sms preference
-- (confirmed via `select count(*) from profiles where
-- notification_channel_preference in ('whatsapp','sms')` = 0), so this is a
-- pure forward fix, no backfill needed. The paired UI fix (removing
-- WhatsApp/SMS as selectable options in Communication preferences) ships in
-- the same PR.
create or replace function private.remap_notification_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
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

    if v_pref = 'email' then
      new.channel := v_pref;
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

do $$
declare
  v_new_channel public.notification_channel;
  v_test_patient uuid := (select id from public.profiles where role = 'patient' limit 1);
begin
  if v_test_patient is null then
    raise notice 'No patient profile to test against; skipping proof.';
    return;
  end if;

  -- Sabotage check: an explicit 'sms' preference must NO LONGER pass through
  -- to a live insert as channel='sms' -- it should fall to push (none
  -- configured for this synthetic id) or stay whatsapp, never 'sms'.
  update public.profiles set notification_channel_preference = 'sms' where id = v_test_patient;

  insert into public.notifications (recipient_id, channel, template, priority, status, payload)
  values (v_test_patient, 'whatsapp', 'proof_remap_test', 'routine', 'pending', '{}'::jsonb)
  returning channel into v_new_channel;

  delete from public.notifications where recipient_id = v_test_patient and template = 'proof_remap_test';
  update public.profiles set notification_channel_preference = null where id = v_test_patient;

  if v_new_channel = 'sms' then
    raise exception 'remap still honours a dead sms preference as a direct channel pick';
  end if;
end $$;
