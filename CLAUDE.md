# Tarragon Health — Claude Code Master Instructions (v3)

> Read every session. Full business detail: `docs/FEATURE_SPEC.md`. Full brand/voice/UI: `docs/BRAND_GUIDE.md`. Marketing site: `docs/MARKETING_SITE_SPEC.md`. Competitive-intelligence feature roadmap: `docs/FULL_SPECIFICATION_V4.md`. Master operating plan (business model, **5-tier doctor ladder**, phased Phase 1/2/3 roadmap): `docs/Tarragon_Health_Master_Operating_Plan_v4.md` — authoritative on the clinical staffing model, supersedes the flat clinician/escalation-doctor language elsewhere. Clinician attribution & trust model: `docs/CLINICAL_TRUST_MODEL_SPEC.md` — still authoritative for per-touchpoint attribution UI rules (e.g. `ReviewedByDoctor`) not covered by the tier ladder. This file is the operating contract — keep it under 300 lines (raised from 200 on 2026-07-15 to let "Current Sprint" read as a scannable dated changelog instead of one dense paragraph), update "Current Sprint" every sprint.

## The Business
Nigeria's digital-first chronic disease, preventive health, and family care coordination OS — the trusted coordination layer between patients, families, doctors, labs, pharmacies, HMOs, and employers. App/web-first, doctor-led (Tarragon directly employs its day-to-day care-team doctors, per `docs/CLINICAL_TRUST_MODEL_SPEC.md`), escalation-driven, AI-automated, partner-network based, with WhatsApp/SMS as a follow-up and notification layer only (see Non-Negotiable Business Rules). **No owned clinics.** Five categories, all architecturally represented from Sprint 1 — they are commercially linked, each feeds the others:

1. **Chronic Disease Management** *(core wedge)* — hypertension, diabetes; expansion: asthma, CKD, heart failure
2. **Preventative Medicine** — cancer/metabolic/infectious/reproductive screening. **Abnormal result → Category 1 upgrade is the highest-priority business event in the platform — never lose it, never let it fail silently.**
3. **Care Coordination** — lab network, pharmacy network, specialist referrals, hospital handoffs
4. **B2B & Institutional** — corporate wellness, HMO capitation, NHIA/government programmes
5. **Platform Infrastructure** *(backbone, not a product line)* — WhatsApp/SMS notification engine (reminders, alerts, confirmations — never signup or a feature's only interface), doctor-led delivery, AI clinical decisioning, longitudinal patient record, partner API layer, analytics

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
- Doctor:patient ratio target — **1:120** for Tier 1–3 staffing (see Clinical Tier Ladder below).
- Abnormal screening result handling (Cat 2→1 upgrade): Supabase trigger → Edge Function → doctor WhatsApp alert **immediate, not scheduled** → doctor has a 4-hour contact SLA → surfaces as Priority 1 (red) on doctor dashboard.

## Clinical Tier Ladder (supersedes flat clinician/escalation-doctor model — 2026-07-15)
Full detail: `docs/Tarragon_Health_Master_Operating_Plan_v4.md` §4/§7/§8. Every clinical judgment is made by a doctor; no case is closed by non-clinical staff; a case climbs only as far as its complexity requires — most stay at Tier 1/2.
- **Care Coordinator** (employed, non-clinical) — logistics only: check-ins, adherence/missed-reading tracking, lab/refill booking. Never interprets a result, adjusts medication, or closes an escalation — routes anything needing judgment to Tier 1.
- **Tier 1** Medical Officer <3yrs (employed) — first-line review of routine/stable readings under protocol; confirms/continues existing stable prescriptions; no new prescribing.
- **Tier 2** Medical Officer 3+yrs (employed) — initiates new medications, standard dose adjustment, handles Tier 1 escalations.
- **Tier 3** Senior Medical Officer (employed) — complex/multi-drug case management, standing QA/spot-audit of Tiers 1–2.
- **Tier 4** Senior Registrar (contracted, part-time retainer) — pre-referral consult, sets referral urgency, approves referrals, owns/updates clinical protocols, supervises Tiers 1–3.
- **Tier 5** Partner Specialist (contracted, referral-only, per-consult) — complex/procedural input; hands routine follow-up back to Tier 3/4 (shared care).

**Schema (layered model):** `clinical_staff.doctor_tier` (built 2026-07-15) carries clinical seniority/routing authority. `clinical_staff.role` (`clinical_director`/`clinician`/`escalation_doctor`) was retired 2026-07-15 (`20260715174500_retire_clinical_staff_role.sql`, see Current Sprint) — replaced by `doctor_tier` plus `clinical_staff.is_clinical_director`. **`is_clinical_director` is a separate org-governance flag (protocol signing, staff verification) orthogonal to tier, not itself a rung on the ladder** — a person can hold Clinical Director status at any tier. `profiles.user_role` (the account/login/RLS role) already had a real, built two-way split before this ladder work: `clinician` (frontline, `/clinician/*` dashboard) vs. `doctor` (escalation-review-only, `/doctor/*` dashboard — `20260709001520_add_doctor_role.sql`) — this maps cleanly onto the ladder without inventing new auth roles: **Tier 1–3 clinical_staff records link to a `clinician`-role profile; Tier 4 (and Tier 5, if given a login at all — referral-only contractors may have none, same as a bio-only Clinical Director) link to a `doctor`-role profile.** Only `care_coordinator` was a genuinely new account value, added this pass. Fine-grained tier detail still lives on `clinical_staff`, not as further auth-enum splitting — Tiers 1–3 share one account role, Tier 4/5 share another.

**Indemnity:** DB-enforced requirement for Clinical Director, Tier 4, and Tier 5 before activation. Tiers 1–3 are employed and covered under Tarragon's institutional policy, not tracked individually.

**Care Coordinator write access:** gets the same org-staff read access as any staff account, but must never gain write access to medications, escalation resolution, or protocol signing — enforced at the app/server-action layer (matches the existing "only Clinical Director can sign protocols" pattern), not a new RLS helper.

**Explicitly Phase 2/3, not initial launch** (confirmed 2026-07-15 — do not build functional code for these without an explicit ask): full specialist-matching engine + 8-stage referral-status pipeline, patient-initiated wellness testing catalogue, Employer/HMO risk-stratification dashboards (today's `/dashboard/corporate` and `/dashboard/hmo` are early/placeholder builds only), Premium ParentCare as a real subscription tier (today only a marketing page), **home sample collection**, and **medication delivery logistics**.

MDCN/regulatory confirmation that this tier authority split (e.g. Tier 1 confirming refills, Tier 2 initiating new medications) is compliant is an open founder item (master plan §16) — never represent the tier ladder as regulator-approved.

## Device & Wearable Integration
Bluetooth clinical devices (BP cuffs, glucometers) are **built** (2026-07-13/14, see Current Sprint). Consumer wearable cloud sync (Apple Health, Google Fit/Health Connect, Oura, WHOOP, Garmin, Fitbit) is **schema-scaffolded only (2026-07-14)** — `wearable_connections`/`wearable_readings` tables + RLS exist (migration `20260714140000_wearable_connections.sql`) and `apps/web/src/lib/wearables/oauth-providers.ts` has a tested, gracefully-degrading OAuth-URL builder for the 4 cloud-OAuth providers (Oura/WHOOP/Garmin/Fitbit) — but there is **no patient-facing "Connect" UI and no webhook ingestion route yet**, deliberately: none of the 5 providers' real developer apps/credentials exist, so a connect button would click through to nothing. Full spec: `docs/FULL_SPECIFICATION_V4.md` §5/§9 (`app/routers/wearables.py` — still unbuilt). Contract to follow when the consumer-wearable path is finished:
- **Ingestion boundary, not owned hardware** — TarragonHealth never talks to device firmware directly. Two ingestion paths only: (1) consumer platform sync via their cloud APIs/webhooks (schema scaffolded, OAuth/webhook flow not yet built); (2) clinical Bluetooth devices paired via the Expo mobile app's native BLE (`apps/mobile`), which uploads parsed readings to `POST /api/mobile/device-readings` — built, per below.
- **Apple Health has no cloud OAuth API at all** — HealthKit data is device-local; syncing it needs the Expo mobile app's own HealthKit bridge (same shape as the BLE clinical-device pairing, not a server-side OAuth redirect), so it's excluded from `oauth-providers.ts`'s `CloudOAuthWearableProvider` type even though `wearable_provider` (the DB enum) includes it for schema completeness.
- **`wearable_readings` is a genuinely separate table from `vitals_readings`, not a "no dual source of truth" violation** — passive wearable metrics (steps, sleep stages, HRV, recovery/strain) have no `vitals_readings.vital_type` equivalent at all. Any wearable metric that *does* overlap an existing vital_type (heart rate → pulse, weight, SpO2) should go to `vitals_readings` with `source='wearable'` instead (that enum value already exists) — the additive-faster-path/no-parallel-table rule below still applies to those overlapping metrics.
- **App/web manual entry is never removed.** Device sync is an additive faster path into the same `vitals_readings` table patients already log into manually via app/web — same downstream escalation logic, same `patient_risk_scores`, same abnormal-result pipeline. No dual source-of-truth for anything that has a `vitals_readings` equivalent — `vitals_readings.source` (`manual`/`device`/`wearable`) distinguishes them, not a parallel table. WhatsApp/SMS may remind a patient to log a reading; it is not itself an entry interface.
- Every reading gets `organisation_id` + RLS like any other table.
- Diaspora/premium tier only for the consumer wearable ecosystem (Apple Health/Oura/WHOOP/Garmin/Fitbit, not yet built) — Bluetooth clinical devices (BP cuff/glucometer/scale) are core-tier, sold as device bundles per `docs/FEATURE_SPEC.md`.
- Weight Scale (0x2A9D) BLE parsing is a known, deliberate scope gap — its GATT resolution needs a separate Weight Scale Feature characteristic not yet implemented; `patient_device_type` includes `scale` for schema completeness but the mobile sync screen shows "not supported yet" for it rather than guessing.

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
- Voice: a doctor who knows your name, not a hospital PA system. No fear-based urgency, no "WARNING:", no clinical jargon in patient-facing copy.

## Current Sprint (UPDATE THIS EVERY SPRINT)

**Status:** Sprint 4 (Python ML Microservice) is paused (2026-07-09) — do not resume without an explicit ask. All active work since then is TypeScript, logged chronologically below.

### Sprint 4 — Python ML Microservice (paused 2026-07-09)
Goal: build `services/ml` into the SCORE2 CVD/HbA1c-trajectory/BP-control/lab-interpretation/cohort-analytics service, wire it into TypeScript via `packages/shared/ml-client.ts`, deploy it — `docs/FEATURE_SPEC.md` §4 (weeks 7–9).

State at pause (confirmed live 2026-07-12): all 6 endpoints typed and never-throw in `ml-client.ts`; wired into BP-control assessment on every BP vitals log, a clinician lab/screening-result form (CVD risk + HbA1c trajectory + `patient_risk_scores` writes), and the corporate dashboard's cohort analytics (org-scoped, no PII sent). Railway deploy confirmed live (`/health`, `/docs` both 200). `patient_risk_scores` has 2 real `bp_control` rows proving the full path (Vercel → Railway → Supabase) worked at least twice — though both predate the "Fix Railway build" PR by a day or two, so if in doubt, log a fresh BP reading and check for a newer row. Sentry wired behind optional `SENTRY_DSN` (no-op if unset); no Sentry project created yet (needs the user's cloud credentials).

### 2026-07-11 — Marketing site + platform convergence (PR #15, merged to main-dev)
- Full marketing site: homepage, 4 priority programmes, pricing, contact/leads, `/medication`, `/labs`
- **AbnormalResultHandler** Edge Function (`supabase/functions/abnormal-result-handler`) — previously missing, now deployed and verified live
- Abnormal-screening E2E test (`apps/web/e2e/`, opt-in via `pnpm test:e2e`)
- WhatsApp policy change codified: app/web is the sole interface for signup/core actions; WhatsApp/SMS is notifications + human doctor↔patient chat only (see Non-Negotiable Business Rules, `docs/ARCHITECTURE.md` §1.3/§8)
- `docs/FULL_SPECIFICATION_V4.md` roadmap doc added
- Staging: Vercel auto-deployed the merge commit (`677735d`) to Preview; build passed but the URL sits behind Vercel's deployment-protection/SSO gate, never independently browser-verified
- CI: TypeScript green; Python ML failed on a pre-existing, unrelated mypy error (confirmed already broken on main-dev before this merge)

### 2026-07-12 — Reconciliation + clinical trust model foundation
**Reconciliation:**
- Local migration filenames now match remote's applied history exactly (30 renamed, committed `df955dd`); `20260711000000_leads.sql` had never actually run — the marketing Contact page's lead capture was silently failing — now live
- Railway's `enchanting-playfulness` service (misleadingly labelled `@tarragon/web`) was confirmed to have always been correctly scoped to `services/ml` — renamed to `@ml-service` for clarity; confirmed genuinely live via `/health`/`/docs`
- `private.handle_new_user()` trigger bugs (missing `+` on phone, dropped role/org on delayed `app_metadata` update) were already fixed by an existing migration — confirmed deployed function matches migration byte-for-byte
- `/corporate`/`/hmo` route collision resolved: platform dashboards moved to `/dashboard/corporate`/`/dashboard/hmo`; bare paths now 404 cleanly and are free for marketing to use
- Pre-existing Python mypy failure fixed (`test_score2.py`'s `dict(...)` + `**kwargs` spread was untyped enough to fail `score2_risk`'s keyword-only params) — inlined the call args instead; `uv run mypy .` clean
- `/about` page built (hero, continuity-thesis pillars, CTA band) — **founder name/photo/bio are still bracketed placeholders**, don't announce this page publicly until a human supplies a real bio
- WhatsApp support-inbox webhook (`supabase/functions/whatsapp-webhook`, human-routed only) and a Termii sender-ID rename (`TarragonHlth` → `Tarragon`) committed

**Clinical trust model foundation** (per `docs/CLINICAL_TRUST_MODEL_SPEC.md` §7 build sequence):
- `clinical_staff` table + `escalations.reviewed_by`/`reviewed_at` — shared null-gated `ReviewedByDoctor` component, set once at resolve time, never retroactively
- `care_team_assignment` (one row per patient) + clinician-side assignment form + patient-facing `YourCareTeam` card, same null-gating
- `protocol_versions` append-only ledger — only the org's active Clinical Director can sign a new protocol version; no update/delete grant at all
- MDCN/NMCN credential verification: `clinical_staff.verified_by` + two DB CHECK constraints (`clinical_staff_active_requires_verification`, `clinical_staff_no_self_verification`) — first UI to actually create `clinical_staff` records
- `PatientEscalations` component — patient-friendly view of the caller's own escalations, composes `ReviewedByDoctor`
- Onboarding wizard (`profiles.onboarding_completed_at` gate, `/onboarding`) — verified live end-to-end
- `send-support-reply` Edge Function (deployed, signs replies with the real clinician name, fails closed if `WHATSAPP_TOKEN` unset) + `/clinician/support-inbox` UI — verified live including the fail-closed path
- Health Passport shipped separately in PR #23 (2026-07-14): `/patient/health-passport`, PDF export via `@react-pdf/renderer` — re-confirmed working 2026-07-15
- Every item from spec §7 done except ops-only items (annual re-verification, indemnity tracking — see 2026-07-13 below)

### 2026-07-12/13 — Patient subscriptions, Paystack payments, add-ons (Sprint 6, NGN only — Stripe/GBP is the entry below)
- `add_ons`/`subscription_add_ons` (each add-on gets its own Paystack Plan+Subscription), `payment_transactions` (webhook-only write), price-lock triggers on `subscription_plans`/`add_ons` once a plan has a real subscriber (admin UI offers "clone as new plan" instead)
- `public.has_feature_access(feature)` RPC generalizes the old inline `has_ai_coach_access()` check (regression-verified)
- Seed data rewritten to match the live pricing page's real tiers (`free`/`essential`/`complete`/`family` + yearly) — old codes were stale and never matched `pricing.ts`; same fix applied to remote
- Paystack: server-only client, hosted-checkout redirect, deployed `paystack-webhook` (signature-verified/idempotent/never-throws)
- Entitlement gating (`RequiresEntitlement`/`UpgradePrompt`) on the 5 capabilities the Free tier excludes; family dashboard (`/patient/family`, `care-team-contact.tsx`) had to be built from scratch
- Full funnel: onboarding plan-selection step → Paystack redirect → webhook-driven activation; self-serve `/patient/subscription`; admin `/admin/settings/subscriptions`
- **2026-07-13, real Paystack test-mode keys supplied:** a genuine `charge.success` processed successfully, confirming `PAYSTACK_WEBHOOK_SECRET` is correctly set
- **Live click-through (2026-07-13) surfaced and fixed 3 real bugs:**
  1. Detach/plan-change didn't call `refetch()` on the relevant React Query hooks — stale UI until manual reload
  2. `subscriptions`' UPDATE RLS only granted org staff, never the subscriber (asymmetric vs. `subscription_add_ons`) — the local-only cancel path silently no-op'd under a patient's own session while still claiming success, leaving them billed. Fixed via `createServiceRoleClient()` for those specific writes (ownership already verified via RLS-scoped SELECT beforehand)
  3. Paystack's `subscription.create` webhook event can arrive before `charge.success` flips the row to `active`, so the enrichment query missed it — fixed by matching `status IN ('trialing','active')`; `paystack-webhook` redeployed (v4)
- **Still open:** a real card charge through Paystack's hosted checkout has never been driven end-to-end in-browser — the sandboxed preview browser can't follow the cross-origin redirect to `checkout.paystack.com` (`ERR_ABORTED`/403 on OPTIONS). Checkout *initialization* is confirmed working (real transaction refs created, verified via Paystack's `/transaction/verify` API) — this exact gap recurred and was re-confirmed 2026-07-15 (see this session's verification pass below)

### 2026-07-13 — Stripe (GBP/USD diaspora)
- Mirrors the Paystack architecture: hosted-checkout redirect, webhook-driven activation, same `subscriptions`/`subscription_add_ons`/`payment_transactions` tables
- `apps/web/src/lib/stripe/` wraps the official SDK to preserve Paystack's never-throw `{ok,data|error}` contract; deployed `stripe-webhook` handles `checkout.session.completed`, subscription created/updated/deleted, invoice succeeded/failed
- `resolveProvider(currency)` (NGN→Paystack, else→Stripe) + a `canDisableRemotely()` gate fixing a real bug: a naive Paystack-shaped check would never cancel a live Stripe subscription, since Stripe rows never populate `provider_email_token`
- Admin UI gained a currency selector; patient/onboarding UI gained `CurrencyTabs`; 18 diaspora rows seeded (round-number pricing, not conversion), `is_active=false` until synced to a real Stripe Price
- **Verified:** typecheck/lint clean; all 18 rows render correctly in-browser; "Sync to Stripe" degrades gracefully without keys
- **Not yet verified:** `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` still empty — no live Stripe Checkout round-trip has happened yet

### 2026-07-13 — Marketing site completion, Lighthouse, clinical_staff ops items, indemnity exemptions
- `/corporate` and `/hmo` marketing pages built via a shared `B2bPageTemplate` — the last unbuilt items in `docs/MARKETING_SITE_SPEC.md` §7's DoD
- Homepage FAQ copy fixed (previously implied WhatsApp could log readings/sign up — now correctly states app/web only)
- Full Lighthouse pass across all 12 marketing pages found and fixed 2 real site-wide issues: low-contrast eyebrow-label text (`text-brand-green` → `text-deep-forest`, several components including a duplicate in `story-panel.tsx` missed on the first grep-only pass) and a missing caption in the homepage walkthrough button's `aria-label` (WCAG 2.5.3). All 12 pages now 100/100/100 a11y/best-practices/SEO, 91–99 performance
- **Merged to `main-dev` as PR #17** (`a4823f6`), all CI green
- Annual license re-verification + indemnity/malpractice insurance tracking built — the last ops-only items from `docs/CLINICAL_TRUST_MODEL_SPEC.md` §7: `indemnity_insurer`/`indemnity_policy_number`/`indemnity_expires_at` + a CHECK constraint blocking activation of a Director/Escalation Doctor without current cover (a write-time gate, not continuous enforcement — ops still needs to act on expiry badges). **Merged as PR #18** (`d89796c`)
- Indemnity-requirement exemptions built per explicit user request (individual/role-wide/org-wide, audited not silent) via a BEFORE INSERT/UPDATE trigger replacing the CHECK constraint; scope isolation verified (a role-wide exemption doesn't leak to other roles). **Merged as PR #19** (`d0a7148`)
- Found (and later resolved by the Stripe work above): two applied-but-uncommitted migrations discovered on remote, meaning someone had started Stripe/diaspora work directly against the DB without committing — same class of drift as the 2026-07-12 leads.sql issue

### 2026-07-13/14 — Bluetooth clinical device integration (branch `claude/tarragon-medical-device-integration-cn8e82`)
- `patient_devices` pairing table + `vitals_readings.source`/`device_id`/`external_reading_id` (idempotent dedupe, no parallel table per the ingestion-boundary rule)
- Real Bluetooth SIG GATT parsers in `packages/shared` (SFLOAT decoder, BP Measurement 0x2A35, Glucose Measurement 0x2A18), 14 tests passing
- `POST /api/mobile/device-readings`: bearer-auth ingestion, dedupes on `23505`, reuses `assessBpControlBestEffort` (extracted + refactored to accept the caller's own Supabase client — fixed a real latent bug where the bearer-token path would've silently no-op'd under RLS)
- New `apps/mobile` Expo scaffold (BLE pairing/sync screens) — typechecks clean, **never run on a simulator/device, no functional verification**
- Weight Scale (0x2A9D) parsing is a known, deliberate scope gap — sync screen shows "not supported yet"
- Adding `apps/mobile` to the workspace broke `pnpm test` (jest-environment-node/jest-mock mismatch) and silently corrupted `apps/web`'s typecheck (`@types/react@18` vs `19` clash) — fixed via `pnpm.overrides` in `pnpm-workspace.yaml`

### 2026-07-15 — Doctor tier ladder, migration reconciliation, Care Coordination merge
- **Tier ladder schema (branch `claude/doctor-tier-ladder-clinical-model`):** `clinical_staff.doctor_tier` (backfilled from the old role column), `profiles.user_role` gained `care_coordinator` (Tier 1-3 map to the existing `clinician` account role, Tier 4/5 to the existing `doctor` role — only `care_coordinator` was genuinely new), `clinician_alerts.escalation_level`, `lab_orders.investigation_tier`. Indemnity trigger extended to cover Tier 4/5 directly
- **`clinical_staff.role` retirement:** dropped the `role` column and its enum type entirely (first DROP COLUMN/DROP TYPE in this project's history) in favor of `is_clinical_director` (orthogonal governance flag, not a tier rung) + `doctor_tier`; all call sites (`useOrgClinicians`, care-team/protocol/health-passport director lookups, admin UI) rewritten; verified via a rolled-back transaction test covering every scope-isolation case
- **Migration reconciliation:** found **13** migrations live on remote with no local file — all from two other open PRs sharing the same DB, [PR #28](https://github.com/Kolalonge-creator/Tarragon-Health/pull/28) (Care Coordination, 8 files) and [PR #36](https://github.com/Kolalonge-creator/Tarragon-Health/pull/36) (Care Nav/employer enrollment, 5 files, 3 needed renaming to their real applied timestamps). Pulled and verified all 13 against live `information_schema`/`pg_proc` before committing — local history now matches remote exactly (83/83)
- **Pharmacy-authority-by-tier:** `private.has_prescribing_authority(org)` (structural DB gate, mirrors the indemnity pattern) requires Tier 2+ or Clinical Director; `medications` RLS now enforces it for org-staff writes (patient self-add untouched). Clinician UI shows a friendly explanation instead of a raw RLS error for Tier 1
- **Tier 1-4 Doctor Dashboard UI:** `/clinician` and `/doctor` now show the caller's real tier label + authority blurb (role-gated views of one worklist, per master plan §12 — not five separate dashboards), falling back to a generic label only when the caller has no `clinical_staff` row
- **PR #28 (Care Coordination) reconciled and merged:** one-off Paystack/Stripe charge path for bookings; human-readable `patient_number`/`order_number`/`referral_number` IDs; `/clinician/referrals` specialist-referral worklist + patient-facing `YourReferrals` card; lab catalogue booking UI (`LabCatalogue`/`LabOrdersList`/`LabResults`) plus 6 new single-test bundles fixing a gap where hiv/hep_b tests existed but were unbookable; pharmacy catalogue booking UI; commission dashboard (`/admin/settings/commissions`) driven by a DB trigger on `payment_confirmed` across all 4 order types
- **Clinician-originated-orders guardrail:** `ordered_by` (→ `clinical_staff`) on `lab_orders`/`pharmacy_orders` + BEFORE INSERT triggers rejecting patient-initiated rows unless tied to a due `screening_schedule` (labs) or an active clinician-sourced medication (pharmacy refills)
- **PR #28 and PR #36 both merged to `main-dev`** (confirmed via `git log`)
- **In-browser verification pass (same day, post-merge):** clicked through all 4 merged flows as real test accounts — clinician lab ordering (real `lab_orders` row, `ordered_by` correctly resolved), patient checkout initiation (real Paystack transaction ref created; the cross-origin redirect to `checkout.paystack.com` is blocked by the sandboxed preview browser, same known gap as the 2026-07-13 Paystack entry above — not a regression), pharmacy ordering correctly blocked for a patient with no clinician-prescribed meds, admin commission dashboard (renders cleanly, correctly empty), employer roster manager, and the Care Navigation booking-request flow (real `booking_requests` row, correctly org-scoped). No console errors, no unexpected failed requests — the 3-way merge reconciliation holds under real clicks, not just typecheck
- **Tier 1 confirm/continue-refill workflow built** (migration `20260715190000_medications_confirm_refill.sql`): `medications.last_confirmed_at`/`last_confirmed_by` (→ `clinical_staff`, server-derived — never client-supplied, can't be spoofed), a new `private.can_confirm_medication_refill(org)` (Tier 1 only) broadening `medications_update`'s RLS gate, and a BEFORE UPDATE trigger (`private.enforce_medication_confirm_only`) that restricts a non-prescribing caller to touching `refill_date` only on an existing `source='clinician'` row — drug/dose/frequency/active-status stay Tier 2+/Director acts, patient-sourced medications are rejected outright. UI: a "Confirm & continue" control on `MedicationsList` (shared with the patient's own view but only rendered when the clinician page passes `canConfirmRefill`, i.e. caller is Tier 1 and lacks prescribing authority), plus a null-gated "Confirmed by your care team · date" line. Verified with a 5-case rolled-back transaction test (refill-only succeeds; dose/is_active/patient-sourced-med all correctly blocked with `42501`; spoofed `last_confirmed_by` silently overridden by the trigger) and a real live click-through as the Tier 1 test account. `pnpm typecheck`/`lint`/`test` (189 tests) all clean.
- **Real card charges driven end-to-end in a real, non-sandboxed browser** (via the `claude-in-chrome` extension controlling the user's actual Chrome, not the sandboxed preview) — closes the gap flagged in the entry above. **Paystack:** a genuine `4084...4081` test charge on lab order LAB-000020 (₦9,000) → real `charge.success` webhook → `lab_orders.status='payment_confirmed'` → commission auto-recorded (₦1,800, Healthtracka, `pending`) — worked cleanly, Paystack's Edge Function secrets were already correctly configured. **Stripe:** synced `essential_usd` to a real Stripe Price via `/admin/settings/subscriptions` (`stripe_price_id`/`stripe_product_id` now set, `is_active=true`); a genuine `4242...4242` test charge produced a real, verified-via-API Stripe subscription — but found and fixed a real gap: the deployed `stripe-webhook` Edge Function reads `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` from its own Deno secrets store, separate from `apps/web/.env.local` (which only configures the Next.js side), so all 6 webhook deliveries at checkout time silently no-op'd (`{ok:false,error:"not_configured"}`, still HTTP 200, so Stripe never auto-retried). Once the user set those two secrets directly on the Edge Function, replayed the missed events as properly HMAC-signed synthetic webhooks (built from real Stripe API data, POSTed only to our own endpoint — no Stripe domain touched) to confirm the fix: `subscriptions.status='active'`, real `provider_ref`, `current_period_end` correctly filled in. **Lesson for next time:** any Edge Function webhook integration needs its secrets set in *both* places — `.env.local` for local dev and the Supabase Edge Function secrets store for the deployed function — they do not share a source.
- **Next:** nothing outstanding from this pass. Broader project Next items unchanged — see Clinical Tier Ladder's Phase 2/3 list above (specialist-matching engine, wellness testing, Employer/HMO risk dashboards, home sample collection, medication delivery) — none of those are in scope without an explicit ask.

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
- Never render a UI element claiming a doctor reviewed a specific case without a corresponding `reviewed_by`/`reviewed_at` record — the "Reviewed by Dr. X" pattern must be a single shared component that is null-gated, never a hardcoded string (see `docs/CLINICAL_TRUST_MODEL_SPEC.md` §2, §9)
- Never grant a Care Coordinator account write access to medications, escalation resolution, or protocol signing — app-layer gate only, see Clinical Tier Ladder above
- Never infer or default a `doctor_tier` in code — an unset tier means the record needs an admin to assign one; same null-gating principle as `reviewed_by`/`reviewed_at`
- Never build functional code (not just schema scaffolding) for home sample collection, medication delivery logistics, the full referral-matching pipeline, patient-initiated wellness testing, or Employer/HMO risk dashboards without an explicit ask — see Clinical Tier Ladder above
- **Superseded 2026-07-15 — Tarragon now directly employs its own doctors; a named doctor is the default face of the day-to-day patient relationship** (see `docs/CLINICAL_TRUST_MODEL_SPEC.md` §1, §9, updated same date). Escalation-doctor review (a second, more senior doctor, distinct from the patient's own day-to-day doctor) is still earned per-case and must never be claimed without a real `reviewed_by`/`reviewed_at` record — that specific attribution rule still applies.

## Where to Look
- System architecture, topology, RLS model, event pipelines, infra → `docs/ARCHITECTURE.md`
- Business model, pricing, full DB schema, 7-sprint plan, clinical protocols, launch gates → `docs/FEATURE_SPEC.md`
- Brand voice, tagline system, colour/type tokens, dashboard copy patterns → `docs/BRAND_GUIDE.md`
- Public marketing site — sitemap, page copy, design tokens, hostname routing, DoD → `docs/MARKETING_SITE_SPEC.md`
- Logo assets → `/brand/Tarragon_Health_Logo_Mark.png`, `/brand/Tarragon_Health_Logo_Lockup.png` (marketing deploy copies → `apps/web/public/brand/`)
- Competitive-intelligence feature roadmap (Health Score, wearables, symptom tracking, fee-at-risk contracts, phased Now/Phase 2/Phase 3) → `docs/FULL_SPECIFICATION_V4.md` — additive feature layer only; per its own §11 guardrail it informs the roadmap and never overrides "Current Sprint" above
- Clinician/doctor role architecture, per-touchpoint attribution rules, escalation→doctor review flow, `clinical_staff`/`care_team_assignment`/`protocol_versions` schema, MDCN/NMCN compliance → `docs/CLINICAL_TRUST_MODEL_SPEC.md` — authoritative on conflicts touching clinician attribution or escalation branding; its Stage/§ cross-references map to the original `docs/source/` planning docs, not `FEATURE_SPEC.md`'s Sprint numbers — see the reconciliation note at the top of the file
- 5-tier doctor ladder, Care Coordinator role, doctor-tier staffing/indemnity rules, phased Phase 1/2/3 roadmap (specialist-matching engine, wellness testing, Employer/HMO dashboards, home sample collection, medication delivery) → `docs/Tarragon_Health_Master_Operating_Plan_v4.md` — authoritative on the clinical staffing model where it conflicts with `CLINICAL_TRUST_MODEL_SPEC.md`'s older flat-role language
