-- Tarragon Health — Register the three cycle-reminder notification templates.
--
-- Companion to 20260902195456_menstrual_cycle_tracking.sql. The daily cron
-- (apps/web/src/app/api/cron/cycle-reminders, logic in lib/cycle/reminders.ts)
-- inserts notifications with these template keys, and notification-bell.tsx
-- renders copy for each; public.notification_templates is the central
-- registry every template key is expected to appear in, so they are added
-- here rather than left as three keys the catalogue does not know about.
--
-- default_channels is `in_app` ONLY, and that is a deliberate product
-- decision rather than a consequence of the WhatsApp/SMS templates still
-- being blocked on Meta/Termii approval. A period reminder is the most
-- sensitive routine message the platform sends: phones are read over
-- shoulders and shared within families, and nothing about a period reminder
-- is urgent enough to justify pushing it to a channel the patient may not
-- control. If anyone later widens these channels, that should be an explicit
-- decision with the same reasoning revisited, not a default.
--
-- category 'clinical' (menstrual health is health, not admin) but
-- business_priority 'routine', and requires_clinical_approval stays false in
-- line with every other row seeded by 20260830002554 — no template is
-- retroactively marked approved by a migration; that stays a real Clinical
-- Director action through public.approve_notification_template().

insert into public.notification_templates
  (key, category, business_priority, audience, default_channels, description)
values
  ('cycle_period_due_soon', 'clinical', 'routine', 'patient',
   array['in_app']::public.notification_channel[],
   'Heads-up that the patient''s next period is expected in about two days, from their own logged cycle history.'),
  ('cycle_period_due_today', 'clinical', 'routine', 'patient',
   array['in_app']::public.notification_channel[],
   'The patient''s next period is expected around today.'),
  ('cycle_period_late', 'clinical', 'routine', 'patient',
   array['in_app']::public.notification_channel[],
   'The patient''s period is a few days past its predicted window. Sent once, never repeated for the same cycle.')
on conflict (key) do nothing;

do $$
declare
  v_missing text;
begin
  select string_agg(k, ', ') into v_missing
  from unnest(array['cycle_period_due_soon', 'cycle_period_due_today', 'cycle_period_late']) as k
  where not exists (select 1 from public.notification_templates where key = k);
  if v_missing is not null then
    raise exception 'cycle reminder templates not registered: %', v_missing;
  end if;

  -- These must never quietly acquire an outbound channel by default.
  if exists (
    select 1 from public.notification_templates
    where key like 'cycle_period_%'
      and default_channels <> array['in_app']::public.notification_channel[]
  ) then
    raise exception 'cycle reminder templates must default to in_app only';
  end if;
end $$;
