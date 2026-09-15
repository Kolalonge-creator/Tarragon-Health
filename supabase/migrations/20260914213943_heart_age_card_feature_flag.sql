-- Replaces the Biological Age card with Heart Age: a SCORE2 risk-age
-- conversion (see services/ml/app/scoring/heart_age.py) rather than a
-- linear rescale of the Health Score. Same governance posture as the flag
-- it replaces (20260914180424_biological_age_card_feature_flag.sql): no
-- clinical sign-off exists for this feature either, so it ships gated off
-- by default. A Clinical Director must confirm the reference risk-factor
-- profile in heart_age.py (currently a literature-standard PROVISIONAL_*
-- placeholder, not yet reviewed) before this is ever switched on for any
-- rollout percentage or cohort, via /admin/settings/feature-flags.
insert into public.feature_flags (key, label, description, category, status)
values (
  'heart_age_card',
  'Heart Age dashboard card',
  'Converts the patient''s already-computed SCORE2 10-year cardiovascular risk into an age, using the published "risk age" technique (same method as the Framingham/JBS3/NHS heart-age tools) — only shown when a real SCORE2 result exists for the patient (age 40-89 with a lipid panel on file), never derived from the lab-optional WHO/ISH AFRO band estimate. Not validated for Sub-Saharan African populations (same caveat as the underlying cvd_10yr score) and its reference risk-factor profile is provisional pending Clinical Director sign-off. Requires that sign-off before enabling for any rollout percentage or cohort.',
  'clinical',
  'off'
)
on conflict (key) do nothing;
