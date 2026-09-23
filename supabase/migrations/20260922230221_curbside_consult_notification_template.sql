-- Register curbside_consult_new_message in the notification_templates
-- registry (20260830002308_notification_templates_registry.sql) — the
-- new-template path that registry's own header describes ("a NEW template
-- can be added here plus a notification_template_locales row and sent with
-- zero code changes"). in_app only, 'important' priority (a colleague is
-- waiting on a reply, but never patient-safety-critical by definition — a
-- curbside consult has no clinical action of its own; see
-- 20260922230142_curbside_consults.sql's header for why nothing here writes
-- to patient_timeline or fires an emergency-adjacent path).
insert into public.notification_templates
  (key, category, business_priority, audience, default_channels, description)
values (
  'curbside_consult_new_message',
  'clinical',
  'important',
  'clinician',
  array['in_app']::public.notification_channel[],
  'A colleague sent a message in a doctor-to-doctor curbside consult thread.'
)
on conflict (key) do nothing;

insert into public.notification_template_locales
  (template_key, locale, channel, subject, body)
values (
  'curbside_consult_new_message',
  'en',
  'in_app',
  null,
  'New message from {{sender_display}} in "{{subject}}"'
)
on conflict (template_key, locale, channel) do nothing;

do $$
begin
  if not exists (select 1 from public.notification_templates where key = 'curbside_consult_new_message') then
    raise exception 'curbside_consult_new_message template was not registered';
  end if;
end $$;
