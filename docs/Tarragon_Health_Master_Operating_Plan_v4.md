# Tarragon Health — Master Operating Plan (v4)

**Status:** Unified plan, Revision 2. Merges the original Master Plan + Build Guide v3 (Stack A, 5 Business Categories, capital-efficient sequencing) with the Continuous Care Operating Model draft (7 Pillars, Continuous Care Loop, tiered investigations, tiered escalation, pharmacy scope separation). Revision 2 replaces the simple "doctor-primary" clinical model with a full doctor-tier ladder, and adds fully built-out Phase 2 and Phase 3 roadmaps so build work does not need to stop to ask what comes next.

Decisions locked as of this revision:
- **Clinical model:** 5-tier doctor ladder (Section 4), not nurse-led, not a flat "doctor reviews everything."
- **Non-clinical layer:** a Care Coordinator role is retained beneath Tier 1 doctors for pure logistics — it never makes a clinical judgment.
- **Staffing model:** Tiers 1–3 (Medical Officer grades) are employed. Tier 4 (Senior Registrar) and Tier 5 (Partner Specialist) are contracted/roster-based.
- **Structure:** 5 Business Categories remain primary; the 7 Pillars are nested inside them.
- **Phase 2 trigger:** metric-based gate, not a calendar date (exact thresholds in Section 14).

This document supersedes the original Master Plan and sits above the Build Guide v3 (technical sequencing) and CLAUDE.md (day-to-day build rules). Where this document changes a decision from those documents, this document is authoritative and those documents should be updated to match — see Section 16.

---

## 1. Executive Summary

Tarragon Health is Nigeria's digital-first chronic disease, preventive health, and family care coordination operating system.

It is not a generic telemedicine app, a clinic chain, a hospital, a pharmacy, or a diagnostics marketplace. Tarragon sits above existing healthcare infrastructure as the trusted coordination layer between patients, families, doctors, care coordinators, laboratories, pharmacies, specialists, employers, HMOs, hospitals, and — eventually — public health partners.

The problem Tarragon solves is not access to doctors. It is lack of continuity. Patients see doctors episodically; nobody consistently monitors their blood pressure, blood sugar, medication adherence, labs, refills, symptoms, and care gaps between visits. Tarragon fixes this by running every patient through one perpetual cycle rather than treating each interaction as a standalone event.

**Consumer-facing promise:** Trusted health monitoring for you, your parents, and your loved ones.
**Internal / institutional description:** A continuous, technology-enabled preventive and chronic care operating system for Africa, starting in Nigeria.

---

## 2. The Tarragon Continuous Care Loop

Everything Tarragon does feeds one cycle. No pathway sits outside it.

```
Patient Joins Tarragon
        ↓
Comprehensive Health Assessment
        ↓
Risk Stratification
        ↓
Personalised Care Programme + Individual Care Plan
        ↓
Monitoring Begins
        ↓
Clinical Review (doctor-tier ladder, Section 4)
        ↓
Diagnostics · Medication · Lifestyle Intervention · Referral
        ↓
Patient Support (adherence, coaching, family updates)
        ↓
Outcome Measurement
        ↓
Care Plan Optimisation
        ↓
Repeat Forever
```

---

## 3. Core Company Definition

| Item | Decision |
|---|---|
| Company name | Tarragon Health |
| Core identity | Nigeria's digital-first chronic disease, preventive health, and family care coordination operating system |
| Primary market | Nigeria first (urban/semi-urban patients, families, employers, HMOs, diaspora payers); wider Africa is the Phase 3 destination |
| First wedge | Hypertension, diabetes, ParentCare, medication adherence, preventive screening, lab coordination, pharmacy refills |
| Operating model | Digital-first, **tiered-doctor-led clinical review**, Care Coordinator-supported, partner-enabled, protocol-driven, outcome-focused |
| What Tarragon is building | A coordination platform for chronic disease monitoring, preventive health, family updates, medication adherence, lab and pharmacy coordination, specialist referral, corporate/HMO population health, and outcome evidence |
| What Tarragon is not | A generic telemedicine app, hospital, clinic chain, pharmacy, lab, or diagnostics marketplace |
| Revenue model | Subscriptions, family plans, premium ParentCare, diaspora payments, lab/pharmacy commissions, device bundles, corporate contracts, HMO contracts, hospital discharge monitoring, future population insights |
| Long-term ambition | Become the trusted chronic disease, preventive health, and family care coordination infrastructure for Nigeria, then other African markets |

---

## 4. Clinical Operating Model — The Doctor Tier Ladder

**Principle:** every clinical judgment is made by a doctor. No case is ever closed by non-clinical staff. Cases move up the ladder only as far as their complexity requires — most stay at Tier 1 or 2. This replaces both "nurse-led" (too little clinical authority at the point of contact) and a flat "doctor reviews everything" (too expensive and doesn't reflect how Nigerian clinical seniority actually works).

### Roles

| Role | Who | Employment | Responsibility |
|---|---|---|---|
| **Care Coordinator** | Non-clinical staff (health coach / trained admin) | Employed | Logistics only: check-in calls/WhatsApp threads, adherence and missed-reading tracking, lab/refill booking, data collection. Never interprets a result, never adjusts medication, never closes a clinical escalation — routes anything requiring judgment to Tier 1. |
| **Tier 1 — Medical Officer, <3 yrs experience** | Junior doctor | Employed | First-line clinical review of routine readings and stable chronic-disease follow-up, under protocol. Confirms/continues existing stable prescriptions per protocol. Escalates anything outside protocol to Tier 2. |
| **Tier 2 — Medical Officer, 3+ yrs experience** | Mid-level doctor | Employed | Routine medication initiation and dose adjustment, standard escalation review, handles what Tier 1 flags. At pilot scale, may double as Tier 3 (see Section 14 staffing plan). |
| **Tier 3 — Senior Medical Officer** | Experienced doctor | Employed | Complex chronic-disease case management, multi-drug regimen management, QA/spot-audit of Tier 1 and Tier 2 decisions, escalation point for Tier 2. Formalised as a distinct hired role once pilot volume justifies it (Phase 2 trigger, Section 14). |
| **Tier 4 — Senior Registrar** | Senior clinical authority | Contracted / roster (part-time retainer initially) | Pre-referral virtual consults, final internal clinical authority, sets referral urgency and approves referrals, owns and updates clinical protocols, supervises/trains Tiers 1–3, reviews specialist-initiated medication changes when a patient returns to Tarragon's care. |
| **Tier 5 — Partner Specialist** | External specialist (cardiology, endocrinology, nephrology, etc.) | Contracted, referral-only, per-consult | Complex/procedural input only, telemedicine-first where clinically appropriate. Hands routine follow-up back to Tarragon's Tier 3/4 once the specialist question is answered (shared care). |

### Escalation flow (a case climbs only as far as it needs to)

```
Care Coordinator (logistics only — no clinical judgment)
        ↓
Tier 1 (routine, in-protocol)
        ↓  escalates if outside protocol
Tier 2 (medication start/change, standard escalation)
        ↓  escalates if complex
Tier 3 (complex chronic disease, QA oversight)
        ↓  escalates if referral may be needed
Tier 4 Senior Registrar (pre-referral consult, referral decision, protocol authority)
        ↓  only if referred
Tier 5 Partner Specialist (referral-only, telemedicine-first)
        ↓  routine follow-up handed back
Tier 3/4 resumes ongoing management
```

### Pharmacy authority by tier
(Full pathway detail in Section 8.)

| Tier | Prescribing authority |
|---|---|
| Care Coordinator | None — logistics/adherence tracking only |
| Tier 1 | Confirms/continues existing stable prescriptions under protocol; no new prescribing |
| Tier 2 | Initiates new medications, adjusts doses for standard chronic disease per protocol |
| Tier 3 | Manages complex/multi-drug regimens, resolves adherence-driven therapy failures |
| Tier 4 | Approves before specialist referral; reviews and reconciles specialist-initiated changes |
| Tier 5 (Partner Specialist) | Prescribes complex/specialist-only medications during the referral episode |

**Placeholder staffing ratios** (starting assumptions only — to be recalculated from real time-per-case data collected during the pilot, per Open Decision in Section 15):

| Tier | Indicative panel/coverage at pilot scale (100 patients) |
|---|---|
| Tier 1 | 1 doctor per ~150–250 active patients (multiple Tier 1 doctors share pilot coverage across shifts) |
| Tier 2 | 1 doctor oversees ~3–5 Tier 1 doctors' escalations |
| Tier 3 | At pilot scale, folded into Tier 2's own escalation capacity — not separately hired until Phase 2 trigger is met |
| Tier 4 | Part-time retainer (a few hours/week) — sufficient at 100-patient scale; converts to larger contract as referral volume grows |
| Tier 5 | Engaged case-by-case, no retainer needed at pilot scale |

---

## 5. The Five Business Categories (primary structure)

| Category | What it is | Pillars nested inside |
|---|---|---|
| **1. Chronic Disease Management** | Hypertension, diabetes, obesity-related risk, kidney risk, cardiovascular risk (core wedge); CKD, asthma, heart failure, COPD, stroke follow-up in Phase 3 | Pillar: Clinical Care |
| **2. Preventive Medicine** | Age/risk-based screening, annual health checks, care gap detection | Pillar: Diagnostics (Section 6) |
| **3. Care Coordination** | Labs, pharmacy, specialist referrals, hospital handoffs | Pillars: Treatment, Care Coordination (Sections 7–8) |
| **4. B2B & Institutional** | Corporate wellness, HMO capitation, government/NHIA contracts | Pillar: Population Health & Analytics |
| **5. Platform Infrastructure** | WhatsApp/SMS engine, doctor-tier dashboards, patient record, partner API layer, AI/analytics | Pillars: Patient Access & Engagement, Patient Support |

Cutting across all five: a **Clinical Governance Layer** (Section 9) — no patient interaction bypasses it.

---

## 6. Investigations & Diagnostics Pathway

### Tier 1 — Scheduled Monitoring (Phase 1 · pilot-ready · ~70–80% of all tests)
Default experience. Chronic disease patients automatically receive investigations per evidence-based guidelines (diabetes: HbA1c every 3 months, UACR/eGFR/lipids/retinal screening yearly; hypertension: U&E/eGFR every 6–12 months, urine dipstick + lipids yearly, ECG every 2–3 years). Platform calculates due dates, sends reminders, books at a partner lab, shows expected cost, receives results, flags abnormals, updates the dashboard. Fully automated.

### Tier 2 — Doctor-Requested Investigations (Phase 1 · pilot-ready)
A Tier 2+ doctor orders additional tests during review (e.g. FBC, CRP, ferritin, B12 for worsening diabetes). Patient notified, chooses a lab, pays, attends. Results return to the ordering doctor's tier dashboard.

### Tier 3 — Patient-Initiated Wellness Testing (**Phase 2 — metric-gated**)
Curated self-order catalogue (cholesterol, glucose, HbA1c, liver/kidney profile, vitamin D, HIV, hepatitis B/C, cervical screening, PSA with counselling, FBC, thyroid, urinalysis), each with plain-language explanations of what it measures, who it's for, its limitations, and when clinician review is recommended. Ships once the Phase 2 metric gate (Section 14) is hit.

### Never patient-orderable, at any tier or phase
CT, MRI, PET, colonoscopy, endoscopy, echocardiography, cardiac stress tests, autoimmune panels, tumour markers, coagulation studies, genetic testing (until the Phase 3 genetic testing programme exists, and even then only doctor-initiated).

### Result triage (all tiers, all phases)

| Flag | Meaning | Action |
|---|---|---|
| Green | Normal | Dashboard updates, next monitoring date scheduled, no clinician action |
| Amber | Needs review within a few days | Routed to Tier 1/2 worklist |
| Red | Urgent | Immediate Tier 2+ notification; same-day escalation up the ladder as needed |

Results are always shown with previous value, current value, target, trend, and a plain-language recommendation — never a bare number.

### Phase 2 additions
- Disease-specific investigation bundles (Diabetes Annual Review, Hypertension Annual Review, Women's Preventive Screen, Executive Health Check)
- Home sample collection via partner network

---

## 7. Specialist Referral & Escalation Model

Maps directly onto the doctor-tier ladder in Section 4. Levels 1–4 are pilot-ready; Level 5's full *matching engine* is Phase 2 (informal specialist relationships still work in Phase 1 — see below).

| Level | What happens | Phase |
|---|---|---|
| **1. Rules engine triage** | Every result auto-classified green/amber/red before any human sees it | Phase 1 |
| **2. Tier 1 review** | Routine, in-protocol readings and follow-up | Phase 1 |
| **3. Tier 2/3 review** | Medication decisions, standard-to-complex escalation, QA oversight | Phase 1 (Tier 2 and 3 may be the same person at pilot scale) |
| **4. Tier 4 Senior Registrar — pre-referral consult + referral decision** | Short virtual consult to rule out a benign explanation before referring; sets urgency (routine/priority/urgent); attaches clinical summary, history, meds, labs, and a specific clinical question | Phase 1 (part-time retainer) |
| **5a. Informal specialist access** | 2–3 specialist partners engaged directly in Lagos/Abuja for the pilot, case-by-case, no automated matching | Phase 1 |
| **5b. Full specialist-matching engine** | Nationwide network searchable by specialty, state, telemedicine/in-person availability, HMO acceptance; telemedicine-first; automated referral-status pipeline (Abnormal Result → Awaiting Review → Referral Approved → Finding Specialist → Booked → Completed → Treatment Plan Received → Monitoring Continues); waitlist + interim management plan when no specialist is available | Phase 2 (metric-gated) |
| **5c. Shared-care handback formalised** | After the specialist consult, routine management responsibility returns to Tier 3/4 automatically, tracked in the record | Phase 2 |

---

## 8. Medication & Pharmacy Pathway

**Governing principle:** Tarragon coordinates medication management. It never prescribes and never dispenses. Licensed doctors (per their tier's authority, Section 4) prescribe; licensed pharmacies dispense.

### Six stages

| Stage | Owner |
|---|---|
| 1. Assessment | Tarragon platform + patient + Care Coordinator (data collection) |
| 2. Clinical decision | Tier 2+ doctor (or Tier 5 specialist, in shared care) |
| 3. Prescription | Tier 2+ doctor / Tier 5 specialist (licensed prescriber) |
| 4. Dispensing | Licensed partner pharmacy |
| 5. Monitoring (adherence, reminders, side-effect check-ins) | Care Coordinator, with Tier 1 doctor spot-review |
| 6. Medication review (scheduled, per condition) | Tier 2/3 doctor, or Tier 4 when reconciling a specialist-initiated change |

### Responsibility matrix

| Activity | Care Coordinator | Tier 1 | Tier 2/3 | Tier 4 | Tier 5 (Specialist) | Pharmacy |
|---|---|---|---|---|---|---|
| Monitor chronic disease | ✓ | ✓ | ✓ | | | |
| Diagnose | | | ✓ | ✓ | ✓ | |
| Prescribe (new/change) | | | ✓ | ✓ (approval) | ✓ | |
| Confirm/continue stable prescription | | ✓ | | | | |
| Dispense | | | | | | ✓ |
| Medication reminders / adherence tracking | ✓ | | | | | |
| Side-effect reporting intake | ✓ | ✓ | ✓ | | ✓ | |
| Medication counselling | ✓ (general education) | ✓ | ✓ | | ✓ | ✓ |
| Drug interaction alerts (automated) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Supply medication | | | | | | ✓ |

### Workflow notes
- **New medication:** Tier 2+ doctor decides treatment, issues e-prescription → patient picks pharmacy (collection or delivery, delivery is Phase 2) → pharmacy verifies and dispenses → Care Coordinator starts adherence check-ins (Day 3, Week 2, Month 1, Month 3, tied to the condition's review schedule) → Tier 1 spot-reviews.
- **Medication change:** Tier 2+ doctor stops the old prescription, issues the new one; pharmacy only ever sees the active prescription; full history stays in the longitudinal record.
- **Specialist-initiated changes:** Tier 5 specialist uploads a consult summary; record and monitoring schedule update automatically; Tier 3/4 reconciles and resumes ongoing management.
- **Refills:** Tier 1 confirms stable refills under protocol (Day 23 of a 30-day supply triggers a reminder → patient confirms → Tier 1 protocol-check → pharmacy fulfils). Never a fully silent auto-refill with zero clinical touch.
- **Safety checks:** automatic interaction, duplicate-therapy, pregnancy, renal-dosing, age, and allergy checks support — never replace — doctor judgment at whichever tier is reviewing.
- **Scheduled medication reviews per condition:** hypertension every 6 months (Tier 2/3), diabetes every 3 months (Tier 2/3), heart failure monthly then quarterly once stable (Tier 3, Phase 3 condition), asthma every 6 months, COPD every 3–6 months (both Phase 3 conditions).
- **Linked lab monitoring:** metformin → kidney function 6–12 monthly; ACE inhibitor → kidney function + potassium after initiation/dose change; statin → LFTs when indicated; warfarin → INR (Phase 3). Auto-created off the medication record.

### Phase 2 additions
- Medication delivery via partner logistics network (currently collection-only in Phase 1)
- Delivery status tracking surfaced to patient and, where consented, family

---

## 9. Clinical Governance Layer

Sits across all five categories; no patient interaction bypasses it.

- Clinical protocols and evidence-based guidelines per condition, per doctor tier (what each tier is and isn't authorised to decide)
- Clinical decision support tooling, tier-appropriate (e.g. Tier 1 sees protocol checklists; Tier 4 sees full referral-authoring tools)
- Prescribing and referral governance mapped to the tier ladder (Section 4, Section 8)
- Doctor credentialing and licensing verification per tier, including MDCN registration checks
- Incident reporting, audit, and quality improvement — includes Tier 3's QA/spot-audit function over Tiers 1–2 as a standing process, not an ad hoc one
- NDPR / data governance and consent management
- AI oversight — any AI-generated triage, summary, or education content is reviewed against these protocols before reaching a patient or influencing a doctor's decision
- Clinical risk management and safeguarding processes
- Documentation standard: every note, escalation, tier handoff, and instruction is recorded against the patient's longitudinal record

---

## 10. Master Patient Journey

| Stage | What happens |
|---|---|
| 1. Acquisition | Sign-up via employer, HMO, referral, family invitation, or direct |
| 2. Consent | Monitoring, communication, data use, and family-access consent captured |
| 3. Onboarding | Medical/medication/allergy/family history, emergency contact, baseline vitals and symptoms captured |
| 4. Risk stratification | Risk engine scores the patient; health score generated |
| 5. Programme assignment | Preventive / lifestyle optimisation / clinical monitoring / disease-specific / corporate / HMO programme assigned |
| 6. Care plan creation | Tier 2+ doctor sets goals, lab schedule, medication plan, monitoring schedule, follow-up schedule |
| 7. Monitoring | Patient logs symptoms/vitals; Care Coordinator tracks adherence and missed readings |
| 8. Clinical review | Case enters the tier ladder (Section 4) at the level its complexity requires |
| 9. Intervention | Telemedicine consult, lab/imaging request, medication change, referral, or lifestyle modification |
| 10. Outcome measurement | Symptom/lab/BP/HbA1c/weight/adherence/satisfaction check against goals |
| 11. Optimisation or maintenance | Goals met → maintenance programme; goals not met → care plan optimised, monitoring continues |
| 12. Family update | Consented summary sent to family dashboard |
| 13. Repeat | Cycle continues indefinitely |

---

## 11. Partner Ecosystem

| Partner type | Role | Phase |
|---|---|---|
| Labs | Test booking, result upload, abnormal flagging | Phase 1 |
| Pharmacies | Prescription validation, dispensing, counselling | Phase 1 |
| Specialist consultants | Referral-only input, informal in Phase 1, full network in Phase 2 | Phase 1 (informal) → Phase 2 (network) |
| Hospitals | Urgent referral, post-discharge monitoring | Phase 1 referral; discharge-monitoring contracts Phase 2 |
| Home-visit providers | Sample collection, frail-patient support | Phase 2 |
| Pharmacy delivery/logistics partners | Medication delivery | Phase 2 |
| Device/wearable manufacturers | BP monitors, glucometers, scales — API/Bluetooth integration | Phase 2 |
| Physiotherapy / rehab providers | Referral pathway | Phase 3 |
| Ambulance / emergency transport | Emergency escalation pathway | Phase 3 |
| Employers | Staff enrolment, corporate wellness | Phase 2 |
| HMOs | Member monitoring, capitation | Phase 2 |
| Diaspora groups | ParentCare distribution, overseas payments | Phase 1 |
| NHIA / government / public health agencies | Population screening, chronic disease registries | Phase 3 |

Each partner integrates through standardised APIs where available, manual upload where not, SLAs, clinical governance standards, and performance metrics.

---

## 12. Business Model, Pricing, Packages, Platform Modules

Unchanged from the existing Master Plan and Build Guide v3. Reference:
- Revenue streams, pricing logic, service packages (Individual/Family + Business) — Master Plan §7, §16, §17
- Free product / 90-Day Health Reset trial strategy — Master Plan §8
- Platform modules, Stack A architecture, 7-sprint/16-week build sequence — Build Guide v3
- Launch gates, pilot success metrics, outcome evidence engine — Master Plan §24–25, §27

**Required update to those documents:** every reference to "nurse dashboard" / "nurse review" / "nurse escalates to doctor" is superseded by the Section 4 tier ladder. The former Nurse/Clinician Dashboard becomes the **Care Coordinator workspace** (worklist, adherence tracking, booking, non-clinical outreach only); a new **Tier 1–4 Doctor Dashboard** (role-gated views of the same underlying worklist, scoped by tier authority) becomes the primary clinical workspace.

---

## 13. Phase 2 Build Plan (post-pilot, metric-gated — see Section 14 for the gate)

Organised by business category so it plugs directly into the existing sprint/category structure.

### Category 1 — Chronic Disease Management
- Formalise Tier 3 (Senior Medical Officer) as a distinct hired role once volume justifies it
- Refine chronic-disease protocols using pilot outcome data

### Category 2 — Preventive Medicine
- Tier 3 patient-initiated wellness testing catalogue + safeguard/education content (Section 6)
- Investigation bundles: Diabetes Annual Review, Hypertension Annual Review, Women's Preventive Screen, Executive Health Check
- Home sample collection via partner network

### Category 3 — Care Coordination
- Full specialist-matching engine: nationwide network, specialty/state/availability/HMO filters, telemedicine-first automation
- Automated referral-status pipeline visible to patient (Section 7, Level 5b)
- Shared-care handback formalised in the record (Section 7, Level 5c)
- Waitlist + interim management plan workflow for no-specialist-available cases
- Medication delivery via partner logistics network (Section 8)
- Hospital discharge/post-admission monitoring contracts

### Category 4 — B2B & Institutional
- Employer dashboard: staff enrolment, anonymised population risk reports, chronic disease metrics
- HMO dashboard: member monitoring, risk stratification, care gap tracking, outcome reporting
- First corporate wellness contracts sold using pilot outcome data
- First HMO capitation conversations

### Category 5 — Platform Infrastructure
- Premium ParentCare tier: dedicated coordinator, scheduled Tier 2+ doctor review, quarterly family report
- AI assistant v1: summarisation, patient education content generation, Care Coordinator/doctor worklist prioritisation, admin automation. **Not** autonomous clinical decision-making — every output stays inside the Section 9 governance review.
- Mobile app (React Native) as a first-class channel alongside WhatsApp/web
- Partner API layer opened for lab/pharmacy integrations that move beyond manual upload
- Device/wearable Bluetooth + API integration for BP monitors, glucometers, scales already on the market
- Geographic expansion beyond Lagos/Abuja to additional cities (per existing Year 2 sequencing)

---

## 14. Phase 2 Trigger — Metric Gate

Phase 2 build items unlock once pilot data clears these thresholds (placeholder numbers — finalise once pilot is running and real data exists; this is the mechanism, not a locked number):

| Metric | Placeholder threshold |
|---|---|
| Validated lab partners | ≥3, each hitting ≥90% turnaround-time SLA |
| Validated pharmacy partners | ≥3, each hitting agreed fulfilment SLA |
| 90-day patient retention (pilot cohort) | ≥70% |
| Abnormal (red-flag) result review SLA | ≥95% reviewed within 4 hours of flagging |
| Referral loop closure | ≥2 referral cases successfully closed (referred → seen → shared-care handback documented) |
| Payment reliability | Subscription payment success rate ≥90%, failed-payment recovery process working |

Once these are hit, Category-by-category Phase 2 items in Section 13 can begin, prioritised by whichever unlocks the most immediate revenue or safety value first (recommended order: specialist-matching engine and HMO/employer dashboards ahead of Tier 3 self-order testing, since the former have direct revenue paths and the latter carries the most incremental regulatory/legal review).

---

## 15. Phase 3 Build Plan (Year 2–5, scale)

### Category 1 — Chronic Disease Management
- Expand conditions: CKD, asthma, heart failure, COPD, stroke follow-up, anticoagulation monitoring, frailty monitoring, post-discharge/readmission-reduction programmes

### Category 2 — Preventive Medicine
- Genetic testing pathway (doctor-initiated only, with genetic counselling partnership)
- Broader cancer/infectious-disease screening expansion as lab partner network matures

### Category 3 — Care Coordination
- Full named subspecialty coverage across all major Nigerian regions
- Positioning shift toward a "virtual multidisciplinary care network": specialists define which conditions they support remotely, referral criteria, availability, and follow-up protocols directly in the platform
- Ambulance/emergency transport and physiotherapy/rehab partner integration

### Category 4 — B2B & Institutional
- NHIA / state government population screening and chronic disease registry contracts
- Scaled HMO and corporate contracts using multi-year outcome evidence
- Anonymised population insights product for pharma, insurance actuaries, and public health bodies (data monetisation revenue stream)

### Category 5 — Platform Infrastructure
- National scale across Nigeria, then Pan-African expansion
- Full Population Health & Analytics pillar maturity: disease registry, predictive analytics, provider performance dashboards, clinical audits, research platform
- Deepen AI: population-level predictive risk modelling (building on the existing Python ML service's SCORE2/HbA1c-trajectory work), always human-in-the-loop per Section 9 governance
- Tarragon-branded remote monitoring devices, moving beyond third-party device integration
- Legal, compliance, and fundraising documentation matured for institutional-scale partners

---

## 16. Open Decisions Still Requiring Founder Input

1. **Exact doctor-tier panel ratios.** Section 4's numbers are placeholders. Recalculate from real time-per-case data once the pilot is running.
2. **Tier 4/5 contract terms.** Define the actual retainer structure (hours/week, per-consult rate) for the Senior Registrar and the specific commercial terms for Partner Specialists.
3. **Re-run pilot unit economics** against the tiered staffing model in Section 4 — materially different cost curve from the original flat nurse-led assumption.
4. **Finalise Phase 2 gate numbers** (Section 14) — the thresholds listed are a reasonable starting framework, not a commitment; adjust once early pilot weeks produce real numbers.
5. **MDCN / regulatory confirmation** that the Tier 1–4 authority split in Section 4 (e.g., Tier 1 confirming refills, Tier 2 initiating new medications) is compliant as designed — recommend a compliance review before this becomes the operating protocol nurses/doctors work from.

---

## 17. Required Updates to Other Documents

- **CLAUDE.md:** replace nurse-led language with the Section 4 tier ladder; update "Current Sprint" business-rule references to Care Coordinator + Tier 1–4 doctor dashboards.
- **Build Guide v3 (sprint plan):** Sprint scope covering "nurse dashboard" build tasks should be re-scoped to the Care Coordinator workspace plus a tier-gated doctor dashboard (role-based views over one underlying worklist, not five separate dashboards).
- **Supabase schema:** add `doctor_tier` (enum: care_coordinator, tier_1, tier_2, tier_3, tier_4_senior_registrar, tier_5_partner_specialist) to the clinician/staff table; add `escalation_level` (1–5) to the escalation/review tables to track where a case sits on the Section 7 ladder; add `investigation_tier` (1/2/3) to the lab-order table to track which investigations pathway (Section 6) a test came through, since Tier 3 doesn't exist yet but the field should exist from Phase 1 so Phase 2 doesn't require a migration.

---

## 18. Final Statement

Tarragon Health is the operating system for chronic disease prevention, monitoring, family care, and health coordination in Nigeria — built on a tiered-doctor clinical model that mirrors how Nigerian medical seniority actually works, organised around five business categories with a seven-pillar clinical operating detail nested inside them, running every patient through one continuous care loop, with a metric-gated path from a 100-patient Lagos/Abuja pilot through to national and eventually Pan-African scale.
