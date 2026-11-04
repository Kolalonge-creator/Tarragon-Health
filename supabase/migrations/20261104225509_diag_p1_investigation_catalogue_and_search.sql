-- Verified lab and imaging directory, Phase 1: one investigation catalogue, its synonyms, and deterministic search.
-- Design: docs/plans/diagnostic-directory-design-2026-11-04.md §5-§7 (PR #1708). Decisions DIR-1 to DIR-3.
--
-- WHAT THIS ADDS (additive only; nothing existing changes behaviour)
--   * reference_concepts gains five nullable investigation columns. A concept is an "investigation" when
--     investigation_category is set. Labs use the existing domain 'lab_test'; imaging, cardiac, endoscopy and
--     physiology use the existing domain 'procedure'. No enum value is added.
--   * modality uses the existing public.imaging_modality type (one list of modalities, not a third).
--   * An ambiguous lay term ("breast scan", "pelvic scan", "heart scan", "MRI") is a synonym of an ambiguous PARENT
--     concept; its children (parent_id) are what the user chooses between. Search never silently picks one.
--   * reference_concept_synonyms gains term_kind (clinical / abbreviation / lay / misspelling).
--   * screen_types.concept_id and imaging_studies.concept_id link the orderable catalogues to the same identity.
--     Backfilled for screen_types only where the match is exact; ogtt_fpg (two tests in one row), panels and
--     non-investigations stay null on purpose. imaging_studies has 0 rows live.
--   * public.search_investigations(p_text, p_min_score, p_limit). The threshold has no default: the caller passes it
--     from versioned config (packages/shared proposed-config "directory.investigation_search"), never a number here.
--
-- WHAT THIS DOES NOT DO
--   No directory listing, no provider, branch, credential or price. patient_description is draft copy for the
--   patient search page (Phase 6) and is not shown anywhere until that page's copy review.
--   LOINC codes are recorded only where the panel/test code is certain; imaging codes are left empty rather than guessed.
--
-- Counts at write time (live 2026-11-04): reference_concepts 109 (none with investigation columns, which are new),
-- reference_concept_synonyms 24, screen_types 38, imaging_studies 0.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.reference_concepts
  add column investigation_category text,
  add column modality public.imaging_modality,
  add column body_region text,
  add column is_ambiguous boolean not null default false,
  add column patient_description text;

alter table public.reference_concepts
  add constraint reference_concepts_investigation_category_check check (
    investigation_category is null or investigation_category in (
      'haematology', 'clinical_chemistry', 'endocrinology', 'lipids', 'renal', 'liver', 'microbiology', 'serology',
      'immunology', 'molecular', 'histopathology', 'cytology', 'tumour_markers', 'urinalysis', 'reproductive',
      'infectious_disease', 'ultrasound', 'breast_imaging', 'xray', 'ct', 'mri', 'cardiac', 'endoscopy', 'physiology',
      'other_imaging')),
  add constraint reference_concepts_investigation_fields_need_category check (
    investigation_category is not null
    or (modality is null and body_region is null and not is_ambiguous and patient_description is null)),
  add constraint reference_concepts_investigation_domain check (
    investigation_category is null or domain in ('lab_test', 'procedure'));

create index reference_concepts_investigation_idx on public.reference_concepts (investigation_category)
  where investigation_category is not null;

comment on column public.reference_concepts.investigation_category is
  'Set = this concept is an orderable investigation in the diagnostic directory catalogue (docs/plans/diagnostic-directory-design-2026-11-04.md).';
comment on column public.reference_concepts.is_ambiguous is
  'An ambiguous parent (e.g. "breast scan"): search returns its children for the user to choose, never the parent itself.';

alter table public.reference_concept_synonyms
  add column term_kind text not null default 'clinical'
    check (term_kind in ('clinical', 'abbreviation', 'lay', 'misspelling'));

-- ---------------------------------------------------------------------------
-- 2. Seed (TARRAGON code system, codes prefixed "inv.")
--    synonyms: 'c:' clinical, 'a:' abbreviation, 'l:' lay, 'm:' misspelling
-- ---------------------------------------------------------------------------
create temporary table _inv (
  code text, domain text, display text, category text, modality text, region text, parent text,
  ambiguous boolean, clarify_order int, loinc text, descr text, syns text[]
) on commit drop;

insert into _inv values
-- Ambiguous parents first (children reference them)
('inv.breast_imaging','procedure','Breast imaging (type to choose)','breast_imaging',null,'breast',null,true,null,null,
 'There is more than one kind of breast scan. Choose the one your doctor asked for, or ask them.',
 array['l:breast scan','l:breast imaging','l:breast check scan']),
('inv.pelvic_scan','procedure','Pelvic scan (type to choose)','ultrasound','ultrasound','pelvis',null,true,null,null,
 'A pelvic scan can be done in different ways. Choose the one your doctor asked for, or ask them.',
 array['l:pelvic scan','l:pelvis scan','l:womb scan']),
('inv.abdominal_scan','procedure','Abdominal scan (type to choose)','ultrasound',null,'abdomen',null,true,null,null,
 'An abdominal scan is usually an ultrasound of the abdomen, or of the abdomen and pelvis together. Choose the one your doctor asked for, or ask them.',
 array['l:abdomen scan','l:abdominal scan','l:tummy scan','l:stomach scan']),
('inv.heart_scan','procedure','Heart test (type to choose)','cardiac',null,'heart',null,true,null,null,
 'There are several heart tests. Choose the one your doctor asked for, or ask them.',
 array['l:heart scan','l:heart test','l:heart check']),
('inv.doppler','procedure','Doppler ultrasound (type to choose)','ultrasound','ultrasound',null,null,true,null,null,
 'A Doppler scan checks blood flow. Choose which blood vessels your doctor asked for.',
 array['c:doppler','c:doppler ultrasound','l:doppler scan']),
('inv.xray','procedure','X-ray (body part to choose)','xray','xray',null,null,true,null,null,
 'Choose the part of the body your doctor asked to be X-rayed.',
 array['c:x-ray','a:xray','c:radiograph','l:x ray']),
('inv.ct','procedure','CT scan (body part to choose)','ct','ct',null,null,true,null,null,
 'Choose the part of the body your doctor asked to be scanned.',
 array['c:ct scan','a:ct','c:cat scan','c:computed tomography']),
('inv.mri','procedure','MRI scan (body part to choose)','mri','mri',null,null,true,null,null,
 'Choose the part of the body your doctor asked to be scanned.',
 array['a:mri','c:mri scan','c:magnetic resonance imaging']),
('inv.mri_spine','procedure','MRI spine (level to choose)','mri','mri','spine','inv.mri',true,null,null,
 'Choose which part of the spine your doctor asked to be scanned.',
 array['c:mri spine','l:spine mri']),
('inv.endoscopy','procedure','Endoscopy (type to choose)','endoscopy',null,null,null,true,null,null,
 'Choose whether your doctor asked for a camera test of the stomach or of the bowel.',
 array['c:endoscopy','l:camera test']),

-- Laboratory
('inv.fbc','lab_test','Full blood count','haematology',null,null,null,false,null,'58410-2',
 'Counts your red cells, white cells and platelets.',
 array['a:fbc','a:cbc','c:complete blood count','l:blood count','m:full blod count']),
('inv.hba1c','lab_test','Glycated haemoglobin (HbA1c)','clinical_chemistry',null,null,null,false,null,'4548-4',
 'Shows your average blood sugar over the last 2 to 3 months.',
 array['a:hba1c','a:a1c','c:haemoglobin a1c','c:hemoglobin a1c','c:glycated hemoglobin','c:glycosylated haemoglobin','l:three month sugar test','m:hba1','m:hb a1c','m:hbaic']),
('inv.fasting_glucose','lab_test','Fasting blood glucose','clinical_chemistry',null,null,null,false,null,'1558-6',
 'Blood sugar measured after not eating overnight.',
 array['a:fbs','a:fbg','a:fpg','c:fasting plasma glucose','l:fasting blood sugar','l:fasting sugar']),
('inv.random_glucose','lab_test','Random blood glucose','clinical_chemistry',null,null,null,false,null,null,
 'Blood sugar measured at any time of day.',
 array['a:rbs','a:rbg','l:random blood sugar']),
('inv.ogtt','lab_test','Oral glucose tolerance test','clinical_chemistry',null,null,null,false,null,null,
 'Blood sugar measured before and after a sugary drink.',
 array['a:ogtt','c:glucose tolerance test']),
('inv.lipid_profile','lab_test','Lipid profile','lipids',null,null,null,false,null,null,
 'Measures cholesterol and other fats in your blood.',
 array['c:lipid panel','c:fasting lipids','l:cholesterol test','c:lipogram','m:lipid profle']),
('inv.kft','lab_test','Kidney function tests (urea, electrolytes, creatinine, eGFR)','renal',null,null,null,false,null,'24362-6',
 'Shows how well your kidneys are working.',
 array['a:rft','a:kft','a:u&e','a:e/u/cr','a:eucr','c:electrolytes urea and creatinine','c:renal function test','l:kidney function','l:kidney test','c:creatinine']),
('inv.lft','lab_test','Liver function tests','liver',null,null,null,false,null,'24325-3',
 'Shows how well your liver is working.',
 array['a:lft','c:liver function','l:liver test']),
('inv.tft','lab_test','Thyroid function tests (TSH, free T4)','endocrinology',null,null,null,false,null,null,
 'Checks how your thyroid gland is working.',
 array['a:tft','a:tsh','c:free t4','l:thyroid test']),
('inv.psa','lab_test','Prostate-specific antigen (PSA)','tumour_markers',null,null,null,false,null,'2857-1',
 'A blood test linked to the prostate. Talk to your doctor before having it.',
 array['a:psa','c:prostate specific antigen','l:prostate blood test']),
('inv.urinalysis','lab_test','Urinalysis','urinalysis',null,null,null,false,null,'24356-8',
 'A check of your urine for sugar, protein, blood and infection.',
 array['l:urine test','c:urine analysis','c:urine dipstick','m:urinalisis']),
('inv.urine_acr','lab_test','Urine albumin to creatinine ratio','renal',null,null,null,false,null,null,
 'Looks for small amounts of protein in your urine, an early sign of kidney strain.',
 array['a:acr','a:uacr','c:urine microalbumin','c:microalbumin']),
('inv.urine_mcs','lab_test','Urine microscopy, culture and sensitivity','microbiology',null,null,null,false,null,null,
 'Looks for a urine infection and which medicines treat it.',
 array['a:urine mcs','a:urine m/c/s','c:urine culture']),
('inv.hep_b','lab_test','Hepatitis B surface antigen','serology',null,null,null,false,null,null,
 'Checks for hepatitis B infection.',
 array['a:hbsag','l:hepatitis b test','l:hep b test']),
('inv.hep_c','lab_test','Hepatitis C antibody','serology',null,null,null,false,null,null,
 'Checks for hepatitis C infection.',
 array['a:hcv','a:anti-hcv','l:hep c test','l:hepatitis c test']),
('inv.hiv','lab_test','HIV test','infectious_disease',null,null,null,false,null,null,
 'Checks for HIV infection.',
 array['c:hiv screening','a:rvs','l:retroviral screening','c:hiv 1 and 2']),
('inv.malaria','lab_test','Malaria parasite test','infectious_disease',null,null,null,false,null,null,
 'Checks your blood for malaria.',
 array['a:mp','l:malaria test','c:blood film for malaria','l:mp test']),
('inv.blood_group','lab_test','Blood group and rhesus','haematology',null,null,null,false,null,null,
 'Finds your blood group.',
 array['l:blood group','c:blood grouping']),
('inv.genotype','lab_test','Haemoglobin genotype','haematology',null,null,null,false,null,null,
 'Shows whether you carry sickle cell (AA, AS, SS and others).',
 array['l:genotype','c:hb genotype','c:haemoglobin electrophoresis','l:sickle cell test']),
('inv.ferritin','lab_test','Ferritin','haematology',null,null,null,false,null,null,
 'Measures your iron stores.',
 array['l:iron stores test']),
('inv.vitamin_b12','lab_test','Vitamin B12','clinical_chemistry',null,null,null,false,null,null,
 'Measures vitamin B12 in your blood.',
 array['a:b12','c:cobalamin']),
('inv.cervical_screening','lab_test','Cervical screening','cytology',null,'cervix',null,false,null,null,
 'A test of cells from the neck of the womb, to find changes early.',
 array['c:pap smear','c:pap test','l:smear test','c:cervical smear']),
('inv.fit','lab_test','Faecal immunochemical test (FIT)','clinical_chemistry',null,null,null,false,null,null,
 'A stool test for hidden blood.',
 array['a:fit','l:stool test for blood']),
('inv.histopathology','lab_test','Histopathology (tissue biopsy)','histopathology',null,null,null,false,null,null,
 'A specialist looks at a piece of tissue under a microscope.',
 array['c:biopsy','c:histology']),

-- Ultrasound
('inv.us_abdomen','procedure','Abdominal ultrasound','ultrasound','ultrasound','abdomen','inv.abdominal_scan',false,1,null,
 'An ultrasound of the liver, gallbladder, pancreas, spleen and kidneys.',
 array['a:abdo uss','a:abdominal uss','a:uss abdomen','c:abdomen ultrasound']),
('inv.us_whole_abdomen','procedure','Whole abdominal (abdominopelvic) ultrasound','ultrasound','ultrasound','abdomen and pelvis','inv.abdominal_scan',false,2,null,
 'An ultrasound of the abdomen and the pelvis together.',
 array['l:whole abdomen scan','c:abdominopelvic ultrasound','a:abdominopelvic uss']),
('inv.us_pelvic','procedure','Pelvic ultrasound (through the tummy)','ultrasound','ultrasound','pelvis','inv.pelvic_scan',false,1,null,
 'An ultrasound of the pelvis done on the skin of the lower tummy.',
 array['a:pelvic uss','c:transabdominal pelvic ultrasound']),
('inv.us_transvaginal','procedure','Transvaginal ultrasound','ultrasound','ultrasound','pelvis','inv.pelvic_scan',false,2,null,
 'An internal ultrasound of the womb and ovaries.',
 array['a:tvs','a:tvus','c:transvaginal scan','l:internal scan']),
('inv.us_obstetric','procedure','Obstetric (pregnancy) ultrasound','ultrasound','ultrasound','pelvis','inv.pelvic_scan',false,3,null,
 'An ultrasound to check a pregnancy.',
 array['l:pregnancy scan','a:obstetric uss','l:baby scan','c:antenatal scan']),
('inv.us_breast','procedure','Breast ultrasound','breast_imaging','ultrasound','breast','inv.breast_imaging',false,2,null,
 'An ultrasound of the breast. Not the same as a mammogram.',
 array['a:breast uss','c:breast sonography']),
('inv.us_thyroid','procedure','Thyroid ultrasound','ultrasound','ultrasound','neck',null,false,null,null,
 'An ultrasound of the thyroid gland in the neck.',
 array['a:thyroid uss','l:neck ultrasound']),
('inv.us_scrotal','procedure','Scrotal ultrasound','ultrasound','ultrasound','scrotum',null,false,null,null,
 'An ultrasound of the testicles.',
 array['a:scrotal uss','c:testicular ultrasound']),
('inv.us_renal','procedure','Renal (kidney) ultrasound','ultrasound','ultrasound','kidneys',null,false,null,null,
 'An ultrasound of the kidneys and bladder.',
 array['l:kidney scan','a:renal uss','c:kidney ultrasound']),
('inv.us_prostate','procedure','Prostate ultrasound','ultrasound','ultrasound','prostate',null,false,null,null,
 'An ultrasound of the prostate.',
 array['l:prostate scan','a:prostate uss']),
('inv.us_doppler_carotid','procedure','Carotid Doppler ultrasound','ultrasound','ultrasound','neck','inv.doppler',false,1,null,
 'Checks blood flow in the neck arteries.',
 array['c:carotid doppler']),
('inv.us_doppler_venous','procedure','Venous Doppler ultrasound (legs)','ultrasound','ultrasound','lower limb','inv.doppler',false,2,null,
 'Checks the leg veins, for example for a clot.',
 array['c:venous doppler','l:dvt scan','l:leg doppler']),
('inv.us_doppler_arterial','procedure','Arterial Doppler ultrasound (legs)','ultrasound','ultrasound','lower limb','inv.doppler',false,3,null,
 'Checks blood flow in the leg arteries.',
 array['c:arterial doppler']),
('inv.us_msk','procedure','Musculoskeletal ultrasound','ultrasound','ultrasound',null,null,false,null,null,
 'An ultrasound of a joint, muscle or tendon.',
 array['a:msk ultrasound','l:joint ultrasound']),

-- Breast imaging
('inv.mammography','procedure','Mammography','breast_imaging','mammography','breast','inv.breast_imaging',false,1,null,
 'An X-ray of the breasts. Not the same as a breast ultrasound.',
 array['c:mammogram','a:mammo','m:mamogram','m:mamography','m:mammogramme']),
('inv.mammography_screening','procedure','Screening mammography','breast_imaging','mammography','breast','inv.mammography',false,null,null,
 'A mammogram for a woman with no breast symptoms.',
 array['c:screening mammogram']),
('inv.mammography_diagnostic','procedure','Diagnostic mammography','breast_imaging','mammography','breast','inv.mammography',false,null,null,
 'A mammogram to look into a breast symptom or finding.',
 array['c:diagnostic mammogram']),
('inv.mri_breast','procedure','Breast MRI','breast_imaging','mri','breast','inv.breast_imaging',false,3,null,
 'An MRI scan of the breasts.',
 array['c:mri breast']),

-- X-ray
('inv.xray_chest','procedure','Chest X-ray','xray','xray','chest','inv.xray',false,1,null,
 'An X-ray of the chest and lungs.',
 array['a:cxr','c:chest radiograph','c:chest xray']),
('inv.xray_abdomen','procedure','Abdominal X-ray','xray','xray','abdomen','inv.xray',false,2,null,
 'An X-ray of the abdomen.',
 array['a:axr','c:abdominal xray']),
('inv.xray_pelvis','procedure','Pelvic X-ray','xray','xray','pelvis','inv.xray',false,3,null,
 'An X-ray of the pelvis and hips.',
 array['c:pelvic xray']),
('inv.xray_skull','procedure','Skull X-ray','xray','xray','skull','inv.xray',false,4,null,
 'An X-ray of the skull.',
 array['c:skull xray']),
('inv.xray_spine','procedure','Spine X-ray','xray','xray','spine','inv.xray',false,5,null,
 'An X-ray of part of the spine.',
 array['c:spine xray','c:back xray']),
('inv.xray_limb','procedure','Limb X-ray','xray','xray','limb','inv.xray',false,6,null,
 'An X-ray of an arm or leg.',
 array['c:limb xray']),
('inv.xray_joint','procedure','Joint X-ray','xray','xray','joint','inv.xray',false,7,null,
 'An X-ray of a joint such as the knee.',
 array['c:joint xray','c:knee xray']),

-- CT
('inv.ct_brain','procedure','CT brain','ct','ct','head','inv.ct',false,1,null,
 'A CT scan of the head.',
 array['c:ct head','l:brain scan ct']),
('inv.ct_chest','procedure','CT chest','ct','ct','chest','inv.ct',false,2,null,
 'A CT scan of the chest.',
 array['c:ct thorax']),
('inv.ct_abdomen','procedure','CT abdomen','ct','ct','abdomen','inv.ct',false,3,null,
 'A CT scan of the abdomen.',
 array['c:ct abdomen scan']),
('inv.ct_pelvis','procedure','CT pelvis','ct','ct','pelvis','inv.ct',false,4,null,
 'A CT scan of the pelvis.',
 array['c:ct pelvic']),
('inv.ct_abdomen_pelvis','procedure','CT abdomen and pelvis','ct','ct','abdomen and pelvis','inv.ct',false,5,null,
 'A CT scan of the abdomen and pelvis together.',
 array['a:ct ap','c:ct abdominopelvic']),
('inv.ct_angiography','procedure','CT angiography','ct','ct',null,'inv.ct',false,6,null,
 'A CT scan of blood vessels using a contrast dye.',
 array['a:cta','c:ct angiogram']),
('inv.ct_spine','procedure','CT spine','ct','ct','spine','inv.ct',false,7,null,
 'A CT scan of part of the spine.',
 array['c:ct spine scan']),
('inv.ct_sinuses','procedure','CT sinuses','ct','ct','sinuses','inv.ct',false,8,null,
 'A CT scan of the sinuses.',
 array['a:ct pns','c:ct paranasal sinuses']),

-- MRI
('inv.mri_brain','procedure','MRI brain','mri','mri','head','inv.mri',false,1,null,
 'An MRI scan of the brain.',
 array['c:mri head','l:brain mri']),
('inv.mri_cervical_spine','procedure','MRI cervical spine','mri','mri','cervical spine','inv.mri_spine',false,1,null,
 'An MRI scan of the neck part of the spine.',
 array['c:mri c-spine','c:mri neck']),
('inv.mri_lumbar_spine','procedure','MRI lumbar spine','mri','mri','lumbar spine','inv.mri_spine',false,2,null,
 'An MRI scan of the lower back.',
 array['c:mri l-spine','c:mri lumbosacral spine','l:lower back mri']),
('inv.mri_knee','procedure','MRI knee','mri','mri','knee','inv.mri',false,3,null,
 'An MRI scan of the knee.',
 array['c:knee mri']),
('inv.mri_shoulder','procedure','MRI shoulder','mri','mri','shoulder','inv.mri',false,4,null,
 'An MRI scan of the shoulder.',
 array['c:shoulder mri']),
('inv.mri_pelvis','procedure','MRI pelvis','mri','mri','pelvis','inv.mri',false,5,null,
 'An MRI scan of the pelvis.',
 array['c:pelvic mri']),
('inv.mri_abdomen','procedure','MRI abdomen','mri','mri','abdomen','inv.mri',false,6,null,
 'An MRI scan of the abdomen.',
 array['c:abdominal mri']),

-- Cardiac
('inv.ecg','procedure','Electrocardiogram (ECG)','cardiac',null,'heart','inv.heart_scan',false,2,'11524-6',
 'A recording of your heart''s electrical activity.',
 array['a:ecg','a:ekg','c:electrocardiograph','l:heart tracing']),
('inv.echo','procedure','Echocardiography','cardiac','echocardiography','heart','inv.heart_scan',false,1,null,
 'An ultrasound scan of the heart.',
 array['a:echo','c:echocardiogram','c:cardiac echo','l:heart ultrasound']),
('inv.holter','procedure','Holter monitoring (24-hour ECG)','cardiac',null,'heart',null,false,null,null,
 'A small recorder worn for a day or more to track your heart rhythm.',
 array['c:holter','c:24 hour ecg','c:ambulatory ecg']),
('inv.abpm','procedure','Ambulatory blood pressure monitoring','cardiac',null,null,null,false,null,null,
 'A cuff worn for 24 hours that measures your blood pressure through the day and night.',
 array['a:abpm','c:24 hour blood pressure','l:24 hour bp']),
('inv.stress_test','procedure','Exercise stress test','cardiac',null,'heart','inv.heart_scan',false,3,null,
 'Your heart is checked while you walk or run on a treadmill.',
 array['c:treadmill test','c:stress ecg','a:ett','c:exercise tolerance test']),

-- Endoscopy and physiology
('inv.upper_gi_endoscopy','procedure','Upper GI endoscopy','endoscopy',null,'upper gastrointestinal tract','inv.endoscopy',false,1,null,
 'A camera test of the food pipe, stomach and first part of the gut.',
 array['a:ogd','c:gastroscopy','c:oesophagogastroduodenoscopy','l:stomach camera test']),
('inv.colonoscopy','procedure','Colonoscopy','endoscopy',null,'colon','inv.endoscopy',false,2,null,
 'A camera test of the large bowel.',
 array['l:bowel camera test','m:colonscopy']),
('inv.spirometry','procedure','Spirometry','physiology',null,'lungs',null,false,null,null,
 'You breathe into a machine to measure how well your lungs work.',
 array['l:breathing test']),
('inv.pft','procedure','Pulmonary function tests','physiology',null,'lungs',null,false,null,null,
 'A fuller set of breathing tests than spirometry.',
 array['a:pft','l:lung function test']),
('inv.audiometry','procedure','Audiometry','physiology',null,'ears',null,false,null,null,
 'A hearing test.',
 array['l:hearing test','c:pure tone audiometry']),
('inv.sleep_study','procedure','Sleep study','physiology',null,null,null,false,null,null,
 'Your breathing and sleep are recorded overnight.',
 array['c:polysomnography','a:psg']),
('inv.dexa','procedure','Bone density scan (DEXA)','other_imaging','other','bones',null,false,null,null,
 'A low-dose scan that measures bone strength.',
 array['a:dexa','a:dxa','l:bone density scan']);

-- Concepts, parents before children
insert into public.reference_concepts
  (code_system_id, domain, code, display, status, attributes,
   investigation_category, modality, body_region, is_ambiguous, patient_description)
select cs.id, i.domain::public.reference_concept_domain, i.code, i.display, 'active',
       jsonb_strip_nulls(jsonb_build_object('loinc', i.loinc, 'clarify_order', i.clarify_order)),
       i.category, i.modality::public.imaging_modality, i.region, i.ambiguous, i.descr
from _inv i
cross join (select id from public.reference_code_systems where code = 'TARRAGON') cs;

update public.reference_concepts c
   set parent_id = p.id
  from _inv i
  join public.reference_concepts p on p.code = i.parent
 where c.code = i.code and i.parent is not null
   and p.code_system_id = c.code_system_id;

insert into public.reference_concept_synonyms (concept_id, term, language, term_kind)
select c.id, substr(s, 3), 'en',
       case left(s, 2) when 'a:' then 'abbreviation' when 'l:' then 'lay' when 'm:' then 'misspelling' else 'clinical' end
from _inv i
cross join lateral unnest(i.syns) s
join public.reference_concepts c on c.code = i.code
 and c.code_system_id = (select id from public.reference_code_systems where code = 'TARRAGON')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Link the orderable catalogues to the same identity
-- ---------------------------------------------------------------------------
alter table public.screen_types add column concept_id uuid references public.reference_concepts (id) on delete restrict;
alter table public.imaging_studies add column concept_id uuid references public.reference_concepts (id) on delete restrict;
create index screen_types_concept_idx on public.screen_types (concept_id) where concept_id is not null;
create index imaging_studies_concept_idx on public.imaging_studies (concept_id) where concept_id is not null;

create or replace function private.require_investigation_concept()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.concept_id is not null and not exists (
       select 1 from public.reference_concepts
        where id = new.concept_id and investigation_category is not null and not is_ambiguous) then
    raise exception '%.concept_id must reference a specific (not ambiguous) investigation concept', tg_table_name
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.require_investigation_concept() from public;

create trigger screen_types_require_investigation_concept
  before insert or update of concept_id on public.screen_types
  for each row execute function private.require_investigation_concept();
create trigger imaging_studies_require_investigation_concept
  before insert or update of concept_id on public.imaging_studies
  for each row execute function private.require_investigation_concept();

-- Exact one-to-one matches only. breast_imaging (ultrasound under 40, mammography 40+) is two investigations and
-- stays null, like ogtt_fpg and the panels.
update public.screen_types st
   set concept_id = c.id
  from (values
    ('mammography','inv.mammography'), ('prostate_ultrasound','inv.us_prostate'), ('psa','inv.psa'),
    ('ecg_resting','inv.ecg'), ('echo','inv.echo'), ('lipid_panel','inv.lipid_profile'), ('blood_group','inv.blood_group'),
    ('ferritin','inv.ferritin'), ('hearing_check','inv.audiometry'), ('sickle_cell_genotype','inv.genotype'),
    ('vitamin_b12','inv.vitamin_b12'), ('kft','inv.kft'), ('hba1c','inv.hba1c'), ('abdominal_ultrasound','inv.us_abdomen'),
    ('bone_density','inv.dexa'), ('colonoscopy','inv.colonoscopy'), ('fbc','inv.fbc'), ('fit','inv.fit'),
    ('hep_b','inv.hep_b'), ('hep_c','inv.hep_c'), ('hiv','inv.hiv'), ('lft','inv.lft'), ('tft','inv.tft'),
    ('urinalysis','inv.urinalysis'), ('urine_acr','inv.urine_acr'), ('cervical_smear','inv.cervical_screening'),
    ('malaria_rdt','inv.malaria')
  ) m(screen_code, concept_code)
  join public.reference_concepts c on c.code = m.concept_code
   and c.code_system_id = (select id from public.reference_code_systems where code = 'TARRAGON')
 where st.code = m.screen_code;

-- ---------------------------------------------------------------------------
-- 4. Search
--   Order of strength: exact display (1.00) > exact synonym or abbreviation (0.98) > whole-word phrase inside a
--   display or synonym (0.90) > trigram similarity. If the strongest match is an ambiguous parent, the result is that
--   parent's children for the user to choose (matched_on = 'clarify'), never a guess.
-- ---------------------------------------------------------------------------
create or replace function public.search_investigations(p_text text, p_min_score numeric, p_limit integer default 10)
returns table (
  concept_id uuid, code text, display text, patient_description text, investigation_category text,
  modality public.imaging_modality, body_region text, score numeric, matched_on text,
  clarifies_concept_id uuid, clarifies_display text
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_min_score is null or p_min_score < 0.1 or p_min_score > 0.99 then
    raise exception 'p_min_score must be between 0.1 and 0.99 (read it from versioned config)' using errcode = '22023';
  end if;

  return query
  with needle as (
    select private.normalise_term(p_text) as n
  ),
  scored as (
    select c.id, c.code, c.display, c.patient_description, c.investigation_category, c.modality, c.body_region,
           c.is_ambiguous,
           case
             when private.normalise_term(c.display) = nd.n then 1.00
             when exists (select 1 from public.reference_concept_synonyms s
                           where s.concept_id = c.id and private.normalise_term(s.term) = nd.n) then 0.98
             when ' ' || private.normalise_term(c.display) || ' ' like '% ' || nd.n || ' %'
               or exists (select 1 from public.reference_concept_synonyms s
                           where s.concept_id = c.id
                             and ' ' || private.normalise_term(s.term) || ' ' like '% ' || nd.n || ' %') then 0.90
             else round(greatest(
               extensions.similarity(private.normalise_term(c.display), nd.n),
               coalesce((select max(extensions.similarity(private.normalise_term(s.term), nd.n))
                           from public.reference_concept_synonyms s where s.concept_id = c.id), 0))::numeric, 3)
           end as sc
      from public.reference_concepts c
      cross join needle nd
     where nd.n is not null
       and c.investigation_category is not null
       and c.status <> 'retired'
  ),
  labelled as (
    select s.*, case when s.sc = 1.00 then 'display' when s.sc = 0.98 then 'synonym'
                     when s.sc = 0.90 then 'contains' else 'fuzzy' end as how
      from scored s
     where s.sc >= p_min_score
  ),
  -- Clarify only when an ambiguous parent is matched EXACTLY (its name or one of its synonyms) and nothing specific
  -- matches as strongly. "breast scan" or "mri" asks; a loose word like "scan" lists matches instead of guessing a parent.
  parent as (
    select l.id, l.display, l.sc
      from labelled l
     where l.is_ambiguous and l.sc >= 0.98
       and not exists (select 1 from labelled o where not o.is_ambiguous and o.sc >= l.sc)
     order by l.sc desc, l.display
     limit 1
  ),
  clarify as (
    select c.id, c.code, c.display, c.patient_description, c.investigation_category, c.modality, c.body_region,
           p.sc, 'clarify'::text as how, p.id as pid, p.display as pdisplay,
           coalesce((c.attributes ->> 'clarify_order')::int, 999) as ord
      from parent p
      join public.reference_concepts c on c.parent_id = p.id
     where c.status <> 'retired' and c.investigation_category is not null
  ),
  plain as (
    select l.id, l.code, l.display, l.patient_description, l.investigation_category, l.modality, l.body_region,
           l.sc, l.how, null::uuid as pid, null::text as pdisplay, 0 as ord
      from labelled l
     where not l.is_ambiguous
       and not exists (select 1 from parent)
     order by l.sc desc, l.display
     limit greatest(coalesce(p_limit, 10), 1)
  )
  select r.id, r.code, r.display, r.patient_description, r.investigation_category, r.modality, r.body_region,
         r.sc, r.how, r.pid, r.pdisplay
    from (select * from clarify union all select * from plain) r
   order by r.ord, r.sc desc, r.display;
end;
$$;

revoke all on function public.search_investigations(text, numeric, integer) from public, anon;
grant execute on function public.search_investigations(text, numeric, integer) to authenticated, service_role;

comment on function public.search_investigations(text, numeric, integer) is
  'Diagnostic directory Phase 1: deterministic investigation search over reference_concepts (investigation_category set). Pass p_min_score from proposed-config "directory.investigation_search". Ambiguous terms return the parent''s children with matched_on = clarify.';

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.reference_concepts where investigation_category is not null;
  if v_n < 80 then raise exception 'expected at least 80 investigation concepts, found %', v_n; end if;

  if exists (select 1 from public.reference_concepts c
              where c.investigation_category is not null and c.is_ambiguous
                and not exists (select 1 from public.reference_concepts k where k.parent_id = c.id)) then
    raise exception 'an ambiguous investigation parent has no children to choose from';
  end if;

  if exists (select 1 from public.screen_types where code in (
       'mammography','prostate_ultrasound','psa','ecg_resting','echo','lipid_panel','blood_group','ferritin','hearing_check',
       'sickle_cell_genotype','vitamin_b12','kft','hba1c','abdominal_ultrasound','bone_density','colonoscopy','fbc','fit',
       'hep_b','hep_c','hiv','lft','tft','urinalysis','urine_acr','cervical_smear','malaria_rdt') and concept_id is null) then
    raise exception 'a mapped screen_type was left without its investigation concept';
  end if;

  if has_function_privilege('anon', 'public.search_investigations(text, numeric, integer)', 'EXECUTE') then
    raise exception 'anon must not execute search_investigations';
  end if;
end;
$$;
