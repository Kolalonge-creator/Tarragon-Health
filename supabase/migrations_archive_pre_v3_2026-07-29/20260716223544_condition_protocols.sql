-- Tarragon Health — Chronic Disease Programme catalogue, step 3/4
--
-- condition_protocols: the WHO-based clinical reference content behind each
-- chronic programme, structured into the five domains the pathway needs —
-- prevention, monitoring, investigations, escalation (red flags), and
-- follow-up. Global reference (no organisation_id), authenticated read,
-- platform-admin write. Same "reference catalogue" ownership as
-- chronic_condition_programmes / drug_monitoring_rules.
--
-- IMPORTANT — this is *reference* content, NOT a signed clinical protocol. It
-- is sourced from WHO guidance (PEN / HEARTS and aligned GINA / GOLD / KDIGO
-- standards WHO PEN references) and seeded so a Clinical Director can review it
-- and sign it into an auditable protocol_versions row. Only that signature
-- activates the condition (see the trigger in step 2). Nothing here should be
-- rendered to a patient as "your doctor's protocol" — it is educational /
-- governance reference until signed. Content is honest clinical guidance but
-- MUST be reviewed by a Nigerian-licensed Clinical Director before launch.

create table if not exists public.condition_protocols (
  id                uuid primary key default gen_random_uuid(),
  condition         public.care_plan_condition not null unique,
  protocol_slug     text not null unique,
  source            text not null default 'World Health Organization',
  source_reference  text,
  summary           text not null,
  prevention        jsonb not null default '[]'::jsonb,
  monitoring        jsonb not null default '{}'::jsonb,
  investigations    jsonb not null default '{}'::jsonb,
  escalation        jsonb not null default '{}'::jsonb,
  follow_up         jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists condition_protocols_set_updated_at on public.condition_protocols;
create trigger condition_protocols_set_updated_at
  before update on public.condition_protocols
  for each row execute function private.set_updated_at();

alter table public.condition_protocols enable row level security;

drop policy if exists condition_protocols_select on public.condition_protocols;
create policy condition_protocols_select on public.condition_protocols
  for select to authenticated
  using (true);

drop policy if exists condition_protocols_insert on public.condition_protocols;
create policy condition_protocols_insert on public.condition_protocols
  for insert to authenticated
  with check (private.is_admin());

drop policy if exists condition_protocols_update on public.condition_protocols;
create policy condition_protocols_update on public.condition_protocols
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update on public.condition_protocols to authenticated;

-- --- seed: WHO-based reference protocols -------------------------------------
insert into public.condition_protocols
  (condition, protocol_slug, source_reference, summary, prevention, monitoring, investigations, escalation, follow_up)
values
(
  'hypertension', 'chronic_hypertension_who',
  'WHO HEARTS technical package; WHO Package of Essential NCD Interventions (PEN)',
  'Blood-pressure control and total cardiovascular-risk reduction through lifestyle measures, protocol-based drug treatment, and structured long-term review.',
  '["Reduce dietary salt to under 5 g per day","Eat a diet rich in fruit, vegetables and whole grains; limit saturated fat","At least 150 minutes of moderate physical activity per week","Maintain a healthy weight (BMI 18.5-24.9)","Avoid tobacco and limit alcohol","Manage stress and ensure adequate sleep"]'::jsonb,
  '{"targets":["BP < 140/90 mmHg (general)","BP < 130/80 mmHg if diabetes, CKD or high CVD risk"],"vitals":["blood_pressure","pulse"],"cadence":"Uncontrolled: review every 2-4 weeks until at target. Controlled: every 3-6 months. Encourage validated home BP monitoring."}'::jsonb,
  '{"baseline":["U&E / creatinine + eGFR","Fasting glucose or HbA1c","Fasting lipid profile","Serum potassium and sodium","Urinalysis for protein","12-lead ECG"],"ongoing":["Renal function + electrolytes annually, and after starting/adjusting ACE inhibitor, ARB or diuretic","Lipids annually","Total CVD risk assessment annually"]}'::jsonb,
  '{"red_flags":["BP >= 180/110 with symptoms (chest pain, breathlessness, neurological deficit, severe headache, visual disturbance) - emergency","BP >= 180/120 without symptoms - urgent same-day clinician review","Signs of target-organ damage (heart failure, renal impairment, retinopathy)"],"sla":"Symptomatic severe hypertension is a Priority-1 red alert - 4-hour clinician contact SLA."}'::jsonb,
  '["Newly diagnosed or uncontrolled: review every 2-4 weeks until BP at target","Once controlled: review every 3-6 months","Annual review of CVD risk, medication, adherence and complications"]'::jsonb
),
(
  'diabetes', 'chronic_diabetes_who',
  'WHO Package of Essential NCD Interventions (PEN); WHO guidance on diagnosis and management of type 2 diabetes',
  'Glycaemic control, blood-pressure and lipid management, and systematic complication screening to prevent micro- and macrovascular disease.',
  '["Achieve and maintain a healthy weight","At least 150 minutes of moderate activity per week","Diet low in refined sugar and saturated fat, high in fibre","Avoid tobacco and limit alcohol","Attend structured self-management education"]'::jsonb,
  '{"targets":["HbA1c < 7% (53 mmol/mol), individualised","Fasting glucose 4-7 mmol/L","BP < 130/80 mmHg","LDL cholesterol at target for CVD risk"],"vitals":["glucose","weight","blood_pressure"],"cadence":"HbA1c every 3 months until stable, then every 6 months. Annual foot and retinal examination."}'::jsonb,
  '{"baseline":["HbA1c","Fasting lipid profile","U&E / creatinine + eGFR","Urine albumin:creatinine ratio (ACR)","LFTs","Dilated retinal examination","Foot examination (pulses, monofilament sensation)"],"ongoing":["HbA1c every 3-6 months","Urine ACR annually","Lipids annually","Renal function annually and after ACE inhibitor / ARB start","Annual foot and eye screening"]}'::jsonb,
  '{"red_flags":["Blood glucose > 15 mmol/L with ketones, vomiting or abdominal pain - suspected DKA, emergency","Hypoglycaemia < 3.9 mmol/L with impaired consciousness - emergency","New or infected foot ulcer","Sudden visual loss"],"sla":"Suspected DKA / hyperglycaemic emergency and severe hypoglycaemia are Priority-1 red alerts - 4-hour clinician contact SLA."}'::jsonb,
  '["Review every 3 months until glycaemic target reached","Then review every 3-6 months","Annual comprehensive complication screen (eyes, feet, kidneys, CVD risk)"]'::jsonb
),
(
  'asthma', 'chronic_asthma_who',
  'WHO PEN; GINA (Global Initiative for Asthma) strategy referenced by WHO',
  'Achieve and maintain symptom control and minimise future exacerbation risk through trigger avoidance, correct inhaler use and step-wise controller therapy.',
  '["Identify and avoid triggers (allergens, smoke, air pollution, occupational exposures)","Stop smoking and avoid second-hand smoke","Annual influenza vaccination","Ensure and re-check correct inhaler technique","Adhere to controller (preventer) therapy"]'::jsonb,
  '{"targets":["No daytime symptoms more than twice a week","No night waking due to asthma","Reliever use no more than twice a week","No activity limitation"],"vitals":["spo2","pulse"],"cadence":"Review 1-3 monthly until controlled, then every 3-6 months. Review within 1 week after any exacerbation."}'::jsonb,
  '{"baseline":["Spirometry (FEV1/FVC with reversibility)","Peak expiratory flow (PEF)","Allergy assessment where indicated"],"ongoing":["Periodic spirometry / PEF","Inhaler technique check at every visit","Assess control (symptoms, reliever use, exacerbations) at every visit"]}'::jsonb,
  '{"red_flags":["SpO2 < 92%","Silent chest, cyanosis or exhaustion","Unable to complete sentences in one breath","PEF < 50% of personal best","Rising reliever use with night symptoms - urgent review"],"sla":"Acute severe asthma is a Priority-1 red alert - immediate emergency care; 4-hour clinician contact SLA for urgent deterioration."}'::jsonb,
  '["Review within 1 week after an exacerbation","Step controller therapy up or down according to control","Annual review including inhaler technique and vaccination"]'::jsonb
),
(
  'copd', 'chronic_copd_who',
  'WHO PEN; GOLD (Global Initiative for Chronic Obstructive Lung Disease) referenced by WHO',
  'Reduce symptoms and exacerbation frequency and preserve lung function, with smoking cessation as the single most important intervention.',
  '["Stop smoking - the most important intervention","Avoid biomass smoke and occupational dust/fume exposure","Annual influenza and pneumococcal vaccination","Attend pulmonary rehabilitation","Stay physically active and maintain good nutrition"]'::jsonb,
  '{"targets":["Reduced exacerbation frequency","Stable or improved symptom burden (mMRC / CAT score)","Maintain functional capacity"],"vitals":["spo2","pulse"],"cadence":"Review every 3-6 months. Review within 4 weeks after an exacerbation."}'::jsonb,
  '{"baseline":["Post-bronchodilator spirometry (FEV1/FVC < 0.70 confirms airflow limitation)","SpO2","Chest X-ray to exclude other pathology","FBC (polycythaemia or anaemia)"],"ongoing":["Annual spirometry","SpO2 at each visit","Review exacerbation frequency and inhaler technique"]}'::jsonb,
  '{"red_flags":["SpO2 < 90% or a fall from the patient baseline","Acute severe breathlessness, confusion or cyanosis","Increased sputum volume and purulence with fever","Use of accessory muscles / peripheral oedema"],"sla":"Acute exacerbation with hypoxia or altered consciousness is a Priority-1 red alert - 4-hour clinician contact SLA."}'::jsonb,
  '["Review within 4 weeks after an exacerbation","Regular review every 3-6 months","Annual vaccination and pulmonary rehabilitation referral where indicated"]'::jsonb
),
(
  'heart_failure', 'chronic_heart_failure_who',
  'WHO PEN; ESC heart-failure management principles aligned with WHO NCD guidance',
  'Relieve congestion, initiate and up-titrate guideline-directed medical therapy, and detect decompensation early through daily weight and symptom monitoring.',
  '["Control blood pressure and diabetes","Treat underlying ischaemic heart disease","Restrict salt and fluid as clinically advised","Avoid NSAIDs and excess alcohol","Stop smoking","Weigh daily and report gain of more than 2 kg in 3 days"]'::jsonb,
  '{"targets":["Euvolaemia (no oedema, no orthopnoea)","BP within individualised target while tolerating therapy","Stable renal function and potassium on treatment"],"vitals":["weight","blood_pressure","pulse"],"cadence":"During up-titration review every 1-2 weeks; when stable every 3 months. Review within 1-2 weeks after any decompensation."}'::jsonb,
  '{"baseline":["BNP or NT-proBNP where available","Echocardiogram","12-lead ECG","U&E / creatinine + eGFR","FBC","TFTs","Fasting glucose and lipids","LFTs","Iron studies"],"ongoing":["U&E + renal function after each change of diuretic, ACE inhibitor, ARB or MRA and periodically","Daily home weight","Periodic echocardiogram as clinically indicated"]}'::jsonb,
  '{"red_flags":["Rapid weight gain with worsening breathlessness or orthopnoea","Breathlessness at rest","Hypotension, syncope or new arrhythmia","Low SpO2 or chest pain"],"sla":"Acute decompensated heart failure is a Priority-1 red alert - 4-hour clinician contact SLA."}'::jsonb,
  '["Review within 1-2 weeks after a decompensation episode","Medication up-titration reviews until target therapy reached","Stable review every 3 months with renal-function checks"]'::jsonb
),
(
  'ckd', 'chronic_ckd_who',
  'WHO PEN; KDIGO CKD evaluation and management principles referenced by WHO',
  'Slow progression and reduce cardiovascular risk through blood-pressure and glycaemic control, avoidance of nephrotoxins, and stage-based monitoring.',
  '["Control blood pressure (target < 130/80 mmHg)","Control diabetes where present","Avoid nephrotoxins - NSAIDs and unregulated herbal remedies","Maintain adequate hydration and treat urinary infections promptly","Stop smoking and maintain a healthy weight"]'::jsonb,
  '{"targets":["BP < 130/80 mmHg","HbA1c at individualised target if diabetic","Slowed eGFR decline","Serum potassium within range"],"vitals":["blood_pressure"],"cadence":"Stage-based: G3 every 6-12 months, G4 every 3-6 months, G5 every 1-3 months."}'::jsonb,
  '{"baseline":["U&E / creatinine + eGFR (to stage)","Urine albumin:creatinine ratio (ACR)","FBC (anaemia)","Calcium, phosphate and PTH","HbA1c","Lipid profile","Urinalysis"],"ongoing":["eGFR and urine ACR at the stage-based cadence","Serum potassium after ACE inhibitor / ARB start or dose change","Haemoglobin and bone profile periodically"]}'::jsonb,
  '{"red_flags":["Rapid decline in eGFR","Serum potassium > 6.0 mmol/L","Fluid overload or pulmonary oedema","Uraemic symptoms (nausea, confusion, pericarditis)","eGFR < 30 or heavy proteinuria - nephrology referral"],"sla":"Hyperkalaemia and fluid overload are Priority-1 red alerts - 4-hour clinician contact SLA."}'::jsonb,
  '["Stage-based review cadence (more frequent as eGFR falls)","Serum potassium check after each ACE inhibitor / ARB adjustment","Nephrology referral at eGFR < 30 or heavy proteinuria","Annual cardiovascular-risk and complication review"]'::jsonb
),
(
  'obesity', 'chronic_obesity_who',
  'WHO guidance on the prevention and management of overweight and obesity',
  'Sustained weight and metabolic-risk reduction through structured lifestyle change, behavioural support and management of associated comorbidities.',
  '["Balanced, calorie-appropriate diet","150-300 minutes of moderate activity per week","Limit sugary drinks and ultra-processed foods","Prioritise sleep and stress management","Access behavioural and peer support"]'::jsonb,
  '{"targets":["5-10% initial weight loss then maintenance","Waist circumference reduction","BP and metabolic markers at target"],"vitals":["weight","blood_pressure"],"cadence":"Every 4-12 weeks during active weight management, then every 3-6 months for maintenance."}'::jsonb,
  '{"baseline":["BMI and waist circumference","Fasting glucose or HbA1c","Fasting lipid profile","LFTs","TFTs","Blood pressure"],"ongoing":["Weight / BMI at every visit","Annual metabolic screen (glucose, lipids)","Screen for and manage comorbidities"]}'::jsonb,
  '{"red_flags":["Obesity with uncontrolled comorbidity (severe hypertension, symptomatic diabetes)","BMI >= 40, or >= 35 with comorbidity - consider specialist / bariatric referral","Symptoms of obstructive sleep apnoea or cardiovascular disease"],"sla":"Escalation follows the SLA of the associated comorbidity."}'::jsonb,
  '["Regular behavioural review during active management","Ongoing comorbidity management","Specialist / bariatric referral per BMI and comorbidity criteria"]'::jsonb
)
on conflict (condition) do nothing;
