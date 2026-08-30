# Tarragon Health — Full Platform Specification v4
### Competitive Intelligence-Enhanced Build Spec
*Builds on Master Plan, Build Guide v3 (Stack A), and Master Brand Package v2. Where those documents conflict with this one, Stack A and Brand Package v2 remain authoritative on architecture and voice — this document only adds a feature layer.*

---

## 0. Purpose

Every category Tarragon competes in already has a well-funded, proven winner: Function Health and Omada in the US, Livongo (sold to Teladoc for $18.5B), Virta, Simple in emerging markets. None of them are built for Nigeria. This document takes the best mechanic from each — the thing that made them win — and maps it into Tarragon's existing five-category architecture, WhatsApp-first and clinician-led, without breaking the 16-week build or the capital-efficiency posture.

The goal isn't to copy features. It's to take the *pattern that drove retention, trust, or ACV* in each company and localize it.

---

## 1. What Tarragon Health Is (unchanged)

Nigeria's digital-first chronic disease, preventive health, and family care coordination operating system — the trusted layer between patients, families, labs, pharmacies, doctors, HMOs, employers, and hospitals. Wedge: hypertension + diabetes. Everything below is additive to that core, not a pivot.

---

## 2. The Five Categories — What's Existing vs. What's New

### 2.1 Category 1 — Chronic Disease Management

| Existing | New (this spec) | Inspired by |
|---|---|---|
| BP, glucose, medication adherence, HTN/diabetes/obesity/CKD/CVD risk | **Connected device sync** — Bluetooth BP cuffs & glucometers auto-push readings instead of manual WhatsApp entry (WhatsApp stays as fallback, never removed) | Livongo — hardware-integrated data collection was the core of an $18.5B exit |
| Vitals-only monitoring | **Symptom & mood tracking** — daily symptoms, pain, fatigue, breathlessness, logged via WhatsApp for amber/red patients | Common chronic-platform capability set |
| Care plan per condition | **"Heart Age" and condition-specific sub-scores** feeding the Health Score (see 4.3) | Hello Heart |
| Roadmap-only: asthma, CKD, heart failure | **Respiratory module brought forward to Phase 3**: peak flow logging + inhaler adherence, concrete data model below | Propeller Health (smart-inhaler prediction of exacerbations) |
| HMO capitation contracts | **Optional fee-at-risk contract structure** for clinical programs, sitting under Category 4 but designed here | Virta Health — outcomes-based pricing strengthens the ROI story for HMOs |

### 2.2 Category 2 — Preventive Medicine

| Existing | New | Inspired by |
|---|---|---|
| Cancer, metabolic, infectious, reproductive screening; Annual Health Check | **Broaden `screen_types`** to include vision, hearing, dental, osteoporosis, and vaccination reminders — near-zero marginal cost since the screening engine is already generic by age/sex/frequency | Common preventive-platform capability list; NHS App |
| Screening reminders as a list | **Personalized Health Timeline** — reframe from "Book your PSA" to "You're due in 3 months" / "Your mammogram is overdue" — a copy and UI change, not a new system | NHS App |
| screening_results, abnormal flagging | **Health Score / biological age** shown on the patient dashboard, computed from screening + vitals + lab data | Function Health, Superpower, Hello Heart |
| Annual Health Check bundle (₦60–65K) | **"Full Panel" premium AHC tier** — more biomarkers than the standard bundle, sold as an ADD-ON per the existing 4-label pricing system | Function Health (comprehensive biannual biomarker testing) |
| — | **Whole-body imaging referral (MRI)** — partner-coordinated, BOOK & PAY, restricted to Premium ParentCare / diaspora / Corporate Gold tiers | Prenuvo |
| — | **Microbiome/nutrition testing — Phase 3 flag only**, not built now | Viome |

### 2.3 Category 3 — Care Coordination

| Existing | New | Inspired by |
|---|---|---|
| Lab booking, pharmacy fulfilment, specialist referral, hospital handoff | **Care Navigation directory** — a patient-facing "find near me" view (labs, pharmacies, vaccination centres, specialists) with maps, distinct from the transactional booking flow that already exists | Common capability list — most winning platforms separate *discovery* from *booking* |
| Booking driven by clinician/AI schedule only | **Location-triggered clinician outreach** for diaspora premium patients when a connected wearable shows an anomalous recovery/strain pattern (Phase 3, premium tier only) | Oura, WHOOP |

### 2.4 Category 4 — B2B & Institutional

| Existing | New | Inspired by |
|---|---|---|
| HMO capitation (₦2–6K/member/month) | **Outcomes-based / fee-at-risk contract option** alongside flat capitation — Tarragon earns more when it demonstrably prevents claims | Virta Health |
| Corporate wellness, opt-in enrolment | **Full-population employer distribution model** — corporate contracts that auto-enrol the whole workforce rather than relying on elective sign-up, widening the funnel per employee per month | Included Health / One Medical — win on distribution, not novelty |
| Outcome Evidence Engine (internal) | **Published, shareable outcome reports** (quarterly "state of workforce health," anonymised) used in BD conversations the way peer-reviewed studies are used by Omada | Omada Health — 25+ studies is a sales asset, not just internal QA |

### 2.5 Category 5 — Platform Infrastructure

| Existing | New | Inspired by |
|---|---|---|
| WhatsApp/SMS engine, clinician workflow, AI clinical decision, patient record, partner API, analytics | **Device/wearable integration layer** — Apple Health, Oura, WHOOP, Garmin, Fitbit, plus Bluetooth BP cuffs, glucometers, smart scales | Oura, WHOOP, Apple Health, Livongo |
| Weekly AI care messages | **Daily AI Health Coach** — WhatsApp-delivered nutrition, exercise, sleep, stress, and smoking-cessation coaching, Nigerian-food-aware | Lark Health, Superpower's 24/7 concierge, Omada's behaviour-change engine |
| — | **Health Score engine** — new Python ML model, detailed below | Function Health, Superpower |

### 2.6 Cross-Cutting Guardrail — Clinician-Originated Orders

A patient must never be able to self-purchase an ad hoc lab test or a brand-new medication straight out of a catalogue with no clinical judgment involved — every transactional booking in Category 3 has to trace back to either the platform itself (a genuinely due, age/sex/frequency-driven screening) or a named clinician. This applies retroactively to the Care Coordination build (lab/pharmacy self-service catalogues), not just future work, since credibility and clinical safety are core to the platform's positioning against every competitor in §3 below.

| Order type | Self-service (patient) | Requires a clinician |
|---|---|---|
| Lab test | Only a bundle matching a currently-due `screening_schedule` (booked from the Personalized Health Timeline / preventive screening calendar) | Any other catalogue test — clinician generates the order directly (`ordered_by` set) |
| Medication | Refilling a medication a clinician already added (`medications.source = 'clinician'`) | Any new/never-prescribed medication — a clinician adds it to the patient's medication list first, which is what unlocks self-service refill |
| Specialist referral | Never patient-initiated | Always clinician/trigger-created — unchanged, this was already the correct pattern and is the model the other two now follow |

Enforcement is a database trigger plus RLS, not a UX convention — `lab_orders`/`pharmacy_orders` gained an `ordered_by` column (→ `clinical_staff`) and a `BEFORE INSERT` trigger that rejects any row that isn't either tied to a valid due screening/prescribed medication or explicitly clinician-attributed. A patient literally cannot construct a row that bypasses this by calling the API directly; it isn't just a hidden button. Where the patient-facing catalogue can no longer self-book (ad hoc lab tests, non-prescribed medications), the UI stays informational (browsable, priced) with a prompt to message the care team, rather than disappearing outright — per §11's guardrail below, this is a deliberate credibility/safety decision, not scope creep.

---

## 3. Competitive Map — What Tarragon Takes From Whom

| Company | Their edge | What Tarragon borrows |
|---|---|---|
| Function Health | Comprehensive biomarker testing made accessible | Full Panel AHC tier, biomarker trend visualisation |
| Superpower | Biological age score, 24/7 AI concierge, price/UX | Health Score, daily AI coach |
| Omada Health | Clinical evidence + payer trust from 25M+ coaching interactions | Published outcome reports as a B2B sales asset |
| Livongo (→ Teladoc, $18.5B) | Hardware-integrated data collection at scale | Bluetooth device sync for BP/glucose |
| Virta Health | Outcomes-based/fee-at-risk pricing | Optional fee-at-risk HMO contract structure |
| Hello Heart | Cardiovascular focus, "Heart Age" | Heart Age as a Health Score component |
| Oura / WHOOP | Passive monitoring, high engagement | Wearable integration layer (diaspora/premium tier) |
| NHS App | Population preventive care, plain-language reminders | Personalized Health Timeline, broadened screen types |
| Simple / NiaHealth | Radical simplicity and reach in LMIC / outside major cities | Validates Tarragon's existing WhatsApp-first, clinician-led model — no change needed, but confirms the thesis |
| Propeller Health | Smart-inhaler exacerbation prediction | Respiratory module (Phase 3, matches existing asthma roadmap item) |
| Included Health / One Medical | Distribution through employer/payer channels | Full-population corporate enrolment model |
| Hinge Health | Disease-specific digital care done excellently | Candidate future category: MSK (Phase 3, not committed) |
| Prenuvo | Early detection via whole-body imaging | Premium MRI referral add-on |
| Viome | AI-personalised nutrition from microbiome | Long-term roadmap flag only |

**Tarragon's structural edge over all of the above:** none of them are clinician-led, WhatsApp-native, or priced for the Nigerian market. That combination — not any single feature — is the moat. Every addition below has to survive contact with that constraint or it doesn't ship.

---

## 4. Gap Analysis Against the Ten Preventive-Platform Capabilities

| Capability | Tarragon status | Action |
|---|---|---|
| 1. Health Risk Assessment | Have (onboarding) | None needed |
| 2. Preventive Screening Engine | Have | Broaden screen_types (vision, hearing, dental, osteoporosis, vaccination) |
| 3. Personalized Health Timeline | Partial | UX/copy change — "due in 3 months" framing |
| 4. Reminders | Have | None needed |
| 5. Wearable Integration | **Missing** | New — Phase 3, diaspora/premium only |
| 6. Laboratory Integration (trends, AI explanation) | Have | Add explicit historical trend charts to lab result view |
| 7. Health Score | **Missing** | New — build rule-based v1 in Sprint 4 |
| 8. Coaching | Partial (weekly AI messages exist) | Upgrade to daily WhatsApp coach — Phase 2 |
| 9. Care Navigation | Partial (booking exists) | Add discovery/maps layer — Phase 2 |
| 10. Population Analytics | Have | Extend with cost-savings projections for HMO pitch |

## 4.1 Gap Analysis Against the Six Chronic-Platform Capabilities

| Capability | Tarragon status | Action |
|---|---|---|
| Remote Monitoring | Have (manual WhatsApp entry) | Add Bluetooth device sync — Phase 2 |
| Medication Management | Have | None needed |
| Symptom Tracking | **Missing** | New — add in Sprint 2, cheap |
| Care Team Communication | Have | None needed |
| Escalation | Have (4h SLA, AbnormalResultHandler) | None needed |
| AI Decision Support | Have (ML risk models) | Extend with Health Score + coaching recommendations |

---

## 5. New Data Model Additions

| Table | Purpose | Key fields |
|---|---|---|
| `health_scores` | Composite health/biological age score, recomputed monthly | patient_id, score_date, overall_score, heart_age, metabolic_age, components (JSON), model_version |
| `symptom_logs` | Daily patient-reported symptoms | patient_id, symptom_type, severity, notes, logged_at |
| `wearable_connections` | Which device/service a patient has linked | patient_id, provider (apple_health/oura/whoop/garmin/fitbit/bp_cuff/glucometer/scale), status, external_id, connected_at |
| `wearable_readings` | Raw synced data from connected devices | connection_id, reading_type, value, unit, recorded_at, source |
| `respiratory_readings` | Phase 3 — asthma/COPD module | patient_id, peak_flow, inhaler_used, symptom_flag, recorded_at |
| `care_navigation_directory` | Discovery layer for labs/pharmacies/vaccination centres/specialists | organisation_id, lat, lng, hours, services_offered, verified |
| `outcomes_contracts` | Fee-at-risk / outcomes-based B2B contract terms | organisation_id, contract_type (capitation/fee_at_risk/flat), outcome_thresholds (JSON), payout_terms |

All new tables inherit the existing rules: `organisation_id` filtering, RLS at the Postgres level, no exceptions.

---

## 6. New WhatsApp Bot Flows

- **Daily coaching bot** (opt-in) — one nutrition/exercise/sleep/stress/smoking tip per day, aware of Nigerian food guidance already in the Brand Guide.
- **Symptom check-in bot** — daily "how are you feeling today?" for amber/red-risk patients only, not the full base.
- **Wearable digest bot** — weekly steps/sleep/recovery summary, diaspora/premium tier only.
- **Care navigation bot** — patient shares WhatsApp location, receives nearest verified lab/pharmacy/vaccination centre.

Every one of these follows the existing non-negotiable rule: if it can't work over WhatsApp, it doesn't ship as a patient-facing feature.

---

## 7. Python ML Service — Additions

| New model | What it does |
|---|---|
| `app/models/health_score.py` | Combines CVD risk, HbA1c trajectory, screening compliance, BP control rate, BMI, and smoking status into a 0–100 score plus Heart Age and Metabolic Age. v1 can be rule-based/weighted-sum before any ML is needed. |
| `app/models/coaching.py` | Selects the day's coaching topic based on the patient's current data gaps (e.g., no BP reading in 5 days → coaching nudges toward logging, not generic content). |
| `app/routers/wearables.py` | Ingests structured wearable data and folds it into the existing risk/combined prediction endpoints. |

Same rules apply as the rest of the ML service: stateless, no DB access, 5-second timeout with graceful fallback, X-Service-Key auth.

---

## 8. Where This Fits in the Build — Now vs. Later

The 16-week build and solo-founder capital efficiency don't get renegotiated for this. Almost everything above is Phase 2/3.

### Ships inside the existing 16-week build (near-zero marginal cost)
- Broadened `screen_types` (vision, hearing, dental, osteoporosis, vaccination) — seed data only, Sprint 1
- Symptom tracking — small addition to the vitals module, Sprint 2
- Personalized Health Timeline framing — copy/UX change, Sprint 2 & Sprint 7
- Health Score v1 (rule-based, not ML) — computed alongside the existing risk scores, Sprint 4

### Phase 2 — Months 4–9, post-pilot, funded by pilot data or a small raise
- Bluetooth device sync (BP cuff, glucometer)
- Daily AI coaching bot
- Care Navigation directory with maps
- Fee-at-risk HMO contract structure
- Full-population employer enrolment model
- Published outcome evidence reports

### Phase 3 — Year 2+, once 100,000+ patient records exist
- Full wearable ecosystem (Apple Health, Oura, WHOOP, Garmin, Fitbit) — diaspora/premium only
- Respiratory/asthma-COPD module
- Whole-body imaging (MRI) referral partnerships
- Microbiome/nutrition testing
- MSK/physiotherapy as a possible sixth category

This mirrors the same principle already governing the monorepo-split decision: defer complexity until the cost of deferring clearly exceeds the cost of building. Nothing here is added to `CLAUDE.md`'s current-sprint scope without an explicit sprint update.

---

## 9. Pricing Implications

All new features route through the existing 4-label transparency system (INCLUDED, BOOK & PAY, FREE ELSEWHERE, ADD-ON) — no new pricing framework needed.

- Health Score, Personalized Timeline, symptom tracking, broadened screening types → **INCLUDED** in existing tiers, since they cost little to serve and raise engagement/retention.
- Full Panel AHC, whole-body MRI referral → **ADD-ON**, gated to Premium ParentCare / diaspora / Corporate Gold.
- ~~Bluetooth devices → sold as **device bundles**~~ **SHELVED 2026-08-02** — patient self-sources their own device instead; see CLAUDE.md's Device & Wearable Integration section for why (NAFDAC local-representative burden, not worth it pre-revenue).
- Daily AI coaching, wearable digests → **INCLUDED** for paid tiers once built; never offered as part of the free 90-Day Health Reset, consistent with the existing "what should not be free" rules (nothing that implies active clinical responsibility).

---

## 10. Updated Differentiation Table

| Competitor type | Their edge | Tarragon's counter |
|---|---|---|
| Function Health / Superpower | Comprehensive testing, biological age, slick UX | Same score concept, Nigerian pricing, WhatsApp delivery — not app-only |
| Omada / Livongo | Payer trust via clinical evidence, hardware data | Clinician-led + published local outcome data, device sync without requiring app literacy |
| Virta | Outcomes-based pricing | Same contract structure, offered to Nigerian HMOs first — no one else there does this |
| Simple / NiaHealth | LMIC simplicity and reach | Tarragon already is this, plus a wider category footprint (prevention + chronic + B2B in one platform) |
| Oura / WHOOP / Apple | Passive wearable engagement | Positioned as diaspora/premium add-on, not the core product — avoids the device-cost barrier that makes wearables inaccessible to most Nigerian patients |
| Hinge Health / Propeller | Disease-specific excellence | Both flagged as future category candidates, not built prematurely |

---

## 11. Guardrail

This document exists to make sure competitor research turns into a prioritized backlog, not scope creep. Four items ship now. The rest wait for the founding-patient pilot to prove retention, conversion, and outcomes before a line of code is written for them. `CLAUDE.md`'s "Current Sprint" section is the only place a Claude Code session should take instructions from — this document informs the roadmap, it doesn't override the sprint file.

---

## 12. Population Health Intelligence & National Health Infrastructure (Long-Horizon Vision)

Everything in §§1–11 above is Phase 1–3 — a multi-year but still recognisably product-shaped roadmap, gated on the founding-patient pilot. This section is a different order of magnitude: it's where Tarragon stops being a healthcare application and starts being health infrastructure a country runs on. It requires patient volume in the hundreds of thousands, real regulatory relationships (NDPC, MDCN/NMCN, potentially government health programmes), and governance structures that don't exist yet even as drafts. **None of §12 is scheduled. None of it should be built, scaffolded, or given a data model without an explicit founder ask** — it sits behind the same guardrail as the specialist-matching engine and Employer/HMO risk dashboards in `docs/Tarragon_Health_Master_Operating_Plan_v4.md`, just further out. It's recorded here because the five-category architecture (`CLAUDE.md` → "The Business") is deliberately built so this remains possible later, not because any of it is coming next.

### 12.1 Purpose
Transform aggregated clinical and operational data into population-level intelligence. The question this layer exists to answer: *what is happening to the health of the population, where are the gaps, and what interventions actually improve outcomes?*

### 12.2 Population segmentation
Segment by geography, age, care programme, risk tier, disease, engagement, and service utilisation — subject to whatever privacy and legal constraints apply at the time (NDPC registration is still an open item; see CLAUDE.md's standing follow-ups).

### 12.3 Population risk map
```
Population
   │
   ├── Low risk       62%
   ├── Moderate       25%
   ├── High risk      10%
   └── Very high       3%
```

### 12.4 Disease surveillance
Trend monitoring across hypertension, diabetes, cardiovascular disease, kidney disease, obesity, relevant infectious diseases, and preventive screening uptake.

### 12.5 Geographic health intelligence
E.g. "Region A has high hypertension prevalence but low screening access" — a finding that could inform provider recruitment, mobile screening deployment, laboratory partnerships, or employer programme targeting.

### 12.6 Care-gap intelligence
```
Patients eligible for screening   100,000
Screened                           61,000
Gap                                 39,000
```

### 12.7 Intervention intelligence
Measure which intervention actually worked, not just which ran:
```
Intervention A → medication adherence +8%
Intervention B → medication adherence +2%
Intervention C → no meaningful change
```

### 12.8 Population programme management
A named example, e.g. a national BP programme:
```
Identify population → Screen → Risk stratify → Enroll → Treat → Monitor → Measure outcomes
```

### 12.9 Public/private partnerships
Potential eventual partners: employers, healthcare systems, insurers, NGOs, development organisations, public-health programmes — each subject to its own legal, clinical, and data-governance review; none currently pursued.

### 12.10 Population outcome dashboard
```
HYPERTENSION PROGRAMME
Enrolled            500,000
Monitoring          420,000
Controlled          310,000
Uncontrolled         90,000
Lost to follow-up    40,000
```

### 12.11 Health economics
Eventually measurable: cost per patient, cost per controlled patient, cost per prevented event, healthcare utilisation, programme ROI.

### 12.12 Predictive population analytics
Potential forecasts: disease burden, capacity requirements, specialist demand, laboratory demand, medication demand.

### 12.13 Resource planning
```
Projected cardiology demand   ↑ 32%
Current capacity              ↓ 15%
Gap                             17%
Action: recruit network specialists
```

### 12.14 Research infrastructure
With appropriate governance, de-identified research datasets for epidemiology, outcomes research, health services research, and clinical research.

### 12.15 Clinical trials infrastructure
Long term, and only with appropriately governed research partners, Tarragon could help identify potentially eligible trial participants from its patient base.

### 12.16 Real-world evidence
```
Treatment → real-world patient outcome
```
Tracked over time, this becomes an evidence platform in its own right.

### 12.17 Population-level AI
Potential uses: risk prediction, demand forecasting, care-gap detection, pathway optimisation. Any model here would need the same validation/governance discipline the platform already applies to clinical AI — see the ML Service rules in `CLAUDE.md` (stateless, no direct DB access) and the doctor-tier authority model, neither of which this layer gets to bypass.

### 12.18 Health inequality analysis
Identify disparities in access, screening, treatment, and outcomes. The purpose is to reduce gaps, not merely describe them.

### 12.19 National-scale architecture
```
                  TARRAGON
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
      PATIENTS     PROVIDERS     PAYERS
        │            │            │
        └────────────┼────────────┘
                     ▼
             NATIONAL NETWORK
                     │
                     ▼
              HEALTH INTELLIGENCE
```

### 12.20 Acceptance criteria
At full maturity, this layer should be able to answer: What is happening? Why is it happening? Where is the problem? Who needs intervention? What intervention works? Did the intervention improve outcomes?

**Guardrail (applies to all of §12):** this section is a north star, not a backlog. It does not get a Phase 2/Phase 3 date the way §8 does, because it depends on scale and regulatory relationships Tarragon doesn't have yet. No table, migration, dashboard, or API in this section gets built off this document alone — it needs a founder ask at the time, the same as any other Phase-2/3+ item this file or `CLAUDE.md` gates.

---

## 13. Tarragon Infrastructure as a Service & Population Health Contracts (Long-Horizon Vision)

Same order of magnitude as §12, and the same non-scheduled status — but a different axis. §12 is about what Tarragon can *learn and show* once it has population-scale data. This section is about a different *customer and business model*: instead of Tarragon holding the patient relationship directly (today's model — patient or employer/HMO pays for a Tarragon-branded plan), an institution that already has its own doctors and patients pays Tarragon to run the digital infrastructure underneath them.

### 13.1 The shift in who the customer is
Today's business (`CLAUDE.md` → "The Business") sells care to patients, and sells patient populations to employers/HMOs as a channel. Infrastructure-as-a-Service instead sells the platform itself to an organisation that keeps its own doctors, patients, and brand:

```
Hospital
HMO
Employer
Clinic
Laboratory
Pharmacy
Government programme
       │
       ▼
TARRAGON PLATFORM
```

Concretely, a hospital with doctors and patients already in place but poor digital infrastructure could run its operations on Tarragon's:
- appointment infrastructure
- care management
- patient engagement
- remote monitoring
- referral management
- laboratory integration
- pharmacy integration
- AI assistance
- population analytics

The hospital pays Tarragon a platform/infrastructure fee. This is a healthcare-technology-infrastructure business, not a healthcare-delivery business — much closer to what `docs/Tarragon_Health_Master_Operating_Plan_v4.md` §16's Protocol API note gestures at (a stateless clinical API for licensee organisations), except broader: not just the clinical decisioning layer, but the whole operational stack (scheduling, messaging, device ingestion, lab/pharmacy integration, dashboards) white-labelled or co-branded under someone else's front door.

**This is architecturally a large step past the Protocol API, not an extension of it.** The Protocol API is stateless and takes patient data in the request body per `CLAUDE.md`'s Python service rules — it never becomes the system of record. Running a hospital's *appointment infrastructure, care management, and patient engagement* means Tarragon's multi-tenant Postgres becomes another organisation's primary patient record store, under its own `organisation_id`, with its own staff logging in as `clinical_staff`/`profiles` rows. That is a fundamentally different trust boundary (a second organisation's clinical liability, a second organisation's regulatory relationship with MDCN/NDPC, potentially a second organisation's own BAA-equivalent data processing agreement) than anything shipped or planned in §§1–12. Nothing about `private.is_org_staff()`, RLS-by-`organisation_id`, or the doctor-tier ladder needs to change in principle — multi-tenancy is already the platform's foundation — but the *scale of blast radius per tenant* (an entire hospital, not one patient) means this needs its own security/contracting review before a single table is touched, not just a founder "yes."

### 13.2 Revenue Engine: Population Health Contracts
Potentially the largest long-term opportunity, and the commercial expression of §12's analytics layer: an organisation contracts Tarragon to manage a defined population (the example used in discovery was 500,000 people). Tarragon is paid based on some combination of:
- population size
- services provided
- outcomes
- programme performance

Potential customers: appropriately structured employers, HMOs, insurers, healthcare networks, public-health organisations, and development programmes. This moves Tarragon toward **Population Health as a Service** — the commercial packaging of the population-programme-management loop already sketched in §12.8 (identify → screen → risk stratify → enroll → treat → monitor → measure outcomes), sold as an outcomes/services contract rather than run as Tarragon's own product.

**Guardrail — this is the section's sharpest edge, read before doing anything with it:** "paid based on population size" is dangerously close in shape to capitation, which `CLAUDE.md`'s Non-Negotiable Business Rules records as a shipped, deliberate removal — **no capitation, ever (I8)**, confirmed 2026-07-29. The two are not automatically the same thing: capitation (as removed) meant Tarragon taking downside financial risk per enrolled patient regardless of utilisation, the way an HMO risk-bearer does — which requires insurance-type licensing Tarragon doesn't have and isn't seeking. A population-health *services* contract (a fee for running infrastructure/programmes against a defined population, priced off headcount as a sizing input, with no insurance risk transfer) is a different legal structure. But the difference lives entirely in the contract's actual risk allocation, not in this document's wording — **any real population-health contract must get the same "appropriately structured" legal/regulatory review this section repeatedly gestures at but does not itself perform**, before it is treated as compatible with I8. Do not let this section's existence be read as license to build capitation-shaped pricing.

**Guardrail (applies to all of §13):** not scheduled, not gated to any Phase in §8, and — like §12 — requires patient/institutional volume, contracting capability, and regulatory relationships Tarragon does not have yet. It sits behind the same explicit-founder-ask gate as §12 and the Master Operating Plan's Phase 2/3 items, with the added condition above: any Population Health Contract must independently clear the I8 no-capitation review before commercial or engineering work starts, not just the general "ask the founder" gate. No table, migration, tenant-onboarding flow, or contract-pricing logic gets built off this document alone.

---

## 14. Financial Operations & Contract Economics (Long-Horizon Vision)

Where §12 is about what Tarragon can *learn* at population scale and §13 is about *who the customer is*, this section is about whether the business stays solvent while it gets there, and how it should eventually price the B2B contracts §4/§13 gesture at. Some of it is partially live today (see 14.1's shipped column); the contract-economics subsections (14.2–14.4) are unbuilt analysis frameworks, not features. **Nothing in 14.2–14.4 gets a data model, dashboard, or pricing engine without an explicit founder ask** — same gate as §12/§13.

### 14.1 Cash management

A healthcare company can grow revenue and still fail on cash flow. The full set of flows Tarragon eventually needs visibility over:

```
Accounts receivable        Accounts payable
Provider settlements        Payroll
Refunds                     Claims receivable
Subscription revenue        Deferred revenue
Cash forecasting
```

**Already shipped, not vision:** the Finance Dashboard v2 build (PR #157, merged 2026-07-27) covers a real subset of this — a cash flow statement (indirect method), an accounts-payable ledger (vendors/bills with WHT), cost centers, and budget-vs-actual — gated behind `private.finance_can()`/`private.is_finance()` with fail-closed RLS on the underlying `finance_*` tables. **Not yet built:** claims receivable, subscription deferred-revenue recognition, provider-settlement tracking, payroll, refund workflows, and any forward-looking cash forecasting model. That PR's own placeholder list also flags that its capitation-loss-ratio figure is manually entered because no claims ledger exists yet — worth knowing before assuming "claims receivable" already has a home.

**Guardrail worth flagging explicitly:** that same PR shipped an "HMO capitation register (PMPM contracts/receipts, distinct revenue account 4300)" on 2026-07-27 — two days *before* `CLAUDE.md`'s I8 ("no capitation, ever") was confirmed shipped as a deliberate platform-wide removal on 2026-07-29. Whether that register is still live, still referenced anywhere, or was part of what I8's removal swept up is unverified as of this writing — confirm the table's current state and I8's actual scope before building anything in 14.1 that assumes a capitation ledger exists or should exist.

### 14.2 Employer contract economics

Per employer, the eventual unit-economics view:

```
Contract value
-
Care delivery cost
-
Customer success cost
-
Provider cost
-
Technology allocation
=
Contribution margin
```

Comparing this across customers is the point, not computing it for any single one: Employer A may be highly profitable while Employer B consumes enormous clinical resources for the same contract value. That comparison is what should inform renewal and pricing decisions — it requires cost allocation (customer success time, provider/clinical-staff time by employer, a technology-cost allocation basis) that nothing in the current schema tracks per-employer today.

### 14.3 HMO economics

The chain Tarragon would need to instrument to demonstrate economic value to an HMO partner:

```
Members
   ↓
Risk profile
   ↓
Healthcare utilisation
   ↓
Tarragon intervention
   ↓
Cost
   ↓
Outcome
```

This is the HMO-specific instance of §12's population-programme-management loop (12.8) and §12.11's health economics (cost per patient, cost per controlled patient, cost per prevented event) — not a separate analytics layer, a specific application of the one already sketched there.

### 14.4 Outcome-based contracting

Long term, and only where clinically appropriate and contractually lawful, some B2B contracts could move from a flat fee toward a structure with a performance component:

```
Base fee
+
Outcome incentive
```

This is the pricing shape the `outcomes_contracts` table (§5's data model, `contract_type` already enumerating `capitation`/`fee_at_risk`/`flat`) was designed for, and the same "fee-at-risk" idea §2.1/§2.4 describe for HMO clinical programs. **The same I8 guardrail from §13.2 applies here without exception:** an outcome-incentive contract that is genuinely a fee for performance (Tarragon earns more when it demonstrably improves an outcome, with no insurance-type downside risk transfer) is a different legal structure from capitation (Tarragon bearing downside financial risk per enrolled member regardless of utilisation, which I8 removed for good reason — it needs insurance-type licensing Tarragon doesn't have). The `contract_type` enum listing `capitation` as an option in §5 predates the I8 removal and should not be read as license to write a capitation-shaped contract now — any real outcome-based contract needs the same legal/regulatory review before it's treated as compatible with I8.

**Guardrail (applies to all of §14):** 14.1's shipped subset aside, this section is analysis-framework vision, not a build order. No cost-allocation model, HMO-economics dashboard, or outcome-contract pricing engine gets built off this document alone — it needs an explicit founder ask, the same as §12/§13.

*— End of Tarragon Health Full Specification v4 —*
