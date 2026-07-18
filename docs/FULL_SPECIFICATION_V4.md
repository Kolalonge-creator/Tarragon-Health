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
- Bluetooth devices → sold as **device bundles** (already a listed revenue stream in the Master Plan) — BOOK & PAY, one-time or financed.
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

*— End of Tarragon Health Full Specification v4 —*
