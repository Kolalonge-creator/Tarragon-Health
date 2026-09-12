-- Patient lab catalogue copy cleanup: no em dashes / double-hyphens in
-- patient-facing panel_bundles.name/description/preparation_instructions
-- (standing brand-voice rule — rewrite grammatically instead). 16 active
-- rows affected, updated by id so nothing else in the table is touched.
-- Also renames the two "Cancer Screening -- X 45+" bundles to
-- "Cancer Screening (X 45+)" to match the parenthetical style already used
-- by "Thyroid Function (TSH, Free T4)" and the app's category map
-- (apps/web/src/lib/labs/lab-catalogue-categories.ts /
-- apps/mobile/src/lib/lab-catalogue-content.ts key off the new names).

update panel_bundles set
  description = 'Know your blood group, rhesus factor, and sickle cell genotype (AA/AS/SS), useful for marriage counselling, pregnancy planning, and emergencies.'
where id = 'e4a86ae2-b458-4b55-8f3b-7b7859cde3e8';

update panel_bundles set
  description = 'HIV, Hepatitis B and Hepatitis C screening. Lab-only: a normal result needs no doctor call, and an abnormal one routes through the standard abnormal-result review.'
where id = '4276046e-ade0-459c-9eb1-9f775c44479e';

update panel_bundles set
  name = 'Cancer Screening (Men 45+)'
where id = '012913ea-a5ee-43e0-b50d-ae4aa7763c37';

update panel_bundles set
  name = 'Cancer Screening (Women 45+)'
where id = 'db6ae564-6528-4550-9a09-c1ac5a7945e7';

update panel_bundles set
  description = 'Single test: cervical cancer screening.'
where id = '90eff482-f4e2-4f34-b585-ed4bb2a74e12';

update panel_bundles set
  preparation_instructions = 'This panel includes a lipid (cholesterol) test. Fast for 9-12 hours beforehand (water is fine) for an accurate reading. The other tests in this panel do not require fasting.'
where id = '598ca582-41a5-4548-81ce-8a6eb86bd12d'; -- Core Screen

update panel_bundles set
  description = 'HbA1c, an oral glucose tolerance test and a lipid panel: the core picture for anyone who wants to know their diabetes risk, not just someone already diagnosed.'
where id = 'daddfe15-1035-4502-8d02-e6b687073744';

update panel_bundles set
  preparation_instructions = 'This panel includes a lipid (cholesterol) test. Fast for 9-12 hours beforehand (water is fine) for an accurate reading. The other tests in this panel do not require fasting.'
where id = 'dc5f0599-da6a-447f-9140-1e1a6ec8039c'; -- Diabetes Panel

update panel_bundles set
  preparation_instructions = 'Fast for 8-12 hours before this test (water is fine). It measures your fasting blood sugar, so eating or drinking anything but water beforehand will affect the result.'
where id = 'dd7c9b03-1622-4a3d-8c33-8ab3967f1c5c'; -- Glucose Tolerance Test

update panel_bundles set
  description = 'Single test: diabetes control marker.'
where id = '5d792bb6-d9b6-457e-a963-afe24a099403';

update panel_bundles set
  description = 'Lipid panel, HbA1c and kidney function: the core cardiometabolic risk picture.'
where id = '2f8e9610-5f5c-44ee-8bdb-6232b8e85825';

update panel_bundles set
  preparation_instructions = 'This panel includes a lipid (cholesterol) test. Fast for 9-12 hours beforehand (water is fine) for an accurate reading. The other tests in this panel do not require fasting.'
where id = 'c09ad0d1-c7cd-4cfc-a7d9-e201a5bc8995'; -- Hypertension Panel

update panel_bundles set
  description = 'Blood group, genotype and hepatitis B and C. Your blood group and genotype never change, so those are done once and kept for life. Hepatitis B and C are a picture of one moment. If something happens that could have exposed you, tell us and we will check again at the right time. You will never be charged for a repeat you do not need.'
where id = '9ff6396f-04d3-4e35-8205-1ee296ff3c28';

update panel_bundles set
  description = 'Single test: cholesterol/triglycerides.',
  preparation_instructions = 'This panel includes a lipid (cholesterol) test. Fast for 9-12 hours beforehand (water is fine) for an accurate reading. The other tests in this panel do not require fasting.'
where id = 'b36eda42-1b1e-46db-9cc1-849df58939ae'; -- Lipid Panel

update panel_bundles set
  description = 'Single test: prostate screening.'
where id = 'dd8dd1cb-c576-49c7-b1f9-710331ce4b3c';

update panel_bundles set
  description = 'TSH and Free T4: the two tests this screen actually promises. Checks how your thyroid is working.'
where id = '9d9636c8-adf9-4123-b67e-9cbbab25e67e';

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
