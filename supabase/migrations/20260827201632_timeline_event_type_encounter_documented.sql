-- Tarragon Health
-- New timeline_event_type value for clinical_encounter_notes (see the
-- immediately-following migration for the trigger that uses it). Split into
-- its own migration: Postgres forbids using a newly added enum value inside
-- the same transaction that added it, error 55P04 -- confirmed precedent in
-- 20260716113000_referral_status_add_waitlisted.sql.

alter type public.timeline_event_type add value if not exists 'encounter_documented';
