-- Tarragon Health
-- profiles.onboarding_completed_at: gates the one-time /onboarding screen
-- (welcome + honest care-model consent copy, docs/CLINICAL_TRUST_MODEL_SPEC.md
-- §5 "Consent screen honesty") that every new patient sees before reaching
-- /patient. Set once, by the patient themselves finishing the screen —
-- there's no admin/staff path to set this on someone else's behalf.

alter table public.profiles
  add column onboarding_completed_at timestamptz;

-- Backfill: existing patients (pre-dating this screen) shouldn't be forced
-- through an unexpected onboarding redirect on their next login. Only new
-- signups going forward see /onboarding.
update public.profiles
  set onboarding_completed_at = now()
  where role = 'patient' and onboarding_completed_at is null;
