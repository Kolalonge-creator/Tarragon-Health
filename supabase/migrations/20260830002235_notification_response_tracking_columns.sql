-- Health Communication Engine — two-way response tracking (part 1).
--
-- `notifications` already tracks the SEND side in full (sent_at/delivered_at/
-- opened_at/failed_at, per 20260730153205). Nothing today tracks the
-- RESPONSE side generically — every two-way flow (appointment confirm/
-- reschedule/cancel, video-visit alternate-time picks, care-access accept/
-- decline) invented its own bespoke response handling on its own source
-- table, with no way to answer "did the recipient act on this specific
-- notification, and what did they choose" from the notifications row
-- itself. This is additive-only: every column is nullable/defaulted, so no
-- existing row or insert path changes behaviour.
--
-- `response_options` lets an enqueuer attach a small set of quick-reply
-- choices to a notification (e.g. appointment confirm: yes/reschedule/
-- cancel/need_help) for the in-app UI to render as buttons — never as an
-- inbound WhatsApp/SMS reply parser (CLAUDE.md: "never build automation
-- that turns an inbound WhatsApp message into a platform action"). A
-- response is always captured by the recipient tapping a button in the
-- app, which then calls whatever real action RPC already exists
-- (reschedule_appointment, cancel_appointment, ...) and stamps these
-- columns as a side effect — see the respond-to-notification API route.
alter table public.notifications
  add column response_options jsonb,
  add column responded_at timestamptz,
  add column response_value text,
  add column action_completed_at timestamptz;

comment on column public.notifications.response_options is
  'Optional array of {"label": "...", "value": "..."} quick-reply choices for the in-app notification UI to render as buttons. Null for a plain one-way notification. Never used to parse an inbound WhatsApp/SMS message into an action.';
comment on column public.notifications.responded_at is
  'When the recipient acted on this notification in-app (tapped a quick-reply option, or otherwise responded). Null = no response yet or none expected.';
comment on column public.notifications.response_value is
  'Which response_options entry (by value) the recipient chose, or a short free-text response for a template that collects one. Null until responded_at is set.';
comment on column public.notifications.action_completed_at is
  'When the response actually finished driving its real-world effect (e.g. the appointment was actually rescheduled), which can be the same instant as responded_at or slightly later if the action involves its own async step. Distinct from responded_at so a UI can tell "acknowledged" apart from "actually done".';

create index notifications_awaiting_response_idx
  on public.notifications (recipient_id, created_at desc)
  where response_options is not null and responded_at is null;
