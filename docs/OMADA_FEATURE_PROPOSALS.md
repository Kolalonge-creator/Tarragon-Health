# Omada-Inspired Feature Proposals — Build Backlog

> **Status: PROPOSED (2026-07-19).** Not built. This is a scoped backlog produced from a review of
> Omada Health's platform against what Tarragon already ships (see CLAUDE.md "Current Sprint"). Each
> item below is filtered through Tarragon's non-negotiables: **no owned clinics**, **WhatsApp/SMS is
> notifications + human doctor↔patient chat only (never a transactional interface)**, **doctor-led,
> not coach-led**, and the **Nigerian market**. Pick items up in priority order; every "INCLUDE"
> item names the schema/entitlement/guardrail hooks so it slots into the existing patterns rather
> than inventing parallel machinery. Branch for this planning doc: `claude/omada-features-tarragon-rsbu04`.
>
> **Nothing here is authorised to build without an explicit per-item ask** — it is a design backlog,
> consistent with the "no functional code for Phase 2/3 items without an explicit ask" guardrail.

## 0. TL;DR — the decisions

| # | Feature | Verdict | Priority |
|---|---|---|---|
| 1 | AI-assisted nutrition / meal analysis (Nigerian food) | **INCLUDE — adapt** | **P1 (highest differentiation, lowest partner dependency)** |
| 2 | In-app asynchronous care-team messaging (threaded to record) | **INCLUDE** | P2 |
| 3 | CGM (continuous glucose monitoring) ingestion | **INCLUDE — Phase 2, partner-gated** | P3 |
| 4 | "Dedicated health coach" model | **ADAPT — do not copy** (map onto Care Coordinator + lifestyle layer) | Guardrail note only |
| 5 | MSK (musculoskeletal) programme | **SKIP for launch** (revisit on B2B demand) | Deferred |
| 6 | Peer support / community groups | **DEFER** (moderation + clinical-misinformation risk) | Deferred |
| 7 | GLP-1 / semaglutide programme | **DEFER** (already the standing decision) | Deferred |

Rationale for each is in the sections below. Items 1–3 are the actual build backlog; 4–7 are
recorded decisions so they don't get re-litigated or accidentally pulled forward.

---

## 1. AI-assisted nutrition / meal analysis — INCLUDE (adapt for Nigeria) · **P1**

**Why:** Omada's newest, most differentiated consumer feature. Fits Tarragon's existing "AI clinical
decisioning" backbone and the already-built **lifestyle coaching** + **diabetes/obesity** flows.
Highest differentiation, and it depends on **no external partner** (unlike CGM/labs) — so it is the
best first pickup.

**The adaptation that matters:** US barcode databases and portion models are useless for Nigerian
food (jollof rice, eba, egusi, amala, suya, moin-moin, plantain). Build meal-photo → vision model →
estimated portions/carbs tuned to a **Nigerian food set**, not a US barcode lookup.

**Guardrails (must hold):**
- Framed as **coaching telemetry only, never clinical** — same discipline as the health-education
  knowledge-check scores. It must **never** feed `patient_risk_scores`, escalation, or the abnormal-result
  pipeline, and must never be attributed to a doctor.
- No fear-based copy (BRAND_GUIDE voice rule).
- App/web is the interface; a WhatsApp reminder to "log your meal" is fine, meal entry over WhatsApp is not.

**Suggested shape (reuse, don't rebuild):**
- New table `nutrition_log_entries` (`patient_id`, `organisation_id`, `logged_at`, `meal_type`,
  `photo_path` → private Storage bucket with patient-own-folder RLS like `vaccination-certificates`,
  `ai_estimate` jsonb `{items[], est_carbs_g, est_calories, confidence}`, `patient_confirmed` bool).
  RLS: patient-owner + `private.is_org_staff`, inserts pinned to `private.current_org_id()`.
- Vision call: LangGraph.js + Claude API (existing AI stack). **5s timeout, graceful fallback** — if the
  model is down or low-confidence, the entry still saves as a plain photo/manual note (never blocks logging).
- A curated **Nigerian food reference set** (seed JSON in `packages/shared`, or a `nigerian_foods`
  catalogue table) mapping common dishes → typical macros; the model grounds against it.
- Entitlement: gate behind `has_feature_access('lifestyle_coaching')` (it's a lifestyle-layer feature) —
  reuse `RequiresEntitlement`/`UpgradePrompt`, no new billing code. Optionally its own `nutrition_ai`
  feature key if sold separately later.
- UI: a card in `/patient/lifestyle` (photo upload → estimate → confirm/adjust) feeding the existing
  weight/lifestyle progress views; optional water-intake tracker on the same card.
- Tests: Jest for the estimate-parsing/confirm server functions; the vision adapter is `server-only`
  (exercise via the app per jest-config convention, like the identity adapter).

**Definition of done:** typecheck/lint/test green; migration committed + `.env.example` updated for any
new AI/vision env; RLS on the new table; works fully via app/web; low-confidence + model-down paths
verified to degrade gracefully.

---

## 2. In-app asynchronous care-team messaging — INCLUDE · **P2**

**Why:** Today the doctor↔patient channel is **WhatsApp** (human-routed, deliberately un-parsed). That's
correct for casual support, but there's no **in-app, threaded, on-the-record** message tied to a specific
escalation or care plan. Omada's async care-team thread is exactly that gap — and building it **in-app**
keeps it inside the WhatsApp-is-notifications-only rule while making the conversation part of the
longitudinal record.

**Guardrails (must hold):**
- In-app only. WhatsApp/SMS may **notify** "you have a new message from your care team"; the message
  itself lives in the app. This is not a WhatsApp transactional flow.
- A clinician reply that constitutes review must still go through the null-gated `ReviewedByDoctor` /
  `reviewed_by` attribution where applicable — a message is not itself a substitute for a logged review.
- `organisation_id` + RLS on every row; Care Coordinators can participate on logistics threads but must
  not resolve escalations or give medical judgment (app-layer gate, same as existing Care Coordinator rules).

**Suggested shape:**
- New `care_messages` (`thread_id`, `patient_id`, `organisation_id`, `sender_profile_id`,
  `sender_role`, `body`, `created_at`, optional `escalation_id` / `care_plan_id` link) — append-only,
  SELECT+INSERT grants only (mirror `patient_timeline`), no UPDATE/DELETE.
- Optional `care_message_threads` if you want a subject/status per thread; otherwise thread by the linked
  entity.
- Enqueue a `notifications` row (WhatsApp+email) on a new message to the counterparty — reuse the existing
  `notifications` queue + `send-pending-notifications` Edge Function (add a `new_care_message` template).
- Write a `patient_timeline` event on new messages so it shows in the unified feed.
- UI: a thread component on the patient dashboard + the clinician patient-detail page; both reuse the
  existing query/hook patterns.

**Definition of done:** typecheck/lint/test green; RLS verified both directions via rolled-back SQL
(patient sees only own threads; cross-patient isolation holds); notification enqueue verified; timeline
event verified; works fully via app/web.

---

## 3. CGM (continuous glucose monitoring) ingestion — INCLUDE (Phase 2, partner-gated) · **P3**

**Why:** The device layer already handles fingerstick glucometers (Glucose Measurement 0x2A18) but not
continuous glucose monitors. CGM is increasingly standard for type-2 diabetes and is **additive to the
existing ingestion boundary** — CGM readings flow into `vitals_readings` the same way, no parallel table.

**Gate on reality:** Abbott Libre / Dexcom availability and affordability in Nigeria is thin. **Do not
build until a real CGM data source/partner exists** — otherwise it's a button that clicks through to
nothing (same lesson as the consumer-wearable OAuth scaffolding). Keep it schema-ready, build the
ingestion when a partner is signed.

**Suggested shape (follow the existing device contract exactly):**
- CGM is a high-frequency stream: readings land in `vitals_readings` with `source='device'` (or a new
  `source='cgm'` value if you want to distinguish trend-stream from spot readings), `vital_type='blood_glucose'`,
  idempotent dedupe on `external_reading_id` (already the pattern).
- Ingestion path: either the Expo mobile app's BLE bridge (like the existing clinical-device path,
  `POST /api/mobile/device-readings`) **or** a partner cloud webhook — whichever the signed partner supports.
  TarragonHealth never talks to firmware directly (ingestion-boundary rule).
- Abnormal readings still flow the existing escalation/abnormal-result pipeline untouched.
- Diaspora/premium tier for the consumer-CGM ecosystem; a clinical CGM bundle is core-tier (mirror the
  BP-cuff/glucometer bundling decision).
- Consider CGM-specific derived metrics (time-in-range) as a **display-only** dashboard card — not a new
  clinical source of truth.

**Definition of done (when built):** migration committed; RLS on any new rows; dedupe verified; abnormal
path confirmed still to fire; graceful behaviour when no CGM partner is configured.

---

## 4. "Dedicated health coach" model — ADAPT, DO NOT COPY (guardrail note)

Omada's **core relationship is a non-clinical coach**. Tarragon's core relationship is a **doctor** (the
"doctor-led" *headline* was retired 2026-07-18, but the employment model is unchanged). **Do not import
Omada's coach-first model** — it undercuts the clinical-trust thesis and the 5-tier ladder.

Tarragon already has the right primitives:
- **Care Coordinator** (employed, non-clinical — logistics, adherence, missed-reading follow-up), and
- the **lifestyle-coaching engagement layer** (`lifestyle_*` tables, check-ins, reviews).

Map any "coaching" surface Omada inspires onto **those two**, and keep clinical judgment with doctors.
Never grant a coaching/coordinator surface write access to medications, escalation resolution, or protocol
signing (existing app-layer gate). **Action: none — this is a decision to prevent a wrong turn, not a build.**

## 5. MSK (musculoskeletal) programme — SKIP for launch

A major Omada pillar, but it's a **US employer** cost-driver (back pain → lost-productivity claims). In
Tarragon's market the wedge is chronic cardiometabolic disease; MSK is a distraction. **Skip for launch;
revisit only if a specific corporate/HMO client demands it** — at which point it slots in as another
`care_plan_condition` + review cadence, not new machinery.

## 6. Peer support / community groups — DEFER

Tempting for engagement, but it's a **moderation, liability, and clinical-misinformation surface** while
Tarragon is still establishing trust and MDCN tier-authority is an open founder item. The failure mode
(unmoderated medical advice between patients under a doctor-led brand) is high-damage, low-ROI right now.
**Defer** until there's moderation capacity and a clinical-governance answer.

## 7. GLP-1 / semaglutide programme — DEFER (standing decision)

Already the standing decision: obesity launched **lifestyle-managed only**, pharmacotherapy explicitly
deferred (see OBESITY_LIFESTYLE_PATHWAY_SPEC.md §7 and the 2026-07-17 sprint entry). Omada leans into
GLP-1 for US market reasons; in Nigeria cost, supply, and prescribing-authority questions make it
premature. **Stay the course** — do not let Omada's positioning pull it forward without an explicit ask.

---

## 8. Strategic note — where Tarragon already beats Omada

Omada is **chronic-disease management only**. Tarragon fuses that with **lab network, pharmacy fulfilment,
specialist referral, home sample collection, vaccination pathways, and telemedicine** on one shared patient
record. That integrated coordination is the moat — Omada can't match it (no clinics, no local partner
network). Don't burn engineering effort chasing Omada's consumer-app polish (community, gamified streaks)
at the expense of the integrated-coordination story that wins Nigerian HMO/employer contracts.

**Build order recommendation:** P1 (Nigerian meal-analysis) → P2 (in-app care messaging) → P3 (CGM, when a
partner exists). Items 4–7 need no build.
