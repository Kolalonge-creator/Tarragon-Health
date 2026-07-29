-- Explicit ask: "other important boosters and their time" -- audited every
-- vaccination_catalog row against real WHO/CDC dosing guidance and found one
-- other clear, well-established gap of the same class as the tetanus one
-- (a vaccine modelled as "single dose marks it done" when it's actually a
-- required multi-dose series): Shingles (recombinant zoster vaccine,
-- Shingrix/RZV) is a 2-dose series, 2-6 months apart, from age 50 -- not a
-- single dose. The old {min_age: 50} shape has NO dose_schedule_months, so
-- computeVaccinationStatuses' standalone min_age branch marked ANY single
-- dose "up_to_date", silently under-vaccinating anyone who only got dose 1.
--
-- Other candidates were deliberately NOT changed this pass, flagged rather
-- than guessed at:
--   - Meningococcal (meningitis-belt MenA booster timing) -- WHO guidance
--     here is still evolving/context-dependent, not confident enough to
--     encode as a fixed rule.
--   - Adult Pneumococcal (min_age: 65) -- real-world scheduling depends on
--     which product (PCV20 vs PCV15+PPSV23) and prior vaccination history;
--     too product/guideline-variable for a fixed-shape reminder without
--     misleading precision.
--   - Pregnancy-triggered Tdap (WHO recommends one dose per pregnancy,
--     ~27-36wk gestation) -- this needs a pregnancy-status dimension the
--     engine/profile doesn't carry at all (a new kind of trigger, not a
--     dosing-shape fix), out of scope for this pass.
--
-- Other existing single-dose/no-booster entries (yellow fever, HPV per
-- Nigeria's 2023 single-dose national policy, hepatitis A/B primary series)
-- were checked and confirmed to already match real no-booster-needed
-- guidance -- not gaps.
update public.vaccination_catalog
  set recommended_age = '{"min_age": 50, "dose_schedule_months": [0, 2]}'::jsonb,
      description = '2-dose series from age 50, 2 to 6 months apart.'
  where code = 'shingles';
