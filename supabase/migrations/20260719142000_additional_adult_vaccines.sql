-- Tarragon Health — Additional adult vaccines
--
-- Annual Health Check pathway TH-CP-AHC-001 §13 (Adult Immunisation Review)
-- lists COVID-19 & influenza, pneumococcal, meningococcal, and typhoid /
-- hepatitis A alongside the already-seeded Td / hep B / yellow fever / HPV /
-- shingles set. This adds the missing five to the global vaccination_catalog,
-- using the same recommended_age jsonb shapes vaccination-status.ts already
-- consumes (interval_years / doses / min_age / dose_schedule_months).
-- Idempotent so a fresh `db reset` (seed) and this migration agree.
-- [LOCALISE] exact schedules/products confirmed with NPHCDA.

insert into public.vaccination_catalog (code, name, description, recommended_age)
values
  ('covid_19',      'COVID-19',      'Per current national guidance; boosters for higher-risk/older adults.',
     '{"interval_years": 1}'::jsonb),
  ('pneumococcal',  'Pneumococcal',  'Older adults and those with chronic disease, per guidance.',
     '{"min_age": 65}'::jsonb),
  ('meningococcal', 'Meningococcal', 'In outbreaks / meningitis-belt risk, per guidance.',
     '{"doses": 1}'::jsonb),
  ('typhoid',       'Typhoid',       'Risk- and travel-based.',
     '{"doses": 1}'::jsonb),
  ('hepatitis_a',   'Hepatitis A',   'Risk- and travel-based; 2-dose series.',
     '{"dose_schedule_months": [0, 6]}'::jsonb)
on conflict (code) do nothing;
