# Tarragon Health — Full Feature Specification

This is the exhaustive reference. `CLAUDE.md` at repo root is the lean per-session contract; this document is what to consult when building any specific feature, table, or sprint deliverable. Stack is Stack A (Next.js/TypeScript/Supabase + Python FastAPI ML microservice) — final, per the Build Guide v3 decision. Where this spec's business logic descends from earlier planning docs that assumed a different stack (e.g. Django) or payment provider (e.g. Flutterwave), those references have been reconciled to Stack A / Paystack+Stripe below.

---

## 1. The Five Business Categories (Full Detail)

### Category 1 — Chronic Disease Management (core wedge, already in motion)
| Condition | Why it matters |
|---|---|
| Hypertension | Common, silent, linked to stroke, kidney disease, heart failure, sudden deterioration |
| Diabetes | Linked to kidney disease, blindness, foot disease, infection, CVD, hypoglycaemia |
| Obesity-related risk | Drives diabetes, hypertension, CVD, fatty liver, long-term complications |
| Kidney risk | Often silent, worsened by hypertension and diabetes |
| Cardiovascular risk | Major driver of preventable morbidity and mortality |
Future: CKD, asthma, heart failure, COPD, stroke follow-up, anticoagulation monitoring, frailty monitoring, post-discharge care.

### Category 2 — Preventative Medicine (major growth lever)
| Area | Examples |
|---|---|
| Cancer screening | PSA, cervical smear, mammography, FIT/stool, colon awareness |
| Metabolic screening | BP, BMI, waist, lipids, HbA1c/fasting glucose, obesity risk |
| Kidney screening | Creatinine, eGFR, urine ACR — especially with hypertension/diabetes |
| Infectious disease | Hepatitis B, HIV, TB risk, malaria RDT/education |
| Reproductive health | Antenatal, PCOS, HPV, menopause |
| General health checks | Annual adult check, risk-based frequency |

**This is the highest-priority business event in the platform:** when a `screening_results` row is inserted with `result_status = abnormal` or `critical`, it must trigger the Category 1 upgrade flow (§8.2). Revenue impact: increases ARPU 2–5× per patient. Never deprioritise, never let it fail silently.

### Category 3 — Care Coordination (the OS connector)
Lab network (booking, result delivery, abnormal flagging) · Pharmacy network (fulfilment, delivery, refills) · Specialist referrals (urologist, oncologist, OB-GYN, cardiology, endocrinology, nephrology, ophthalmology, dietetics, podiatry) · Hospital handoffs (inpatient links, discharge follow-up, urgent referral).

### Category 4 — B2B & Institutional (highest ACV)
Corporate wellness (annual checks, risk reports, workforce health) · HMO partnerships (capitation, prevention compliance, claims reduction) · NHIA/government (population screening, public health contracts) · Hospital discharge contracts · Diaspora groups (ParentCare distribution).

### Category 5 — Platform Infrastructure (backbone, not a product line)
WhatsApp/SMS notification engine + human doctor↔patient support chat (app/web is the interface for signup and every core action, see CLAUDE.md) · Clinician-led delivery (home visits, sample collection, counselling) · AI clinical decisioning (flag abnormals, automate escalation, care plans) · Longitudinal patient health record · Partner API layer (labs, pharmacies, hospitals) · Data & analytics (population dashboards for HMOs/corporates) · Audit log (immutable, medico-legal protection).

**The chain:** Prevention identifies risk → Chronic management manages disease → Care coordination routes services → B2B funds scale → Platform infrastructure makes the system work.

---

## 2. Revenue Streams & Pricing

**Corrected 2026-09-03 — everything below this line except §2.6 describes a business model that no
longer exists.** All of it was retired or removed by four separate founder decisions, each already
documented in `CLAUDE.md`/`docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`, and none of it was updated here at
the time:
- **No subscriptions, no plan tiers.** The app is free; Tarragon charges only for a doctor's time,
  priced per piece of work (`service_products`), plus the 12-week doctor-supported chronic-care
  programme as the one recurring paid product (2026-08-31/2026-09-02 pay-per-service cutover).
- **No family plans, no ParentCare, ever.** Individual enrolment only (founder decision 2026-07-29,
  `family_plan_members` dropped).
- **No HMO capitation, ever.** Removed as a shipped guardrail 2026-07-29 (`hmo_contracts`/the
  `capitation` enum value dropped) — see CLAUDE.md's Non-Negotiable Business Rules, item I8.
- **No lab/pharmacy commissions, no Tarragon-booked fulfilment.** Self-arranged fulfilment
  (2026-08-03): patients arrange and pay their own lab/pharmacy directly and upload results/receipts;
  Tarragon never routes, books, or bills a partner on a patient's behalf, and takes no commission.
- **No Stripe, no diaspora GBP/USD tier.** Removed entirely 2026-09-03 — Paystack (NGN) is the only
  live payment provider; a diaspora buyer sponsors an NGN purchase (Care Voucher / gift-a-health-check)
  for a patient in Nigeria rather than buying a subscription themselves.

**Do not hardcode any specific price here** — per CLAUDE.md, pricing churns constantly; check the live
`service_products` table or the current running code. For the actual current pricing/entitlement
model, read `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`'s 2026-08-31 to 2026-09-03 entry.

### 2.6 Preventive Screening Frequency (product logic input)
| Group | Frequency | Core checks |
|---|---|---|
| Hypertension only | ≥ yearly | BP, weight/BMI, lifestyle, meds, eGFR, Na/K, urine ACR, cholesterol, HbA1c/glucose |
| Diabetes | Annual full + HbA1c every 3–6mo | HbA1c, BP, weight/BMI, cholesterol, eGFR, urine ACR, foot check, smoking status, eye screen, meds |
| Diabetes kidney monitoring | ≥ yearly | eGFR + urine ACR |
| Diabetic eye screening | Every 1–2 yrs | Retinopathy screening |
| Healthy adults 40–74 | Every 1–5 yrs (risk-based) | BP, BMI, waist, cholesterol, glucose, lifestyle, CV risk |
| Healthy adults <40, low risk | Every 2–5 yrs | BP, BMI/waist, lifestyle, cholesterol/glucose if overweight, family history |
| Diabetes-risk group | Every 1–3 yrs | HbA1c/fasting glucose — overweight, obese, family history, prior gestational diabetes, high BP, age 35+ |

Simple rule: **hypertensive → yearly; diabetic → yearly + HbA1c 2–4×/yr; healthy adults → every 1–5 yrs by age/risk.** Nigeria-specific default: annual preventive check, since many lack regular primary care access.

---

## 3. Full Database Schema

### 3.1 Core / Auth / Multi-Tenancy
- `profiles` — role enum: `patient │ clinician │ admin │ hmo_admin │ corporate_admin`; linked to `auth.users`
- `organisations` — type enum: `clinic │ hmo │ corporate │ lab │ pharmacy │ direct_consumer`; `profiles.organisation_id` FK
- A seeded `direct_consumer` organisation ("Tarragon Health Direct") is the default for self-serve signups with no `organisation_id` in signup metadata, so every domain table's `organisation_id NOT NULL` invariant holds even for an org-less consumer (see §10)
- All tables carry `organisation_id`; RLS policies: patient sees own rows only, clinician sees org patients, HMO admin sees their member patients, corporate admin sees their enrolled employees, super-admin sees all
- `profile_access` — login-level delegation (profile_id, grantee_user_id, permission_level: view/manage, plus a `care_access_category`-scoped consent model added 2026-08-30) so an adult dependent/caregiver can log in independently while an owner retains access. `family_plan_members` was dropped 2026-07-29 (no family plans, ever — individual enrolment only) and is no longer part of this model.

### 3.2 Chronic Disease Core (Category 1)
- `vitals_readings` — BP (systolic/diastolic), glucose (fasting/random/post-meal), weight, pulse, timestamp
- `care_plans` — condition, target ranges, clinician-assigned, patient read-only view
- `medications` — drug, dose, frequency, refill_date, linked to care_plans
- `medication_logs` — taken/missed/skipped + reason, adherence % rollup, alert if <70% for 3 days
- `patient_risk_scores` — rule-based + later ML-based (model_version tracked). Distinct from `prevention_risk_scores` (§3.3), which is condition tiering for the screening recommendation engine, not chronic-disease scoring.
- `appointments`
- `symptoms` — patient-reported; red-flag rules (chest pain, weakness, breathlessness, confusion, visual symptoms)
- `clinician_alerts`, `escalations` (status: open/under review/resolved/referred)

### 3.3 Preventative Medicine (Category 2 — new in v3)
| Table | Purpose | Key fields |
|---|---|---|
| `screening_schedules` | Patient's personalised AI-generated screening calendar | patient_id, screen_type (enum), due_date, status (pending/booked/completed/overdue), reminder_sent_at, next_due_date |
| `screen_types` | Reference table of all screening types coordinated | code, name, sex_applicability (M/F/All), age_from, age_to, frequency_months, commission_rate, recommended_provider_type |
| `screening_results` | Result per completed screening event | patient_id, schedule_id, lab_order_id, result_status (normal/borderline/abnormal/critical), result_summary, abnormal_flags (text[]), created_at |
| `screening_upgrades` | Audit log of every abnormal result → Cat 1 upgrade event | patient_id, screening_result_id, condition_triggered (hypertension/diabetes/cancer_referral/other), upgrade_at, handled_by_clinician_id, action_taken |
| `annual_health_checks` | Full AHC record — highest-LTV Cat 2 product | patient_id, year, status, completion_pct, total_cost_ngn, tests_completed (JSON), gender_screens_completed (JSON) |
| `specialist_referrals` | Referrals from abnormal screens to specialists | patient_id, specialist_type, referral_reason, status, referral_fee_ngn, booking_confirmed_at, appointment_date |

(`family_plan_members` — dropped 2026-07-29, no family plans ever, individual enrolment only.)

Seed `screen_types` with 12 types at minimum: PSA (male, 40+, 1yr), cervical smear (female, 25–64, 3yr), mammography, FIT, HbA1c, lipid panel, hepatitis B, HIV, TB, malaria RDT, PCOS panel, antenatal booking. Plus 6 more from the V1 consumer-spec catalog: hepatitis C, sickle cell genotype, vision check, clinical breast exam, bone density, colonoscopy (see §10).

- `risk_assessment_responses` — structured questionnaire per profile: category (lifestyle/family_history/pmh/meds/vaccination/screening_history), question_key, response (jsonb); full retake history kept, not upsert-only
- `prevention_risk_scores` — rule-based tier (low/moderate/high, reusing the `risk_level` enum) per condition, computed from the responses above; feeds the screening recommendation engine (distinct from `patient_risk_scores` in §3.2)
- `vaccination_catalog` — reference table (code, name, description, recommended_age jsonb); seed: tetanus/Td booster, hepatitis B, yellow fever, HPV, influenza, shingles
- `vaccination_records` — per-profile doses given (vaccination_catalog_id, dose_number, date_administered, provider, certificate_url), self-reported entries in scope

### 3.4 Care Coordination (Category 3)
- `lab_providers`, `lab_tests` — seed Synlab, Cerba Lancet, Healthtracka, Afriglobal Medicare with real test/price/commission_rate/home_collection data
- `lab_orders` — linked to patient and (if applicable) `screening_schedule_id`
- `panel_bundles` — Hypertension Panel (₦22,000), Diabetes Panel (₦18,500), Annual Health Check bundle (₦65,000)
- `lab_result_interpretations` — output of ML `/interpret/labs`
- `pharmacy_partners`, `pharmacy_medications`, `pharmacy_orders` — seed Medplus, HealthPlus, Alpha Pharmacy, MedsPal
- `commissions` — one unified table for lab + pharmacy + referral commission events; dashboard slices by partner/test type/month
- `facilities` — curated directory (hospital/lab/pharmacy/radiology/optician/vaccination_centre), global like `lab_providers`; `booking_requests` — request-based (not real-time confirmed) booking per profile, facility contact confirms manually

### 3.5 B2B & Billing (Category 4)
- `subscription_plans` — feature array determines active categories per plan
- `subscriptions` — per user/family/employer/HMO
- `hmo_contracts` — capitation rate, NHIA-format monthly claim file, status: submitted/approved/rejected/paid
- `corporate_contracts` — per-employee-per-year, monthly invoicing
- `commissions` (shared with §3.4)

### 3.6 Platform Infrastructure (Category 5)
- `audit_log` — immutable (no UPDATE/DELETE at the Postgres constraint level); every clinical, billing, and ML-prediction event logged
- `notifications` — channel: email/SMS/in-app/WhatsApp
- `conversation_state` (Upstash Redis, not Postgres) — per phone number; tracks outbound WhatsApp/SMS notification/delivery state (dedup, retries); there is no bot/intent-routing automation — inbound WhatsApp is human doctor↔patient support chat only, routed to a clinician inbox (see §10 note 1 and CLAUDE.md's 2026-07-11 WhatsApp policy)
- `referrals` — patient_refers_patient (₦2,000 airtime), doctor_refers_patient (₦3,500/enrolled, max 20/mo), corporate_champion
- The AI Health Coach is built and live (LangGraph.js + Claude API, tool-calling, audit trail, escalation handoff) — see `docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md` for current status, not this scaffold description

### 3.7 Critical Business Logic — Abnormal Result → Upgrade Flow
This is the highest-priority business event in the platform:
1. `screening_results` insert with `result_status = abnormal|critical` fires a Supabase trigger
2. Edge Function `AbnormalResultHandler` runs:
   - Reads `abnormal_flags` to determine triggered condition
   - Creates a `screening_upgrades` record
   - BP-related → drafts a hypertension `care_plan` for clinician review
   - Glucose-related → drafts a diabetes `care_plan` for clinician review
   - Cancer-related → creates a `specialist_referrals` record
   - Sends clinician WhatsApp alert **immediately** (not scheduled)
   - Sends patient WhatsApp: "Your result needs a follow-up. Your care team will call you today."
3. Clinician dashboard surfaces as **Priority 1 alert** (red, above all else)
4. Clinician has a **4-hour SLA** to make contact, built into the alert system

---

## 4. The 7-Sprint / 16-Week Build Sequence

All five categories are architecturally represented from Sprint 1. Changing the schema later is expensive — design it complete now.

| Sprint | Weeks | Focus | Stack |
|---|---|---|---|
| 1 | 1–2 | Auth, multi-tenancy, full DB schema (all 5 categories), FastAPI scaffold | TS + Python (parallel) |
| 2 | 3–4 | Core Patient OS — vitals, care plans, prevention scheduler, abnormal result handler, patient + clinician dashboards | TypeScript |
| 3 | 5–6 | AI engine + WhatsApp/SMS notification integration — outbound reminders/alerts/confirmations for vitals, medication, screening, lab booking, and results (app/web remains the interface for all of these) — plus inbound human doctor↔patient support chat (webhook → clinician inbox, no automation), LangGraph.js clinical workflow, family portal, SMS fallback | Python/FastAPI + TS |
| 4 | 7–9 | Python ML microservice — SCORE2 CVD model, HbA1c trajectory, BP control assessment, lab/screening interpretation, population cohort analytics, batch prediction, deploy to Railway/Render, integrate with TS via ml-client | Python |
| 5 | 10–11 | Lab & pharmacy network — partner catalogue, bundle pricing, screening-specific booking, commission tracking | TypeScript |
| 6 | 12–13 | HMO billing, subscriptions, revenue engine — all plans, Paystack subscriptions, Stripe diaspora, HMO capitation + outcomes report, corporate billing, financial dashboard | TypeScript |
| 7 | 14–15 | Corporate dashboard, outcomes reporting, platform admin, referral programme, audit trail + NDPR tools | TypeScript |
| — | 16 | Security audit, load test, launch | All |

### Sprint 1 detail (foundation — get this right, it's expensive to redo)
Supabase Auth (phone OTP + email) → `profiles` with full role enum → `organisations` → full chronic + prevention DB schema with RLS → multi-tenant RLS policies for every tenant type → Auth UI with role-based redirect → FastAPI scaffold with `/health`, Docker, CI (parallel, 1–2 days).

### Sprint 4 detail (ML — 3 weeks)
- **Week 7:** SCORE2 CVD risk model (published coefficients; inputs age/sex/systolic_bp/total_cholesterol/hdl_cholesterol/is_smoker; outputs cvd_risk_10yr + risk_level) · HbA1c trajectory (scipy.stats.linregress, Nathan formula, 90% CI) · BP control assessment (30-day control rate, variability, morning surge flag) · FastAPI endpoints under `X-Service-Key` auth
- **Week 8:** Lab reference range engine (Nigerian NAS + WHO ranges) · Screening result interpretation (feeds AbnormalResultHandler) · Population cohort analytics (`/analytics/cohort` — powers corporate/HMO dashboards) · Batch prediction (asyncio.gather, max 2 batch calls/min/key)
- **Week 9:** TS ML client with 5s timeout + graceful fallback · wire into vitals Edge Function, lab result ingestion, screening result flow, corporate cohort feed · deploy, health check, Sentry

### Full 16-Week Milestone / Revenue-Unlock Table
| Week | What's live | Revenue unlocked |
|---|---|---|
| 1–2 | Auth, multi-tenancy, full schema seeded, FastAPI `/health`, CI passing | Foundation only |
| 3–4 | Vitals + care plans + screening scheduler + dashboards + abnormal handler | Cat 1 unlocked; Cat 2 structure ready |
| 5–6 | WhatsApp/SMS reminders & alerts live for vitals/meds/screening/lab-booking (app/web is the interface), AI messages live | Cat 1 fully app/web-operational with notification layer; Cat 2+3 same |
| 7–9 | ML models built, tested, deployed, integrated | Cat 4 B2B preview data available |
| 10–11 | Lab + pharmacy network live, commission tracking | Cat 3 fully operational |
| 12–13 | All subscriptions + Paystack + Stripe + HMO capitation + corporate billing live | Cat 1+2 subscription revenue + Cat 4 HMO/corporate revenue collecting |
| 14–15 | Corporate dashboard, outcomes reports, referrals, admin, audit trail | All five categories fully operational |
| 16 | Security audit passed, load tested, founding patients onboarded | All revenue streams live — flywheel turning |

---

## 5. Clinical Operating Model & Protocols

### 5.1 Roles
Patient · Family member · Clinician (reviews readings, calls patients, checks adherence, flags concerns, reviews escalated cases, advises clinical action) · Lab partner · Pharmacy partner · Admin · Employer · HMO · AI assistant (summaries, education, triage support, clinician prioritisation).

### 5.2 Clinician-to-Patient Ratio & Escalation
- **Ratio target: under review, do not cite a fixed number.** Per CLAUDE.md's Non-Negotiable Business Rules: 1:120 was the working Tier 1–3 figure, now under review since 2026-07-30, with 1:2000 an aspiration (not a committed number) pending real time-per-case pilot data. Describe the mechanism — protocol-driven triage before a doctor sees a case — not a ratio.
- **Four-level escalation:** (1) Routine — within normal range, no action · (2) Clinician review — flagged reading or care-gap, clinician follows up · (3) Urgent escalation — clinician cannot resolve routinely, escalates per protocol · (4) Emergency/urgent care advice — red-flag symptom, immediate safety instruction + urgent care direction.

### 5.3 Protocols to Build
| Protocol | Purpose |
|---|---|
| Hypertension monitoring | Routine, concerning, urgent, emergency BP actions |
| Diabetes monitoring | Glucose review, hypoglycaemia response, hyperglycaemia response |
| Medication adherence | Actions after missed doses, missed refills, poor adherence |
| Lab monitoring | When HbA1c, U&E, creatinine, lipids, urine ACR, LFTs, FBC, etc. are due |
| Red flag escalation | Chest pain, stroke symptoms, severe headache, confusion, severe breathlessness, collapse, hypoglycaemia |
| Family update | What can be shared, when, with whom, under what consent |
| Clinician call script | Standardises check-ins |
| Escalation protocol | When a routine case must be escalated for urgent review |
| Hospital referral | When a patient must attend urgent/emergency care |
| Documentation | Clinical notes, actions, escalations, advice recorded |
| Clinical safety review | How red flags, incidents, near misses, complaints are reviewed |
| Quality assurance | Audits clinician notes, review response times, outcome measures |

---

## 6. Module-by-Module Feature Checklist

Use this as a build tracker — check off per sprint. (Originally scoped against a different stack; implement all of the below on Stack A: Next.js/Supabase/TypeScript + FastAPI, not Django/PostgreSQL standalone.)

- [ ] **Accounts** — signup, login, roles, permissions (Supabase Auth, phone OTP + email)
- [ ] **Patient profile** — health record, conditions, medications, allergies, emergency contacts, family history, baseline vitals, risk symptoms
- [ ] **Family access** — consent-based monitoring + payment support, patient-family link
- [ ] **Monitoring** — BP/glucose/weight/pulse/symptoms/adherence, charts, abnormal reading flags, missed-reading alerts
- [ ] **Medication** — dose schedule, missed-dose tracker, refill tracker + reminder, pharmacy request workflow, delivery status
- [ ] **Labs** — partner model, test catalogue, booking, result upload (PDF + structured), abnormal flag, plain-English explanation, follow-up action, commission tracking
- [ ] **Preventive screening** — screening rules engine (age/sex/diagnosis/risk-based), annual health check workflow, care gap dashboard, preventive reminders, preventive report, upgrade logic
- [ ] **Pharmacy** — refill requests, fulfilment, delivery status, family medication alert (if consented)
- [ ] **Clinician dashboard** — daily worklist, abnormal readings list, missed medication list, lab-due list, call note form, next follow-up date, family update trigger, escalation homepage, escalated patient summary, recent vitals/meds/labs, review note, action plan, close-escalation function, workload metrics
- [ ] **Escalation engine** — risk flags, urgent review queue, emergency advice pathway, escalation status (open/under review/resolved/referred)
- [ ] **Family dashboard** — parent status page (green/amber/red), latest readings, adherence, upcoming actions, alerts, monthly report, payment management
- [ ] **Payments** — Paystack (NGN, recurring, webhooks: charge.success/charge.failure/subscription.disable, 7-day grace + dunning), Stripe (GBP diaspora, Customer Portal), invoice history, failed-payment handling, plan upgrade/downgrade, corporate billing
- [ ] **Notifications** — email, SMS (Termii), in-app, WhatsApp (follow-up/notification channel, not primary — see CLAUDE.md), scheduled reminders (Upstash), missed-reading alerts, family update notifications
- [ ] **Admin dashboard** — users, orgs, system health (API latency, WhatsApp delivery rate, ML service status, alert queue depth), finance (MRR/ARR/churn/commission/receivables), ML model versioning + batch re-scoring trigger
- [ ] **Corporate dashboard** — staff enrolment, workforce health (ML cohort risk distribution), screening compliance %, abnormal findings (anonymised), overdue-screen actions list
- [ ] **HMO dashboard** — member population risk, care gap tracking, outcome/claims-prevented reporting
- [ ] **Analytics** — outcomes, retention, adherence, escalation speed, revenue
- [ ] **Content** — health education library, FAQs, protocols, clinician call scripts
- [ ] **AI assistant** — summaries, education, triage support, clinician prioritisation, admin automation (LangGraph.js + Claude API)
- [ ] **Referral programme** — patient-refers-patient, doctor-refers-patient, corporate champion; referrer dashboard (code, link, earnings, payouts)
- [ ] **Audit trail + NDPR tools** — immutable event log, patient data export (JSON + PDF, 72hrs), right-to-erasure (anonymise personal fields, retain clinical minimum for regulatory period)

---

## 7. Launch Gates (do not launch publicly until all met)

| Gate | Standard |
|---|---|
| User authentication | Secure signup, login, roles, permissions |
| Patient onboarding | Complete health profile, medications, allergies, emergency contact |
| Consent | Captured for monitoring + family access |
| Monitoring | BP/glucose/medication tracking working |
| Preventive reminders | Basic screening + care gap reminders working |
| Risk flagging | Abnormal readings generate clinician tasks |
| Escalation | Clinician review workflow exists |
| Documentation | Clinician notes can be saved |
| Family dashboard | Family can view consented summary |
| Payments | At least one payment provider working end-to-end |
| Notifications | Email or SMS reminders working |
| Admin dashboard | Admin can monitor users, risk, activity, revenue |
| Safety process | Red-flag advice + urgent escalation protocol in place |
| Outcome tracking | Baseline outcome metrics captured |
| Partner workflow | At least one lab and one pharmacy workflow ready |

### Pre-Launch Security Checklist
- [ ] All Supabase RLS policies reviewed by a **fresh** Claude Code session (reviewer pattern)
- [ ] Clinician from Org A cannot see patients from Org B (must return 0 rows)
- [ ] ML service returns valid JSON for edge cases (age 18, age 80, missing fields)
- [ ] Platform continues functioning when ML service returns 500 (graceful fallback)
- [ ] AbnormalResultHandler fires correctly for all screen types
- [ ] Abnormal result → clinician WhatsApp alert arrives within 60 seconds
- [ ] `X-Service-Key` not present in any git commit history
- [ ] WhatsApp message templates approved by Meta (submit ~2 weeks before launch)
- [ ] Paystack webhook signature validation tested against replayed requests
- [ ] Load test: 100 concurrent vitals submissions handled gracefully
- [ ] NDPR patient data export works end-to-end
- [ ] Screening schedule correctly generated for ≥10 test patients of varied age/sex

---

## 8. Partner Network & Workflow

| Partner type | Role |
|---|---|
| Labs (Synlab, Cerba Lancet, Healthtracka, Afriglobal) | HbA1c, kidney function, lipids, urine ACR, FBC, LFTs, screening tests |
| Pharmacies (Medplus, HealthPlus, Alpha Pharmacy, MedsPal) | Refills, delivery, adherence support |
| Doctors | Escalation review, medication review, clinical safety |
| Hospitals | Urgent referral, specialist care, post-discharge monitoring |
| Home visit clinicians | BP/glucose checks, sample collection, frail patient support |
| ~~Device suppliers~~ | ~~BP monitors, glucometers, scales, pulse oximeters~~ — **SHELVED 2026-08-02**, patient self-sources, see CLAUDE.md |
| Employers | Staff enrolment, corporate chronic disease care |
| HMOs (Reliance, Avon, Ronsberger, Wellahealth) | Member monitoring, chronic risk control |
| Diaspora groups | ~~ParentCare distribution~~ — ParentCare deleted 2026-07-29; diaspora is now a sponsor of a patient's Paystack purchase (Care Voucher / gift-a-health-check), not a distribution channel for a tier |
| Specialist clinics | Cardiology, endocrinology, nephrology, ophthalmology, dietetics, podiatry |

**Workflow chain — superseded 2026-08-03 by self-arranged fulfilment.** Tarragon no longer books, bills, or takes a commission on labs/pharmacies/specialists. Real chain: platform calculates due dates and reminds → patient books/pays the lab or pharmacy directly (any provider, not just a partner) → patient (or, for a contracted partner like Synlab, the partner directly) uploads results → abnormal flagging → clinical review → pharmacy refill is the same self-arranged pattern. No commission tracking exists; partner QA is limited to the handful of contracted partners with a real billing relationship (e.g. Synlab).

Each partner needs: onboarding criteria, SLAs, pricing, quality standards, reporting requirements, complaint escalation route.

---

## 9. Geographic Sequencing (do not over-promise geography before fulfilment is reliable)

| Year | Focus |
|---|---|
| 1 | Lagos + Abuja only; lock in lab/pharmacy partners; launch hypertension, diabetes, ParentCare, preventive tracking; 50–100 patient pilot |
| 2 | Expand corporate/HMO contracts; use enrolled cohorts to negotiate better lab/pharmacy rates; expand to selected additional cities |
| 3 | 100,000+ patient records + outcome evidence → approach NHIA, state governments, large employers |
| 4–5 | Scale nationally, deepen AI/analytics, expand chronic disease categories, defensible population health infrastructure |

---

## 10. V1 Consumer Spec Reconciliation (Sprint 3)

`TARRAGON_HEALTH_V1_SPEC.md` (repo root) was written as a standalone consumer-app build brief, as if greenfield. It wasn't — this schema already covered most of it under different names, with multi-tenant RLS the standalone spec didn't have. Four decisions govern how it was folded in, and this section is the map from its terms to what's actually built.

**Resolved decisions:**
1. **Reminders** build for WhatsApp+SMS first as the notification channel, per CLAUDE.md's non-negotiable rule (updated 2026-07-11) that app/web is the required interface for every feature and WhatsApp/SMS is follow-up-only, never the primary interaction path — push/email are additive alongside WhatsApp/SMS. (Send integration itself is not yet built — `notifications` is still write-only.)
2. **Family/multi-profile model**: `profile_access` (§3.1) delivers the "adult dependent/caregiver can log in independently, owner retains access" model. `family_plan_members` was dropped 2026-07-29 (no family plans, ever) — it is no longer "additive to" this model, it's gone. `profiles` is still strictly 1:1 with `auth.users`.
3. **B2B/institutional work resumed and shipped.** `hmo_contracts`/`corporate_contracts` are historical — HMO capitation was removed as a product 2026-07-29 (I8); `subscription_plans` was retired 2026-09-02 for pay-per-service. Employer/HMO dashboards were pulled forward and built 2026-07-16 on explicit founder ask — see CLAUDE.md's Clinical Tier Ladder section.
4. **AI Health Coach is built and live** — LangGraph.js + Claude API, tool-calling, audit trail. See `docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md`.

**Term mapping** (V1 spec name → actual table):
- `screening_catalog` / `screening_recommendations` → `screen_types` / `screening_schedules` (already existed, no new tables)
- `risk_scores` → `prevention_risk_scores` (renamed to avoid colliding with the existing chronic-disease `patient_risk_scores`)
- `health_records` (polymorphic) → **not built**; the existing typed tables (`vitals_readings`, `screening_results`, lab results) cover it, and a unified "Health Passport" view should be a read-side query, not a new write table — flagged for explicit sign-off before building
- `reminders` → `notifications` (channel/status/template/payload already covers it; `push` added to the channel enum)
- `profiles` (V1 spec's account-owner-plus-dependents shape) → the existing `profiles` (1:1 with `auth.users`) plus `profile_access` — there is no second `profiles`-like table (`family_plan_members` no longer exists, dropped 2026-07-29)
- `facilities` / `booking_requests` → new tables, global directory + org-scoped request, same trust model as `lab_providers`/`lab_orders`

---

*This document is a living reference. Update it alongside `CLAUDE.md`'s "Current Sprint" line at the start of every sprint.*
