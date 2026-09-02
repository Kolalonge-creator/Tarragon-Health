-- Tarragon Health
-- Data Governance gap-closure, item 2 of 7 (§87.6 "consent management" of
-- the 2026-08-29 governance/safety spec audit). Confirmed live before
-- writing this: consent_type is still exactly data_processing/telehealth/
-- terms_of_service -- device-data, marketing, and research consent have no
-- context of their own. The spec is explicit: "do not use one blanket
-- checkbox for everything."
--
-- Split into its own migration (enum value, no usage yet): Postgres cannot
-- use a newly-added enum value in the same transaction that added it, same
-- reason as every other enum-add this pass (20260829213000, 20260829221117).
-- A follow-up migration will seed a current consent_versions row per new
-- type once real copy exists for each -- adding the enum value now is the
-- taxonomy half of this gap; the collection UI is a real follow-up, not
-- silently declared done here.

alter type public.consent_type add value if not exists 'device_data';
alter type public.consent_type add value if not exists 'marketing';
alter type public.consent_type add value if not exists 'research';
