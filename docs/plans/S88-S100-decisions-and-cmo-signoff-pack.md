# S88 to S100: founder decisions and CMO sign-off pack

Date: 2026-10-07. Companion to `S88-S100-post-v5-competitor-gap-and-build-plan.md`.
**Status of every clinical item below: DRAFT, UNSIGNED.** The founder's menu selections are recorded as decisions. They are not signatures. Per the standing rule, an item is signed only after the exact text below (or an edited version) is shown and the founder approves that specific item in chat, and then only through the existing CMO chat-signing RPC method.

## 1. Decisions recorded (founder, 2026-10-07)

| ID | Decision | Effect on the plan |
|---|---|---|
| F2 | Finish S40 first | Nothing past S87 starts until S40 writes "Stage 1 complete". No waiver. |
| F3 | Outcome REPORTING yes, risk transfer no | Fixed price per service. Audited outcome reports for payers. I8 unchanged. No fee-at-risk template. |
| F4 | Partner with HMO, NGO and employer, all three; the build must be usable by all | S91 and S92 share one partner-agnostic core (see section 3). |
| F8 | Approve native build and device lab with a written budget cap | **Cap figure still needed from founder** before S88 spends. |
| C1 | AI copilot: drafts only, clinician edits and signs, shadow-measured first | S89 scope fixed; wording in 4.1. |
| C2 | BP anchor: Nigeria national guideline primary, cross-checked to ISH 2020 and WHO 2021 | S90 hypertension gap rules; wording in 4.2. |
| C3 | GLP-1: readiness and monitoring only, no Tarragon sourcing | S95 scope fixed; wording in 4.3. |
| C4 | Nurse visits: vitals, glucose, sample collection, post-discharge check; medicines only on a signed order | S93 scope fixed; wording in 4.4. |
| C5 | Second opinion deferred | S94 stays gated; matching-engine guardrail stands. |
| C6 | Small-cell suppression: 10 per cell, no complementary disclosure | Applies to S90, S91, S92 and every partner report. |
| C7 | Diabetes anchor: ADA 2026, IDF and WHO as cross-checks, individualised | S90/S95 diabetes rules; wording in 4.5. |
| G1 | Independent clinical reviewer for high-risk items | Added gate before each signature in section 4 (see 5). |

Not asked and still open: F5 (nurse and ambulance partner names), F9 (primary read of the TechCabal 2026 report and Reliance pricing), the Pidgin/English-only reconciliation, and the two spec points flagged in section 6.

## 2. Guideline register (what each item is grounded in)

Verified today by search summaries (titles and dates only; the CMO must open the source before signing):
- **2025 ACC/AHA high blood pressure guideline** (Aug 2025): target below 130/80, PREVENT risk calculator replaces Pooled Cohort Equations, urine albumin-to-creatinine ratio for all, 3 to 6 months of lifestyle first at lower risk. US-derived; not validated in West Africans. Source: ACC journal scan 2025-08-14.
- **WHO guideline on GLP-1 therapies for obesity in adults** (1 Dec 2025): conditional recommendation for long-term use (6 months or more) at BMI 30 or above, not in pregnancy, treated as a class (liraglutide, semaglutide, tirzepatide), with intensive behavioural therapy; conditional because of cost, limited long-term safety data, system readiness and equity.
- **ADA Standards of Care in Diabetes 2026** (8 Dec 2025): broader CGM use, integrated cardiometabolic, kidney and liver management, presymptomatic type 1 screening.
- **Nigerian hypertension guidance**: Nigerian Hypertension Society 2020 guidelines (total CV risk stratification, early drug therapy in high risk, multi-drug for BP above 160/100); 2019 Nigeria Hypertension Protocol (four-step, fixed-dose combinations); national guidelines 2023 to 2028 (Resolve to Save Lives hosts the PDF).
- **NHIA Act 2022**: compulsory health insurance for citizens and legal residents; NHIA enforces a basic minimum package across federal, state and private schemes.
- **NDPA 2023**: health data is sensitive; cross-border transfer needs adequacy or a lawful mechanism; DPA and DPO obligations (NDPC registration and DPO appointment are already done per CLAUDE.md).
- **MDCN Code of Medical Ethics 2008** recognises telemedicine and recommends encryption of patient data; sector commentary says Nigeria has no dedicated telemedicine statute, so counsel's view remains needed.

From background knowledge (CMO to verify): ISH 2020 Global Hypertension Practice Guidelines (essential and optimal standards); WHO 2021 guideline for pharmacological treatment of hypertension; WHO HEARTS technical package; WHO PEN essential NCD package; IDF Clinical Practice Recommendations; WHO Ethics and Governance of AI for Health (2021) and guidance on large multimodal models (2024); WHO task-shifting recommendations (2012); NMCN scope of practice; ISO 14971 (medical-device risk management), IEC 62304 and IEC 82304-1 (health software); EU AI Act as an international benchmark only.

## 3. Build consequence of F4 (one core, three partner types)

S91 and S92 become one design, delivered in two PRs:
- **Partner organisation** with a type (`hmo`, `ngo`, `employer`). One cohort, one benefit-rule table, one aggregate-report pipeline.
- **Benefit rules as data**: services covered, price list reference, pre-authorisation required or not, sponsor-paid entitlements, caps. No stored balance (INV-09), no capitation (I8).
- **Eligibility**: HMO member file or enrolment code; NGO programme invitation; employer roster. All end as the same `cohort_member` record with a consent record.
- **Reporting**: same aggregate pipeline, 10-per-cell suppression with complementary-disclosure checks (C6). Employer reports never include reproductive, pregnancy or mental-health fields (C.1). HMO claims-lite carries only the covered member and the service, not clinical detail.
- **Settlement**: HMO claim settlement, NGO invoice against programme budget, employer invoice, all in kobo.
- Activation stays a founder act (`set_platform_module`); each type stays off until its own signed counterparty and DPA exist.

## 4. FINAL TEXT for items 4.1 to 4.6 (selected 2026-10-07)

**Status of all six: CMO-approved on 2026-10-07 as the founder's recorded position, pending independent clinical review (G1). NOT signed in the database.** No signing RPC has been run. Every numeric value is from guidelines I could only partly open and carries "verify against source" until the CMO confirms the source was checked. Signing needs: the config row to exist, the independent reviewer's note attached, and a final yes from the founder.

### 4.1 AI copilot acceptable use v1 (S89)
- **May draft:** pre-visit brief, task or order proposal, reply to a patient message, documentation-completeness check, handoff summary.
- **May not:** triage; set or change a dose; write to the record without the clinician's edit and signature; send anything about symptoms, results or medicines; act autonomously; auto-send any message (founder decision).
- Every output is labelled AI-drafted until signed. Deterministic red-flag rules run before any model call (INV-01). Each call site is registered in `ai_systems` and routed through `runGovernedAi()`. `runtime_governed` stays false until a real, human-run evaluation exists; no evaluation, prompt approval or knowledge-source approval is seeded.
- **Shadow mode:** at least 8 weeks AND at least 200 reviewed drafts, whichever is later. The CMO reviews the edit rate and every unsafe-draft report before go-live. A draft that would have been unsafe if signed is logged as an AI safety incident and pauses go-live. Only Tarragon's own measured minutes saved may be quoted, never vendor figures.
- Grounding: WHO Ethics and Governance of AI for Health (2021); WHO guidance on large multimodal models (2024); EU AI Act post-market monitoring (benchmark); ISO 14971; NDPA 2023 automated-decision safeguards; MDCN: responsibility stays with the registered practitioner.

### 4.2 Hypertension care-gap rules v1 (S90)
- **Control target (adult on treatment):** clinic BP below 140/90 by default; home average below 135/85. A clinician may set a stricter individual target (for example below 130/80 for diabetes, CKD, prior stroke or coronary disease, high risk) recorded with name and reason.
- **Trigger for an outreach task and a clinician medicine-review task:** 3 consecutive readings above target on at least 2 different days, OR a 7-day home average above target. Severe readings are never handled here; the existing deterministic red-flag and emergency rules handle them. Rules never change medicines.
- **Cadence:** uncontrolled or newly started: reading every 7 days, review monthly until controlled. Controlled: reading every 14 days, review every 3 months. Annual labs: creatinine/eGFR, urine albumin-to-creatinine ratio, lipids, glucose or HbA1c, electrolytes. Overdue means 7 days past due for a reading, 14 days for a review, 30 days for labs.
- **Risk score:** no PREVENT. Total risk is a clinician judgement recorded on the patient. The WHO 2019 CVD chart guard stays OFF until the coefficients are supplied and signed.
- Notifications name neither the condition nor any reading (INV-07).
- Grounding (verify): Nigeria national hypertension guidelines (2023-2028 edition) and Nigerian Hypertension Society 2020; ISH 2020; WHO 2021; WHO HEARTS; 2025 ACC/AHA noted and deliberately not adopted as the default.

### 4.3 GLP-1 readiness and monitoring protocol v1 (S95)
- **Entry to a doctor conversation:** BMI 30 or above, or 27 or above with a weight-related complication, and only after at least 3 months of the behavioural programme. Not pregnant. Whether to use lower ancestry-specific cutoffs is left to the CMO.
- **Hard stops:** pregnancy or planning pregnancy; personal or family history of medullary thyroid cancer or MEN2; known hypersensitivity.
- **Refer to a doctor before anything else:** prior pancreatitis; gallbladder disease; diabetic retinopathy; eating disorder; kidney disease; insulin or sulfonylurea use; age under 18 or over 75.
- **Monitoring:** weight and BP monthly; GI tolerability; hypoglycaemia checks with insulin or sulfonylureas; review at 3 months; stop-and-review rule; contraception counselling.
- Any initiation, dose or stop is a signed clinician decision by a tier with initiating authority. Tarragon never sources, prices, compounds or delivers the drug. Only NAFDAC-registered product collected from a partner pharmacy; suspected falsified product is reported to NAFDAC.
- Guard `weight_programme_glp1_enabled` ships OFF until a prescriber rota and partner-pharmacy supply route exist.
- Grounding: WHO GLP-1 guideline (1 Dec 2025, conditional); ADA Standards of Care 2026.

### 4.4 Field-nurse visit scope v1 (S93)
- **In scope:** BP, pulse, SpO2, temperature, weight, capillary glucose; sample collection; post-discharge checklist set by a clinician; signed education content. Medicines only on a signed order from a registered prescriber for that patient and visit.
- **Excluded:** injections, wound care, dressings, any invasive procedure, medicine delivery, virtual ward. Injections can be added only by a separate signed amendment once indemnity, sharps handling and adverse-event capture exist.
- Red readings go through deterministic triage and the page ladder. Patient consent is recorded before each visit; the nurse's verified identity is shown to the patient; the nurse gives no clinical advice beyond the signed checklist.
- Off until a contracted nurse partner and SLA exist.
- Grounding: WHO task-shifting recommendations (2012); WHO transitional-care guidance; NMCN scope of practice; MDCN duty of care; NDPA consent.

### 4.5 Diabetes targets and review triggers v1 (S90, S95)
- **Default HbA1c target:** below 7.0 percent; 7.0 to 8.0 percent relaxed for older, frail, hypoglycaemia-prone or limited life expectancy; set per patient by a named clinician with a reason.
- **Triggers (create a medicines-review task, never a dose change):** HbA1c above individual target at the 3-month check; home fasting glucose above 7.2 mmol/L (130 mg/dL) on 3 readings over 7 days; any reading below 3.9 mmol/L (70 mg/dL) creates a same-day review; below 3.0 mmol/L (54 mg/dL) goes to urgent triage via the existing deterministic glucose rules.
- Fingerstick and laboratory HbA1c only (CGM dormant).
- Grounding (verify): ADA Standards of Care 2026; IDF Clinical Practice Recommendations; WHO PEN.

### 4.6 Aggregate reporting and small-cell rule v1 (S90 to S92)
- No aggregate is shown for a group under 10 people (HMO, NGO and other partners); employer reports only for groups of 50 or more enrolled staff. Cells cannot be derived by subtraction. Employers never see reproductive, pregnancy or mental-health data. Individual drill-down is superadmin only (I9). Every partner report is logged.
- Grounding: NDPA 2023 minimisation and sensitive-data rules; statistical-disclosure practice; WHO data-sharing principles.

## 5. Signing procedure for each item (agreed gate)

1. Done: final text and values shown and selected (section 4).
2. Pending: independent clinical reviewer reads the pack and records approval or comments (none named yet). High-risk: 4.1, 4.2, 4.3, 4.5. Medium: 4.4, 4.6.
3. Pending: founder confirms the source documents were checked for every numeric value.
4. Pending: the config row exists (built in S89, S90, S93 or S95) and is registered in the sign-off hub (`GOVERNED_CONFIG_TABLES`, queue, `_signoff-panels`, `CONFIG_PANELS`).
5. Then, and only then, the CMO chat-signing RPC runs after a final founder yes for that specific item.
6. Guards stay OFF until their separate conditions are met. Signing config never flips a guard.

## 6. Additional decisions recorded 2026-10-07

- **Device lab (F8):** Android plus iPhone plus a low-end Tecno/Infinix handset. A naira or dollar cap figure was not given; S88 does not spend until one is written here.
- **Language:** English only at launch; the adding-languages framework (S86) stays ready. PR 984 direction is confirmed.
- **Data residency:** production is in eu-west-1; partner DPAs state that truthfully with documented NDPA transfer safeguards (counsel confirms the mechanism). The doc that says af-south-1 must be corrected.
- **Independent reviewer:** none named yet; approvals are recorded as pending independent review.
- **Still open:** names of the nurse and ambulance partners (F5), the primary read of the TechCabal 2026 report and Reliance pricing (F9), the device-lab cap figure.
