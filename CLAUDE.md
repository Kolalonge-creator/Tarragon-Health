# Tarragon Health — Claude Code Master Instructions (v3)

> Read every session. Full business detail: `docs/FEATURE_SPEC.md`. Full brand/voice/UI: `docs/BRAND_GUIDE.md`. Marketing site: `docs/MARKETING_SITE_SPEC.md`. Competitive-intelligence feature roadmap: `docs/FULL_SPECIFICATION_V4.md`. This file is the operating contract — keep it under 200 lines, update "Current Sprint" every sprint.

## The Business
Nigeria's digital-first chronic disease, preventive health, and family care coordination OS — the trusted coordination layer between patients, families, clinicians, labs, pharmacies, HMOs, and employers. App/web-first, clinician-led, escalation-driven, AI-automated, partner-network based, with WhatsApp/SMS as a follow-up and notification layer only (see Non-Negotiable Business Rules). **No owned clinics.** Five categories, all architecturally represented from Sprint 1 — they are commercially linked, each feeds the others:

1. **Chronic Disease Management** *(core wedge)* — hypertension, diabetes; expansion: asthma, CKD, heart failure
2. **Preventative Medicine** — cancer/metabolic/infectious/reproductive screening. **Abnormal result → Category 1 upgrade is the highest-priority business event in the platform — never lose it, never let it fail silently.**
3. **Care Coordination** — lab network, pharmacy network, specialist referrals, hospital handoffs
4. **B2B & Institutional** — corporate wellness, HMO capitation, NHIA/government programmes
5. **Platform Infrastructure** *(backbone, not a product line)* — WhatsApp/SMS notification engine (reminders, alerts, confirmations — never signup or a feature's only interface), nurse-led delivery, AI clinical decisioning, longitudinal patient record, partner API layer, analytics

Prevention and chronic management **share the same patient record** — design every table and dashboard for dual-state.

## Architecture: Two-Layer (Stack A — Final, Do Not Relitigate)

### Primary Platform — TypeScript
- Web: Next.js 16, TypeScript, Tailwind, shadcn/ui (`apps/web`) — this Next.js has breaking changes vs. training data; read `node_modules/next/dist/docs/` before writing framework code
- **Marketing site:** public pages live in `apps/web/src/app/(marketing)/` as a route group inside the same Next.js app — not a separate package yet. `middleware.ts` routes by hostname: root domain → marketing, `app.` subdomain → platform. Full spec, page copy, and design direction in `docs/MARKETING_SITE_SPEC.md` — read it before building any marketing page. Split into `apps/marketing` only when marketing needs its own CMS/team/deploy velocity — not yet. Marketing pages must not import platform/auth modules; Contact/Join is the only page that writes to Supabase (`leads` table).
- Mobile: React Native Expo (`apps/mobile`)
- DB/Auth/Storage/Realtime: Supabase Postgres, **eu-west-1** region (Supabase has no Africa region; closest available to Nigeria — NDPR residency gap accepted for now), pgvector
- Cache/queues: Upstash Redis
- AI workflows: LangGraph.js + Claude API
- Comms: WhatsApp Cloud API + Termii SMS (fallback) — **follow-up/notification channel only** (reminders, alerts, confirmations); never required for signup or for any feature to function — see Non-Negotiable Business Rules
- Payments: Paystack (NGN), Stripe (GBP/USD diaspora)
- Hosting: Vercel (web + Edge Functions), Railway (persistent compute/background jobs), Cloudflare (DNS/edge)

### ML Microservice — Python (`services/ml/`)
- FastAPI 0.115+, Python 3.12, package manager **uv only** (never bare pip)
- scikit-learn, pandas, numpy, scipy; Pydantic v2 everywhere; pytest + httpx
- **Stateless. No database access. No file writes.** Patient data arrives in the request body — never pulled by the service.

### Service Communication Rules
- TypeScript → ML service over HTTP only (`ML_SERVICE_URL`), auth header `X-Service-Key` (`ML_SERVICE_KEY`)
- 5-second timeout, graceful fallback — **the platform must keep working if ML is down**
- `packages/shared/ml-client.ts`: typed client, never throws, returns `null` on error

## Non-Negotiable Business Rules
- All NGN amounts stored in **kobo** (smallest unit). Diaspora billing: GBP primary, USD secondary, via Stripe.
- **Superseded 2026-07-11 — WhatsApp is not a required interface for signup or core platform actions.** Signup, onboarding, and every core patient/clinician transaction (vitals/meds/screening/booking logging, dose tracking, etc.) happen via app or web only — no bot-driven data entry over WhatsApp, ever, and no feature may be built to depend on a WhatsApp send succeeding. WhatsApp/SMS (Termii fallback) still carries reminders/alerts/confirmations, **and patients may message their doctor on WhatsApp for support, with the doctor replying on WhatsApp too** — that two-way channel is human-routed (a clinician inbox), never parsed by automation into a platform action.
- Phone numbers always E.164 (`+234XXXXXXXXX`). Timezone always `Africa/Lagos`.
- Every table has `organisation_id` — always filter by it. **RLS enforced at the Postgres level for every multi-tenant table — never bypass, never filter in application code instead.**
- Clinician:patient ratio target — **1:120**. Four-level clinical escalation: routine → clinician review → urgent escalation → emergency/urgent care advice.
- Abnormal screening result handling (Cat 2→1 upgrade): Supabase trigger → Edge Function → clinician WhatsApp alert **immediate, not scheduled** → clinician has a 4-hour contact SLA → surfaces as Priority 1 (red) on clinician dashboard.

## Device & Wearable Integration (Planned — Phase 3, not yet built)
Full spec: `docs/FULL_SPECIFICATION_V4.md` §5/§9 (`wearable_connections`, `wearable_readings` tables; `app/routers/wearables.py`). Contract to follow when this is built:
- **Ingestion boundary, not owned hardware** — TarragonHealth never talks to device firmware directly. Two ingestion paths only: (1) consumer platform sync (Apple Health, Google Fit/Health Connect, Oura, WHOOP, Garmin, Fitbit) via their cloud APIs/webhooks; (2) clinical Bluetooth devices (BP cuffs, glucometers, smart scales) paired via the Expo mobile app's native BLE, which uploads readings to the platform — the ML service itself never touches a device.
- **App/web manual entry is never removed.** Device sync is an additive faster path into the same vitals tables patients already log into manually via app/web — same downstream escalation logic, same `patient_risk_scores`, same abnormal-result pipeline. No dual source-of-truth. WhatsApp/SMS may remind a patient to log a reading; it is not itself an entry interface.
- Every reading gets `organisation_id` + RLS like any other table; store raw values + unit + `source` (device vs. manual) on `wearable_readings` for audit.
- Diaspora/premium tier only for the consumer wearable ecosystem (Apple Health/Oura/WHOOP/Garmin/Fitbit) — Bluetooth clinical devices (BP cuff/glucometer/scale) are core-tier, sold as device bundles per `docs/FEATURE_SPEC.md`.
- Per `docs/FULL_SPECIFICATION_V4.md` §11: this is roadmap, not current work — do not start building it unless the user explicitly asks or "Current Sprint" below is updated to point at it.

## TypeScript Code Rules
- Strict mode always. No `any`. Ever. pnpm only.
- All DB queries via Supabase client with RLS active. All API routes validate input with Zod. React Query for all data fetching.
- kebab-case files, PascalCase components. `NEXT_PUBLIC_` prefix only for client-safe env vars. Jest tests for every service function.

## Python Code Rules
- Python 3.12 + uv only. Pydantic v2 schemas for every endpoint — no untyped dicts. Type hints on all params/returns.
- `async def` for all endpoints. Models loaded once at startup (lifespan), never per request. pytest for every model function.
- Never import from `apps/` or `packages/` — the ML service is fully standalone.

## Key Partners & Market References (use real names in seed data / demos)
- HMOs: Reliance, Avon, Ronsberger, Wellahealth. Labs: Synlab Nigeria, Cerba Lancet, Healthtracka, Afriglobal Medicare.
- Comparable platforms referenced for positioning: Helium Health, Wellahealth.

## Brand (see `docs/BRAND_GUIDE.md` for full system)
- Master tagline: **"Care that stays with you."** Wordmark: **TarragonHealth** (camel-case). Mark: **Guard Leaf** (shield + sprout crown + checkmark vein).
- Tarragon Green `#0E7C52` (brand/primary actions), Clinical Navy `#12324B` (B2B/clinical documents). Clinical dashboard status colours (green/amber/red/blue/grey) are a **separate system** from brand colour — never confuse the two.
- Voice: a nurse who knows your name, not a hospital PA system. No fear-based urgency, no "WARNING:", no clinical jargon in patient-facing copy.

## Current Sprint (UPDATE THIS EVERY SPRINT)
Current Sprint: Sprint 4 — Python ML Microservice — **ON HOLD (2026-07-09)** per user decision to prioritize other platform work; do not resume ML work unless explicitly asked.
Sprint Goal (paused): Build out `services/ml` (Sprint 1 gave it a bare FastAPI scaffold) into the SCORE2 CVD/HbA1c-trajectory/BP-control/lab-interpretation/cohort-analytics service, wire it into the TypeScript platform via `packages/shared/ml-client.ts`, and deploy it — per `docs/FEATURE_SPEC.md` §4 Sprint 4 detail (weeks 7–9).
State at pause: Week 9 done — `packages/shared/ml-client.ts` has typed helpers for all 6 endpoints (`cvdRisk`, `hba1cTrajectory`, `bpControl`, `interpretLabs`, `analyseCohort`, `batchPredict`), each never-throws/null-on-failure per the existing contract. Wired into real call sites: BP-control assessment after every blood-pressure vitals log (`apps/web/.../patient/actions.ts`); a new clinician lab/screening-result form (`.../clinician/patients/[patientId]/screening-result-form.tsx`) that calls `/interpret/labs`, opportunistically computes CVD risk (when a lipid panel + existing BP/smoking data are available) and HbA1c trajectory (via the new `lab_analyte_readings` history table), and writes `patient_risk_scores`; the corporate dashboard now renders real `/analytics/cohort` output scoped to the admin's own `organisation_id` (no PII sent). Sentry wired behind an optional `SENTRY_DSN` env var (no-op if unset); Dockerfile/health check confirmed deploy-ready as-is. Remaining when resumed: the user runs the actual Railway/Render deploy and creates a Sentry project (needs their cloud credentials/DSN, not available in this environment) — see session notes for exact steps.
Active Service: TypeScript — **marketing site + platform convergence, merged to `main-dev` 2026-07-11 (PR #15).** Landed: full marketing site (homepage, 4 priority programmes, pricing, contact/leads, `/medication` + `/labs`); the previously-missing **AbnormalResultHandler** Edge Function (`supabase/functions/abnormal-result-handler`), deployed and verified live against `koiplnmbgnqnbywhpjlf`; an abnormal-screening E2E test (`apps/web/e2e/`, opt-in via `pnpm test:e2e`); the WhatsApp policy change (app/web is the sole interface for signup/core actions; WhatsApp/SMS is notifications + human doctor↔patient support chat only — see Non-Negotiable Business Rules, `docs/ARCHITECTURE.md` §1.3/§8, `docs/FEATURE_SPEC.md`); `docs/FULL_SPECIFICATION_V4.md` roadmap doc. **Staging deploy (2026-07-11):** Vercel auto-deployed `main-dev`'s merge commit (`677735d`) to its Preview environment — build succeeded per Vercel's own check, but the URL sits behind Vercel's deployment-protection/SSO gate so it hasn't been independently browser-verified; ask the user to confirm or disable protection for this environment. A Railway deployment (`enchanting-playfulness` service) also fired for `@tarragon/web` on this same commit — unexpected, since Railway is documented as ML/background-compute-only (never the web app); flagged, not investigated. CI on the PR/merge: TypeScript (typecheck/lint/test/build) passed; Python ML failed on a **pre-existing, unrelated** `mypy` error in `services/ml/tests/test_score2.py` — confirmed already failing on main-dev's last 4 runs before this merge, not something this PR touched or introduced. **Known open items (not blocking, not yet fixed):** (1) local migration filenames/timestamps still don't match the remote project's applied migration history; (2) two bugs in the deployed `private.handle_new_user()` trigger — `admin.createUser({ phone })` strips the leading `+` before it hits `profiles_phone_e164`, and the trigger fires before GoTrue's `app_metadata` update lands so `role`/`organisation_id` are silently dropped (deployed function also has an uncommitted coalesce-to-default-org fallback — more drift, same shape as (1)); (3) `/corporate` and `/hmo` marketing pages blocked on a path collision with platform dashboard routes of the same name; (4) `/about` page not started; (5) pre-existing Python ML mypy failure above. **Next:** decide which of the open items above to pick up, or move to a new initiative. See `docs/MARKETING_SITE_SPEC.md` §7, `docs/ARCHITECTURE.md` §7/§17 item 5.

## Definition of Done
- TypeScript: compiles, ESLint passes, tests pass, migrations committed
- Python: mypy passes, pytest passes, all Pydantic schemas typed
- Both: feature branch (never commit to main), `.env.example` updated for any new vars, works fully via app/web — WhatsApp/SMS notifications are additive, never required

## What Claude Must Never Do
- Never commit directly to `main`
- Never hardcode credentials
- Never bypass Supabase RLS, "just for this query"
- Never give the ML service direct database access
- Never skip Zod validation (TS) or Pydantic schemas (Python)
- Never design a patient-facing feature that requires a WhatsApp send to succeed, or that only works via WhatsApp — app/web is the interface for every core action; WhatsApp/SMS is notifications plus human doctor↔patient support chat, not a transactional interface
- Never build a WhatsApp-initiated signup, onboarding, or account-creation flow, and never build automation (bots/intent parsing) that turns an inbound WhatsApp message into a platform action — signup and core actions are app/web only; inbound WhatsApp only ever routes to a human clinician inbox
- Never deprioritise or silently swallow an abnormal screening result event
- Never invent a standalone sub-brand name for an internal product (see `docs/BRAND_GUIDE.md` §7)

## Where to Look
- System architecture, topology, RLS model, event pipelines, infra → `docs/ARCHITECTURE.md`
- Business model, pricing, full DB schema, 7-sprint plan, clinical protocols, launch gates → `docs/FEATURE_SPEC.md`
- Brand voice, tagline system, colour/type tokens, dashboard copy patterns → `docs/BRAND_GUIDE.md`
- Public marketing site — sitemap, page copy, design tokens, hostname routing, DoD → `docs/MARKETING_SITE_SPEC.md`
- Logo assets → `/brand/Tarragon_Health_Logo_Mark.png`, `/brand/Tarragon_Health_Logo_Lockup.png` (marketing deploy copies → `apps/web/public/brand/`)
- Competitive-intelligence feature roadmap (Health Score, wearables, symptom tracking, fee-at-risk contracts, phased Now/Phase 2/Phase 3) → `docs/FULL_SPECIFICATION_V4.md` — additive feature layer only; per its own §11 guardrail it informs the roadmap and never overrides "Current Sprint" above
