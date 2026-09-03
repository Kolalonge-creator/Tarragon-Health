-- Health Communication Engine — message escalation (17.12, part 1).
--
-- New enum value only — a freshly-added enum value can't be used in the
-- same transaction that adds it (same split this codebase always uses).
-- Covers the gap 17.12 describes: a patient's free-text care_messages post
-- has no safety screening today — it just sits in the normal thread until
-- a clinician happens to read it. See the companion migration for the
-- deterministic (never AI-only, per the spec's own explicit rule) keyword
-- screen and its clinician_alerts wiring.
alter type public.alert_type_code add value 'message_safety_flag';
