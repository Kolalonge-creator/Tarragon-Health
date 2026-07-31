-- Restore the clinical catalogue that the 2026-07-29 rebuild-from-migrations
-- silently dropped, and move it out of seed.sql so it cannot be lost again.
--
-- WHY THIS EXISTS
-- ---------------
-- supabase/seed/seed.sql runs on a local `db reset` and is NEVER applied to a
-- remote project (CLAUDE.md states this explicitly). Every catalogue row that
-- lived only in seed.sql therefore disappeared when the platform database was
-- rebuilt from migrations on 2026-07-29. Measured live before writing this:
--
--     lab_providers     0   (expected 4)
--     lab_tests         0   (expected 15)
--     facilities        0   (expected 9)
--     pharmacy_partners 0   (expected 4)
--     screen_types      1   (expected 20)
--     panel_bundles    10   but annual_health_check MISSING
--
-- The user-visible consequence was total, not cosmetic:
--
--   * Every self-bookable panel_bundle pointed at lab_tests rows that no
--     longer existed, so nothing resolved to a real orderable test.
--   * FacilitySelector had zero rows to offer, so the "pick a nearby facility"
--     step of the booking flow was an empty dropdown with no way forward.
--   * The screening engine had one screen_type to work with, so the personal
--     screening calendar (the core of the Prevent tier) came out near-empty
--     for every patient regardless of age or sex.
--   * `annual_health_check` — the flagship 65,000 naira product advertised on
--     /annual-health-check, on /pricing and in the three-package ladder — did
--     not exist as a row at all. Migration 20260723150205's
--     `update panel_bundles set self_bookable = true where code =
--     'annual_health_check'` matched ZERO rows on the rebuilt database and
--     failed silently, because that row was only ever created by seed.sql.
--
-- So a healthy patient (the highest-intent prevention visitor there is) could
-- read the marketing site, register, reach for the one product aimed at them,
-- and hit a dead end. Restoring this as a migration is the actual fix: the
-- data now replays with the schema on any future rebuild.
--
-- Everything below is additive and idempotent — `on conflict do nothing`,
-- `where not exists`, or null-guarded UPDATEs. It never deletes or overwrites
-- an operator's real edits, so it is safe to re-run and safe to apply to an
-- environment that was never broken. seed.sql keeps its copies for local
-- `db reset`; the two are consistent, and this file is the one that governs
-- deployed environments.

-- ---------------------------------------------------------------------------
-- 1. screen_types — drives the personal screening calendar
-- ---------------------------------------------------------------------------
-- `sensitive` is set inline here rather than left to migration 20260719140000,
-- whose UPDATE already ran (against an empty table) and will never run again.
insert into public.screen_types
  (code, name, sex_applicability, age_from, age_to, frequency_months,
   commission_rate, recommended_provider_type, sensitive)
values
  ('psa',                 'Prostate-Specific Antigen (PSA)',  'male',   40, null, 12,   0.2000, 'lab',    true),
  ('cervical_smear',      'Cervical Smear',                   'female', 25, 64,   36,   0.2000, 'lab',    true),
  ('mammography',         'Mammography',                      'female', 40, 74,   24,   0.1800, 'lab',    true),
  ('fit',                 'Faecal Immunochemical Test (FIT)', 'all',    45, 74,   24,   0.2000, 'lab',    true),
  ('hba1c',               'HbA1c',                            'all',    18, null, 6,    0.2200, 'lab',    false),
  ('lipid_panel',         'Lipid Panel',                      'all',    40, 74,   12,   0.2000, 'lab',    false),
  ('hep_b',               'Hepatitis B Surface Antigen',      'all',    18, null, null, 0.2000, 'lab',    true),
  ('hiv',                 'HIV Screening',                    'all',    18, null, 12,   0.1500, 'lab',    true),
  ('tb_screen',           'Tuberculosis Screening',           'all',    null, null, 12,  0.1500, 'lab',    false),
  ('malaria_rdt',         'Malaria Rapid Diagnostic Test',    'all',    null, null, null,0.1500, 'lab',    false),
  ('pcos_panel',          'PCOS Panel',                       'female', 18, 45,   null, 0.2200, 'lab',    false),
  ('antenatal_booking',   'Antenatal Booking',                'female', 15, 49,   null, null,   'clinic', false),
  ('hep_c',               'Hepatitis C Test',                 'all',    18, null, null, 0.2000, 'lab',    true),
  ('sickle_cell_genotype','Sickle Cell Genotype',             'all',    18, null, null, 0.2000, 'lab',    false),
  ('blood_group',         'Blood Group & Rhesus Factor',      'all',    0,  null, null, 0.2000, 'lab',    false),
  ('vision_check',        'Vision Check',                     'all',    40, null, 24,   0.1500, 'clinic', false),
  ('clinical_breast_exam','Clinical Breast Exam',             'female', 25, null, 12,   0.1500, 'clinic', true),
  ('bone_density',        'Bone Density Scan',                'female', 65, null, null, 0.1800, 'clinic', false),
  ('colonoscopy',         'Colonoscopy',                      'all',    45, null, 120,  0.2000, 'clinic', true),
  ('blood_pressure',      'Blood Pressure Check',             'all',    18, null, 24,   0.1500, 'clinic', false)
on conflict (code) do nothing;

-- The one row that survived the rebuild (blood_group) predates the sensitive
-- column's UPDATE too; make sure the flags are right on any pre-existing row
-- without touching an operator's deliberate change to a non-sensitive type.
update public.screen_types set sensitive = true
where code in ('hiv', 'hep_b', 'hep_c', 'cervical_smear', 'mammography',
               'psa', 'fit', 'colonoscopy', 'clinical_breast_exam')
  and sensitive = false;

-- ---------------------------------------------------------------------------
-- 2. lab_providers — the real contracted partner names used in marketing
-- ---------------------------------------------------------------------------
insert into public.lab_providers (name, home_collection, regions)
values
  ('Synlab Nigeria',      true, array['Lagos', 'Abuja']),
  ('Cerba Lancet',        true, array['Lagos', 'Abuja']),
  ('Healthtracka',        true, array['Lagos', 'Abuja']),
  ('Afriglobal Medicare', true, array['Lagos'])
on conflict (name) do nothing;

-- Lab-facing notification contacts. Deliberately .example addresses and
-- obviously-fake +234 numbers so a restore never pages a real partner inbox
-- or handset; ops replaces them when a partner is genuinely contracted.
update public.lab_providers set contact_email = 'labs@synlab.example',             contact_phone = '+2348030000101' where name = 'Synlab Nigeria'      and contact_email is null;
update public.lab_providers set contact_email = 'labs@cerbalancet.example',        contact_phone = '+2348030000102' where name = 'Cerba Lancet'        and contact_email is null;
update public.lab_providers set contact_email = 'labs@healthtracka.example',       contact_phone = '+2348030000103' where name = 'Healthtracka'        and contact_email is null;
update public.lab_providers set contact_email = 'labs@afriglobalmedicare.example', contact_phone = '+2348030000104' where name = 'Afriglobal Medicare' and contact_email is null;

-- ---------------------------------------------------------------------------
-- 3. lab_tests — what the panel_bundles' test_codes actually resolve to
-- ---------------------------------------------------------------------------
insert into public.lab_tests (provider_id, code, name, price_kobo, commission_rate, turnaround_hours)
select p.id, t.code, t.name, t.price_kobo, t.commission_rate, t.turnaround_hours
from public.lab_providers p
join (values
  ('Synlab Nigeria',      'hba1c',                'HbA1c',                        800000::bigint, 0.2000, 48),
  ('Synlab Nigeria',      'lipid_panel',          'Lipid Panel',                  950000::bigint, 0.2000, 48),
  ('Synlab Nigeria',      'psa',                  'PSA',                         1200000::bigint, 0.2000, 72),
  ('Synlab Nigeria',      'blood_group',          'Blood Group & Rhesus Factor',  350000::bigint, 0.2000, 24),
  ('Synlab Nigeria',      'sickle_cell_genotype', 'Sickle Cell Genotype',         400000::bigint, 0.2000, 24),
  ('Cerba Lancet',        'hba1c',                'HbA1c',                        850000::bigint, 0.2000, 48),
  ('Cerba Lancet',        'cervical_smear',       'Cervical Smear',              1800000::bigint, 0.2000, 96),
  ('Cerba Lancet',        'hep_c',                'Hepatitis C Antibody Test',    750000::bigint, 0.2000, 48),
  ('Healthtracka',        'hba1c',                'HbA1c (home collection)',      900000::bigint, 0.2200, 48),
  ('Healthtracka',        'hiv',                  'HIV Screening',                600000::bigint, 0.1500, 24),
  ('Healthtracka',        'blood_group',          'Blood Group & Rhesus Factor',  300000::bigint, 0.2200, 24),
  ('Healthtracka',        'sickle_cell_genotype', 'Sickle Cell Genotype',         350000::bigint, 0.2200, 24),
  ('Afriglobal Medicare', 'lipid_panel',          'Lipid Panel',                  900000::bigint, 0.2000, 48),
  ('Afriglobal Medicare', 'hep_b',                'Hepatitis B Surface Antigen',  700000::bigint, 0.2000, 48),
  ('Afriglobal Medicare', 'hep_c',                'Hepatitis C Antibody Test',    700000::bigint, 0.2000, 48)
) as t(provider_name, code, name, price_kobo, commission_rate, turnaround_hours)
  on t.provider_name = p.name
on conflict (provider_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- 4. annual_health_check — the flagship bundle that never came back
-- ---------------------------------------------------------------------------
-- 65,000 naira, matching the advertised price in
-- apps/web/src/app/(marketing)/_content/pricing.ts. self_bookable is set in the
-- INSERT rather than left to 20260723150205's UPDATE, which is exactly the
-- statement that silently matched nothing and caused this gap.
insert into public.panel_bundles (code, name, description, price_kobo, test_codes, self_bookable)
values
  ('annual_health_check', 'Annual Health Check',
     'Full metabolic panel plus age- and sex-appropriate cancer screens. Doctor-reviewed.',
     6500000, array['hba1c', 'lipid_panel', 'psa', 'cervical_smear'], true)
on conflict (code) do nothing;

-- The two chronic work-up panels are clinician-ordered, not self-bookable.
insert into public.panel_bundles (code, name, description, price_kobo, test_codes)
values
  ('hypertension_panel', 'Hypertension Panel',
     'BP work-up: U&E, eGFR, urine ACR, lipids, HbA1c.',
     2200000, array['lipid_panel', 'hba1c']),
  ('diabetes_panel', 'Diabetes Panel',
     'HbA1c, lipids, eGFR, urine ACR, foot risk baseline.',
     1850000, array['hba1c', 'lipid_panel'])
on conflict (code) do nothing;

-- Re-apply the self-bookable set now that every referenced row exists. This is
-- 20260723150205 + 20260723164727 + 20260724020715's intent, replayed against a
-- populated table. PSA stays package-only per WHO guidance on population
-- screening; everything not listed stays clinician-originated.
update public.panel_bundles set self_bookable = true
where code in ('annual_health_check', 'health_check_basic', 'health_check_comprehensive',
               'single_cervical_smear', 'single_hiv', 'single_hep_b', 'single_hep_c',
               'single_blood_group_genotype')
  and self_bookable = false;

-- ---------------------------------------------------------------------------
-- 5. facilities — the "pick somewhere near you" step
-- ---------------------------------------------------------------------------
insert into public.facilities
  (name, type, state, city, area, address, latitude, longitude, verified, is_active, lab_provider_id)
select
  v.name, v.type::public.facility_type, v.state, v.city, v.area, v.address,
  v.lat, v.lng, true, true, p.id
from (values
  ('Synlab Nigeria — Ikeja',         'lab', 'Lagos', 'Ikeja',           'Allen Avenue',  'Allen Avenue, Ikeja',           6.6018, 3.3515, 'Synlab Nigeria'),
  ('Synlab Nigeria — Wuse',          'lab', 'Abuja', 'Wuse',            'Wuse 2',        'Aminu Kano Cres, Wuse 2',       9.0765, 7.4796, 'Synlab Nigeria'),
  ('Cerba Lancet — Victoria Island', 'lab', 'Lagos', 'Victoria Island', 'Adeola Odeku',  'Adeola Odeku St, VI',           6.4281, 3.4219, 'Cerba Lancet'),
  ('Healthtracka — Lekki',           'lab', 'Lagos', 'Lekki',           'Lekki Phase 1', 'Admiralty Way, Lekki Phase 1',  6.4698, 3.5852, 'Healthtracka'),
  ('Afriglobal Medicare — Yaba',     'lab', 'Lagos', 'Yaba',            'Sabo',          'Herbert Macaulay Way, Yaba',    6.5095, 3.3711, 'Afriglobal Medicare'),
  ('Ikeja Vaccination Centre',       'vaccination_centre', 'Lagos', 'Ikeja', 'Oba Akran', 'Oba Akran Ave, Ikeja',         6.6100, 3.3450, null),
  ('Wuse Vaccination Centre',        'vaccination_centre', 'Abuja', 'Wuse',  'Wuse 2',    'Adetokunbo Ademola Cres, Wuse',9.0723, 7.4850, null),
  ('Lagos General Hospital — Ikeja', 'hospital', 'Lagos', 'Ikeja', 'Ikeja GRA', 'Oba Akinjobi Way, Ikeja',               6.5833, 3.3500, null),
  ('Garki Hospital — Abuja',         'hospital', 'Abuja', 'Garki', 'Area 3',    'Tafawa Balewa Way, Garki',              9.0333, 7.4930, null)
) as v(name, type, state, city, area, address, lat, lng, provider_name)
left join public.lab_providers p on p.name = v.provider_name
where not exists (select 1 from public.facilities f where f.name = v.name);

-- ---------------------------------------------------------------------------
-- 6. pharmacy_partners — same .example contact convention as the labs
-- ---------------------------------------------------------------------------
insert into public.pharmacy_partners
  (name, delivery, regions, contact_phone, contact_email, address, latitude, longitude,
   uses_platform_login, state, city, area)
values
  ('Medplus',        true, array['Lagos', 'Abuja'], '+2348030000001', 'orders@medplus.example',     'Allen Avenue, Ikeja, Lagos',             6.6018, 3.3515, false, 'Lagos', 'Ikeja',           'Allen Avenue'),
  ('HealthPlus',     true, array['Lagos', 'Abuja'], '+2348030000002', 'orders@healthplus.example',  'Adeola Odeku St, Victoria Island, Lagos', 6.4281, 3.4219, true,  'Lagos', 'Victoria Island', 'Adeola Odeku'),
  ('Alpha Pharmacy', true, array['Lagos'],          '+2348030000003', 'care@alphapharmacy.example', 'Adeniran Ogunsanya, Surulere, Lagos',     6.5010, 3.3552, false, 'Lagos', 'Surulere',        'Adeniran Ogunsanya'),
  ('MedsPal',        true, array['Lagos'],          '+2348030000004', 'orders@medspal.example',     'Admiralty Way, Lekki Phase 1, Lagos',     6.4698, 3.5852, false, 'Lagos', 'Lekki',           'Lekki Phase 1')
on conflict (name) do nothing;

-- Specialist catalogue survived the rebuild but with no location, so locality
-- matching had nothing to sort on.
update public.specialist_providers set state = 'Lagos', city = 'Ikeja' where state is null;

-- ---------------------------------------------------------------------------
-- 7. Assertions — the migration is the test
-- ---------------------------------------------------------------------------
-- Each check is the live-observable symptom a patient would have hit, not just
-- a row count: a self-bookable bundle whose test_codes do not resolve to real
-- lab_tests is still a dead end even if both tables are non-empty.
do $$
declare
  v_screens        int;
  v_providers      int;
  v_facilities     int;
  v_unresolved     text;
  v_ahc_price      bigint;
begin
  select count(*) into v_screens    from public.screen_types;
  select count(*) into v_providers  from public.lab_providers where is_active;
  select count(*) into v_facilities from public.facilities where is_active and type = 'lab';

  if v_screens < 20 then
    raise exception 'screen_types restore incomplete: % rows, expected at least 20', v_screens;
  end if;
  if v_providers < 4 then
    raise exception 'lab_providers restore incomplete: % active, expected at least 4', v_providers;
  end if;
  if v_facilities < 5 then
    raise exception 'lab facilities restore incomplete: % active, expected at least 5', v_facilities;
  end if;

  -- The real invariant: every self-bookable bundle must be orderable, i.e.
  -- each of its test_codes has at least one active lab_tests row behind it.
  select string_agg(distinct b.code || '/' || t.code, ', ')
    into v_unresolved
  from public.panel_bundles b
  cross join lateral unnest(b.test_codes) as t(code)
  where b.self_bookable
    and not exists (
      select 1 from public.lab_tests lt
      join public.lab_providers lp on lp.id = lt.provider_id
      where lt.code = t.code and lt.is_active and lp.is_active
    );
  if v_unresolved is not null then
    raise exception 'self-bookable bundles reference unorderable tests: %', v_unresolved;
  end if;

  select price_kobo into v_ahc_price
  from public.panel_bundles where code = 'annual_health_check' and self_bookable;
  if v_ahc_price is null then
    raise exception 'annual_health_check missing or not self_bookable after restore';
  end if;
  if v_ahc_price <> 6500000 then
    raise exception 'annual_health_check price is % kobo, expected 6500000 to match marketing', v_ahc_price;
  end if;

  raise notice 'Catalogue restored: % screen types, % labs, % lab facilities, AHC bookable at %',
    v_screens, v_providers, v_facilities, v_ahc_price;
end $$;
