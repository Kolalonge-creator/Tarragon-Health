-- Tarragon Health — Sprint 1 seed data
--
-- Populates the global reference catalogues only (no tenant/patient data):
-- screen_types, vaccination_catalog, lab partners + a starter test menu,
-- panel bundles, pharmacy partners + a starter formulary, and subscription
-- plans.
-- Idempotent: safe to run repeatedly. Money is in minor units (kobo for NGN,
-- pence for GBP). Real partner names per CLAUDE.md / FEATURE_SPEC §8.

-- ---------------------------------------------------------------------------
-- screen_types (>= 12) — commission_rate is a fraction (0.20 = 20%)
-- ---------------------------------------------------------------------------
insert into public.screen_types
  (code, name, sex_applicability, age_from, age_to, frequency_months, commission_rate, recommended_provider_type)
values
  ('psa',              'Prostate-Specific Antigen (PSA)', 'male',   40, null, 12, 0.2000, 'lab'),
  ('cervical_smear',   'Cervical Smear',                  'female', 25, 64,   36, 0.2000, 'lab'),
  ('mammography',      'Mammography',                     'female', 40, 74,   24, 0.1800, 'lab'),
  ('fit',              'Faecal Immunochemical Test (FIT)','all',    45, 74,   24, 0.2000, 'lab'),
  ('hba1c',            'HbA1c',                           'all',    18, null, 6,  0.2200, 'lab'),
  ('lipid_panel',      'Lipid Panel',                     'all',    40, 74,   12, 0.2000, 'lab'),
  ('hep_b',            'Hepatitis B Surface Antigen',     'all',    18, null, null, 0.2000, 'lab'),
  ('hiv',              'HIV Screening',                   'all',    18, null, 12, 0.1500, 'lab'),
  ('tb_screen',        'Tuberculosis Screening',          'all',    null, null, 12, 0.1500, 'lab'),
  ('malaria_rdt',      'Malaria Rapid Diagnostic Test',   'all',    null, null, null, 0.1500, 'lab'),
  ('pcos_panel',       'PCOS Panel',                      'female', 18, 45,   null, 0.2200, 'lab'),
  ('antenatal_booking','Antenatal Booking',               'female', 15, 49,   null, null,   'clinic')
on conflict (code) do nothing;

-- screen_types — additions from TARRAGON_HEALTH_V1_SPEC.md §6 not already
-- covered by the rows above (see docs/FEATURE_SPEC.md reconciliation note)
insert into public.screen_types
  (code, name, sex_applicability, age_from, age_to, frequency_months, commission_rate, recommended_provider_type)
values
  ('hep_c',                'Hepatitis C Test',       'all',    18, null, null, 0.2000, 'lab'),
  ('sickle_cell_genotype', 'Sickle Cell Genotype',   'all',    18, null, null, 0.2000, 'lab'),
  ('vision_check',         'Vision Check',           'all',    40, null, 24,   0.1500, 'clinic'),
  ('clinical_breast_exam', 'Clinical Breast Exam',   'female', 25, null, 12,   0.1500, 'clinic'),
  ('bone_density',         'Bone Density Scan',      'female', 65, null, null, 0.1800, 'clinic'),
  ('colonoscopy',          'Colonoscopy',            'all',    45, null, 120,  0.2000, 'clinic'),
  -- base cadence per spec §6.1; the screening recommendation engine
  -- (apps/web/src/lib/rules/screening-recommendations.ts) tightens this to
  -- 12 months once the patient's hypertension risk tier is moderate/high
  ('blood_pressure',       'Blood Pressure Check',   'all',    18, null, 24,   0.1500, 'clinic')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- vaccination_catalog (V1 spec §6.5 — adult core set)
-- ---------------------------------------------------------------------------
insert into public.vaccination_catalog (code, name, description, recommended_age)
values
  ('tetanus_td_booster', 'Tetanus/Td Booster', 'Booster dose every 10 years.',
     '{"interval_years": 10}'::jsonb),
  ('hepatitis_b',        'Hepatitis B',        '3-dose series if non-immune.',
     '{"dose_schedule_months": [0, 1, 6]}'::jsonb),
  ('yellow_fever',       'Yellow Fever',       'Once, per Nigeria requirements.',
     '{"doses": 1}'::jsonb),
  ('hpv',                'HPV',                'Catch-up through age 26.',
     '{"max_catch_up_age": 26}'::jsonb),
  ('influenza',          'Influenza',          'Annual, optional.',
     '{"interval_years": 1}'::jsonb),
  ('shingles',           'Shingles',           'From age 50.',
     '{"min_age": 50}'::jsonb)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- lab_providers
-- ---------------------------------------------------------------------------
insert into public.lab_providers (name, home_collection, regions)
values
  ('Synlab Nigeria',     true,  array['Lagos', 'Abuja']),
  ('Cerba Lancet',       true,  array['Lagos', 'Abuja']),
  ('Healthtracka',       true,  array['Lagos', 'Abuja']),
  ('Afriglobal Medicare',true,  array['Lagos'])
on conflict (name) do nothing;

-- lab_tests — starter menu keyed to screen_types codes (price in kobo)
insert into public.lab_tests (provider_id, code, name, price_kobo, commission_rate, turnaround_hours)
select p.id, t.code, t.name, t.price_kobo, t.commission_rate, t.turnaround_hours
from public.lab_providers p
join (values
  ('Synlab Nigeria',      'hba1c',        'HbA1c',                    800000::bigint, 0.2000, 48),
  ('Synlab Nigeria',      'lipid_panel',  'Lipid Panel',              950000::bigint, 0.2000, 48),
  ('Synlab Nigeria',      'psa',          'PSA',                     1200000::bigint, 0.2000, 72),
  ('Cerba Lancet',        'hba1c',        'HbA1c',                    850000::bigint, 0.2000, 48),
  ('Cerba Lancet',        'cervical_smear','Cervical Smear',         1800000::bigint, 0.2000, 96),
  ('Healthtracka',        'hba1c',        'HbA1c (home collection)',  900000::bigint, 0.2200, 48),
  ('Healthtracka',        'hiv',          'HIV Screening',            600000::bigint, 0.1500, 24),
  ('Afriglobal Medicare', 'lipid_panel',  'Lipid Panel',              900000::bigint, 0.2000, 48),
  ('Afriglobal Medicare', 'hep_b',        'Hepatitis B Surface Antigen',700000::bigint, 0.2000, 48)
) as t(provider_name, code, name, price_kobo, commission_rate, turnaround_hours)
  on t.provider_name = p.name
on conflict (provider_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- panel_bundles (price in kobo)
-- ---------------------------------------------------------------------------
insert into public.panel_bundles (code, name, description, price_kobo, test_codes)
values
  ('hypertension_panel', 'Hypertension Panel',
     'BP work-up: U&E, eGFR, urine ACR, lipids, HbA1c.',
     2200000, array['lipid_panel', 'hba1c']),
  ('diabetes_panel', 'Diabetes Panel',
     'HbA1c, lipids, eGFR, urine ACR, foot risk baseline.',
     1850000, array['hba1c', 'lipid_panel']),
  ('annual_health_check', 'Annual Health Check',
     'Full metabolic panel plus gender-specific cancer screens.',
     6500000, array['hba1c', 'lipid_panel', 'psa', 'cervical_smear'])
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- pharmacy_partners
-- ---------------------------------------------------------------------------
insert into public.pharmacy_partners (name, delivery, regions)
values
  ('Medplus',        true, array['Lagos', 'Abuja']),
  ('HealthPlus',     true, array['Lagos', 'Abuja']),
  ('Alpha Pharmacy', true, array['Lagos']),
  ('MedsPal',        true, array['Lagos'])
on conflict (name) do nothing;

-- pharmacy_medications — starter formulary (chronic-disease staples; price in kobo)
insert into public.pharmacy_medications (pharmacy_partner_id, drug_name, pack_size, price_kobo)
select p.id, m.drug_name, m.pack_size, m.price_kobo
from public.pharmacy_partners p
join (values
  ('Medplus',        'Amlodipine 5mg',  '30 tablets', 250000::bigint),
  ('Medplus',        'Lisinopril 10mg', '30 tablets', 320000::bigint),
  ('Medplus',        'Metformin 500mg', '60 tablets', 300000::bigint),
  ('HealthPlus',     'Amlodipine 10mg', '30 tablets', 300000::bigint),
  ('HealthPlus',     'Metformin 1000mg','60 tablets', 420000::bigint),
  ('Alpha Pharmacy', 'Losartan 50mg',   '30 tablets', 380000::bigint),
  ('MedsPal',        'Atorvastatin 20mg','30 tablets',450000::bigint)
) as m(partner_name, drug_name, pack_size, price_kobo)
  on m.partner_name = p.name
on conflict (pharmacy_partner_id, drug_name, pack_size) do nothing;

-- ---------------------------------------------------------------------------
-- subscription_plans (NGN in kobo, GBP in pence)
-- ---------------------------------------------------------------------------
insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features)
values
  ('free_tracker', 'Free Health Tracker',
     'Self-monitoring, logging, reminders, education, Health Passport.',
     0, 'NGN', 'monthly', array['tracking', 'reminders', 'education']),
  ('basic_monitoring', 'Basic Monitoring',
     'BP + glucose tracking, medication reminders, doctor WhatsApp support.',
     800000, 'NGN', 'monthly', array['chronic', 'reminders', 'whatsapp_support']),
  ('prevention_addon', 'Prevention Add-on',
     'Screening reminders, result tracking, referral coordination.',
     2500000, 'NGN', 'yearly', array['prevention', 'coordination']),
  ('annual_health_check', 'Annual Health Check',
     'Full metabolic panel + gender-specific cancer screens + monitoring.',
     6000000, 'NGN', 'yearly', array['prevention', 'chronic', 'labs']),
  ('family_plan', 'Family Plan',
     '4-6 members; antenatal, elder care, adult screening combined.',
     15000000, 'NGN', 'yearly', array['family', 'chronic', 'prevention']),
  ('diaspora_essential', 'Diaspora — Essential',
     '1 condition monitored remotely, WhatsApp updates, monthly doctor call.',
     1500, 'GBP', 'monthly', array['chronic', 'whatsapp_support', 'diaspora']),
  ('diaspora_premium', 'Diaspora — Premium',
     'Full monitoring + family portal access.',
     4500, 'GBP', 'monthly', array['chronic', 'prevention', 'family', 'diaspora'])
on conflict (code) do nothing;
