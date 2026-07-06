# Tarragon Health — Claude Code Master Instructions (v3)

> Read every session. Full business detail: `docs/FEATURE_SPEC.md`. Full brand/voice/UI: `docs/BRAND_GUIDE.md`. This file is the operating contract — keep it under 200 lines, update "Current Sprint" every sprint.

## The Business
Nigeria's digital-first chronic disease, preventive health, and family care coordination OS — the trusted coordination layer between patients, families, clinicians, labs, pharmacies, HMOs, and employers. Digital-first, WhatsApp/SMS-enabled, clinician-led, escalation-driven, AI-automated, partner-network based. **No owned clinics.** Five categories, all architecturally represented from Sprint 1 — they are commercially linked, each feeds the others:

1. **Chronic Disease Management** *(core wedge)* — hypertension, diabetes; expansion: asthma, CKD, heart failure
2. **Preventative Medicine** — cancer/metabolic/infectious/reproductive screening. **Abnormal result → Category 1 upgrade is the highest-priority business event in the platform — never lose it, never let it fail silently.**
3. **Care Coordination** — lab network, pharmacy network, specialist referrals, hospital handoffs
4. **B2B & Institutional** — corporate wellness, HMO capitation, NHIA/government programmes
5. **Platform Infrastructure** *(backbone, not a product line)* — WhatsApp/SMS engine, nurse-led delivery, AI clinical decisioning, longitudinal patient record, partner API layer, analytics

Prevention and chronic management **share the same patient record** — design every table and dashboard for dual-state.

## Architecture: Two-Layer (Stack A — Final, Do Not Relitigate)

### Primary Platform — TypeScript
- Web: Next.js 16, TypeScript, Tailwind, shadcn/ui (`apps/web`) — this Next.js has breaking changes vs. training data; read `node_modules/next/dist/docs/` before writing framework code
- Mobile: React Native Expo (`apps/mobile`)
- DB/Auth/Storage/Realtime: Supabase Postgres, **eu-west-1** region (Supabase has no Africa region; closest available to Nigeria — NDPR residency gap accepted for now), pgvector
- Cache/queues: Upstash Redis
- AI workflows: LangGraph.js + Claude API
- Comms: WhatsApp Cloud API (**primary patient channel**), Termii SMS (fallback)
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
- **Every patient action must work via WhatsApp AND via app/web** — no feature ships app-only.
- Phone numbers always E.164 (`+234XXXXXXXXX`). Timezone always `Africa/Lagos`.
- Every table has `organisation_id` — always filter by it. **RLS enforced at the Postgres level for every multi-tenant table — never bypass, never filter in application code instead.**
- Clinician:patient ratio target — **1:120**. Four-level clinical escalation: routine → clinician review → urgent escalation → emergency/urgent care advice.
- Abnormal screening result handling (Cat 2→1 upgrade): Supabase trigger → Edge Function → clinician WhatsApp alert **immediate, not scheduled** → clinician has a 4-hour contact SLA → surfaces as Priority 1 (red) on clinician dashboard.

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
Current Sprint: Sprint 3 — V1 Consumer Prevention Foundation
Sprint Goal: Reconcile `TARRAGON_HEALTH_V1_SPEC.md` (standalone consumer build brief) with the existing schema and ship the DB foundation for risk assessment, vaccination registry, family profile-access, facility directory, and an AI coach scaffold — see `docs/FEATURE_SPEC.md` §10 for the reconciliation decisions. No new B2B/HMO/corporate feature work until this track ships.
Current Task: Phase 0 complete — schema migrations (`profile_access`, `risk_assessment_responses`/`prevention_risk_scores`, `vaccination_catalog`/`vaccination_records`, `facilities`/`booking_requests`, `ai_conversations`, default `direct_consumer` organisation) + seed data + doc reconciliation. Next: notification send layer (WhatsApp/Termii), then the risk-tier rules engine.
Active Service: TypeScript

## Definition of Done
- TypeScript: compiles, ESLint passes, tests pass, migrations committed
- Python: mypy passes, pytest passes, all Pydantic schemas typed
- Both: feature branch (never commit to main), `.env.example` updated for any new vars, works via WhatsApp if it's a patient-facing feature

## What Claude Must Never Do
- Never commit directly to `main`
- Never hardcode credentials
- Never bypass Supabase RLS, "just for this query"
- Never give the ML service direct database access
- Never skip Zod validation (TS) or Pydantic schemas (Python)
- Never design a patient-facing feature that only works in the app, not via WhatsApp
- Never deprioritise or silently swallow an abnormal screening result event
- Never invent a standalone sub-brand name for an internal product (see `docs/BRAND_GUIDE.md` §7)

## Where to Look
- System architecture, topology, RLS model, event pipelines, infra → `docs/ARCHITECTURE.md`
- Business model, pricing, full DB schema, 7-sprint plan, clinical protocols, launch gates → `docs/FEATURE_SPEC.md`
- Brand voice, tagline system, colour/type tokens, dashboard copy patterns → `docs/BRAND_GUIDE.md`
- Logo assets → `/brand/Tarragon_Health_Logo_Mark.png`, `/brand/Tarragon_Health_Logo_Lockup.png`
