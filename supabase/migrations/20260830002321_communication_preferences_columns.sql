-- Health Communication Engine — communication preferences (17.15, part 1).
--
-- `profiles.preferred_reminder_channel` already exists but is narrowly
-- scoped (whatsapp/voice only, built for ParentCare elders choosing a
-- phone call over WhatsApp — 20260723201654) and has been effectively dead
-- since voice was disabled platform-wide (20260803160544). This adds two
-- genuinely new, independent preferences rather than repurposing that
-- column (repurposing it would silently change what an existing, if
-- currently-unused, column means):
--
--   notification_channel_preference — a patient's preferred channel for
--   ROUTINE, non-critical notifications only (see the companion change to
--   private.remap_notification_channel()). NULL = no preference, use the
--   platform default (push-first, whatsapp/sms fallback). Critical/clinical
--   notifications never consult this — they always follow the governed
--   escalation ladder (critical_notification_engine.sql), matching 17.15's
--   "clinical communications may have separate rules".
--
--   marketing_opt_in — separate consent pathway for marketing content
--   (17.4: "Marketing: Separate consent and communication pathway"),
--   defaulting to false (opt-in, not opt-out). Consumed by
--   notification_broadcasts (see the companion marketing-consent
--   migration) — never by any clinical/operational/transactional send.
--
-- Both are plain, unguarded profiles columns: private.guard_profiles_self_
-- update() (20260827192712) is a DENYLIST of privileged columns a patient
-- may not self-edit, and neither of these appears in it, so both are
-- self-editable by the account owner from day one, matching every other
-- patient preference column (language, condition_language_preference,
-- preferred_reminder_channel) already on this table.
alter table public.profiles
  add column notification_channel_preference public.notification_channel
    check (notification_channel_preference in ('whatsapp', 'sms', 'email', 'push') or notification_channel_preference is null),
  add column marketing_opt_in boolean not null default false;

comment on column public.profiles.notification_channel_preference is
  'Preferred channel for ROUTINE (non-critical) notifications only. NULL = platform default (push-first, whatsapp/sms fallback). Never consulted for a critical-priority or clinical-content notification — those always follow the governed escalation ladder regardless of this setting.';
comment on column public.profiles.marketing_opt_in is
  'Separate consent pathway for marketing content (17.4), defaulting to opted-out. Only notification_broadcasts rows flagged is_marketing consult this column — every clinical/operational/transactional notification is sent regardless of this setting.';
