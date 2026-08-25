-- Tarragon Health — Sprint 1 seed data
--
-- Populates the global reference catalogues only (no tenant/patient data):
-- screen_types, vaccination_catalog, lab partners + a starter test menu,
-- panel bundles, pharmacy partners + a starter formulary, and subscription
-- plans.
-- Idempotent: safe to run repeatedly. Money is in minor units (kobo for NGN,
-- cents for USD). Real partner names per CLAUDE.md / FEATURE_SPEC §8.
--
-- ⚠️ THIS FILE ONLY RUNS ON A LOCAL `supabase db reset`. It is never applied
-- to a remote project. On 2026-07-29 the platform database was rebuilt from
-- migrations and every catalogue that lived only here vanished from
-- production: lab_providers, lab_tests, facilities and pharmacy_partners went
-- to zero rows, screen_types to one, and the flagship annual_health_check
-- panel_bundle disappeared entirely, which silently made the Annual Health
-- Check and every confidential screening unbookable.
--
-- The clinical catalogue is therefore ALSO carried by
-- supabase/migrations/20260730231822_restore_clinical_catalogue.sql, which is
-- what governs deployed environments. That migration runs before this file on
-- a local reset, so the inserts below simply no-op via their existing
-- `on conflict do nothing`. Keep the two consistent, and when you add a new
-- catalogue row that production needs, put it in a migration, not only here.

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
  ('blood_group',          'Blood Group & Rhesus Factor', 'all', 0, null, null, 0.2000, 'lab'),
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
     '{"min_age": 50}'::jsonb),
  ('covid_19',           'COVID-19',           'Per current national guidance; boosters for higher-risk/older adults.',
     '{"interval_years": 1}'::jsonb),
  ('pneumococcal',       'Pneumococcal',       'Older adults and those with chronic disease, per guidance.',
     '{"min_age": 65}'::jsonb),
  ('meningococcal',      'Meningococcal',      'In outbreaks / meningitis-belt risk, per guidance.',
     '{"doses": 1}'::jsonb),
  ('typhoid',            'Typhoid',            'Risk- and travel-based.',
     '{"doses": 1}'::jsonb),
  ('hepatitis_a',        'Hepatitis A',        'Risk- and travel-based; 2-dose series.',
     '{"dose_schedule_months": [0, 6]}'::jsonb)
on conflict (code) do nothing;

-- WHO's full lifetime tetanus toxoid-containing-vaccine (TTCV) schedule: the
-- infant Pentavalent series (child_penta, seeded by the
-- child_immunisation_nphcda migration, not this file) plus 3 further
-- childhood boosters (~18 months / 4-7 years / 9-15 years) before the adult
-- 10-year cadence begins -- migrations 20260724022928 + 20260724024110.
-- Not part of the ON CONFLICT insert above since child_* rows live only in
-- that migration; INSERT here is its own idempotent ON CONFLICT DO NOTHING.
insert into public.vaccination_catalog (code, name, description, recommended_age)
values
  ('child_tetanus_booster_1', 'Tetanus Booster — 18 Months',
     'WHO-recommended childhood tetanus booster, typically given between 12 and 23 months.',
     '{"age_schedule_weeks": [78], "max_age_years": 3}'::jsonb),
  ('child_tetanus_booster_2', 'Tetanus Booster — 4 to 7 Years',
     'WHO-recommended childhood tetanus booster, typically given between 4 and 7 years.',
     '{"age_schedule_weeks": [208], "max_age_years": 8}'::jsonb),
  ('child_tetanus_booster_3', 'Tetanus Booster — 9 to 15 Years',
     'WHO-recommended childhood tetanus booster, typically given between 9 and 15 years -- the last dose before the adult 10-year booster cycle begins.',
     '{"age_schedule_weeks": [469], "max_age_years": 16}'::jsonb)
on conflict (code) do nothing;

-- Anchor the adult tetanus/Td booster off child_tetanus_booster_3 (the LAST
-- stage of the WHO series above), via computeVaccinationStatuses'
-- anchor_fallback_code. Always sets the same final value rather than
-- guarding on "not already set" -- this key's value changed once already
-- (from child_penta to child_tetanus_booster_3, see migration
-- 20260724024110), so a presence-only guard would have skipped
-- backfilling the corrected value on an environment seeded before that
-- change; setting the same key/value repeatedly is already idempotent.
update public.vaccination_catalog
  set recommended_age = recommended_age || '{"anchor_fallback_code": "child_tetanus_booster_3"}'::jsonb
  where code = 'tetanus_td_booster';

-- Shingles (Shingrix/RZV) is a real 2-dose series 2-6 months apart, not a
-- single dose -- migration 20260724025012. Overwrites the base insert's
-- {"min_age": 50} above (which alone marks any single dose "complete") with
-- the compound min_age + dose_schedule_months shape.
update public.vaccination_catalog
  set recommended_age = '{"min_age": 50, "dose_schedule_months": [0, 2]}'::jsonb,
      description = '2-dose series from age 50, 2 to 6 months apart.'
  where code = 'shingles';

-- ---------------------------------------------------------------------------
-- lab_providers
--
-- Synlab Nigeria is seeded active and nationwide (regions = every state) to
-- mirror the live project post-20260825185258_lab_partner_fulfilment_restored
-- — that migration's UPDATE runs before this INSERT on a fresh `db reset`
-- (migrations replay against an empty table), so the nationwide/active state
-- has to be set here directly too, or local dev and the live project would
-- diverge. The other three lab_providers stay inactive/regional placeholders
-- — only Synlab is a real, signed partner.
-- ---------------------------------------------------------------------------
insert into public.lab_providers (name, home_collection, regions, is_active)
values
  ('Synlab Nigeria',     true,  array[
     'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
     'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','Gombe','Imo','Jigawa',
     'Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger',
     'Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe',
     'Zamfara','Abuja'
   ], true),
  ('Cerba Lancet',       true,  array['Lagos', 'Abuja'], false),
  ('Healthtracka',       true,  array['Lagos', 'Abuja'], false),
  ('Afriglobal Medicare',true,  array['Lagos'], false)
on conflict (name) do nothing;

-- Lab-facing notification contacts (migration 20260724020744) — .example
-- addresses, same convention as pharmacy_partners above, so seeding never
-- sends to a real inbox/handset. Plain UPDATE (not part of the INSERT ...
-- ON CONFLICT above) since these columns didn't exist when the insert ran
-- on an already-seeded environment; the null guard keeps it idempotent.
update public.lab_providers set contact_email = 'labs@synlab.example', contact_phone = '+2348030000101' where name = 'Synlab Nigeria' and contact_email is null;
update public.lab_providers set contact_email = 'labs@cerbalancet.example', contact_phone = '+2348030000102' where name = 'Cerba Lancet' and contact_email is null;
update public.lab_providers set contact_email = 'labs@healthtracka.example', contact_phone = '+2348030000103' where name = 'Healthtracka' and contact_email is null;
update public.lab_providers set contact_email = 'labs@afriglobalmedicare.example', contact_phone = '+2348030000104' where name = 'Afriglobal Medicare' and contact_email is null;

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
  ('Afriglobal Medicare', 'hep_b',        'Hepatitis B Surface Antigen',700000::bigint, 0.2000, 48),
  ('Synlab Nigeria',      'blood_group',           'Blood Group & Rhesus Factor', 350000::bigint, 0.2000, 24),
  ('Synlab Nigeria',      'sickle_cell_genotype',  'Sickle Cell Genotype',        400000::bigint, 0.2000, 24),
  ('Healthtracka',        'blood_group',           'Blood Group & Rhesus Factor', 300000::bigint, 0.2200, 24),
  ('Healthtracka',        'sickle_cell_genotype',  'Sickle Cell Genotype',        350000::bigint, 0.2200, 24),
  ('Cerba Lancet',        'hep_c',                 'Hepatitis C Antibody Test',   750000::bigint, 0.2000, 48),
  ('Afriglobal Medicare', 'hep_c',                 'Hepatitis C Antibody Test',   700000::bigint, 0.2000, 48)
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

-- Health Check tier ladder (migration 20260723164727): Basic (WHO PEN
-- cardiometabolic) / Standard (annual_health_check) / Comprehensive (adds
-- HIV + Hep B + Hep C). PLACEHOLDER PRICES — founder to confirm.
insert into public.panel_bundles (code, name, description, price_kobo, test_codes, self_bookable)
values
  ('health_check_basic', 'Health Check — Basic',
     'Cardiometabolic essentials (WHO PEN): HbA1c and full lipid panel, plus BP and BMI at the lab. Doctor-reviewed.',
     1500000, array['hba1c', 'lipid_panel'], true),
  ('health_check_comprehensive', 'Health Check — Comprehensive',
     'Everything in the Annual Health Check plus HIV, Hepatitis B, and Hepatitis C screening. Doctor-reviewed.',
     7500000, array['hba1c', 'lipid_panel', 'psa', 'cervical_smear', 'hiv', 'hep_b', 'hep_c'], true)
on conflict (code) do nothing;

-- Blood group & genotype combo, and standalone Hepatitis C — migration
-- 20260724020715. Bundled together (patients almost always want both, same
-- as how Nigerian labs package it) rather than two separate bookable items.
-- Prices are PLACEHOLDER — founder to confirm, same convention as every
-- other self-bookable bundle price above.
insert into public.panel_bundles (code, name, description, price_kobo, test_codes, self_bookable)
values
  ('single_blood_group_genotype', 'Blood Group & Genotype',
     'Know your blood group, rhesus factor, and sickle cell genotype (AA/AS/SS) — useful for marriage counselling, pregnancy planning, and emergencies.',
     650000, array['blood_group', 'sickle_cell_genotype'], true),
  ('single_hep_c', 'Hepatitis C Screening',
     'Confidential Hepatitis C antibody test.',
     700000, array['hep_c'], true)
on conflict (code) do nothing;

-- Existing comprehensive bundles may already be seeded from an older
-- environment without hep_c in test_codes — backfill idempotently.
update public.panel_bundles
  set test_codes = array['hba1c', 'lipid_panel', 'psa', 'cervical_smear', 'hiv', 'hep_b', 'hep_c'],
      description = 'Everything in the Annual Health Check plus HIV, Hepatitis B, and Hepatitis C screening. Doctor-reviewed.'
  where code = 'health_check_comprehensive'
    and not ('hep_c' = any(test_codes));

-- Self-bookable set (migrations 20260723150205 + 20260723164727 +
-- 20260724020715): the three Health Check packages plus the WHO-essential
-- confidential screenings (cervical smear per the WHO 90-70-90 elimination
-- strategy, HIV, Hep B, Hep C) plus blood group & genotype. Deliberately NOT
-- a general wellness catalogue — PSA stays package-only per WHO guidance;
-- everything else stays clinician-originated.
update public.panel_bundles set self_bookable = true
  where code in ('annual_health_check', 'single_cervical_smear', 'single_hiv', 'single_hep_b', 'single_hep_c', 'single_blood_group_genotype');

-- ---------------------------------------------------------------------------
-- pharmacy_partners
-- ---------------------------------------------------------------------------
-- Contact (SMS/email for no-login fulfilment) + geocoordinates (nearest-pharmacy
-- selection) added 2026-07-16. Emails use .example domains and the phones are
-- clearly-fake +234 numbers so seeding never sends to a real inbox/handset.
-- uses_platform_login flags the one demo partner that logs into the dashboard
-- (Phase 8); the rest are notification-only. ON CONFLICT DO UPDATE backfills
-- these columns onto partners already seeded before this migration.
insert into public.pharmacy_partners
  (name, delivery, regions, contact_phone, contact_email, address, latitude, longitude, uses_platform_login)
values
  ('Medplus',        true, array['Lagos', 'Abuja'], '+2348030000001', 'orders@medplus.example',        'Allen Avenue, Ikeja, Lagos',        6.6018, 3.3515, false),
  ('HealthPlus',     true, array['Lagos', 'Abuja'], '+2348030000002', 'orders@healthplus.example',     'Adeola Odeku St, Victoria Island, Lagos', 6.4281, 3.4219, true),
  ('Alpha Pharmacy', true, array['Lagos'],          '+2348030000003', 'care@alphapharmacy.example',    'Adeniran Ogunsanya, Surulere, Lagos', 6.5010, 3.3552, false),
  ('MedsPal',        true, array['Lagos'],          '+2348030000004', 'orders@medspal.example',        'Admiralty Way, Lekki Phase 1, Lagos', 6.4698, 3.5852, false)
on conflict (name) do update set
  delivery           = excluded.delivery,
  regions            = excluded.regions,
  contact_phone      = excluded.contact_phone,
  contact_email      = excluded.contact_email,
  address            = excluded.address,
  latitude           = excluded.latitude,
  longitude          = excluded.longitude,
  uses_platform_login = excluded.uses_platform_login;

-- pharmacy_medications — starter formulary (chronic-disease staples; price in kobo).
-- Staple drugs are deliberately stocked by SEVERAL partners so "choose your
-- nearest pharmacy" is a real choice (same drug, different partner/price/location).
insert into public.pharmacy_medications (pharmacy_partner_id, drug_name, pack_size, price_kobo)
select p.id, m.drug_name, m.pack_size, m.price_kobo
from public.pharmacy_partners p
join (values
  ('Medplus',        'Amlodipine 5mg',   '30 tablets', 250000::bigint),
  ('Medplus',        'Lisinopril 10mg',  '30 tablets', 320000::bigint),
  ('Medplus',        'Metformin 500mg',  '60 tablets', 300000::bigint),
  ('HealthPlus',     'Amlodipine 5mg',   '30 tablets', 265000::bigint),
  ('HealthPlus',     'Metformin 500mg',  '60 tablets', 310000::bigint),
  ('HealthPlus',     'Lisinopril 10mg',  '30 tablets', 335000::bigint),
  ('Alpha Pharmacy', 'Amlodipine 5mg',   '30 tablets', 240000::bigint),
  ('Alpha Pharmacy', 'Metformin 500mg',  '60 tablets', 295000::bigint),
  ('Alpha Pharmacy', 'Losartan 50mg',    '30 tablets', 380000::bigint),
  ('MedsPal',        'Metformin 500mg',  '60 tablets', 305000::bigint),
  ('MedsPal',        'Atorvastatin 20mg','30 tablets', 450000::bigint)
) as m(partner_name, drug_name, pack_size, price_kobo)
  on m.partner_name = p.name
on conflict (pharmacy_partner_id, drug_name, pack_size) do nothing;

-- ---------------------------------------------------------------------------
-- facilities — physical directory for the "choose a facility near me" pickers
-- (labs, vaccination centres, hospitals). Lab facilities link to the lab_providers
-- row that runs them (facilities.lab_provider_id) so a booking there derives its
-- commission-bearing provider; vaccination/hospital rows have no link and book via
-- booking_requests. state/city/area + lat/lng make them findable by location.
-- Idempotent via NOT EXISTS on name (facilities has no unique name constraint).
-- ---------------------------------------------------------------------------
insert into public.facilities
  (name, type, state, city, area, address, latitude, longitude, verified, is_active, lab_provider_id)
select
  v.name, v.type::public.facility_type, v.state, v.city, v.area, v.address,
  v.lat, v.lng, true, true, p.id
from (values
  -- Lab collection centres (linked to seeded lab_providers)
  ('Synlab Nigeria — Ikeja',        'lab', 'Lagos', 'Ikeja',           'Allen Avenue',   'Allen Avenue, Ikeja',          6.6018, 3.3515, 'Synlab Nigeria'),
  ('Synlab Nigeria — Wuse',         'lab', 'Abuja', 'Wuse',            'Wuse 2',         'Aminu Kano Cres, Wuse 2',      9.0765, 7.4796, 'Synlab Nigeria'),
  ('Cerba Lancet — Victoria Island','lab', 'Lagos', 'Victoria Island', 'Adeola Odeku',   'Adeola Odeku St, VI',          6.4281, 3.4219, 'Cerba Lancet'),
  ('Healthtracka — Lekki',          'lab', 'Lagos', 'Lekki',           'Lekki Phase 1',  'Admiralty Way, Lekki Phase 1', 6.4698, 3.5852, 'Healthtracka'),
  ('Afriglobal Medicare — Yaba',    'lab', 'Lagos', 'Yaba',            'Sabo',           'Herbert Macaulay Way, Yaba',   6.5095, 3.3711, 'Afriglobal Medicare'),
  -- Vaccination centres (no commercial link — booking-request only)
  ('Ikeja Vaccination Centre',      'vaccination_centre', 'Lagos', 'Ikeja', 'Oba Akran', 'Oba Akran Ave, Ikeja',         6.6100, 3.3450, null),
  ('Wuse Vaccination Centre',       'vaccination_centre', 'Abuja', 'Wuse',  'Wuse 2',    'Adetokunbo Ademola Cres, Wuse',9.0723, 7.4850, null),
  -- Hospitals
  ('Lagos General Hospital — Ikeja','hospital', 'Lagos', 'Ikeja', 'Ikeja GRA', 'Oba Akinjobi Way, Ikeja',            6.5833, 3.3500, null),
  ('Garki Hospital — Abuja',        'hospital', 'Abuja', 'Garki', 'Area 3',    'Tafawa Balewa Way, Garki',           9.0333, 7.4930, null)
) as v(name, type, state, city, area, address, lat, lng, provider_name)
left join public.lab_providers p on p.name = v.provider_name
where not exists (select 1 from public.facilities f where f.name = v.name);

-- Backfill structured location onto the partner-keyed catalogues so their
-- location filters work (both already carry address/geo or a `location` string).
update public.pharmacy_partners set state = 'Lagos', city = 'Ikeja',           area = 'Allen Avenue'    where name = 'Medplus'        and state is null;
update public.pharmacy_partners set state = 'Lagos', city = 'Victoria Island', area = 'Adeola Odeku'     where name = 'HealthPlus'     and state is null;
update public.pharmacy_partners set state = 'Lagos', city = 'Surulere',        area = 'Adeniran Ogunsanya' where name = 'Alpha Pharmacy' and state is null;
update public.pharmacy_partners set state = 'Lagos', city = 'Lekki',           area = 'Lekki Phase 1'   where name = 'MedsPal'        and state is null;

-- Placeholder specialist catalogue is all Lagos-based (seeded in
-- 20260715003255...); give them a state/city so locality matching has data.
update public.specialist_providers set state = 'Lagos', city = 'Ikeja' where state is null;

-- ---------------------------------------------------------------------------
-- subscription_plans (NGN in kobo) — kept in sync with the marketing
-- pricing page (apps/web/src/app/(marketing)/_content/pricing.ts NGN_TIERS)
-- which is the copy/price source of truth; this table must match it, not
-- the other way around. Feature codes here are what public.has_feature_access()/
-- RequiresEntitlement gate on. Diaspora (USD, Stripe) rows are seeded
-- separately below, in the same tiers/features, once this NGN block lands.
--
-- Entitlement features granted to the comprehensive tiers by later migrations
-- (annual_review 20260717123000, lifestyle_coaching 20260717141000,
-- health_education 20260717151000 + gap fix 20260719213449, async_doctor_visit
-- 20260723010040, ai_coach 20260810131959) are INLINED in these arrays: on
-- `supabase db reset` those migrations' UPDATEs run before this seed file, so
-- the inserts here must carry the full live-DB feature set themselves
-- (2026-07-23 reconciliation). Note: as of 20260729130000_restore_subscription_
-- price_book.sql, these specific complete*/complete_yearly* rows are actually
-- migration-created (that migration's own `insert ... on conflict do update`
-- wins over whatever this seed file tries afterward), so inlining here is
-- belt-and-suspenders documentation, not load-bearing, for this block —
-- still worth keeping accurate so a reader grepping this file for a feature
-- code sees the true live set.
-- ---------------------------------------------------------------------------
insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features)
values
  ('free', 'Tarragon Free',
     'Self-tracking, reminders, education, Health Passport. No doctor review on this plan.',
     0, 'NGN', 'monthly', array['tracking', 'reminders', 'education']),
  ('essential', 'Essential Care',
     'One condition: monthly doctor review, monthly doctor check-in, care team messaging in the app.',
     800000, 'NGN', 'monthly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills']),
  ('essential_yearly', 'Essential Care (yearly)',
     'Essential Care billed annually — 2 months free.',
     8000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills']),
  ('complete', 'Complete Care',
     'Multiple conditions or higher risk: weekly doctor review, priority doctor escalation.',
     1500000, 'NGN', 'monthly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'annual_review', 'lifestyle_coaching', 'ai_coach', 'health_education', 'async_doctor_visit']),
  ('complete_yearly', 'Complete Care (yearly)',
     'Complete Care billed annually — 2 months free.',
     15000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'annual_review', 'lifestyle_coaching', 'ai_coach', 'health_education', 'async_doctor_visit'])
on conflict (code) do nothing;


-- ---------------------------------------------------------------------------
-- Tarragon Prevent — the stay-healthy tier between Free and Essential
-- (migration 20260723150222_prevent_plan_tier). Prevention-first features:
-- prevention_coordination (screening-calendar booking rights) +
-- health_education on top of the Free basics; no chronic/clinician_review —
-- doctor involvement on this tier is the abnormal-result escalation pipeline,
-- which is plan-independent. PRICING IS PLACEHOLDER (founder to confirm);
-- is_active=false until synced to Paystack/Stripe, per convention.
-- ---------------------------------------------------------------------------
insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features, is_active)
values
  ('prevent', 'Tarragon Prevent',
     'The stay-healthy plan: personal screening calendar with booking, vaccination tracking, and personalised health education. A doctor steps in the moment a result needs one.',
     350000, 'NGN', 'monthly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education'], false),
  ('prevent_yearly', 'Tarragon Prevent (yearly)',
     'Tarragon Prevent billed annually — 2 months free.',
     3500000, 'NGN', 'yearly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education'], false),
  ('prevent_usd', 'Tarragon Prevent',
     'The stay-healthy plan: personal screening calendar with booking, vaccination tracking, and personalised health education. A doctor steps in the moment a result needs one.',
     900, 'USD', 'monthly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education'], false),
  ('prevent_yearly_usd', 'Tarragon Prevent (yearly)',
     'Tarragon Prevent billed annually — 2 months free.',
     9000, 'USD', 'yearly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education'], false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- add_ons — the base recurring, attach-to-subscription add-ons (see
-- pricing.ts ADD_ONS). The pay-per-use "BOOK & PAY" items (HPV vaccine,
-- starter kit, Annual Health Check) are intentionally not modeled here.
-- ---------------------------------------------------------------------------
insert into public.add_ons (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code)
values
  ('prevention-screening', 'Prevention Screening Add-on',
     'Personalised screening calendar, WhatsApp reminders, booking coordination, results tracking. Does not prepay for the tests themselves.',
     2500000, 'NGN', 'yearly', array['prevention_coordination'], null),
  -- 'care-coordinator' (Dedicated Care Coordinator, ₦30,000/mo) removed
  -- 2026-07-31. It sold a named human assigned to one patient, and the founder
  -- confirmed the operating model will not include dedicated per-patient staff.
  -- Its feature key was also read by nothing, so it charged for an entitlement
  -- that gated no code path. Withdrawn rather than left seeded inactive so a
  -- fresh environment never resurrects it. See the migration of the same date.
  ('expedited-response', 'Expedited Doctor Response',
     'Doctor response time for non-emergency questions moves to under 2 hours.',
     500000, 'NGN', 'monthly', array['expedited_response'], null)
on conflict (code) do nothing;


-- ---------------------------------------------------------------------------
-- Diaspora (USD, Stripe) plans — same tiers/features as the NGN rows
-- above, `_usd`-suffixed codes; the amount is the naira price converted
-- conversion of the NGN price). `is_active=false` until an admin syncs each
-- row to a real Stripe Price via /admin/settings/subscriptions's
-- "Sync to Stripe" retry button — mirrors how NGN rows only activate once
-- their Paystack Plan sync succeeds, so a Stripe outage never leaves a plan
-- patients can select but can't check out with.
-- ---------------------------------------------------------------------------
insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features, is_active)
values
  ('essential_usd', 'Essential Care', 'One condition: monthly doctor review, monthly doctor check-in, care team messaging in the app.',
     1900, 'USD', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills'], false),
  ('essential_yearly_usd', 'Essential Care (yearly)', 'Essential Care billed annually — 2 months free.',
     19000, 'USD', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills'], false),
  ('complete_usd', 'Complete Care', 'Multiple conditions or higher risk: weekly doctor review, priority doctor escalation.',
     3900, 'USD', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'annual_review', 'lifestyle_coaching', 'ai_coach', 'health_education', 'async_doctor_visit'], false),
  ('complete_yearly_usd', 'Complete Care (yearly)', 'Complete Care billed annually — 2 months free.',
     39000, 'USD', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'annual_review', 'lifestyle_coaching', 'ai_coach', 'health_education', 'async_doctor_visit'], false)
on conflict (code) do nothing;

insert into public.add_ons (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code, is_active)
values
  ('prevention-screening_usd', 'Prevention Screening Add-on',
     'Personalised screening calendar, WhatsApp reminders, booking coordination, results tracking. Does not prepay for the tests themselves.',
     1500, 'USD', 'yearly', array['prevention_coordination'], null, false),
  -- 'care-coordinator_usd' removed 2026-07-31, same reason as its naira parent.
  ('expedited-response_usd', 'Expedited Clinician Response',
     'Clinician response time for non-emergency questions moves to under 2 hours.',
     300, 'USD', 'monthly', array['expedited_response'], null, false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Health Education add-on (mirrors 20260717151000 / 20260719214207). The
-- plan-side health_education entitlement is inlined in the plan feature
-- arrays above (see the note on the subscription_plans block), so the old
-- post-insert array_append block is gone.
-- ---------------------------------------------------------------------------
insert into public.add_ons
  (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code, is_active)
values
  ('health-education', 'Health Education',
     'Personalised, clinician-reviewed learning built around your conditions, with short knowledge checks. Included free on Complete Care and above.',
     500000, 'NGN', 'monthly', array['health_education'], null, true),
  ('health-education_usd', 'Health Education',
     'Personalised, clinician-reviewed learning built around your conditions, with short knowledge checks. Included free on Complete Care and above.',
     300, 'USD', 'monthly', array['health_education'], null, false)
on conflict (code) do nothing;
