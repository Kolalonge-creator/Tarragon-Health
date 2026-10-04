-- S02 (v5 identity, access and consent baseline), part 1 of 2: new consent_type labels.
--
-- ALTER TYPE ... ADD VALUE cannot share a transaction with anything that uses the new label, so the labels live in
-- their own migration and the next one (20260930*_s02_identity_consent_audit_baseline) never references them.
--
-- v5 4.2 names five consent codes: care, care_circle_sharing, research, sponsor_reporting, scribe_default. Live has
-- `research` already (plus data_processing, telehealth, terms_of_service, device_data, marketing,
-- wearable_device_data). Nothing is renamed or removed: live wins for the existing codes (docs/RECONCILIATION.md
-- section 6), and the four missing v5 codes are added so later sessions (S04 onboarding consent, S23 scribe) can
-- record them in the existing append-only patient_consents table instead of a parallel `consents` table.
--
-- No rows use the new labels (nothing can: they did not exist). No data step.

alter type public.consent_type add value if not exists 'care';
alter type public.consent_type add value if not exists 'care_circle_sharing';
alter type public.consent_type add value if not exists 'sponsor_reporting';
alter type public.consent_type add value if not exists 'scribe_default';
