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
-- RequiresEntitlement gate on. Diaspora (USD/GBP, Stripe) rows are seeded
-- separately below, in the same tiers/features, once this NGN block lands.
-- ---------------------------------------------------------------------------
insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features)
values
  ('free', 'Tarragon Free',
     'Self-tracking, reminders, education, Health Passport. No doctor review on this plan.',
     0, 'NGN', 'monthly', array['tracking', 'reminders', 'education']),
  ('essential', 'Essential Care',
     'One condition: monthly doctor review, monthly doctor check-in, WhatsApp care team access.',
     800000, 'NGN', 'monthly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills']),
  ('essential_yearly', 'Essential Care (yearly)',
     'Essential Care billed annually — 2 months free.',
     8000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills']),
  ('complete', 'Complete Care',
     'Multiple conditions or higher risk: weekly doctor review, priority doctor escalation.',
     1500000, 'NGN', 'monthly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation']),
  ('complete_yearly', 'Complete Care (yearly)',
     'Complete Care billed annually — 2 months free.',
     15000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation']),
  ('family', 'Family Lite',
     'Up to 4 people at Complete Care–level monitoring, shared family dashboard, one combined bill, monthly family report.',
     15000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard'])
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- NGN higher tiers added after the V2 pricing update (marketing NGN_TIERS
-- family-plus / family-premium / parentcare). Seeded is_active=false — same
-- convention as the diaspora rows below: each activates only once an admin
-- syncs it to a real Paystack Plan via /admin/settings/subscriptions, so a
-- Stripe/Paystack outage never leaves a selectable-but-uncheckoutable plan.
-- ---------------------------------------------------------------------------
insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features, is_active)
values
  ('family_plus', 'Family Plus',
     'Everything in Family Lite, plus a named family doctor coordinator, priority escalation across all members, and one free Annual Health Check a year.',
     22000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'annual_review', 'lifestyle_coaching', 'health_education'], false),
  ('family_premium', 'Family Premium',
     'Everything in Family Plus, plus a named doctor coordinator with a scheduled monthly appointment for every member, quarterly reports, expedited response, and two free Annual Health Checks a year.',
     32000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'expedited_response', 'quarterly_report', 'annual_review', 'lifestyle_coaching', 'health_education'], false),
  ('parentcare', 'ParentCare',
     'Dedicated monitoring for up to 2 parents: named doctor coordinator, scheduled doctor review, quarterly family report, priority escalation, and lab/pharmacy coordination.',
     2500000, 'NGN', 'monthly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report'], false),
  ('parentcare_yearly', 'ParentCare (yearly)',
     'ParentCare billed annually — 2 months free.',
     25000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report'], false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- add_ons — the base recurring, attach-to-subscription add-ons (see
-- pricing.ts ADD_ONS); the tier/currency-specific extra-member add-ons are
-- seeded in the block below. The pay-per-use "BOOK & PAY" items (HPV vaccine,
-- starter kit, Annual Health Check) are intentionally not modeled here.
-- ---------------------------------------------------------------------------
insert into public.add_ons (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code)
values
  ('prevention-screening', 'Prevention Screening Add-on',
     'Personalised screening calendar, WhatsApp reminders, booking coordination, results tracking. Does not prepay for the tests themselves.',
     2500000, 'NGN', 'yearly', array['prevention_coordination'], null),
  ('care-coordinator', 'Dedicated Care Coordinator',
     'One named doctor coordinator, a scheduled monthly doctor appointment, quarterly PDF report, priority escalation.',
     3000000, 'NGN', 'monthly', array['dedicated_coordinator'], 'complete'),
  ('extra-family-member', 'Extra Family Member',
     'Adds one more person to the Family Plan (up to 6 total) at Complete Care–level monitoring.',
     3000000, 'NGN', 'yearly', array['extra_family_slot'], 'family'),
  ('expedited-response', 'Expedited Doctor Response',
     'Doctor response time for non-emergency questions moves to under 2 hours.',
     500000, 'NGN', 'monthly', array['expedited_response'], null)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Extra-member add-ons for the higher family tiers + ParentCare (marketing
-- pricing.ts ADD_ONS extra-family-member tiered pricing + ParentCare's extra
-- parent). restricted_to_plan_code is an exact-match string, so each
-- tier/currency/interval variant gets its own row. is_active=false until the
-- parent plan is synced, matching the plans above.
-- ---------------------------------------------------------------------------
insert into public.add_ons (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code, is_active)
values
  ('extra-family-member-plus', 'Extra Family Member (Family Plus)',
     'Adds one more person to Family Plus (up to 6 total) at the same level of monitoring.',
     4000000, 'NGN', 'yearly', array['extra_family_slot'], 'family_plus', false),
  ('extra-family-member-premium', 'Extra Family Member (Family Premium)',
     'Adds one more person to Family Premium (up to 6 total) at the same level of monitoring.',
     5500000, 'NGN', 'yearly', array['extra_family_slot'], 'family_premium', false),
  ('extra-parentcare-member', 'Extra Parent (ParentCare)',
     'Adds a third parent to a ParentCare subscription at the same level of monitoring.',
     800000, 'NGN', 'monthly', array['extra_family_slot'], 'parentcare', false),
  ('extra-parentcare-member-yearly', 'Extra Parent (ParentCare, yearly)',
     'Adds a third parent to a yearly ParentCare subscription at the same level of monitoring.',
     8000000, 'NGN', 'yearly', array['extra_family_slot'], 'parentcare_yearly', false),
  ('extra-parentcare-member-gbp', 'Extra Parent (ParentCare)',
     'Adds a third parent to a ParentCare subscription at the same level of monitoring.',
     3900, 'GBP', 'monthly', array['extra_family_slot'], 'parentcare_gbp', false),
  ('extra-parentcare-member-yearly-gbp', 'Extra Parent (ParentCare, yearly)',
     'Adds a third parent to a yearly ParentCare subscription at the same level of monitoring.',
     39000, 'GBP', 'yearly', array['extra_family_slot'], 'parentcare_yearly_gbp', false),
  ('extra-parentcare-member-usd', 'Extra Parent (ParentCare)',
     'Adds a third parent to a ParentCare subscription at the same level of monitoring.',
     700, 'USD', 'monthly', array['extra_family_slot'], 'parentcare_usd', false),
  ('extra-parentcare-member-yearly-usd', 'Extra Parent (ParentCare, yearly)',
     'Adds a third parent to a yearly ParentCare subscription at the same level of monitoring.',
     7000, 'USD', 'yearly', array['extra_family_slot'], 'parentcare_yearly_usd', false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Diaspora (USD/GBP, Stripe) plans — same tiers/features as the NGN rows
-- above, `_usd`/`_gbp`-suffixed codes, round-number pricing (not a currency
-- conversion of the NGN price). `is_active=false` until an admin syncs each
-- row to a real Stripe Price via /admin/settings/subscriptions's
-- "Sync to Stripe" retry button — mirrors how NGN rows only activate once
-- their Paystack Plan sync succeeds, so a Stripe outage never leaves a plan
-- patients can select but can't check out with.
-- ---------------------------------------------------------------------------
insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features, is_active)
values
  ('essential_usd', 'Essential Care', 'One condition: monthly doctor review, monthly doctor check-in, WhatsApp care team access.',
     500, 'USD', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills'], false),
  ('essential_gbp', 'Essential Care', 'One condition: monthly doctor review, monthly doctor check-in, WhatsApp care team access.',
     2500, 'GBP', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills'], false),
  ('essential_yearly_usd', 'Essential Care (yearly)', 'Essential Care billed annually — 2 months free.',
     5000, 'USD', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills'], false),
  ('essential_yearly_gbp', 'Essential Care (yearly)', 'Essential Care billed annually — 2 months free.',
     25000, 'GBP', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills'], false),
  ('complete_usd', 'Complete Care', 'Multiple conditions or higher risk: weekly doctor review, priority doctor escalation.',
     1000, 'USD', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation'], false),
  ('complete_gbp', 'Complete Care', 'Multiple conditions or higher risk: weekly doctor review, priority doctor escalation.',
     5900, 'GBP', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation'], false),
  ('complete_yearly_usd', 'Complete Care (yearly)', 'Complete Care billed annually — 2 months free.',
     10000, 'USD', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation'], false),
  ('complete_yearly_gbp', 'Complete Care (yearly)', 'Complete Care billed annually — 2 months free.',
     59000, 'GBP', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation'], false),
  ('family_usd', 'Family Lite', 'Up to 4 people at Complete Care–level monitoring, shared family dashboard, one combined bill.',
     10000, 'USD', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard'], false),
  ('family_gbp', 'Family Lite', 'Up to 4 people at Complete Care–level monitoring, shared family dashboard, one combined bill.',
     8000, 'GBP', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard'], false),
  -- Diaspora Premium (marketing GBP_TIERS diaspora-premium) + ParentCare diaspora variants.
  ('diaspora_premium_gbp', 'Premium Care (Diaspora)', 'Complete Care, plus a named doctor coordinator, a scheduled monthly doctor appointment, and a quarterly PDF report.',
     9900, 'GBP', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'dedicated_coordinator', 'quarterly_report', 'annual_review', 'lifestyle_coaching', 'health_education'], false),
  ('diaspora_premium_yearly_gbp', 'Premium Care (Diaspora, yearly)', 'Premium Care (Diaspora) billed annually.',
     99000, 'GBP', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'dedicated_coordinator', 'quarterly_report', 'annual_review', 'lifestyle_coaching', 'health_education'], false),
  ('parentcare_gbp', 'ParentCare', 'Dedicated monitoring for up to 2 parents from abroad: named doctor coordinator, scheduled doctor review, quarterly family report, priority escalation, and lab/pharmacy coordination in Nigeria.',
     11900, 'GBP', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report'], false),
  ('parentcare_yearly_gbp', 'ParentCare (yearly)', 'ParentCare billed annually — 2 months free.',
     119000, 'GBP', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report'], false),
  ('parentcare_usd', 'ParentCare', 'Dedicated monitoring for up to 2 parents from abroad: named doctor coordinator, scheduled doctor review, quarterly family report, priority escalation, and lab/pharmacy coordination in Nigeria.',
     2000, 'USD', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report'], false),
  ('parentcare_yearly_usd', 'ParentCare (yearly)', 'ParentCare billed annually — 2 months free.',
     20000, 'USD', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report'], false)
on conflict (code) do nothing;

insert into public.add_ons (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code, is_active)
values
  ('prevention-screening_usd', 'Prevention Screening Add-on',
     'Personalised screening calendar, WhatsApp reminders, booking coordination, results tracking. Does not prepay for the tests themselves.',
     1500, 'USD', 'yearly', array['prevention_coordination'], null, false),
  ('prevention-screening_gbp', 'Prevention Screening Add-on',
     'Personalised screening calendar, WhatsApp reminders, booking coordination, results tracking. Does not prepay for the tests themselves.',
     1200, 'GBP', 'yearly', array['prevention_coordination'], null, false),
  ('care-coordinator_usd', 'Dedicated Care Coordinator',
     'One named clinician coordinator, a scheduled monthly doctor appointment, quarterly PDF report, priority escalation.',
     2000, 'USD', 'monthly', array['dedicated_coordinator'], 'complete_usd', false),
  ('care-coordinator_gbp', 'Dedicated Care Coordinator',
     'One named clinician coordinator, a scheduled monthly doctor appointment, quarterly PDF report, priority escalation.',
     1600, 'GBP', 'monthly', array['dedicated_coordinator'], 'complete_gbp', false),
  ('extra-family-member_usd', 'Extra Family Member',
     'Adds one more person to the Family Plan (up to 6 total) at Complete Care–level monitoring.',
     2000, 'USD', 'yearly', array['extra_family_slot'], 'family_usd', false),
  ('extra-family-member_gbp', 'Extra Family Member',
     'Adds one more person to the Family Plan (up to 6 total) at Complete Care–level monitoring.',
     1600, 'GBP', 'yearly', array['extra_family_slot'], 'family_gbp', false),
  ('expedited-response_usd', 'Expedited Clinician Response',
     'Clinician response time for non-emergency questions moves to under 2 hours.',
     300, 'USD', 'monthly', array['expedited_response'], null, false),
  ('expedited-response_gbp', 'Expedited Clinician Response',
     'Clinician response time for non-emergency questions moves to under 2 hours.',
     250, 'GBP', 'monthly', array['expedited_response'], null, false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Health Education entitlement (mirrors 20260717151000). Appended here so a
-- fresh env picks it up AFTER the plan/add-on inserts above — the migration's
-- UPDATE would otherwise run before these rows exist. Idempotent.
-- ---------------------------------------------------------------------------
update public.subscription_plans
   set features = array_append(features, 'health_education')
 where code in (
         'complete', 'complete_yearly',
         'complete_usd', 'complete_gbp', 'complete_yearly_usd', 'complete_yearly_gbp',
         'family', 'family_usd', 'family_gbp',
         'parentcare', 'parentcare_yearly',
         'parentcare_gbp', 'parentcare_yearly_gbp',
         'parentcare_usd', 'parentcare_yearly_usd'
       )
   and not ('health_education' = any(features));

insert into public.add_ons
  (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code, is_active)
values
  ('health-education', 'Health Education',
     'Personalised, clinician-reviewed learning built around your conditions, with short knowledge checks. Included free on Complete Care and above.',
     500000, 'NGN', 'monthly', array['health_education'], null, true),
  ('health-education_usd', 'Health Education',
     'Personalised, clinician-reviewed learning built around your conditions, with short knowledge checks. Included free on Complete Care and above.',
     300, 'USD', 'monthly', array['health_education'], null, false),
  ('health-education_gbp', 'Health Education',
     'Personalised, clinician-reviewed learning built around your conditions, with short knowledge checks. Included free on Complete Care and above.',
     250, 'GBP', 'monthly', array['health_education'], null, false)
on conflict (code) do nothing;
