# Standards cross-check for the CMO values (2026-10-07)

What was checked: the 27 CMO-owned PROPOSED values, against Nigerian and international references, plus the units used for lab values. This is a desk check from published sources found on 2026-10-07; no laboratory was called and no guideline PDF was read in full where the source below says so. Where a value has no external standard it is labelled **operating choice** and was approved by the CMO on that basis, not on a reference.

## 1. Units: what Nigerian laboratories print, and how the platform copes

- **Canonical units stay as they are**, because they are what Nigerian laboratories most often print. An Ibadan (south-west Nigeria) laboratory reports fasting glucose, total cholesterol and creatinine in **mg/dL**, and sodium and potassium in **mmol/L** (search result for Nigerian laboratory reporting units; one site, so read it as common practice, not a national rule). The Jos reference-interval study reports creatinine in µmol/L and glucose in mmol/L, which shows both styles are in use. So: mg/dL for glucose, creatinine and lipids; mmol/L for sodium and potassium; g/dL haemoglobin; 10^9/L counts; U/L enzymes; % HbA1c.
- **Other units are recognised and converted**, in `packages/clinical/src/lab-units.ts`, before a value reaches the database: glucose and lipids mmol/L, creatinine µmol/L, HbA1c mmol/mol (IFCC), haemoglobin g/L, counts as cells/µL or K/µL or 10^3/µL, sodium and potassium mEq/L, enzymes IU/L or µkat/L, TSH µIU/mL. Factors are physical constants (glucose 18.016, creatinine 88.4, cholesterol 38.67, triglycerides 88.57, HbA1c IFCC/NGSP master equation). A unit it does not know is refused with a plain message, never guessed. The partner entry form has a unit picker per analyte.
- **Not verified:** the units the actual partner laboratory (SYNLAB Nigeria) prints. Ask them or read one real report; the converter makes either answer safe, but the default unit in the picker should match their habit.

## 2. Lab limits (migration `20261007121842_s27g_lab_panel_membership_sex_ranges.sql`)

| Analyte | Before | Now | Reference and reasoning |
|---|---|---|---|
| Haemoglobin | 12 to 17.5 for all; critical below 7 | **Men 13 to 17.5, women 12 to 15.5**; critical below 7 and above 20 unchanged | WHO anaemia thresholds retained in the 2024 guideline: 13 g/dL for men, 12 g/dL for non-pregnant women. A pregnant woman below 11 is already below 12, so she is flagged for review (conservative). Jos study means (men about 14, women about 12.4 to 13.1) sit inside these ranges. |
| Creatinine | 0.6 to 1.3 for all | **Men 0.7 to 1.3, women 0.6 to 1.1 mg/dL**; critical above 4.0 unchanged | Conventional sex-specific ranges (muscle mass). Note creatinine alone is not kidney function; eGFR is a separate, later item. |
| HDL | low below 40 | **Men below 40, women below 50 mg/dL** | NCEP ATP III / AHA low-HDL definitions. |
| Fasting glucose | ref 70 to 99; critical below 40 and above 400 | ref unchanged; **critical below 45 and above 360 mg/dL** | Royal College of Pathologists telephone limits: 2.5 and 20 mmol/L (about 45 and 360 mg/dL). The 99 upper limit follows the ADA (impaired fasting glucose from 100 mg/dL, 5.6 mmol/L). WHO and NICE start impaired fasting glucose at 110 mg/dL (6.1 mmol/L). The ADA line was kept because Tarragon is a prevention service and a lower line sends more people to a clinician; the cost is more reviews. |
| HbA1c | ref up to 5.6; critical above 14 | unchanged | ADA prediabetes starts at 5.7 percent; NICE at 6.0 percent (42 mmol/mol). Diabetes at 6.5 percent in both. The critical limit of 14 percent is a Tarragon safety choice, not a published critical value. |
| Potassium | 3.5 to 5.1; critical below 2.5 and above 6.5 | ref unchanged; **critical below 3.0 and above 6.0** | Royal College of Pathologists / hospital telephone limits cite below 3.0 and above 6.0 mmol/L. Hospital haemolysis can raise potassium falsely, so a critical high prompts a repeat as well as urgency. |
| Sodium | 135 to 145; critical 120 and 160 | ref unchanged; **critical 120 or below, and above 150** | Same source: 120 or below, above 150 mmol/L. Stored as "below 121" because the rule is strict less-than. |
| ALT | 7 to 56 | **7 to 40 U/L** | 56 is a common US-assay upper limit; 40 U/L is the widely used UK and harmonised limit. Nigerian reference studies in healthy adults report ALT up to about 48 in men, from small samples. Chosen to lean toward not missing early liver disease. |
| White cell count | 4.0 to 11.0; critical below 1 and above 30 | **3.0 to 11.0 10^9/L**; critical unchanged | Duffy-null associated neutrophil count: lower neutrophil and white cell counts are normal in many people of African ancestry, and it is found in 80 to 100 percent of people in sub-Saharan Africa. Labelling them neutropenic is a known source of harm. 3.0 is a pragmatic lower limit; a value below it is still reviewed. |
| Platelets | 150 to 450 | unchanged | A military-recruit study of 7,797 young Nigerian adults found a median of 218 against a Western 280, so mildly low counts are common. 150 was kept, since a low count is only held for routine review, not treated as critical. A Nigerian-specific lower limit would need a larger study. |
| Total cholesterol, LDL, triglycerides | 200, 130, 150 mg/dL | unchanged | Desirable total cholesterol below 200 mg/dL (5.2 mmol/L), triglycerides below 150 (1.7 mmol/L). The 130 mg/dL LDL line is the "borderline high" flag, not a treatment goal: ESC 2021 goals are risk-based (below 70 mg/dL high risk, below 55 very high risk), set by a clinician. |
| TSH | 0.4 to 4.0 | unchanged | Common adult reference interval (0.4 to 4.0 or 4.5 mIU/L). Pregnancy and age need clinician judgement. |
| AST, platelets critical, WBC critical, Hb critical | | unchanged | Common hospital critical limits. |

**Not adopted:** the 2014 Jos reference-interval study (124 men, 125 women, blood donors) was *not* used to set limits. Its potassium range (4.0 to 7.5) and sodium range (as low as 120) point to sample-handling problems, and its samples are small. It is useful for context only.

**Sex not recorded:** a patient with no recorded sex is judged by the narrowest of the two ranges, so an uncertain case goes to a clinician instead of being released. Six of twelve live profiles have no sex recorded today; the onboarding screen should ask.

## 3. Blood pressure

| Value | Decision | Reference |
|---|---|---|
| `bp.starting_suggestion_target` | **Changed** from one pair to NICE bands: below 135/85 under 80 years, below 145/85 from 80. Tighter targets (type 2 diabetes with kidney, eye or cerebrovascular damage: clinic below 130/80; CKD with ACR 70 mg/mmol or more: home below 125/75) are set by the care team as the personal target and never inferred by the phone. | NICE NG136: home (HBPM) threshold 135/85; targets below 140/90 clinic and below 135/85 home under 80; below 150/90 clinic and below 145/85 home at 80 or over. NICE NG28 and NG203 for the 130/80 and 125/75 groups. The 2023 Nigerian national hypertension guideline uses 140/90 as its treatment threshold (the guideline PDF was too large to read in full; this is from search summaries). |
| `bp.home_protocol` | Confirmed | NICE NG136: two readings one minute apart, seated, twice a day, at least 4 and ideally 7 days. ESH: 5 minutes rest; no caffeine, exercise or smoking in the previous 30 minutes. |
| `bp.average_gate` | Confirmed with a caveat | It decides when an average is *shown*; NICE's diagnostic average needs at least 4 days. The app does not present it as a diagnosis. |

## 4. Operating values (no external standard)

paging.escalation_minutes (5 and 10), clinician.min_practice_years_after_house_job, clinician.training_test, clinician.tier1_audited_task_count, queue.handback_review_threshold, clinician.max_lead_patients, bp.trend_display, bp.symptom_checklist, medicines.dose_rules, written_care.behaviour, care_change.behaviour, queue.rules, queue.claims, paging.rules, quality.audit, triage.bp_rule_set, triage.wiring_rules, reliability.dashboard: confirmed as operating choices by the CMO on 2026-10-07. `adherence.threshold` (80 percent over 7 days) follows the conventional adherent cut-off. `lead.rules` fatigue limits (11 hours rest, 72 hours in any 7 days) match common junior-doctor working-time limits but `lead.rules` is held (below).

## 5. Held back, still `proposed`

- **`triage.silence_rule_days` (5)**: spec case 7 says 5 days, the safety fixture triggers at 6. Awaiting the CMO's answer. The registry value stays 5 and the fixture is not edited until decided.
- **`queue.task_types` and `lead.rules`**: both name the Medical Officer tier, which decision F-05 retires. The tier cannot be removed in one config change: 110 database proof scripts and 48 application files still use `medical_officer`, and live `task_types` has 8 types with that minimum tier. It needs its own session (the F-05 removal): move those task types to one doctor tier, update the proofs and screens, then drop the enum value (live has 0 clinicians at that tier, 2 senior and 1 chief). Confirmed when that ships.
- **`lab.panels` v2**: confirmed only when the CMO signs `lab_panel_signoffs` v2 in the database (`sign_lab_panels`). Until then nothing auto-releases (INV-14).
- **`lab.release_policy`**: confirmed; the 1440 minute contact window is only the fallback if the escalation SLA row is missing (live SLA: 720 minutes critical, 1440 non-critical).

## 6. Sources
- Nigerian laboratory units: https://ajol.info/index.php/atp/article/view/288711 (search result; Ibadan)
- Nigerian adult reference intervals: https://pmc.ncbi.nlm.nih.gov/articles/PMC4022493/ (Jos, 2014); https://uilspace.unilorin.edu.ng/items/11f89835-36fc-42f7-9eba-7e8d6cc7162e (North Central haematology)
- NICE NG136 hypertension: https://www.england.nhs.uk/london/wp-content/uploads/sites/8/2019/11/NICE-NG136-Hypertension-Management-Guideline-.pdf ; https://www.nice.org.uk/guidance/QS28/chapter/quality-statement-4-blood-pressure-targets
- NICE CKD ACR 70 or more: https://www.nice.org.uk/indicators/ind264-kidney-conditions-ckd-and-blood-pressure-when-acr-70-or-more/chapter/indicator
- Nigeria national hypertension guideline 2023: https://resolvetosavelives.org/wp-content/uploads/2025/03/NATIONAL-GUIDELINES-FOR-THE-PREVENTION-AND-MANAGEMENT-OF-HYPERTENSION-IN-NIGERIA.-_Final-Approved-Version-1.pdf
- WHO haemoglobin thresholds 2024: https://pubmed.ncbi.nlm.nih.gov/38432242/
- WHO versus ADA glucose and HbA1c criteria: https://pmc.ncbi.nlm.nih.gov/articles/PMC7385566/table/T2
- Critical laboratory limits: https://www.thelondonclinic.co.uk/sites/default/files/2023-03/Telephoning%20limits%20for%20critical_unexpected%20Biochemistry%20results.pdf ; Royal College of Pathologists: https://www.rcpath.org/asset/A45A795F%2D3340%2D4539%2DB6DD0091DE348192/
- Duffy-null associated neutrophil count: https://pmc.ncbi.nlm.nih.gov/articles/PMC9881043 ; https://www.hematology.org/-/media/hematology/files/dei/duffy-null/anc-by-duffy-status-health-care-system-application.pdf
- HbA1c IFCC/NGSP: https://ngsp.org/ifccngsp.asp
- ESC 2021 prevention (LDL goals): https://www.acc.org/latest-in-cardiology/articles/2022/01/31/18/12/whats-new-in-the-2021-esc-guidelines-on-cvd-prevention
