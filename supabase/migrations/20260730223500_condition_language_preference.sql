-- Lets a patient choose clinical ("obesity") vs. the platform's own default
-- gentler ("weight") language for their own patient-facing copy, instead of
-- the 2026-07-30 site-wide softening decision (marketing-site-redesign pass)
-- being the only option for every patient. Same shape as
-- profiles.preferred_reminder_channel (20260723201654_voice_reminders_and_language.sql)
-- — an opt-in column, defaulting to today's existing behaviour, read only by
-- the handful of UI surfaces that actually name the condition.
alter table public.profiles
  add column if not exists condition_language_preference text
    not null default 'gentle'
    check (condition_language_preference in ('gentle', 'clinical'));

comment on column public.profiles.condition_language_preference is
  'Patient-chosen tone for condition names in their own UI: gentle (default, e.g. "weight") '
  'or clinical (e.g. "obesity"). Never affects clinical records, coding, or clinician-facing copy.';
