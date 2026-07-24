-- Closes two real catalogue gaps, both explicit founder asks:
-- 1. Blood group + genotype: genotype existed only as a screen_types row used
--    by clinician result-entry (screening-result.ts) — it had NO lab_tests
--    row and NO panel_bundle, so nobody, clinician or patient, could ever
--    actually order it. Blood group didn't exist anywhere at all. Bundled as
--    one combo bundle (patients almost always want both together, and this
--    is how Nigerian labs package it) rather than two separate self-bookable
--    items.
-- 2. Hepatitis C: existed only as a screen_types row marked `sensitive` in
--    the 20260719140000 gating migration — no lab_tests row, no bundle
--    (single or in health_check_comprehensive), not bookable by anyone.
--    Added alongside HIV/Hep B in the confidential self-bookable set and in
--    the Comprehensive Health Check package, per explicit ask.
-- self_bookable is a plain data flag (private.enforce_lab_order_origin reads
-- panel_bundles.self_bookable directly, no hardcoded bundle-code list to
-- update) so these need no trigger/function change.

-- screen_types: blood_group (genotype/sickle_cell_genotype already exists)
insert into public.screen_types
  (code, name, sex_applicability, age_from, age_to, frequency_months, commission_rate, recommended_provider_type)
values
  ('blood_group', 'Blood Group & Rhesus Factor', 'all', 0, null, null, 0.2000, 'lab')
on conflict (code) do nothing;

-- lab_tests — one row per existing provider per new test, price in kobo.
-- Bundled combo booking uses panel_bundles.price_kobo (fixed, provider-agnostic,
-- same as every other bundle in this catalogue), these per-test rows exist so
-- the catalogue is complete/consistent with every other screen_type.
insert into public.lab_tests (provider_id, code, name, price_kobo, commission_rate, turnaround_hours)
select p.id, t.code, t.name, t.price_kobo, t.commission_rate, t.turnaround_hours
from public.lab_providers p
join (values
  ('Synlab Nigeria',      'blood_group',           'Blood Group & Rhesus Factor', 350000::bigint, 0.2000, 24),
  ('Synlab Nigeria',      'sickle_cell_genotype',  'Sickle Cell Genotype',        400000::bigint, 0.2000, 24),
  ('Healthtracka',        'blood_group',           'Blood Group & Rhesus Factor', 300000::bigint, 0.2200, 24),
  ('Healthtracka',        'sickle_cell_genotype',  'Sickle Cell Genotype',        350000::bigint, 0.2200, 24),
  ('Cerba Lancet',        'hep_c',                 'Hepatitis C Antibody Test',   750000::bigint, 0.2000, 48),
  ('Afriglobal Medicare', 'hep_c',                 'Hepatitis C Antibody Test',   700000::bigint, 0.2000, 48)
) as t(provider_name, code, name, price_kobo, commission_rate, turnaround_hours)
  on t.provider_name = p.name
on conflict (provider_id, code) do nothing;

-- panel_bundles — new self-bookable single/combo bundles. Prices are
-- PLACEHOLDER — founder to confirm, same convention as every other
-- self-bookable bundle price in this catalogue.
insert into public.panel_bundles (code, name, description, price_kobo, test_codes, self_bookable)
values
  ('single_blood_group_genotype', 'Blood Group & Genotype',
     'Know your blood group, rhesus factor, and sickle cell genotype (AA/AS/SS) — useful for marriage counselling, pregnancy planning, and emergencies.',
     650000, array['blood_group', 'sickle_cell_genotype'], true),
  ('single_hep_c', 'Hepatitis C Screening',
     'Confidential Hepatitis C antibody test.',
     700000, array['hep_c'], true)
on conflict (code) do nothing;

-- Add Hepatitis C to the Comprehensive Health Check package alongside the
-- existing HIV + Hepatitis B, per explicit ask. Price left unchanged
-- (existing PLACEHOLDER convention already flagged for founder confirmation).
update public.panel_bundles
  set test_codes = array['hba1c', 'lipid_panel', 'psa', 'cervical_smear', 'hiv', 'hep_b', 'hep_c'],
      description = 'Everything in the Annual Health Check plus HIV, Hepatitis B, and Hepatitis C screening. Doctor-reviewed.'
  where code = 'health_check_comprehensive'
    and not ('hep_c' = any(test_codes));
