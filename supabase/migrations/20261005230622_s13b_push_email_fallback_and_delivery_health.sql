-- S13b: email fallback after an unconfirmed push, and delivery health for the "notifications not arriving?" check.
-- Needs 20261005224944_s13_notifications_framework.sql (delivery events, rules config).
--
-- 1. report_notification_opened(): the app tells us a person opened a notification (a tap on the push, or on the
--    inbox row). Until now nothing wrote opened_at. Own notifications only; idempotent.
-- 2. private.queue_push_email_fallbacks(): a routine push that was accepted but never opened within
--    pushFallback.afterMinutes (default 240, PROPOSED) gets ONE generic email nudge ("something is waiting in your
--    app"), at most pushFallback.perRecipientPerDay a day, only to a patient with an email address that has not
--    bounced or complained. The email never repeats or hints at the original message (INV-07), is never SMS (INV-08),
--    and a critical row is never touched (the escalation engine owns those). The sender still applies the patient's
--    own email preference for the original message's category and the quiet hours.
-- 3. my_notification_delivery_health(): own counts for the last 14 days, so the app can tell a phone that has
--    notifications switched off from one whose maker's battery manager is stopping the app.
-- Row counts at writing: nothing to convert; one rules row is superseded by version 2.

alter table public.notification_delivery_events drop constraint if exists notification_delivery_events_event_check;
alter table public.notification_delivery_events add constraint notification_delivery_events_event_check
  check (event in ('accepted','receipt_pending','delivered','opened','failed','bounced','complained','deferred_quiet','suppressed_cap','blocked_inv07','token_dead','email_fallback_queued'));

update public.notification_rules_config set is_active = false where is_active;
insert into public.notification_rules_config (version, is_active, config, note) values
  (2, true,
   '{"quietHours":{"enabled":true,"start":"21:00","end":"07:00"},"routinePushPerDay":4,"receiptCheckMinutes":15,"receiptGiveUpHours":24,"pushFallback":{"enabled":true,"afterMinutes":240,"maxAgeHours":24,"perRecipientPerDay":1,"batchSize":200}}'::jsonb,
   'S13b PROPOSED: one generic email nudge when a routine push is not opened within 4 hours, at most one a day.');

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description)
values ('push_unconfirmed_email_nudge', 'operational', 'routine', 'patient', array['email']::public.notification_channel[], 'scheduled',
        'Generic email sent once when a routine push was accepted but not opened. Never names the original message.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body)
values ('push_unconfirmed_email_nudge', 'en', 'email', 'Something is waiting in your Tarragon Health app',
        'Hi {{patient_name}}, something is waiting for you in the Tarragon Health app. Open the app to see it.')
on conflict (template_key, locale, channel) do nothing;

create function public.report_notification_opened(p_notification_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_uid uuid := auth.uid(); v_row record;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select id, recipient_id, opened_at into v_row from public.notifications where id = p_notification_id;
  if v_row.id is null or v_row.recipient_id <> v_uid then
    raise exception 'not your notification' using errcode = '42501';
  end if;
  if v_row.opened_at is not null then return; end if;
  perform public.record_notification_delivery_event(p_notification_id, 'opened', 'system', null, '{"via":"app"}'::jsonb);
end $fn$;
revoke all on function public.report_notification_opened(uuid) from public, anon;
grant execute on function public.report_notification_opened(uuid) to authenticated;

create function private.queue_push_email_fallbacks() returns integer
language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare
  v_cfg jsonb; v_after integer; v_max integer; v_per_day integer; v_batch integer; v_n integer := 0; r record;
begin
  select config -> 'pushFallback' into v_cfg from public.notification_rules_config where is_active;
  if v_cfg is null or coalesce((v_cfg ->> 'enabled')::boolean, false) is not true then return 0; end if;
  v_after := coalesce((v_cfg ->> 'afterMinutes')::integer, 240);
  v_max := coalesce((v_cfg ->> 'maxAgeHours')::integer, 24);
  v_per_day := coalesce((v_cfg ->> 'perRecipientPerDay')::integer, 1);
  v_batch := coalesce((v_cfg ->> 'batchSize')::integer, 200);

  for r in
    select n.id, n.organisation_id, n.recipient_id, u.email, p.full_name
      from public.notifications n
      join public.profiles p on p.id = n.recipient_id and p.role = 'patient'
      join auth.users u on u.id = n.recipient_id and u.email is not null
     where n.channel = 'push' and n.priority = 'routine' and n.status = 'sent'
       and n.opened_at is null
       and n.sent_at <= now() - make_interval(mins => v_after)
       and n.sent_at >= now() - make_interval(hours => v_max)
       and n.template <> 'push_unconfirmed_email_nudge'
       and not exists (select 1 from public.notification_delivery_events e
                        where e.notification_id = n.id and e.event = 'email_fallback_queued')
       and not exists (select 1 from public.notification_email_suppressions s where s.email = lower(u.email))
       and (select count(*) from public.notifications f
             where f.recipient_id = n.recipient_id and f.template = 'push_unconfirmed_email_nudge'
               and f.created_at > now() - interval '24 hours') < v_per_day
     order by n.sent_at
     limit v_batch
  loop
    -- Re-check inside the loop: two rows of one recipient in the same pass must give one email.
    continue when (select count(*) from public.notifications f
                    where f.recipient_id = r.recipient_id and f.template = 'push_unconfirmed_email_nudge'
                      and f.created_at > now() - interval '24 hours') >= v_per_day;
    insert into public.notifications (organisation_id, recipient_id, channel, status, priority, template, payload)
    values (r.organisation_id, r.recipient_id, 'email', 'pending', 'routine', 'push_unconfirmed_email_nudge',
            jsonb_build_object('to_email', lower(r.email), 'patient_name', coalesce(split_part(r.full_name, ' ', 1), 'there'), 'fallback_for', r.id));
    insert into public.notification_delivery_events (notification_id, organisation_id, event, provider, detail)
    values (r.id, r.organisation_id, 'email_fallback_queued', 'system', '{}'::jsonb);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;
revoke all on function private.queue_push_email_fallbacks() from public, anon, authenticated;
grant execute on function private.queue_push_email_fallbacks() to service_role;

select cron.schedule('push-email-fallback', '*/15 * * * *', $$select private.queue_push_email_fallbacks();$$);

create function public.my_notification_delivery_health(p_days integer default 14)
returns table (push_sent bigint, push_delivered bigint, push_opened bigint, push_failed bigint, token_dead bigint,
               active_push_devices bigint, last_opened_at timestamptz, last_push_sent_at timestamptz)
language sql stable security definer set search_path = pg_catalog, public as $fn$
  with mine as (
    select n.id, n.sent_at, n.opened_at from public.notifications n
     where n.recipient_id = auth.uid() and n.channel = 'push' and n.status = 'sent'
       and n.sent_at >= now() - make_interval(days => least(greatest(p_days, 1), 60))
  ), ev as (
    select e.event from public.notification_delivery_events e join mine m on m.id = e.notification_id
  )
  select (select count(*) from mine),
         (select count(*) from ev where event = 'delivered'),
         (select count(*) from mine where opened_at is not null),
         (select count(*) from ev where event = 'failed'),
         (select count(*) from ev where event = 'token_dead'),
         (select count(*) from public.push_subscriptions s where s.profile_id = auth.uid() and s.disabled_at is null and s.expo_push_token is not null),
         (select max(opened_at) from mine),
         (select max(sent_at) from mine)
   where auth.uid() is not null
$fn$;
revoke all on function public.my_notification_delivery_health(integer) from public, anon;
grant execute on function public.my_notification_delivery_health(integer) to authenticated;

do $do$
begin
  if (select count(*) from public.notification_rules_config where is_active) <> 1 then raise exception 'S13b: not exactly one active rules row'; end if;
  if not exists (select 1 from public.notification_template_locales where template_key = 'push_unconfirmed_email_nudge' and is_active) then
    raise exception 'S13b: nudge template missing';
  end if;
  if has_function_privilege('anon', 'public.report_notification_opened(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_notification_delivery_health(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.queue_push_email_fallbacks()', 'EXECUTE') then
    raise exception 'S13b: a function is executable by a role that must not run it';
  end if;
end $do$;
