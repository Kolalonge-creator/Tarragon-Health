-- Patient lab catalogue copy cleanup: no em dashes / double-hyphens in
-- patient-facing panel_bundles.name/description/preparation_instructions
-- (standing brand-voice rule — rewrite grammatically instead). 16 active
-- rows affected, updated by code (panel_bundles.code, unique and stable
-- across every environment) so nothing else in the table is touched.
-- Also renames the two "Cancer Screening -- X 45+" bundles to
-- "Cancer Screening (X 45+)" to match the parenthetical style already used
-- by "Thyroid Function (TSH, Free T4)" and the app's category map
-- (apps/web/src/lib/labs/lab-catalogue-categories.ts /
-- apps/mobile/src/lib/lab-catalogue-content.ts key off the new names).
--
-- CORRECTED post-merge: the original version of this migration (already
-- applied live in production on 2026-09-11) targeted these 16 rows by `id`.
-- That's fine against the live database, where those rows' ids already
-- existed — but `panel_bundles.id` is `gen_random_uuid()`-assigned at
-- INSERT time, not a literal the row's own migration pins, so a fresh
-- replay (CI, a new local `supabase db reset`) generates entirely different
-- ids for the same bundles and every `where id = '<uuid>'` below silently
-- matched zero rows, leaving the fresh dataset's dash-containing copy
-- unfixed and tripping this migration's own closing assertion. Rewritten
-- to target `code` (`panel_bundles_code_key`, UNIQUE) instead, which is
-- stable and correct in both a fresh replay and (idempotently, since the
-- content is identical) against the already-fixed production rows.

update panel_bundles set
  description = 'Know your blood group, rhesus factor, and sickle cell genotype (AA/AS/SS), useful for marriage counselling, pregnancy planning, and emergencies.'
where code = 'single_blood_group_genotype';

update panel_bundles set
  description = 'HIV, Hepatitis B and Hepatitis C screening. Lab-only: a normal result needs no doctor call, and an abnormal one routes through the standard abnormal-result review.'
where code = 'blood_borne_virus_screen';

update panel_bundles set
  name = 'Cancer Screening (Men 45+)'
where code = 'cancer_screen_men_45plus';

update panel_bundles set
  name = 'Cancer Screening (Women 45+)'
where code = 'cancer_screen_women_45plus';

update panel_bundles set
  description = 'Single test: cervical cancer screening.'
where code = 'single_cervical_smear';

update panel_bundles set
  preparation_instructions = 'This panel includes a lipid (cholesterol) test. Fast for 9-12 hours beforehand (water is fine) for an accurate reading. The other tests in this panel do not require fasting.'
where code = 'screen_core'; -- Core Screen

update panel_bundles set
  description = 'HbA1c, an oral glucose tolerance test and a lipid panel: the core picture for anyone who wants to know their diabetes risk, not just someone already diagnosed.'
where code = 'diabetes_check';

update panel_bundles set
  preparation_instructions = 'This panel includes a lipid (cholesterol) test. Fast for 9-12 hours beforehand (water is fine) for an accurate reading. The other tests in this panel do not require fasting.'
where code = 'diabetes_panel'; -- Diabetes Panel

update panel_bundles set
  preparation_instructions = 'Fast for 8-12 hours before this test (water is fine). It measures your fasting blood sugar, so eating or drinking anything but water beforehand will affect the result.'
where code = 'single_ogtt_fpg'; -- Glucose Tolerance Test

update panel_bundles set
  description = 'Single test: diabetes control marker.'
where code = 'single_hba1c';

update panel_bundles set
  description = 'Lipid panel, HbA1c and kidney function: the core cardiometabolic risk picture.'
where code = 'heart_health_check';

update panel_bundles set
  preparation_instructions = 'This panel includes a lipid (cholesterol) test. Fast for 9-12 hours beforehand (water is fine) for an accurate reading. The other tests in this panel do not require fasting.'
where code = 'hypertension_panel'; -- Hypertension Panel

update panel_bundles set
  description = 'Blood group, genotype and hepatitis B and C. Your blood group and genotype never change, so those are done once and kept for life. Hepatitis B and C are a picture of one moment. If something happens that could have exposed you, tell us and we will check again at the right time. You will never be charged for a repeat you do not need.'
where code = 'know_your_basics';

update panel_bundles set
  description = 'Single test: cholesterol/triglycerides.',
  preparation_instructions = 'This panel includes a lipid (cholesterol) test. Fast for 9-12 hours beforehand (water is fine) for an accurate reading. The other tests in this panel do not require fasting.'
where code = 'single_lipid_panel'; -- Lipid Panel

update panel_bundles set
  description = 'Single test: prostate screening.'
where code = 'single_psa';

update panel_bundles set
  description = 'TSH and Free T4: the two tests this screen actually promises. Checks how your thyroid is working.'
where code = 'single_tft';

do $$
declare
  remaining int;
begin
  select count(*) into remaining
  from panel_bundles
  where is_active = true
    and (name like '%--%' or name like '%—%'
      or description like '%--%' or description like '%—%'
      or preparation_instructions like '%--%' or preparation_instructions like '%—%');
  if remaining <> 0 then
    raise exception 'lab_catalogue_dash_cleanup: % active panel_bundles rows still contain a dash character', remaining;
  end if;
end $$;
