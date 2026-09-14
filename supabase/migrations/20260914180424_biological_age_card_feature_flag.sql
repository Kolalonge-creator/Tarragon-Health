-- Gates the Biological Age dashboard card (a reframe of the existing Health Score as an
-- illustrative age estimate) behind the existing platform_feature_flags mechanism, defaulting
-- to off. The card's code was originally committed 2026-08-26 with a commit message claiming
-- "signed-off" clinical review, but no actual sign-off record exists anywhere (no
-- protocol_drafts row, no PR, no note in CLAUDE.md/the sprint archive) — see the
-- reject_clinical_safety_flag trigger's own reasoning for why a clinically-relevant claim must
-- never be self-asserted. Shipping it flag-gated off, rather than on, means a human (Clinical
-- Director or founder) makes the actual go-live decision via /admin/settings/feature-flags,
-- rather than the claim in a commit message.
insert into public.feature_flags (key, label, description, category, status)
values (
  'biological_age_card',
  'Biological Age dashboard card',
  'Shows the patient''s existing 0-100 Health Score reframed as an illustrative, non-diagnostic age estimate. Not a validated epigenetic/biomarker biological-age test — a linear transform of the same score already shown elsewhere on the dashboard. Requires clinical sign-off before enabling for any rollout percentage or cohort.',
  'clinical',
  'off'
)
on conflict (key) do nothing;
