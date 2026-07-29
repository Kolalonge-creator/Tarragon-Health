-- Tarragon Health — Care Coordination Build 4: single-test panel_bundles.
--
-- lab_orders only supports booking via panel_bundle_id (no junction table
-- for individual lab_tests), so a "single test" is just a one-item bundle —
-- same model the 3 existing combo panels already use. This also fixes a
-- pre-existing gap: hiv and hep_b tests exist in lab_tests but were never
-- part of any panel_bundle, making them entirely unbookable until now.
-- Prices taken from the lowest-priced existing lab_tests row per code.
insert into public.panel_bundles (code, name, description, price_kobo, test_codes) values
  ('single_hba1c', 'HbA1c', 'Single test — diabetes control marker.', 800000, '{hba1c}'),
  ('single_lipid_panel', 'Lipid Panel', 'Single test — cholesterol/triglycerides.', 900000, '{lipid_panel}'),
  ('single_psa', 'PSA', 'Single test — prostate screening.', 1200000, '{psa}'),
  ('single_cervical_smear', 'Cervical Smear', 'Single test — cervical cancer screening.', 1800000, '{cervical_smear}'),
  ('single_hiv', 'HIV Screening', 'Single test.', 600000, '{hiv}'),
  ('single_hep_b', 'Hepatitis B Surface Antigen', 'Single test.', 700000, '{hep_b}');
