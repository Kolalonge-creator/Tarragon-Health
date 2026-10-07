# Global competitor review for Tarragon Health (October 2026)

Scope: 20 global products/projects reviewed through three lenses (functionality, design/UX, code/tech) for a Nigeria-first chronic-disease and preventive care coordination platform.

## Method and honesty notes

- Sources: public web search results and four public GitHub repo pages (HAPI FHIR, OpenMRS core, OpenEMR, Bahmni core). Search was summarised by the tool; I did NOT open app-store listings, take screenshots, or install any app.
- **Design/UX lens is the weakest.** Almost nothing below about onboarding screens, navigation, notification copy or accessibility was verified from screenshots or store listings. Where a UX row says "not verified", treat it as an open research task, not a finding.
- **Code/tech lens:** only public repos, SDK listings and job posts were used. No private code was inspected. Most commercial products here have no public code.
- Vendor-reported outcomes (Hello Heart, Dario, Sword, Omada, Virta) are marketing or company-funded studies unless noted. Treat as claims.
- Pricing figures are from search snippets and may be stale or US-market only. Nothing here is Nigeria pricing.
- Confidence markers: **H** = from a fetched or multiply-sourced public source; **M** = single search-result source; **L** = inference or not verified.
- This file does not copy vendor text or designs. All descriptions are paraphrased.
- Tarragon context used for fit checks: free app plus a membership, in-app care team (no WhatsApp), Paystack/NGN only, labs and referrals, RPM, hypertension/diabetes pathways, RLS-protected records, AI under a governance registry.

---

## Section A. Chronic-condition and digital-care platforms

### A1. Teladoc Health / Livongo

| Item | Finding |
|---|---|
| Strengths | Scale. Chronic care enrollment 1.17M in Q3 2025 (down 1% year on year, up 4% sequentially) [M]. Livongo pioneered connected-meter plus coaching bundled for employers [L, background knowledge]. |
| Weaknesses | Revenue fell 2% in Q3 2025. Repeated goodwill impairments in 2025 (Catapult Health, Telecare Australia), i.e. acquisitions did not earn their price [M]. BetterHelp users declining. Lesson: a bundle of acquired products is not a coherent care model. |
| Unsuitable for Nigeria | Employer-paid per-member model, US meter-supply logistics, US payer integrations. |
| Clinical safety flags | None found specific to this review. Not verified. |
| Lenses | Functionality: partly verified. Design/UX: not verified. Code: no public repos reviewed. |
| Evidence | https://www.sec.gov/Archives/edgar/data/1477449/000147744925000117/tdoc-20250930xexx991.htm ; https://www.aol.com/articles/teladoc-tdoc-q3-2025-earnings-000537580.html |

### A2. Omada Health

| Item | Finding |
|---|---|
| Strengths | Multi-condition cardiometabolic platform (prediabetes, diabetes, hypertension, cholesterol, MSK, behavioural health) under one care team of coaches plus selected specialists, delivered "within the scope of their credentials" [H, 10-K]. 886,000+ members, 2,000+ customers at 31 Dec 2025 [M]. Added GLP-1 prescribing and a "care companion" track layered on the core curriculum [M]. Sells savings models with independent cost estimates [M, company-funded]. |
| Weaknesses | Outcome and savings numbers are company-commissioned. Coaches are non-prescribers, so doctor access is gated through a separate prescribing step. |
| Unsuitable for Nigeria | PBM and employer distribution, US cash-pay GLP-1 channel, 50-state licensing model. GLP-1 drugs are not a realistic first priority for Nigerian cost structure. |
| Clinical safety flags | Scope-of-credential language is the right pattern. No unsafe practice found. |
| Lenses | Functionality: verified via filings and releases. Design/UX: not verified. Code: none public. |
| Evidence | https://www.sec.gov/Archives/edgar/data/1611115/000162828026015637/omda-20251231.htm ; https://omadahealth.gcs-web.com/news-releases/news-release-details/omada-health-announces-glp-1-prescribing-capability-support |

### A3. Hello Heart

| Item | Finding |
|---|---|
| Strengths | Narrow hypertension focus: connected cuff, medication reminders, daily education tied to readings, shareable reports for providers [M]. Longest published digital hypertension cohort: 28,000+ users over 3 years in JAMA Network Open; reported stage 2 mean systolic drop of 20.9 mmHg among those who stayed engaged [M]. |
| Weaknesses | Result is for users who stuck with the programme (survivorship bias). Observational, not randomised. Company-affiliated authors likely [L]. |
| Unsuitable for Nigeria | Depends on a Bluetooth cuff and a smartphone with data; employer or plan payer. Tarragon already has manual entry as the base path, which is the correct low-connectivity answer. |
| Clinical safety flags | Self-reported or cuff readings with no clinician in the loop on the consumer tier; check how escalation is handled before copying [L]. |
| Lenses | Functionality: partly verified. Design/UX: not verified. Code: none public. |
| Evidence | https://www.healio.com/news/cardiology/20211208/digital-app-helps-adults-achieve-sustained-bp-reduction ; https://www.fiercehealthcare.com/digital-health/mobile-app-lowers-blood-pressure-for-84-stage-ii-hypertension-users |

### A4. Dario

| Item | Finding |
|---|---|
| Strengths | Pocket glucometer that plugs into a phone, multi-condition app, coaching layer. Reported hypertension results: about 70% of users improved BP, about 8 mmHg systolic on average [M]. |
| Weaknesses | Outcomes are company-presented at ADA sessions. Cited subscription tiers ($9.99 to $29.99 a month) come from an aggregator page, not Dario itself [L]. Proprietary strips/hardware lock-in. |
| Unsuitable for Nigeria | Imported proprietary consumables, USD-denominated tiers. Tarragon's 2026-08-02 decision not to sell devices is consistent with this risk. |
| Clinical safety flags | None found. |
| Lenses | Functionality: partly verified. Design/UX and code: not verified. |
| Evidence | https://www.dariohealth.com/metabolic-solutions/ ; https://dariohealth.investorroom.com/2020-06-15-DarioHealth-Presents-New-Studies-Demonstrating-Sustained-Improvements-in-Blood-Glucose-and-Blood-Pressure-Control-in-Users-with-Diabetes-and-Hypertension-at-the-American-Diabetes-Associations-80th-Scientific-Sessions |

### A5. Virta Health

| Item | Finding |
|---|---|
| Strengths | Sells clinical change, not engagement. High-intensity model: screens out riskier patients, connected glucose and ketone tools, frequent check-ins so physicians can deprescribe insulin and other drugs safely [M, analyst]. Prices at about $2,808 year one and $2,388 later, with 100% of fees at risk against clinical outcomes (credits if A1c and medication-elimination targets are missed) [M]. |
| Weaknesses | The diet approach is controversial and the model may be pressured to loosen standards at scale [M]. Savings claims are company analysis. |
| Unsuitable for Nigeria | Very low-carb protocol needs cultural and food-staple adaptation (rice, yam, garri, cassava). Ketone testing supplies are costly. |
| Clinical safety flags | Insulin and sulfonylurea deprescribing must be physician-supervised with frequent glucose data. Do not copy without a signed protocol. |
| Lenses | Functionality: partly verified. Design/UX and code: not verified. |
| Evidence | https://www.mobihealthnews.com/news/virta-health-announces-risk-based-pricing-controversial-diabetes-management-platform ; https://www.virtahealth.com/press/virta-health-puts-100-of-fees-at-risk-with-announcement-of-new-pricing-structure ; https://sacra.com/research/virta-health |

### A6. Sword Health

| Item | Finding |
|---|---|
| Strengths | AI-guided exercise with motion-sensor feedback plus licensed physical therapist oversight; 24/7 access to a PT, short sessions; reports 55% of MSK members surgery-free and 3:1 ROI (independent analysis cited by company) [M]. Human-in-the-loop AI framing. |
| Weaknesses | Hardware kit shipped to members; MSK, not Tarragon's core. |
| Unsuitable for Nigeria | Tablet and sensor shipping, English-only video coaching assumptions. |
| Clinical safety flags | None found. |
| Lenses | Functionality: partly verified. Design/UX and code: not verified. |
| Evidence | https://swordhealth.com/newsroom/thrive-digital-physical-therapy ; https://en.wikipedia.org/wiki/Sword_Health |

### A7. Cityblock Health

| Item | Finding |
|---|---|
| Strengths | Community health partners (non-clinical locals) in the care team beside clinicians; modalities mixed (video, phone, SMS, in-home). Reported nearly 20% inpatient utilisation reduction in a behavioural health programme (NEJM per search summary; **not independently confirmed**) [M]. |
| Weaknesses | Medicaid-capitated US model; high-touch and human-intensive. |
| Unsuitable for Nigeria | Direct reuse not possible, but the principle maps to Nigeria's CHEW task-shifting. Note: Tarragon rejected capitation (I8). |
| Clinical safety flags | None found. |
| Lenses | Functionality: partly verified. Design/UX and code: not verified. |
| Evidence | https://www.chcs.org/resource-center-item/return-on-health-telehealth-cityblock-health-complex-care-coordination/ ; https://www.ama-assn.org/practice-management/digital-health/return-health-telehealth-case-study-complex-care-coordination |

### A8. Medisafe

| Item | Finding |
|---|---|
| Strengths | Persistent reminders that continue until the dose is confirmed; "Medfriend" notifies a family member or caregiver on a missed dose; 90+ measurement trackers; drug-interaction warnings; import medications from a pharmacy; enterprise SDK and Care Connector for pharma and providers [M]. |
| Weaknesses | Consumer value is adherence only; revenue depends on pharma partnerships [L]. |
| Unsuitable for Nigeria | Pharmacy import depends on US pharmacy data networks. Interaction database licensing is a cost. |
| Clinical safety flags | Interaction warnings need a licensed, maintained drug database; a stale one is a safety risk. |
| Lenses | Functionality: partly verified. Design/UX and code (SDK only): not verified. |
| Evidence | https://medisafe.com/medisafe-app-becomes-first-to-add-import-from-pharmacy-capability-in-latest-effort-to-break-down-health-system-barriers ; https://intuitionlabs.ai/software/patient-education-engagement/medication-adherence-apps/medisafe |

### A9. mySugr

| Item | Finding |
|---|---|
| Strengths | Customisable logging screen (remove or add fields per therapy), analytics for pattern spotting, printable or shareable reports, Apple Health and Google Fit compatibility [M]. |
| Weaknesses | Owned by Roche/Accu-Chek, so it is tied to that device ecosystem [L]. |
| Unsuitable for Nigeria | Ecosystem tie; some features gated by country and medical-device regulation. |
| Clinical safety flags | Insulin-dose logging should not drive dosing advice without regulatory clearance. |
| Lenses | Functionality: partly verified. Design: not verified. Code: none public. |
| Evidence | https://www.accu-chek.com/apps-and-software/mysugr-app ; https://www.adces.org/danatech/apps-dtx/find-apps-tools/product-detail/mysugr |

### A10. Pear Therapeutics / Better Therapeutics (cautionary)

| Item | Finding |
|---|---|
| Strengths | FDA-cleared prescription digital therapeutics proved a regulatory pathway exists. |
| Weaknesses | Pear: Chapter 11 in April 2023, $12.7M revenue vs $75.5M net loss, assets sold for about $6M, 92% layoffs; only about 10 states plus a few plans reimbursed. Lesson: clinical clearance without a paying customer is not a business [M]. |
| Unsuitable for Nigeria | Reimbursement-dependent. |
| Lessons for Tarragon | Charge for human clinical time that someone demonstrably pays for (matches Tarragon's membership and per-service pivot). Do not build revenue on a software-only prescription product. |
| Lenses | Functionality and business: verified from trade press. Others n/a. |
| Evidence | https://medtech.citeline.com/MT147939/Pear-Bankruptcy-Filing-Highlights-Difficult-Challenges-Facing-Digital-Therapeutics ; https://www.managedhealthcareexecutive.com/view/what-does-pear-therapeutics-bankruptcy-mean-for-pdts- |

---

## Section B. Consumer-access and AI-triage platforms

### B1. Ro

| Item | Finding |
|---|---|
| Strengths | Asynchronous visit: patient completes a dynamic intake, a doctor reviews later, "always open". Custom in-house EMR. Ro publishes research on async vs sync side effects [M]. |
| Weaknesses | Product mix is consumer-demand driven (weight, sexual health). Async needs a robust intake or it misses red flags. |
| Unsuitable for Nigeria | US pharmacy fulfilment; compounded-drug controversies are US-specific. |
| Clinical safety flags | Async-only is unsafe for acute undifferentiated symptoms without a red-flag front gate (Tarragon's triage engine plays this role). |
| Lenses | Functionality: verified at summary level. Design/UX: not verified. Code: no public repos reviewed. |
| Evidence | https://ro.co/research/10pm-doctor-visit/ ; https://ro.co/research/comparable-rates-side-effects-found-with-treatment/ |

### B2. K Health

| Item | Finding |
|---|---|
| Strengths | AI chat gathers symptoms, then hands to a clinician; white-label with health systems (Cedars-Sinai app) [M]. |
| Weaknesses | I could not verify clinical outcomes or study details. The search did not return the Cedars-Sinai study the prompt implied; do not cite one. |
| Unsuitable for Nigeria | Large US health-system partner integration. |
| Clinical safety flags | AI diagnosis disclosure and clinician sign-off must be explicit. Tarragon already requires governed AI. |
| Lenses | Functionality: weak verification. Design/code: not verified. |
| Evidence | https://www.techtarget.com/virtualhealthcare/news/366596905/Cedars-Sinai-Expands-Virtual-Care-Access-with-New-mHealth-App |

### B3. Ada Health

| Item | Finding |
|---|---|
| Strengths | Published a vendor-run comparison of 8 apps in BMJ Open: Ada correct condition in top 3 about 71% vs about 38% average; gave a suggestion 99% of the time [M, vendor-authored]. A Swahili-language evaluation in a Tanzanian district hospital (AFYA study) is the closest public precedent for local-language, low-resource validation [M]. ED study: 70% sensitivity for at least one final diagnosis in its top 5 [M]. |
| Weaknesses | Accuracy is mid-range at best (about 70%); not a diagnosis tool. The headline study is by Ada authors. |
| Unsuitable for Nigeria | Not validated on Nigerian disease prevalence (malaria, sickle cell) as far as I could verify [L]. |
| Clinical safety flags | Any symptom checker must be validated locally before patient-facing release. |
| Lenses | Functionality: verified at summary level. Design/code: not verified. |
| Evidence | https://about.ada.com/?p=6297 ; https://mhealth.jmir.org/2022/9/e38364 ; https://ada.com/help/how-accurate-is-adas-assessment |

### B4. Babylon Health (collapse lessons)

| Item | Finding |
|---|---|
| Strengths | Reached large patient volume (about 100,000 NHS GP practice patients) [M]. |
| Weaknesses and lessons | Lost almost all of a $4.2B valuation; UK business put up for sale August 2023. A 2020 BMJ study reported about 50% condition coverage and about 30% diagnostic accuracy for its triage; the "beats GPs" claim rested on a small non-peer-reviewed test; CQC reported delayed responses to urgent symptoms and weak AI oversight in 2022 [M, one secondary source]. |
| Unsuitable for Nigeria | Fixed-price capitated NHS contract model. |
| Clinical safety flags | Highest-confidence anti-pattern: marketing AI superiority before independent validation. Tarragon's rule to avoid "doctor-led" overclaiming and to register every AI call site is the right guardrail. |
| Evidence | https://www.digitalhealth.net/2023/08/babylon-looks-to-sell-uk-business-amid-bankruptcy-fears/ ; https://dx.doi.org/10.1136/bmj.l2387 ; https://vibegraveyard.ai/story/babylon-chatbot-exam-claims/ |

### B5. Doctolib

| Item | Finding |
|---|---|
| Strengths | Scheduling-first marketplace plus practitioner software; teleconsultation, messaging, patient notifications [M]. Stack per job posts: Rails, PostgreSQL, Redis, React; multiple daily deploys, 25K+ automated tests [M, recruiting pages, low authority]. |
| Weaknesses | I did not find public confirmation of open-source releases. Not verified. |
| Unsuitable for Nigeria | Regulated French/German health-data hosting model; not directly transferable. |
| Lenses | Functionality: weak verification. Design: not verified. Code: stack only from job posts. |
| Evidence | https://medium.com/doctolib (engineering blog; **not opened**) ; job posts via https://welcometothejungle.com/fr/companies/doctolib |

### B6. Zocdoc

| Item | Finding |
|---|---|
| Strengths | Free for patients; providers pay per new patient booking, with free practice tools [M]. Per-outcome pricing aligns incentives. |
| Weaknesses | Marketplace depends on insurance data. |
| Unsuitable for Nigeria | Insurance-based search; thin provider schedule data. |
| Lenses | Functionality: verified at summary level only. Design and code: not verified. |
| Evidence | https://www.zocdoc.com/about/newpricing |

### B7. One Medical (Amazon)

| Item | Finding |
|---|---|
| Strengths | Membership ($199 a year, $99 for Prime) covers on-demand and async virtual care plus navigation and referral management [M]. Direct precedent for Tarragon's membership model. |
| Weaknesses | Physical clinics (Tarragon owns none). |
| Unsuitable for Nigeria | Price point and clinic network. |
| Evidence | https://onemedical.com/membership/ ; https://kffhealthnews.org/MTc3MjA0Nw |

### B8. MyChart / Epic

| Item | Finding |
|---|---|
| Strengths | Records, results, appointment scheduling, e-check-in, secure messaging, telehealth; proxy access lets one account manage family members; FHIR-based open APIs [M]. |
| Weaknesses | Tied to hospital deployments; patient experience varies by health system. |
| Unsuitable for Nigeria | Epic licensing, hospital-led. |
| Lenses | Functionality: verified at summary level. Design: not verified. Code: none public (FHIR spec and sandbox are public but not reviewed). |
| Evidence | https://intuitionlabs.ai/software/radiology-workflow-informatics/patient-communication-portals/epic-mychart ; https://www.mindbowser.com/epic-database-access |

### B9. Oura / Whoop (consumer wearables)

| Item | Finding |
|---|---|
| Strengths | Whoop's Blood Pressure Insights drew an FDA warning letter in July 2025 (marketed as wellness, FDA said device); closed out June 2026; Whoop selected for CMS ACCESS programme [M]. Shows wellness-vs-medical positioning matters. |
| Weaknesses | Wellness estimates are not clinical measurements. |
| Unsuitable for Nigeria | High device cost, subscription in USD. |
| Clinical safety flags | Tarragon already badges wearable readings "Wearable estimate". Keep it. |
| UX | Readiness-score design was not verified; search did not return it. |
| Evidence | https://9to5google.com/2025/08/14/whoop-blood-pressure-fda/ ; https://www.mddionline.com/wearable-medical-devices/fda-backs-down-on-whoop-blood-pressure-monitoring-dispute |

---

## Section C. Open-source health software (code ideas)

| Project | License (fetched) | What it offers | Use for Tarragon | Caution |
|---|---|---|---|---|
| HAPI FHIR | Apache 2.0 [H] | Java FHIR client and server framework | Reference for FHIR resource shapes and validators for the existing `/api/v1/fhir/import` work; Apache license is the most permissive. | Java; use as a validator or reference, not a runtime dependency in a TS stack. |
| OpenMRS core | MPL 2.0 with health disclaimer [H] | Modular EMR with concept dictionary, built for resource-limited settings | Concept-dictionary idea for coded observations; module model. | MPL file-level copyleft; Java. Use ideas, not code. |
| Bahmni (core) | License file present, type not shown in my fetch; a separate search source states AGPL v3 [M] | OpenMRS plus Odoo plus OpenELIS bundle; 500+ implementations in 50 countries [M] | Lab workflow reference (OpenELIS), field-proven in Africa. | AGPL is strong copyleft; do not copy code into the platform without legal review. |
| OpenEMR | GPL 3.0 [H] | PHP EHR, practice management, FHIR compliance | Billing and scheduling flows as a reference only. | GPL; reading for ideas is fine, copying code is not. |

Lenses: only licenses and one-line descriptions were verified. I did not read source trees for architecture. Offline-first claims for OpenMRS came from a single search summary [L].

---

## Section D. Nigeria and low-connectivity fit checks

- A Lagos pilot used pharmacists to measure BP and counsel, with cardiologists enrolling and remotely monitoring patients for a monthly fee (BMC Health Services Research, 2018) [M]. Evidence: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6277995/
- Nigeria's National Hypertension Control Initiative lets CHEWs treat uncomplicated hypertension and uses a mixed paper plus DHIS2 data flow [M]. Same source family.
- Common unsuitability across Section A: USD pricing, imported devices, employer or insurer payers, constant data connectivity.

---

## Ranked list: 15 most valuable ideas for Tarragon

Ordering weighs expected patient benefit, safety, fit with existing Tarragon decisions, and evidence strength. "Verify" means a Tarragon pilot or clinical sign-off is needed before commitment. None is a build instruction; each needs an owner decision.

| # | Idea | Source and evidence | Fit with Tarragon | Confidence |
|---|---|---|---|---|
| 1 | **Do not claim AI accuracy before independent local validation; publish validation method.** Gate any symptom-checker claim behind a locally run, independently reviewed study. | Babylon BMJ 2020 and CQC 2022 findings; Ada AFYA Tanzania protocol as a local-validation model. https://dx.doi.org/10.1136/bmj.l2387 ; https://mhealth.jmir.org/2022/9/e38364 | Reinforces existing AI governance registry and triage-engine gate. | H |
| 2 | **Escalating missed-dose reminders plus a nominated family contact notified in-app** (Medfriend pattern), without relying on any single send succeeding. | Medisafe. https://intuitionlabs.ai/software/patient-education-engagement/medication-adherence-apps/medisafe | Fits Care Circle and the in-app inbox; SMS stays paging/verification only. | M |
| 3 | **Outcome-linked pricing for the 12-week chronic programme**: credit or partial refund when a pre-agreed clinical target (for example BP control) is not met. | Virta put 100% of fees at risk. https://www.virtahealth.com/press/virta-health-puts-100-of-fees-at-risk-with-announcement-of-new-pricing-structure | Fits membership model; needs founder, finance and CMO decision and careful target definition (avoid perverse incentive to screen out sicker patients, which Virta itself does). | M |
| 4 | **Screen-in criteria and frequent check-ins before deprescribing** (insulin or sulfonylurea). Only enrol patients a protocol deems safe; require dense glucose data. | Virta high-intensity model (analyst description). https://sacra.com/research/virta-health | Fits diabetes pathway. Needs CMO signed protocol. Do not build without sign-off. | M |
| 5 | **Task-shifted community partner in the care team**: a local non-clinical community health partner for outreach and logistics beside doctors. | Cityblock; Nigeria NHCI CHEW task shifting. https://www.chcs.org/resource-center-item/return-on-health-telehealth-cityblock-health-complex-care-coordination/ | Matches Care Coordinator tier; consistent with the founder principle that coordinators are a scaling lever, not a gate. | M |
| 6 | **Pharmacy-based BP check points feeding remote monitoring**: pharmacists measure and log BP; doctors review remotely. | Lagos pharmacy mHealth pilot. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6277995/ | Solves "no home cuff" and low-trust-in-device issues; extends partner network. Needs a partner agreement and device-validation policy. | M |
| 7 | **Customisable logging fields per therapy** to cut data-entry burden. | mySugr. https://www.accu-chek.com/apps-and-software/mysugr-app | Small UI win for low-end phones; manual entry is already the base path. | M |
| 8 | **Printable or shareable clinician-ready reports** for visits with outside doctors. | mySugr, Hello Heart. https://www.healio.com/news/cardiology/20211208/digital-app-helps-adults-achieve-sustained-bp-reduction | Fits referral and handoff categories; works offline when exported. | M |
| 9 | **Proxy access for family members managed from one account** (already served by profile access; confirm UX parity). | MyChart proxy access. https://www.mindbowser.com/epic-database-access | Existing consent graph covers it; reinforce category-scoped access, never copy older RLS shapes for reproductive data. | M |
| 10 | **Async intake with a hard red-flag gate in front** so a doctor reviews later without missing emergencies. | Ro async model. https://ro.co/research/10pm-doctor-visit/ | Matches existing triage engine and in-app care messages. Verify red-flag coverage on local conditions. | M |
| 11 | **Keep wearable data labelled as estimates and avoid diagnostic claims**; take regulatory positioning seriously. | Whoop FDA warning letter 2025, closed 2026. https://www.mddionline.com/wearable-medical-devices/fda-backs-down-on-whoop-blood-pressure-monitoring-dispute | Already done; add a copy review checklist for any new metric. | H |
| 12 | **Hybrid paper plus digital data capture for community programmes** that sync when connectivity returns. | Nigeria NHCI uses paper registers plus DHIS2. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6277995/ | Fits offline-first; evidence is about national programme design, not a product Tarragon can copy. | L |
| 13 | **Per-outcome partner pricing (pay only on a booked or completed referral)** for specialist and lab partners. | Zocdoc pays per new patient booking. https://www.zocdoc.com/about/newpricing | Fits partner economics; check the never-sell-below-partner-cost triggers. | L |
| 14 | **Use HAPI FHIR (Apache 2.0) as a validator or reference for FHIR import tests; use Bahmni/OpenELIS as a lab-workflow reference only.** | Licenses fetched from GitHub. https://github.com/hapifhir/hapi-fhir ; https://github.com/openmrs/openmrs-core | Low-risk engineering reuse; legal review needed before borrowing from AGPL or GPL projects. | H (licenses), L (benefit) |
| 15 | **Publish outcomes with full-cohort denominators**, not only engaged users (Hello Heart's headline result is among those who stayed engaged). Also keep one coherent care model rather than bolt-ons (Teladoc's goodwill impairments). | https://www.healio.com/news/cardiology/20211208/digital-app-helps-adults-achieve-sustained-bp-reduction ; https://www.sec.gov/Archives/edgar/data/1477449/000147744925000117/tdoc-20250930xexx991.htm | Fits outcomes reporting and trust positioning. | M |

---

## Flags (clinical safety or unsuitable for Nigeria)

1. Unvalidated AI triage or diagnosis (Babylon). Do not copy marketing claims.
2. Insulin or drug deprescribing without signed protocols and dense monitoring (Virta pattern).
3. Wellness-device blood pressure estimates marketed as clinical (Whoop warning letter).
4. Employer, PBM, or insurer-funded distribution and US pharmacy or meter logistics (Teladoc, Omada, Hello Heart, Dario, Ro).
5. Imported proprietary consumables and USD subscriptions (Dario, Whoop).
6. Dependence on constant data and smartphones: always keep manual and offline-tolerant entry.
7. Drug-interaction warnings need a licensed, maintained database (Medisafe pattern).
8. Copyleft code (AGPL, GPL) must not be copied into proprietary code without legal review.

## What could not be verified

- Any app-store listing, screenshot, onboarding flow, notification copy, accessibility behaviour or navigation for any product. The whole design/UX lens remains open.
- Livongo-specific current features and pricing (search returned only Teladoc totals).
- K Health clinical evidence; Doctolib open-source projects; Oura readiness UX; Cityblock NEJM result (single secondary source).
- Pricing for Omada, Hello Heart, Sword and Cityblock.
- Source code architecture of OpenMRS, Bahmni, OpenEMR or HAPI FHIR beyond license and one-line description; Bahmni's license type was not stated in my fetch (AGPL v3 comes from a search source).
- All outcome numbers are vendor-reported unless stated.
