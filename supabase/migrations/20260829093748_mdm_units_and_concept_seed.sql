-- Tarragon Health — Health Data Architecture & MDM: units of measure (§34.7)
-- + curated seed data for the terminology core (§34.5/§34.6).
--
-- UNITS (§34.7: "Store units explicitly... The system must understand
-- conversions where applicable.")
--
-- units_of_measure is a REGISTRY, not a general-purpose unit converter.
-- unit_conversions deliberately covers only PHYSICAL-QUANTITY conversions
-- that are substance-independent — mass (kg<->lb), length (cm<->in),
-- temperature (degC<->degF). A concentration conversion (mg/dL<->mmol/L)
-- is NOT substance-independent: the factor is the analyte's molar mass, so
-- glucose's mg/dL->mmol/L factor (0.0555) is different from cholesterol's
-- (0.0259) and urea's again. That per-analyte conversion table already
-- exists and is the single source of truth — see the header of
-- apps/web/src/lib/lab-reports/analyte-catalogue.ts, which says exactly
-- this about itself ("NOT IN THIS FILE: clinical thresholds..."; its
-- `unitConversions` field is the analyte-specific factor). Building a
-- second, generic mg/dL->mmol/L row here would silently contradict that
-- file the day someone adds an analyte whose factor differs — so
-- concentration units are REGISTERED here (their string is now a real,
-- governed row instead of an ungoverned free-text unit) but their
-- conversions stay in the TS catalogue, deliberately, with a pointer
-- comment below rather than a duplicate/competing implementation.
create table public.units_of_measure (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  dimension   text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.units_of_measure is
  'Registry of unit strings this platform stores (§34.7). Concentration units (mg/dL, mmol/L, ...) are registered here for governance but their conversions live in apps/web/src/lib/lab-reports/analyte-catalogue.ts (substance-specific, not a generic unit conversion) — see table comment on unit_conversions.';

create table public.unit_conversions (
  id             uuid primary key default gen_random_uuid(),
  from_unit_id   uuid not null references public.units_of_measure (id) on delete cascade,
  to_unit_id     uuid not null references public.units_of_measure (id) on delete cascade,
  -- to_value = from_value * factor + offset. offset covers degC<->degF;
  -- every other conversion here is offset = 0.
  factor         numeric not null,
  offset_amount  numeric not null default 0,
  created_at     timestamptz not null default now(),
  constraint unit_conversions_distinct check (from_unit_id <> to_unit_id),
  unique (from_unit_id, to_unit_id)
);

comment on table public.unit_conversions is
  'Substance-independent physical-quantity conversions ONLY (mass, length, temperature). Never add a concentration pair (mg/dL, mmol/L, ng/mL, ...) here — that factor depends on the specific analyte''s molar mass and already lives, per-analyte, in analyte-catalogue.ts. A generic row here would silently disagree with that file for at least one analyte.';

create or replace function public.convert_unit(
  p_value numeric,
  p_from_code text,
  p_to_code text
)
returns numeric
language sql
stable
set search_path = ''
as $$
  select p_value * c.factor + c.offset_amount
  from public.unit_conversions c
  join public.units_of_measure f on f.id = c.from_unit_id
  join public.units_of_measure t on t.id = c.to_unit_id
  where f.code = p_from_code and t.code = p_to_code;
$$;

comment on function public.convert_unit is
  'Physical-quantity unit conversion (§34.7). Returns null if p_from_code/p_to_code is not a registered conversion pair — deliberately does not fall back to a guess. Concentration units are out of scope; see unit_conversions table comment.';

alter table public.units_of_measure enable row level security;
alter table public.unit_conversions enable row level security;

create policy units_of_measure_select on public.units_of_measure for select to authenticated using (true);
create policy units_of_measure_insert on public.units_of_measure for insert to authenticated with check (private.is_admin());
create policy units_of_measure_update on public.units_of_measure for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy units_of_measure_delete on public.units_of_measure for delete to authenticated using (private.is_admin());

create policy unit_conversions_select on public.unit_conversions for select to authenticated using (true);
create policy unit_conversions_insert on public.unit_conversions for insert to authenticated with check (private.is_admin());
create policy unit_conversions_update on public.unit_conversions for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy unit_conversions_delete on public.unit_conversions for delete to authenticated using (private.is_admin());

grant select, insert, update, delete on public.units_of_measure to authenticated;
grant select, insert, update, delete on public.unit_conversions to authenticated;
revoke all on public.units_of_measure from anon;
revoke all on public.unit_conversions from anon;
revoke execute on function public.convert_unit(numeric, text, text) from public, anon;
grant execute on function public.convert_unit(numeric, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seed: units actually used across vitals_readings, lab_analyte_readings and
-- the analyte catalogue today (grepped, not invented).
-- ---------------------------------------------------------------------------

insert into public.units_of_measure (code, name, dimension) values
  ('mmHg',      'millimetres of mercury',        'pressure'),
  ('bpm',       'beats per minute',               'rate'),
  ('kg',        'kilogram',                       'mass'),
  ('lb',        'pound',                          'mass'),
  ('cm',        'centimetre',                     'length'),
  ('in',        'inch',                           'length'),
  ('degC',      'degrees Celsius',                'temperature'),
  ('degF',      'degrees Fahrenheit',             'temperature'),
  ('percent',   'percent',                        'fraction'),
  ('mg/dL',     'milligrams per decilitre',       'concentration'),
  ('mmol/L',    'millimoles per litre',           'concentration'),
  ('mg/g',      'milligrams per gram',            'concentration'),
  ('g/dL',      'grams per decilitre',            'concentration'),
  ('U/L',       'units per litre',                'activity_concentration'),
  ('ng/mL',     'nanograms per millilitre',       'concentration'),
  ('pg/mL',     'picograms per millilitre',       'concentration'),
  ('mIU/L',     'milli-international units per litre', 'concentration'),
  ('ng/dL',     'nanograms per decilitre',        'concentration'),
  ('10^9/L',    'x10^9 per litre',                'count_concentration'),
  ('10^12/L',   'x10^12 per litre',               'count_concentration'),
  ('fL',        'femtolitre',                     'volume'),
  ('pg',        'picogram',                       'mass'),
  ('mm/hr',     'millimetres per hour',           'rate'),
  ('/uL',       'per microlitre',                 'count_concentration'),
  ('mg/L',      'milligrams per litre',           'concentration'),
  ('mmol_mol',  'millimoles per mole (IFCC HbA1c)', 'ratio')
on conflict (code) do nothing;

-- Physical-quantity conversions only, per the table comment above.
insert into public.unit_conversions (from_unit_id, to_unit_id, factor, offset_amount)
select f.id, t.id, v.factor, v.offset_amount
from (values
  ('kg', 'lb', 2.2046226218, 0),
  ('lb', 'kg', 0.45359237, 0),
  ('cm', 'in', 0.3937007874, 0),
  ('in', 'cm', 2.54, 0),
  ('degC', 'degF', 1.8, 32),
  ('degF', 'degC', 0.5555555556, -17.7777777778)
) as v(from_code, to_code, factor, offset_amount)
join public.units_of_measure f on f.code = v.from_code
join public.units_of_measure t on t.code = v.to_code
on conflict (from_unit_id, to_unit_id) do nothing;

-- ---------------------------------------------------------------------------
-- Seed: code systems
-- ---------------------------------------------------------------------------

insert into public.reference_code_systems (code, name, uri, version, is_licensed, licence_note) values
  ('ICD10',  'ICD-10 (WHO)', 'http://hl7.org/fhir/sid/icd-10', '2019', false, null),
  ('ATC',    'Anatomical Therapeutic Chemical Classification (WHOCC)', 'http://www.whocc.no/atc', '2024', false, null),
  ('LOINC',  'Logical Observation Identifiers Names and Codes (Regenstrief)', 'http://loinc.org', '2.78', false, null),
  ('ISO3166-1', 'ISO 3166-1 country codes', 'urn:iso:std:iso:3166', null, false, null),
  ('ISO639-1',  'ISO 639-1 language codes', 'urn:ietf:bcp:47', null, false, null),
  ('TARRAGON', 'Tarragon Health internal reference terms (used where no free-to-use external code fits — allergens, internal procedures)', 'https://tarragonhealth.ng/fhir/CodeSystem/internal', '1', false, null),
  ('SNOMED-CT', 'SNOMED CT', 'http://snomed.info/sct', null, true,
   'Registered with zero concepts — requires an IHTSDO member/affiliate licence and Nigeria''s national member status is not something this build can assert. See CLAUDE.md/this migration''s header. A future licensed import is then an INSERT, not a schema change.'),
  ('RxNorm', 'RxNorm (US NLM)', 'http://www.nlm.nih.gov/research/umls/rxnorm', null, true,
   'Registered with zero concepts — RxNorm is US-formulary-specific and not licensed/validated for the Nigerian formulary this platform actually dispenses against; ATC is used instead for the seeded medication concepts. Kept registered so a future validated RxNorm cross-map is an INSERT, not a schema change.')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Seed: condition concepts (ICD-10) — exactly the 7 chronic_condition_
-- programmes.code values (20260716223231_chronic_condition_programmes.sql)
-- plus the handful of other conditions the platform already tracks by
-- dedicated status columns (profiles.hiv_status/hbv_status/hcv_status) or
-- references in patient_conditions-adjacent code, so a real "type diagnosis
-- text -> get a suggested code" lookup has something to resolve against
-- from day one rather than an empty table.
-- ---------------------------------------------------------------------------

insert into public.reference_concepts (code_system_id, domain, code, display, definition)
select cs.id, 'condition', v.code, v.display, v.definition
from public.reference_code_systems cs, (values
  ('I10',   'Essential (primary) hypertension', 'Chronic elevated blood pressure with no identified secondary cause.'),
  ('E11',   'Type 2 diabetes mellitus', 'Non-insulin-dependent diabetes mellitus.'),
  ('J45',   'Asthma', 'Chronic inflammatory airway disease with reversible airflow obstruction.'),
  ('J44',   'Chronic obstructive pulmonary disease', 'Progressive airflow limitation, usually smoking-related.'),
  ('I50',   'Heart failure', 'Inability of the heart to pump sufficiently to meet the body''s needs.'),
  ('N18',   'Chronic kidney disease', 'Progressive loss of kidney function over months to years.'),
  ('E66',   'Obesity', 'Excess body fat accumulation presenting a risk to health.'),
  ('E78',   'Dyslipidaemia', 'Abnormal amount of lipids in the blood.'),
  ('B20',   'HIV disease', 'Human immunodeficiency virus infection.'),
  ('B18.1', 'Chronic viral hepatitis B', 'Chronic hepatitis B virus infection.'),
  ('B18.2', 'Chronic viral hepatitis C', 'Chronic hepatitis C virus infection.'),
  ('E03',   'Hypothyroidism', 'Underactive thyroid gland.'),
  ('M10',   'Gout', 'Inflammatory arthritis caused by urate crystal deposition.')
) as v(code, display, definition)
where cs.code = 'ICD10'
on conflict (code_system_id, code) do nothing;

-- Synonyms — the actual free-text spellings this platform's own condition
-- protocol/chronic-programme names use, so §34.6's own worked example
-- ("high blood pressure") round-trips for real.
insert into public.reference_concept_synonyms (concept_id, term)
select c.id, v.term
from public.reference_concepts c
join public.reference_code_systems cs on cs.id = c.code_system_id and cs.code = 'ICD10'
join (values
  ('I10', 'hypertension'),
  ('I10', 'high blood pressure'),
  ('I10', 'HTN'),
  ('E11', 'type 2 diabetes'),
  ('E11', 'diabetes'),
  ('E11', 'T2DM'),
  ('J45', 'asthma'),
  ('J44', 'COPD'),
  ('I50', 'heart failure'),
  ('I50', 'congestive heart failure'),
  ('I50', 'CHF'),
  ('N18', 'chronic kidney disease'),
  ('N18', 'CKD'),
  ('E66', 'obesity'),
  ('E78', 'dyslipidaemia'),
  ('E78', 'high cholesterol'),
  ('B20', 'HIV'),
  ('B18.1', 'hepatitis B'),
  ('B18.1', 'HBV'),
  ('B18.2', 'hepatitis C'),
  ('B18.2', 'HCV'),
  ('E03', 'hypothyroidism'),
  ('E03', 'underactive thyroid'),
  ('M10', 'gout')
) as v(code, term) on v.code = c.code
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Seed: medication concepts (ATC) — every drug_name this platform's own
-- drug_monitoring_rules and bp_ladder_steps migrations already reference
-- (20260716173000_drug_class_lab_monitoring.sql, 20260720020742_bp_drug_
-- ladder_and_safety.sql, 20260720121001_statin_lipid_monitoring.sql), so
-- the concept table is grounded in this platform's real formulary usage
-- rather than an arbitrary drug list.
-- ---------------------------------------------------------------------------

insert into public.reference_concepts (code_system_id, domain, code, display, definition)
select cs.id, 'medication', v.code, v.display, v.definition
from public.reference_code_systems cs, (values
  ('A10BA02', 'Metformin', 'Biguanide, first-line oral glucose-lowering agent.'),
  ('A10AB01', 'Insulin (human)', 'Insulin, used across regimens; specific analogue captured in the free-text drug_name.'),
  ('C09AA01', 'Captopril', 'ACE inhibitor.'),
  ('C09AA02', 'Enalapril', 'ACE inhibitor.'),
  ('C09AA03', 'Lisinopril', 'ACE inhibitor.'),
  ('C09AA04', 'Perindopril', 'ACE inhibitor.'),
  ('C09AA05', 'Ramipril', 'ACE inhibitor.'),
  ('C09CA01', 'Losartan', 'Angiotensin II receptor blocker (ARB).'),
  ('C09CA03', 'Valsartan', 'Angiotensin II receptor blocker (ARB).'),
  ('C09CA04', 'Irbesartan', 'Angiotensin II receptor blocker (ARB).'),
  ('C09CA06', 'Candesartan', 'Angiotensin II receptor blocker (ARB).'),
  ('C09CA07', 'Telmisartan', 'Angiotensin II receptor blocker (ARB).'),
  ('C08CA01', 'Amlodipine', 'Dihydropyridine calcium channel blocker; first-line BP ladder step 1 on this platform.'),
  ('C03AA03', 'Hydrochlorothiazide', 'Thiazide diuretic.'),
  ('C03BA11', 'Indapamide', 'Thiazide-like diuretic.'),
  ('C03DA01', 'Spironolactone', 'Potassium-sparing (aldosterone antagonist) diuretic.'),
  ('C03DB01', 'Amiloride', 'Potassium-sparing diuretic.'),
  ('C10AA01', 'Simvastatin', 'HMG-CoA reductase inhibitor (statin).'),
  ('C10AA03', 'Pravastatin', 'HMG-CoA reductase inhibitor (statin).'),
  ('C10AA05', 'Atorvastatin', 'HMG-CoA reductase inhibitor (statin).'),
  ('C10AA07', 'Rosuvastatin', 'HMG-CoA reductase inhibitor (statin).'),
  ('C10AA08', 'Pitavastatin', 'HMG-CoA reductase inhibitor (statin).'),
  ('B01AA03', 'Warfarin', 'Vitamin K antagonist anticoagulant.')
) as v(code, display, definition)
where cs.code = 'ATC'
on conflict (code_system_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- Seed: lab_analyte concepts (LOINC) — mapped 1:1 onto the code strings
-- already written to lab_analyte_readings.code today
-- (apps/web/src/lib/lab-reports/analyte-catalogue.ts), so a concept_id
-- link added to that table later resolves to a real, correct LOINC code
-- rather than a guess. LOINC codes below are the standard, widely-cited
-- codes for each analyte.
-- ---------------------------------------------------------------------------

insert into public.reference_concepts (code_system_id, domain, code, display, attributes)
select cs.id, 'lab_analyte', v.code, v.display, jsonb_build_object('tarragon_analyte_code', v.tarragon_code)
from public.reference_code_systems cs, (values
  ('2160-0',  'Creatinine [Mass/volume] in Serum or Plasma', 'creatinine'),
  ('3094-0',  'Urea nitrogen [Mass/volume] in Serum or Plasma', 'urea'),
  ('4548-4',  'Haemoglobin A1c/Haemoglobin.total in Blood', 'hba1c'),
  ('1558-6',  'Fasting glucose [Mass/volume] in Serum or Plasma', 'fasting_glucose'),
  ('2345-7',  'Glucose [Mass/volume] in Serum or Plasma', 'random_glucose'),
  ('2093-3',  'Cholesterol [Mass/volume] in Serum or Plasma', 'total_cholesterol'),
  ('2085-9',  'HDL Cholesterol [Mass/volume] in Serum or Plasma', 'hdl_cholesterol'),
  ('2089-1',  'LDL Cholesterol [Mass/volume] in Serum or Plasma', 'ldl_cholesterol'),
  ('2571-8',  'Triglyceride [Mass/volume] in Serum or Plasma', 'triglycerides'),
  ('1742-6',  'Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma', 'alt'),
  ('1920-8',  'Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma', 'ast'),
  ('6768-6',  'Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma', 'alp'),
  ('1975-2',  'Total bilirubin [Mass/volume] in Serum or Plasma', 'total_bilirubin'),
  ('1751-7',  'Albumin [Mass/volume] in Serum or Plasma', 'albumin'),
  ('718-7',   'Haemoglobin [Mass/volume] in Blood', 'haemoglobin'),
  ('4544-3',  'Haematocrit [Volume Fraction] of Blood', 'haematocrit'),
  ('6690-2',  'White blood cell count in Blood', 'wbc'),
  ('777-3',   'Platelet count in Blood', 'platelets'),
  ('2951-2',  'Sodium [Moles/volume] in Serum or Plasma', 'sodium'),
  ('2823-3',  'Potassium [Moles/volume] in Serum or Plasma', 'potassium'),
  ('2075-0',  'Chloride [Moles/volume] in Serum or Plasma', 'chloride'),
  ('1963-8',  'Bicarbonate [Moles/volume] in Serum or Plasma', 'bicarbonate'),
  ('3016-3',  'Thyrotropin (TSH) [Units/volume] in Serum or Plasma', 'tsh'),
  ('3024-7',  'Free thyroxine (T4) [Mass/volume] in Serum or Plasma', 'free_t4'),
  ('2857-1',  'Prostate specific Ag [Mass/volume] in Serum or Plasma', 'psa'),
  ('3084-1',  'Urate [Mass/volume] in Serum or Plasma', 'uric_acid'),
  ('789-8',   'Erythrocytes [#/volume] in Blood', 'rbc'),
  ('787-2',   'MCV [Entitic volume] by Automated count', 'mcv'),
  ('785-6',   'MCH [Entitic mass] by Automated count', 'mch'),
  ('786-4',   'MCHC [Mass/volume] by Automated count', 'mchc'),
  ('30385-9', 'Neutrophils/100 leukocytes in Blood by Automated count', 'neutrophils_pct'),
  ('26478-8', 'Lymphocytes [#/volume] in Blood', 'lymphocytes_pct'),
  ('26449-9', 'Eosinophils/100 leukocytes in Blood by Automated count', 'eosinophils_pct'),
  ('26485-3', 'Monocytes/100 leukocytes in Blood by Automated count', 'monocytes_pct'),
  ('30341-2', 'Erythrocyte sedimentation rate', 'esr'),
  ('5792-7',  'Glucose [Presence] in Urine by Test strip', 'urine_glucose'),
  ('20454-5', 'Protein [Mass/volume] in Urine by Test strip', 'urine_protein'),
  ('5794-3',  'Hemoglobin [Presence] in Urine by Test strip', 'urine_blood'),
  ('5799-2',  'Leukocyte esterase [Presence] in Urine by Test strip', 'urine_leukocytes'),
  ('5802-4',  'Nitrite [Presence] in Urine by Test strip', 'urine_nitrite'),
  ('5797-6',  'Ketones [Presence] in Urine by Test strip', 'urine_ketones'),
  ('14957-5', 'Microalbumin/Creatinine [Mass Ratio] in Urine', 'urine_acr'),
  ('30934-4', 'Prealbumin [Mass/volume] in Serum or Plasma', 'total_protein'),
  ('2324-2',  'Gamma glutamyl transferase [Enzymatic activity/volume] in Serum or Plasma', 'ggt'),
  ('1968-7',  'Direct bilirubin [Mass/volume] in Serum or Plasma', 'direct_bilirubin'),
  ('3051-0',  'Free triiodothyronine (T3) [Mass/volume] in Serum or Plasma', 'free_t3'),
  ('2276-4',  'Ferritin [Mass/volume] in Serum or Plasma', 'ferritin'),
  ('2132-9',  'Vitamin B12 [Mass/volume] in Serum or Plasma', 'vitamin_b12'),
  ('2284-8',  'Folate [Mass/volume] in Serum or Plasma', 'folate'),
  ('1989-3',  '25-Hydroxyvitamin D3 [Mass/volume] in Serum or Plasma', 'vitamin_d'),
  ('1988-5',  'C reactive protein [Mass/volume] in Serum or Plasma', 'crp')
) as v(code, display, tarragon_code)
where cs.code = 'LOINC'
on conflict (code_system_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- Seed: allergen concepts (TARRAGON internal — no free-to-use allergen
-- vocabulary was licensed, see the TARRAGON code system's own note above).
-- The list is the drug/allergen classes this platform's own BP-safety
-- trigger and drug-interaction reasoning already treat as classes (ACE
-- inhibitor, ARB, thiazide, statin, sulfa) plus the common non-drug
-- allergens a Nigerian intake form realistically asks about.
-- ---------------------------------------------------------------------------

insert into public.reference_concepts (code_system_id, domain, code, display)
select cs.id, 'allergen', v.code, v.display
from public.reference_code_systems cs, (values
  ('PENICILLIN',  'Penicillin / beta-lactam antibiotics'),
  ('SULFA',       'Sulfonamide (sulfa) drugs'),
  ('NSAID',       'NSAIDs (e.g. ibuprofen, diclofenac)'),
  ('ASPIRIN',     'Aspirin'),
  ('ACE_INHIBITOR', 'ACE inhibitors'),
  ('CONTRAST_IODINE', 'Iodinated contrast media'),
  ('LATEX',       'Latex'),
  ('PEANUT',      'Peanuts'),
  ('SHELLFISH',   'Shellfish'),
  ('EGG',         'Egg'),
  ('BEE_STING',   'Bee/wasp sting'),
  ('ADHESIVE_TAPE','Adhesive tape / plaster')
) as v(code, display)
where cs.code = 'TARRAGON'
on conflict (code_system_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- Seed: country and language concepts (small, deliberately not exhaustive
-- ISO tables — Nigeria plus the diaspora markets this platform actually
-- prices for per CLAUDE.md's diaspora billing rule, GBP/USD).
-- ---------------------------------------------------------------------------

insert into public.reference_concepts (code_system_id, domain, code, display)
select cs.id, 'country', v.code, v.display
from public.reference_code_systems cs, (values
  ('NG', 'Nigeria'), ('GB', 'United Kingdom'), ('US', 'United States'),
  ('CA', 'Canada'), ('GH', 'Ghana')
) as v(code, display)
where cs.code = 'ISO3166-1'
on conflict (code_system_id, code) do nothing;

insert into public.reference_concepts (code_system_id, domain, code, display)
select cs.id, 'language', v.code, v.display
from public.reference_code_systems cs, (values
  ('en', 'English'), ('yo', 'Yoruba'), ('ig', 'Igbo'),
  ('ha', 'Hausa'), ('fr', 'French')
) as v(code, display)
where cs.code = 'ISO639-1'
on conflict (code_system_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- Verification (mirrors this codebase's do $$ ... raise exception pattern).
-- ---------------------------------------------------------------------------

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.reference_concepts where domain = 'condition';
  if v_count < 7 then
    raise exception 'FAIL: expected at least 7 seeded condition concepts, found %', v_count;
  end if;

  select count(*) into v_count from public.reference_concepts where domain = 'medication';
  if v_count < 15 then
    raise exception 'FAIL: expected at least 15 seeded medication concepts, found %', v_count;
  end if;

  select count(*) into v_count from public.reference_concepts where domain = 'lab_analyte';
  if v_count < 30 then
    raise exception 'FAIL: expected at least 30 seeded lab_analyte concepts, found %', v_count;
  end if;

  -- SNOMED-CT and RxNorm must stay at zero concepts per the licence posture
  -- documented above — a future accidental seed against an unlicensed
  -- system is exactly the compliance mistake this guard exists to catch.
  select count(*) into v_count
  from public.reference_concepts c
  join public.reference_code_systems cs on cs.id = c.code_system_id
  where cs.code in ('SNOMED-CT', 'RxNorm');
  if v_count <> 0 then
    raise exception 'FAIL: % concept(s) seeded against an unlicensed code system (SNOMED-CT/RxNorm)', v_count;
  end if;
end;
$$;
