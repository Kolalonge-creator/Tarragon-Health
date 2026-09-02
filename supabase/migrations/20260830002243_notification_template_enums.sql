-- Health Communication Engine — template registry enums (part 2).
--
-- Own migration for the enum types only — a freshly-added enum value can't
-- be used in the same transaction that adds it, same split this codebase
-- always uses (e.g. notification_priority before critical_notification_engine).
--
-- Two distinct classification axes, deliberately kept separate from the
-- axes that already exist and are wired into live routing:
--   - `notification_category` is the patient-facing COMMUNICATION TYPE
--     (what kind of message this is, for history/filtering/preferences).
--     Distinct from `alert_category` (clinical/care_management/medication/
--     operational), which classifies INTERNAL clinician_alerts routing —
--     different domain, not renamed or merged.
--   - `notification_business_priority` is the governance-facing urgency
--     label a template is catalogued under (for admins/compliance reading
--     the registry). Distinct from the existing `notification_priority`
--     enum (routine/critical), which drives the live forced-channel
--     escalation ladder (critical_notification_engine.sql) — that engine
--     and its two values are untouched here. A template's business
--     priority informs, but is not mechanically bound to, which technical
--     priority its notifications rows carry.
create type public.notification_category as enum (
  'clinical', 'operational', 'medication', 'laboratory', 'referral', 'education', 'administrative'
);

create type public.notification_business_priority as enum (
  'critical', 'urgent', 'important', 'routine', 'marketing'
);
