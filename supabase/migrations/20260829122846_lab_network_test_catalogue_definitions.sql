-- Laboratory Network, part 2: standardised test definitions (§56.4, §56.6).
--
-- screen_types is already the canonical "what is this test" catalogue keyed
-- by a unique `code` — every lab_tests row (one per provider) references the
-- same code, so the per-test fields §56.4 asks for (specimen, preparation,
-- units, reference range) belong here once, not duplicated per provider.
-- Price and turnaround already vary correctly per provider on lab_tests
-- (that table IS the "laboratory availability" half of §56.4); this
-- migration only adds the provider-independent definition half.
--
-- patient_explainer is the single blurb the search result (§56.6) shows for
-- "what it is / why it may be requested" — distinct from clinical_basis
-- (20260821191743), which exists specifically to flag the rarer case where
-- there is NO evidence-based reason for a test (currently only 'tft'). Most
-- tests have no clinical_basis row and shouldn't — patient_explainer is the
-- one field every searchable test needs.

alter table public.screen_types
  add column if not exists specimen_type          text,
  add column if not exists preparation_instructions text,
  add column if not exists units                   text,
  add column if not exists reference_range_text    text,
  add column if not exists patient_explainer        text;

comment on column public.screen_types.specimen_type is
  'What sample this test needs, e.g. "Venous blood (SST tube)", "Clean-catch urine", "Stool (FIT kit)". Shown on the search result and the booking prep step. Null means not yet recorded — the booking flow must not silently omit the prep step rather than surface the gap.';
comment on column public.screen_types.preparation_instructions is
  'Patient-facing prep, e.g. "Fast for 8-12 hours; water only." Null means no special preparation is required, not "unknown" — recorded explicitly as an empty string is deliberately avoided so a blank prep step in the UI is a data gap, not a claim.';
comment on column public.screen_types.units is
  'The unit the result is reported in, e.g. "mmol/L", "%", "ng/mL". Purely descriptive — lab_analyte_readings carries the actual per-result unit/reference-range/flag (20260827193103); this is catalogue-level guidance shown before a result exists.';
comment on column public.screen_types.reference_range_text is
  'A short, adult-general reference range for display alongside the test in search/booking, e.g. "4.0-5.6% (non-diabetic)". Explicitly NOT authoritative for interpreting a real result — lab_analyte_readings.reference_range_text (per-result, per-lab) is that. This is orientation copy, shown before a patient has ordered anything.';
comment on column public.screen_types.patient_explainer is
  'What this test is and why it may be requested, in plain language — the answer test search (§56.6) shows first. Distinct from clinical_basis, which exists only for the rarer case where a test has no evidence-based justification at all.';

-- Backfill the tests that are actually bookable today (Synlab's real
-- contracted list plus the pre-existing single-test bundles) rather than
-- leaving every row null — a search result with nothing to show is worse
-- than no search at all. Sourced from public clinical reference ranges for
-- the standard assay each code names; not lab-specific and not a substitute
-- for a real result's own reference_range_text.
update public.screen_types set
  specimen_type = v.specimen_type,
  preparation_instructions = v.prep,
  units = v.units,
  reference_range_text = v.range_text,
  patient_explainer = v.explainer
from (values
  ('blood_group',          'Venous blood (EDTA tube)', null, null, 'A, B, AB or O, and Rhesus positive/negative', 'Identifies your blood type and Rhesus factor — needed before any transfusion or surgery, and relevant to pregnancy care. A once-in-a-lifetime fact about your body.'),
  ('sickle_cell_genotype',  'Venous blood (EDTA tube)', null, null, 'AA, AS, SS, AC, SC or other', 'Checks which haemoglobin genotype you carry. Important for family planning — two carrier parents (AS/AS or similar) can have a child with sickle cell disease.'),
  ('hep_b',                 'Venous blood (SST tube)', null, null, 'Non-reactive / Reactive', 'Checks for active Hepatitis B infection. Requested as a routine screen and before some medications or procedures.'),
  ('hep_c',                 'Venous blood (SST tube)', null, null, 'Non-reactive / Reactive', 'Checks for Hepatitis C exposure. Requested as a routine screen and for anyone with a relevant risk history.'),
  ('lft',                   'Venous blood (SST tube)', 'Fasting not required.', null, 'Varies by analyte (ALT, AST, ALP, bilirubin, albumin)', 'Checks how well your liver is working — often requested as part of an annual review or before starting a medication that is processed by the liver.'),
  ('kft',                   'Venous blood (SST tube)', 'Fasting not required.', null, 'Varies by analyte (creatinine, urea, eGFR, electrolytes)', 'Checks how well your kidneys are filtering. Requested annually if you have hypertension or diabetes, since both can affect kidney function over time.'),
  ('hba1c',                 'Venous blood (EDTA tube)', 'Fasting not required — reflects average sugar over ~3 months.', '%', '<5.7% normal, 5.7-6.4% prediabetes, ≥6.5% diabetes', 'Measures your average blood sugar over the last two to three months. The main test used to diagnose and monitor diabetes.'),
  ('lipid_panel',           'Venous blood (SST tube)', 'Fast for 8-12 hours; water only.', 'mg/dL', 'Varies by analyte (total, LDL, HDL cholesterol, triglycerides)', 'Checks your cholesterol and triglycerides — key markers for cardiovascular risk. Requested annually, more often if you are already on treatment.'),
  ('urinalysis',            'Clean-catch urine', null, null, 'No protein, glucose, blood or nitrites', 'A general urine test that can flag a urinary tract infection, kidney problems, diabetes or dehydration.'),
  ('fbc',                   'Venous blood (EDTA tube)', 'Fasting not required.', null, 'Varies by cell line (haemoglobin, white cells, platelets)', 'A general look at your blood cells — can flag anaemia, infection, or a clotting-related issue.'),
  ('hiv',                   'Venous blood (SST tube) or fingerstick', null, null, 'Non-reactive / Reactive', 'Checks your HIV status. Routine, confidential, and offered as part of standard preventive care.'),
  ('fit',                   'Stool (home FIT kit)', 'Follow the kit instructions; avoid the sample being contaminated with urine.', null, 'Negative / Positive (hidden blood detected)', 'A home sample that checks for hidden blood in stool — the standard screen for bowel cancer risk from age 45.'),
  ('tft',                   'Venous blood (SST tube)', 'Fasting not required.', 'mIU/L', 'TSH 0.4-4.0 mIU/L (adult reference)', 'Checks how your thyroid is working, via TSH and related hormones.'),
  ('psa',                   'Venous blood (SST tube)', 'Avoid ejaculation and vigorous exercise for 48 hours before the test.', 'ng/mL', '<4.0 ng/mL (age-dependent)', 'A prostate-specific marker. Requires a documented shared decision with your care team before it is ordered, because an abnormal result can lead to further testing that carries its own risks.'),
  ('cervical_smear',        'Cervical sample (liquid-based cytology), taken at a clinic', null, null, 'Reported as normal / abnormal cytology', 'Screens for cervical cell changes that could develop into cancer if untreated. Recommended every three years for women 25-65.'),
  ('vitamin_b12',           'Venous blood (SST tube)', 'Fasting not required.', 'pg/mL', '200-900 pg/mL', 'Checks your vitamin B12 level — low B12 can cause fatigue and, if prolonged, nerve problems.'),
  ('ferritin',              'Venous blood (SST tube)', 'Fasting not required.', 'ng/mL', '30-400 ng/mL (adult, sex-dependent)', 'Checks your iron stores — a normal full blood count can still miss early iron deficiency, which ferritin catches.'),
  ('syphilis',              'Venous blood (SST tube)', null, null, 'Non-reactive / Reactive', 'A routine sexual-health screen for syphilis.'),
  ('urine_acr',             'Clean-catch urine (early morning preferred)', null, 'mg/g', '<30 mg/g normal', 'Looks for small amounts of protein leaking into urine — the earliest detectable sign that hypertension or diabetes is affecting the kidneys.'),
  ('ogtt_fpg',              'Venous blood, fasting then again 2 hours after a glucose drink', 'Fast for 8-12 hours before arrival; the test itself takes about 2 hours.', 'mmol/L', 'Fasting <6.1, 2-hour <7.8 mmol/L (non-diabetic)', 'Measures how your body handles sugar over time — used to confirm a diabetes or prediabetes diagnosis when a single reading is unclear.')
) as v(code, specimen_type, prep, units, range_text, explainer)
where screen_types.code = v.code;

do $$
declare
  v_missing text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'screen_types' and column_name = 'patient_explainer'
  ) then
    raise exception 'screen_types.patient_explainer was not created';
  end if;

  select string_agg(code, ', ') into v_missing
    from public.screen_types
   where code in (select unnest(test_codes) from public.panel_bundles where is_active)
     and patient_explainer is null;
  if v_missing is not null then
    raise exception 'every code in an active bundle should have a search-ready explainer, missing: %', v_missing;
  end if;
end $$;
