-- Core / Advanced / Comprehensive Screen ladder.
--
-- Retires 'annual_health_check' (₦65,000) and 'health_check_comprehensive'
-- (₦75,000) — both are strict subsets of the new Core Screen panel — and
-- replaces them with a 3-tier cumulative ladder. 'health_check_basic'
-- (₦15,000, HbA1c+lipids) is untouched: a genuinely different quick-check
-- product below this ladder. Standalone à la carte single-item bundles
-- (single_hiv, single_hep_b, single_hep_c, single_cervical_smear,
-- single_blood_group_genotype) are untouched.
--
-- Naming deliberately avoids "Essential"/"Preventive" — those collide with
-- the Essential Care and Tarragon Prevent subscription tier names.
--
-- Imaging items (abdominal ultrasound, breast imaging, prostate ultrasound,
-- echo) get screen_types rows for reference/completeness but NO lab_tests
-- rows — zero imaging-capable partners exist in the catalogue today. This is
-- the same dormant-until-real pattern as home_visit_providers /
-- logistics_partners: the bundle is sellable, each imaging line item shows
-- "not yet available" until a real imaging partner is contracted and gets a
-- lab_tests row.

-- ---------------------------------------------------------------------------
-- 1. New screen_types — lab-only items (self-bookable, fulfillable today)
-- ---------------------------------------------------------------------------
insert into public.screen_types (code, name, sex_applicability, age_from, age_to, frequency_months, sensitive)
values
  ('fbc',         'Full Blood Count',                       'all', 18, null, 12, false),
  ('lft',         'Liver Function Test',                    'all', 18, null, 12, false),
  ('kft',         'Kidney Function (U&E, Creatinine, eGFR)','all', 18, null, 12, false),
  ('tft',         'Thyroid Function (TSH, Free T4)',        'all', 18, null, 12, false),
  ('urinalysis',  'Urinalysis',                              'all', 18, null, 12, false),
  ('urine_acr',   'Urine Albumin:Creatinine Ratio',          'all', 18, null, 12, false),
  ('ecg_resting', 'Resting 12-Lead ECG',                     'all', 18, null, 12, false),
  ('syphilis',    'Syphilis (VDRL with TPHA confirmation)',  'all', 18, null, 12, true),
  -- Conditional, not calendar-scheduled: OGTT only fires when a same-cycle
  -- HbA1c lands 6.0-6.4%. frequency_months stays null on purpose.
  ('ogtt_fpg',    'Oral Glucose Tolerance Test / Fasting Plasma Glucose', 'all', 18, null, null, false)
on conflict (code) do nothing;

-- Imaging — reference rows only, deliberately with no fulfilling lab_tests.
insert into public.screen_types (code, name, sex_applicability, age_from, age_to, frequency_months, sensitive)
values
  ('abdominal_ultrasound', 'Abdominal Ultrasound',  'all',    18, null, 24,   true),
  ('breast_imaging',       'Breast Imaging (Ultrasound <40 / Mammography 40+)', 'female', 18, null, 24, true),
  ('prostate_ultrasound',  'Prostate Ultrasound',    'male',  50, null, 24,   true),
  -- Echo is conditional on ECG/BP/symptom indication, not calendar-scheduled.
  ('echo',                 'Echocardiogram',         'all',   18, null, null, true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. lab_tests — one row per active provider, lab-only codes only
-- ---------------------------------------------------------------------------
insert into public.lab_tests (provider_id, code, name, price_kobo, turnaround_hours, is_active)
select p.id, t.code, t.name, t.price_kobo, 48, true
from (values
  ('413fa046-94b6-47fe-9f99-236737eb61e5'::uuid),
  ('bf4b3d30-dcd5-4bfd-8a96-772beee65eab'::uuid),
  ('c625d509-4d1c-4156-ba44-d1e535a900a3'::uuid),
  ('d8d35107-4664-4191-8cf5-463ba746b332'::uuid)
) as p(id)
cross join (values
  ('fbc',         'Full Blood Count',      400000),
  ('lft',         'Liver Function Test',   600000),
  ('kft',         'Kidney Function Test',  600000),
  ('tft',         'Thyroid Function Test', 1000000),
  ('urinalysis',  'Urinalysis',            250000),
  ('urine_acr',   'Urine ACR',             500000),
  ('ecg_resting', 'Resting ECG',           600000),
  ('syphilis',    'Syphilis Screening (VDRL/TPHA)', 600000),
  ('ogtt_fpg',    'OGTT / Fasting Plasma Glucose', 400000)
) as t(code, name, price_kobo)
join public.lab_providers p2 on p2.id = p.id and p2.is_active
where not exists (
  select 1 from public.lab_tests lt where lt.provider_id = p.id and lt.code = t.code
);

-- ---------------------------------------------------------------------------
-- 3. Retire the two subsumed Health Check bundles
-- ---------------------------------------------------------------------------
update public.panel_bundles
  set is_active = false
  where code in ('annual_health_check', 'health_check_comprehensive');

-- ---------------------------------------------------------------------------
-- 4. New ladder — cumulative, self-bookable
-- ---------------------------------------------------------------------------
insert into public.panel_bundles (code, name, description, price_kobo, test_codes, self_bookable)
values
  ('screen_core',
   'Core Screen',
   'Cardiometabolic, organ-baseline and blood-borne-virus screen: HbA1c, full lipid panel, FBC, liver/kidney/thyroid function, urinalysis, HIV, Hepatitis B, Hepatitis C, genotype and blood group (once), plus PHQ-9/GAD-7 and a clinician-reviewed report.',
   6500000,
   array['hba1c','lipid_panel','fbc','lft','kft','tft','urinalysis','hiv','hep_b','hep_c','blood_group','sickle_cell_genotype'],
   true),
  ('screen_advanced',
   'Advanced Screen',
   'Everything in Core Screen, plus urine ACR, OGTT (fires only on borderline HbA1c), resting ECG, and age-triggered FIT and PSA screening, with a personalised screening calendar written to your health passport.',
   9500000,
   array['hba1c','lipid_panel','fbc','lft','kft','tft','urinalysis','hiv','hep_b','hep_c','blood_group','sickle_cell_genotype','urine_acr','ogtt_fpg','ecg_resting','fit','psa'],
   true),
  ('screen_comprehensive',
   'Comprehensive Screen',
   'Everything in Advanced Screen, plus abdominal ultrasound, breast imaging, prostate ultrasound, syphilis screening, an STI risk assessment, a vaccination catch-up plan, and a 15-minute doctor video consult to walk through your results.',
   14900000,
   array['hba1c','lipid_panel','fbc','lft','kft','tft','urinalysis','hiv','hep_b','hep_c','blood_group','sickle_cell_genotype','urine_acr','ogtt_fpg','ecg_resting','fit','psa','syphilis','abdominal_ultrasound','breast_imaging','prostate_ultrasound']
   ,true)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      price_kobo = excluded.price_kobo,
      test_codes = excluded.test_codes,
      self_bookable = excluded.self_bookable;

-- ---------------------------------------------------------------------------
-- 5. Assertions
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.panel_bundles
    where code in ('annual_health_check','health_check_comprehensive') and is_active = true;
  if v_count > 0 then
    raise exception 'annual_health_check/health_check_comprehensive should be retired (is_active=false)';
  end if;

  select count(*) into v_count from public.panel_bundles
    where code in ('screen_core','screen_advanced','screen_comprehensive') and self_bookable = true and is_active = true;
  if v_count <> 3 then
    raise exception 'expected 3 active self-bookable Screen tiers, found %', v_count;
  end if;

  select count(*) into v_count from public.lab_tests
    where code in ('fbc','lft','kft','tft','urinalysis','urine_acr','ecg_resting','syphilis','ogtt_fpg');
  if v_count <> 36 then
    raise exception 'expected 36 new lab_tests rows (9 codes x 4 providers), found %', v_count;
  end if;

  -- Imaging must stay dormant: zero fulfilling lab_tests rows.
  select count(*) into v_count from public.lab_tests
    where code in ('abdominal_ultrasound','breast_imaging','prostate_ultrasound','echo');
  if v_count <> 0 then
    raise exception 'imaging codes must have zero lab_tests rows until a real imaging partner exists, found %', v_count;
  end if;
end $$;
