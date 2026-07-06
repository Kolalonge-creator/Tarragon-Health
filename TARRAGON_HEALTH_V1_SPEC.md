# Tarragon Health — V1 Product & Engineering Specification

> **Reconciliation note (Sprint 3):** this document was written as a standalone build brief, as if greenfield. The repo already had a fuller, org-scoped, RLS-hardened schema covering most of Section 5's data model under different names. See `docs/FEATURE_SPEC.md` §10 for the resolved decisions and the full table-name mapping (e.g. `screening_catalog`→`screen_types`, `risk_scores`→`prevention_risk_scores`, `profiles`→existing `profiles`+`profile_access`+`family_plan_members`). Treat Section 5/6 below as historical intent, not the literal schema to build — the actual schema is in `supabase/migrations/`.

**Purpose of this document:** this is a build brief, written to be fed directly into Claude Code. It takes the full Personal Health Prevention Operating System (PH-POS) vision and cuts it down to what a small team should actually build first, without losing the long-term roadmap. Section 4 and the Appendix preserve every feature that's been deferred, so this is a scoping decision, not a deletion.

---

## 0. How to Use This Document

1. Sections 1–3 are the product spec — what V1 does and why.
2. Section 5 is the data model — build this first, in Supabase.
3. Section 6 is seed data for the screening/vaccination engine — load this before building the recommendation logic.
4. Section 7 confirms the stack (matches your existing monorepo decisions).
5. Section 8 is the literal build order — hand each phase to Claude Code as a separate task.
6. Section 9 is non-negotiable technical/compliance guardrails.
7. Section 4 + Appendix = backlog. Don't build these in V1 even if asked to "add value" — they add scope risk, not speed to market.

---

## 1. Product Vision (Condensed)

**Mission:** Prevent disease, increase healthy life expectancy, and reduce healthcare costs by ensuring every Nigerian receives the right preventive care at the right time.

**V1 promise (narrower than the long-term vision, deliberately):** Give any Nigerian adult a personal, evidence-based preventive care plan — what to check, when, why it matters, and a place to store the results — without requiring them to already know what "preventive care" means.

The long-term vision (birth-to-old-age national infrastructure, population analytics, corporate wellness, wearables) is correct as a destination. It is wrong as a V1 build target. Everything in Section 3 is chosen because it can be validated with real users within weeks, not because it's the most impressive feature.

---

## 2. What Changed From the Original Vision, and Why

| Original scope | Decision | Reasoning |
|---|---|---|
| Full birth-to-old-age platform | Keep architecture open to it, build adult preventive care first | Children's preventive care needs different clinical logic (growth curves, developmental milestones) — separate workstream, not a V1 blocker |
| ~19 pillars simultaneously | 10 core features (Section 3) | A platform that does 10 things well beats one that does 19 things at 50% |
| Exhaustive screening library (40+ tests across every cancer/organ system) | Condensed, high-impact catalog (Section 6), built as **data**, not code | The catalog is a table in your database. Adding test #41 later is a database insert, not a re-architecture. So nothing is actually lost — it's deferred to "add via admin panel," not "rebuild the engine." |
| Full multi-channel reminders (SMS, WhatsApp, email, push, phone call, family, employer, community health worker) | Push + Email first, SMS/WhatsApp second, rest deferred | Push/email are free and fast to build. SMS/WhatsApp need a paid provider account (Termii/Africa's Talking) — worth it, but it's a Phase 3 task, not Phase 1. Phone calls and employer/CHW escalation need operational infrastructure you don't have yet. |
| Full booking marketplace (real-time scheduling across hospitals, labs, pharmacies, radiology, physio, opticians, telemedicine) | Facility directory + booking *request* (not confirmed real-time booking) | Real booking requires integration agreements with each facility. You don't have those yet. A request-based flow gets you 80% of the user value (discoverability, one-tap request) with 0% of the partnership dependency. |
| AI Health Coach in "simple English and major Nigerian languages" | English only, i18n-ready architecture | Translation quality for medical content in Yoruba/Igbo/Hausa needs clinical review, not just translation — that's a content workstream to run in parallel, not a blocker for launch |
| Genetic information | Removed from V1 entirely | No genetic testing partner, no consent/counselling infrastructure yet. Explicitly Phase 3+. |
| Wearable integration | Removed from V1 entirely | Zero users yet. Build this when you have users asking for it. |
| Corporate wellness, Community dashboards, Population health analytics | Removed from V1 entirely | These are B2B2C and B2G products that monetize an *existing* user base. You don't have one yet. Build the consumer product, get to product-market fit, then build these on top of the data you're already collecting. |

**The core principle:** every "cut" feature is either (a) a data-catalog entry you add later with no re-engineering, or (b) a separate product built on top of a user base you don't have yet. Nothing here is a strategic retreat — it's sequencing.

---

## 3. V1 Scope — Core Features

### 3.1 Auth & Onboarding
- Email or phone (OTP) sign-up via Supabase Auth
- Create primary profile: name, DOB, sex, occupation, state/location
- Option to add family members under the same account during or after onboarding

**Acceptance criteria:**
- User can sign up, verify, and land on a populated dashboard within 5 screens
- A profile record exists in `profiles` before the user reaches the risk assessment

### 3.2 Risk Assessment
A structured questionnaire capturing:
- Demographics (already captured at onboarding)
- Family history (parents/siblings: diabetes, hypertension, cancer type, heart disease, sickle cell)
- Lifestyle: smoking, alcohol, exercise frequency, diet pattern, sleep, stress
- Past medical history & current medications (free text + structured tags)
- Vaccination history (self-reported, reconciled against the vaccination registry later)
- Prior screening results (self-reported dates/values where known)

**Output:** a `risk_scores` record per profile containing a simple, transparent risk flag per disease category (not a black-box score in V1 — see below).

**V1 simplification:** Skip the "AI calculates true health age vs current health age" framing for now. It sounds compelling but needs a validated model behind it or it's just marketing fluff wearing a lab coat. V1 instead computes **rule-based risk tiers** (low/moderate/high) per condition, using standard risk factors (age, BMI, family history, smoking status, existing diagnoses). This is honest, defensible, and still drives the recommendation engine. "Health age" scoring is a good Phase 2 feature once you have a real model and can defend the number to a clinician or a regulator.

**Acceptance criteria:**
- Every question maps to a stored field, not just free text, so it can drive the recommendation engine
- Assessment can be re-taken/updated; changes recompute risk tiers and downstream recommendations

### 3.3 Personalized Screening Recommendation Engine
Rules engine that reads:
- Profile (age, sex)
- Risk tiers from 3.2
- The screening catalog (Section 6)

...and outputs a per-profile list of recommended screenings with due dates, statuses, and "why this matters" copy.

**Acceptance criteria:**
- Recommendations regenerate automatically when age crosses a threshold or risk tier changes
- Each recommendation has a status: `upcoming`, `due`, `overdue`, `completed`, `skipped`
- Completing a screening (via 3.4) updates status and schedules the next due date automatically

### 3.4 Digital Health Passport
- Manual entry of results (vitals, lab values, screening outcomes)
- File upload for lab reports/imaging (PDF/image, stored in Supabase Storage)
- Chronological view per profile, filterable by category
- Powers the trend view for chronic-risk tracking (BP, glucose, weight over time)

**Acceptance criteria:**
- A completed screening recommendation can be linked directly to a health record
- Records are scoped to a profile, visible only to the account owner (and to the profile owner if they're a separate adult user — see Section 9 on family data access)

### 3.5 Vaccination Registry
- Vaccination catalog (Section 6): childhood + adult core vaccines relevant to Nigeria
- Record doses given, dates, provider
- Auto-generates the "due/overdue" state per profile
- Simple downloadable PDF certificate per vaccine record (low effort, high perceived value — keep this one, it did not need to be cut)

**Acceptance criteria:**
- Vaccination due dates appear in the same reminder queue as screenings

### 3.6 Reminder Engine
- Channels in V1: **push notification + email**
- Channel in Phase 3 (still V1.x, not deferred indefinitely): **SMS + WhatsApp** via a Nigeria-capable provider (Termii or Africa's Talking recommended over Twilio for local delivery rates/cost)
- Reminder cadence: on due date, then repeated on a backoff schedule until completed or dismissed

**Deferred:** phone call reminders, employer-triggered reminders, community health worker escalation — these need operational partners you don't have yet.

### 3.7 AI Health Coach
- Chat interface backed by Claude API
- Scope: explain *why a specific recommended test matters*, what to expect, how to prepare, and plain-English interpretation of entered results
- Explicitly **not** a diagnostic tool — every response should route abnormal-sounding results toward "see a clinician," never toward a diagnosis
- English only in V1; design the content/prompt layer so Yoruba/Igbo/Hausa can be added without a rebuild (i.e., keep coach copy and locale as separate concerns)

**Acceptance criteria:**
- Coach has context on the specific profile's due/completed screenings when answering
- Coach responses include a clear, consistent disclaimer and a "talk to a doctor" path for anything result-interpretation-related that isn't a simple explainer

### 3.8 Family Health
- Multiple profiles per account (parents, children, grandparents)
- Shared family history (a family history entry can apply to multiple linked profiles)
- Each profile gets its own risk assessment, recommendations, and passport

### 3.9 Facility Directory & Booking Requests (Lite)
- Static/curated directory: hospitals, labs, pharmacies, radiology, vaccination centres, opticians (start with one city/state, expand later)
- User submits a **booking request** (not real-time confirmed booking) — facility contact receives it, confirms manually for now
- This is intentionally low-tech in V1: it validates demand before you invest in real scheduling integrations

### 3.10 Care Navigation (Rules-Based)
- When a result entered in the Health Passport is flagged abnormal (simple threshold rules per test type), trigger:
  - A follow-up recommendation (e.g., "repeat test," "see a specialist")
  - A suggested next action surfaced in the dashboard
- **Not** a diagnostic engine — this is a rules-based nudge system, not clinical decision support. Keep the language advisory, not directive.

---

## 4. Explicitly Deferred (Phase 2 / Phase 3 Backlog)

Nothing below is cancelled. It's sequenced after V1 has real users and revenue signal.

**Phase 2 candidates** (once you have paying users / real usage data):
- "Health age" AI scoring model (once you can build/validate it properly)
- Full booking integration with real-time scheduling (once you have facility partnerships)
- Multi-language AI coach (Yoruba, Igbo, Hausa)
- Digital certificate verification via QR (extend the Phase 1 PDF certificate)
- Expanded screening catalog entries (this is just data — add as needed)
- Genetic risk assessment (BRCA, etc.) — needs a testing/counselling partner first

**Phase 3+ candidates** (separate products built on your consumer data moat):
- Corporate wellness dashboards (B2B — sell to employers once you have employees using the app)
- Community/city/state dashboards (needs population-scale data you don't have yet)
- Population health analytics / national dashboards (B2G — sell to state or federal health ministries)
- Wearable integration (Apple Watch, Fitbit, Garmin, Samsung, Google Fit, BP/glucose devices, smart scales)
- Employer-triggered and community-health-worker-triggered reminders
- Full health education library (video/course content) — start with lightweight article content in V1 if there's time, but don't block launch on it

---

## 5. Data Model (Supabase / Postgres)

Core tables — build these in the order listed, since later tables reference earlier ones.

```
users                     -- Supabase auth users (built-in)

profiles
  id, user_id (account owner), full_name, dob, sex,
  occupation, state, relationship_to_owner (self/child/parent/spouse/other),
  created_at

risk_assessment_responses
  id, profile_id, category (lifestyle/family_history/pmh/meds/vaccination/screening_history),
  question_key, response (jsonb), created_at

risk_scores
  id, profile_id, condition (hypertension/diabetes/cvd/breast_ca/cervical_ca/colorectal_ca/etc.),
  tier (low/moderate/high), computed_at, inputs_snapshot (jsonb)

screening_catalog
  id, name, category, applicable_sex (male/female/both),
  min_age, max_age, interval_months, risk_escalation_rules (jsonb),
  patient_explainer (text), guideline_source

screening_recommendations
  id, profile_id, screening_catalog_id, due_date, status,
  last_completed_date, linked_health_record_id (nullable)

vaccination_catalog
  id, name, description, recommended_age (jsonb: months/years + dose schedule)

vaccination_records
  id, profile_id, vaccination_catalog_id, dose_number,
  date_administered, provider, certificate_url

health_records
  id, profile_id, record_type (vitals/lab/imaging/screening_result),
  data (jsonb), file_url (nullable), recorded_at, source,
  is_flagged_abnormal (bool)

reminders
  id, profile_id, related_recommendation_id, channel (push/email/sms/whatsapp),
  scheduled_for, status (pending/sent/completed/dismissed), sent_at

facilities
  id, name, type (hospital/lab/pharmacy/radiology/optician/vaccination_centre),
  state, city, contact_phone, contact_email, address

booking_requests
  id, profile_id, facility_id, service_type, requested_date,
  status (requested/confirmed/completed/cancelled), notes

ai_conversations
  id, profile_id, messages (jsonb array), created_at, updated_at
```

**Row-level security (build this in from day one, not as a retrofit):**
- A profile is only readable/writable by the account owner (`profiles.user_id = auth.uid()`)
- For adult family members with their own login, you'll need a `profile_access` join table (profile_id, user_id, permission_level) so an adult "child profile" can eventually log in independently while parents retain view access — stub this table now even if unused in V1, it's much harder to retrofit than to reserve

---

## 6. Screening & Vaccination Catalog (V1 Seed Data)

This is deliberately condensed from the full exhaustive list — it covers the highest-impact, most evidence-strong screenings, structured as data so expanding it later is a database insert, not new code.

### 6.1 General Adult (both sexes)

| Screening | Start age | Interval | Escalation trigger |
|---|---|---|---|
| Blood pressure | 18 | 24 months | Annual if risk tier ≥ moderate |
| BMI / waist circumference | 18 | 12 months | — |
| Fasting glucose / HbA1c | 35 | 36 months | From 25 if BMI ≥ 25 or family history |
| Lipid profile | 40 | 60 months | From 30 if risk tier high |
| HIV test | 15 | Once, then risk-based | Annual if high-risk exposure reported |
| Hepatitis B panel | 18 | Once | Vaccinate if non-immune |
| Hepatitis C test | 18 | Once | Risk-based repeat |
| Sickle cell genotype | 18 | Once | Priority: preconception |
| TB screening | Any | Symptom/exposure-based | — |
| Vision check | 40 | 24 months | — |

### 6.2 Women

| Screening | Start age | Interval |
|---|---|---|
| Cervical screening (HPV/Pap) | 25 | 36–60 months until 65 |
| Clinical breast exam | 25 | 12 months |
| Mammography | 40 (earlier if family history) | 24 months |
| Preconception counselling | Reproductive age, on request | — |
| Bone density | 65 (or post-menopause + risk factors) | — |

### 6.3 Men

| Screening | Start age | Interval |
|---|---|---|
| PSA discussion (shared decision-making, not automatic testing) | 50 (45 if high-risk/family history) | 12–24 months |
| Testicular self-awareness education | 18 | Once, reinforced periodically |

### 6.4 Both sexes — cancer

| Screening | Start age | Interval |
|---|---|---|
| Colorectal (FIT) | 45 | 12 months |
| Colorectal (colonoscopy, if chosen instead of FIT) | 45 | 120 months |

### 6.5 Vaccinations (adult core set)

| Vaccine | Schedule |
|---|---|
| Tetanus/Td booster | Every 10 years |
| Hepatitis B | 3-dose series if non-immune |
| Yellow fever | Once (per Nigeria requirements) |
| HPV | Catch-up through age 26 |
| Influenza | Annual (optional) |
| Shingles | From age 50 |

*Note: this table is intentionally shorter than the original exhaustive brief. Add entries via the `screening_catalog`/`vaccination_catalog` tables as clinical priorities are validated — no engine changes required.*

---

## 7. Tech Stack & Architecture (confirmed, matches current decisions)

- **Monorepo:** Turborepo + pnpm workspaces
- **Web:** Next.js
- **Mobile:** React Native
- **Backend:** Node.js / TypeScript
- **Database & Auth & Storage:** Supabase (free tier through development; upgrade to Pro before any real user data enters the system)
- **AI layer:** Claude API for the Health Coach (Section 3.7) and, later, care-navigation copy generation
- **SMS/WhatsApp (Phase 1.x, not day one):** Termii or Africa's Talking (better Nigeria delivery/cost than Twilio)

---

## 8. Build Milestones (hand each phase to Claude Code as its own task)

**Phase 0 — Foundations**
Monorepo scaffold, Supabase project + schema (Section 5), auth (email/phone OTP), shared UI package, base design tokens.

**Phase 1 — Onboarding & Risk**
Profile creation, family member add flow, risk assessment questionnaire, rule-based risk tier computation (3.2).

**Phase 2 — Recommendation Engine & Passport**
Screening recommendation engine reading the catalog (3.3), Digital Health Passport with manual entry + file upload (3.4).

**Phase 3 — Vaccination & Reminders**
Vaccination registry + PDF certificate (3.5), reminder engine — push + email first, SMS/WhatsApp provider integration second (3.6).

**Phase 4 — AI Health Coach**
Claude API integration with profile context, disclaimer/guardrail logic (3.7).

**Phase 5 — Facility Directory & Booking Requests**
Curated directory for one city/state, booking request flow, no real-time scheduling (3.9).

**Phase 6 — Care Navigation**
Abnormal-value flagging rules, follow-up recommendation triggers (3.10).

---

## 9. Non-Functional Requirements

- **Data protection:** design for NDPR (Nigeria Data Protection Regulation) compliance from day one — explicit consent capture at onboarding, data minimization, right to export/delete a profile's data
- **Row-level security:** enforced in Supabase from Phase 0, not retrofitted later
- **No PHI in logs:** application logs must never contain health record contents, only IDs/metadata
- **Compliance-tier features (encryption-at-rest audit trails, formal access logging, backup/retention policy)**: flagged as required before onboarding real patient data at scale — build the schema to support it now, implement enforcement before the Supabase Pro upgrade / first real user cohort
- **Every AI-generated health explanation must carry a consistent, visible disclaimer** and must never present itself as a diagnosis

---

## Appendix — Full Original Feature List, Mapped to Phase

| Original feature | Status |
|---|---|
| Risk assessment | ✅ V1 (3.2), simplified — no "health age" score yet |
| Personalized prevention timeline | ✅ V1 (3.3) |
| Comprehensive screening library | ✅ V1, condensed catalog (Section 6); full breadth is a data-entry task, not deferred functionality |
| Vaccination management | ✅ V1 (3.5) |
| Health check scheduler | ✅ V1, folded into 3.3 + 3.6 |
| Intelligent reminder engine | ✅ V1 partial — push/email now, SMS/WhatsApp Phase 1.x, phone/employer/CHW deferred |
| Booking system | ✅ V1 lite (3.9) — request-based, not real-time |
| Digital Health Passport | ✅ V1 (3.4) |
| AI Health Coach | ✅ V1, English-only (3.7) |
| Care navigation | ✅ V1, rules-based (3.10) |
| Chronic disease tracking | ✅ V1, folded into Health Passport trend view |
| Family health | ✅ V1 (3.8) |
| Corporate wellness | ⏸ Phase 3+ |
| Community health dashboards | ⏸ Phase 3+ |
| Population health analytics | ⏸ Phase 3+ |
| Health education library | ⏸ Phase 2, lightweight articles only if time allows in V1 |
| Wearable integration | ⏸ Phase 3+ |
| Genetic information | ⏸ Phase 2/3, needs a testing/counselling partner |
| Multi-language AI coach | ⏸ Phase 2 |
