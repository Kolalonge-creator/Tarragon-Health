# Tarragon Health — Claude Code Master Instructions

> Read every session.

## Where things actually stand (documentation cleanup pass, 2026-08-04)

**`apps/web` is the platform and the build target.** A same-day pivot on 2026-07-29 briefly froze it
in favor of a narrower "v3" cardiometabolic rebuild (`tarragon-build-spec-v3.md`, a separate
`tarragon-control` repo) — that pivot was reversed within a day. **v3 is an idea source, not a
replacement.** Its engineering/clinical-safety discipline (invariants as failing-first tests,
deterministic classification with a `clinician_override` field, delivery-state tracking, the
escalation SLA as data not code, `content_class` CHECKs on notifications, etc.) was ported into
`apps/web` piece by piece through 2026-07-30 — that port is now **done** (see the archive's "v3
integration" entries), except `recorded_by NOT NULL` provenance, which was deliberately left as
`ON DELETE RESTRICT` instead of `NOT NULL` (a blanket `NOT NULL` would break every legitimately-
null-until-actioned attribution column on the platform — see the archive for the full reasoning).
v3's product-narrowing ideas were split: four were adopted as real, shipped removals — no
capitation, ever (I8); institutions get aggregate-only patient access, ever, only superadmin may
drill into an individual (I9); individual enrolment only (no family plans, no ParentCare); one
naira price list, with a derived USD price at an admin-set rate — all confirmed shipped 2026-07-29.
Everything else in v3's scope-narrowing list was rejected; care coordination, specialist referrals,
and multimorbidity remain core platform categories.

**Database:** the one true, go-forward Supabase project is `koiplnmbgnqnbywhpjlf` ("Tarragon
Health"). Two other projects existed as of 2026-07-29 — `rjsxbhgqdudowlvarmzq` ("Tarragon
Platform", a throwaway rehearsal copy) and `jpdwbnvrgvpntcmfefeu` ("tarragon-control-staging", a
paused duplicate v3 build) — and were flagged for owner-side deletion (an agent can pause a
Supabase project, not delete one). Confirm whether that's actually happened before assuming either
still exists. `reference/tarragon-control/` holds the only backup (a git bundle + full file
snapshot) of the separate `tarragon-control` v3 repo, which has no git remote — it and the
root-level `tarragon-control/` working copy are deliberate preservation, not duplicate clutter;
don't delete either without checking with the founder first.

**Standing engineering lessons from the 2026-07-29 database rebuild** (still apply — re-learned the
hard way more than once, worth keeping visible rather than buried 2,000 lines into a changelog):
- **Never hand-type a round-number migration timestamp.** Six real migrations once collided on the
  same `20260720120000` version number from parallel sessions doing exactly that —
  `supabase_migrations.version` is the primary key, so only the first of each group ever recorded.
- **A live schema object can exist with no migration record at all — not even an uncommitted one.**
  Found 2026-08-27: 7 migrations from a same-day audit pass were live but never committed (at least
  present in `supabase_migrations.schema_migrations`, so comparing `list_migrations` against local
  files caught them); 3 more had drifted filenames. Worse, `private.guard_profiles_self_update()` —
  the trigger blocking a user from self-editing privileged `profiles` columns (`role`,
  `organisation_id`, `lab_provider_id`, …) — existed live with **no migration record anywhere,
  including in `schema_migrations`**, meaning it was applied by some means entirely outside the
  migration system and a plain `list_migrations`-vs-local-files diff can't find it. Before assuming
  a security-relevant trigger/function/policy doesn't exist (or extending one), check its live
  definition directly (`pg_get_functiondef`/`pg_get_triggerdef` via `execute_sql`), not just
  whether a migration file for it exists.
- **A freshly created table needs its own `grant ... to authenticated`.** RLS restricts rows; it
  does not grant table-level access. Supabase auto-provisions that grant at project creation but not
  for a table added later by a plain migration. This silently broke access at least three times
  (the original M1 sprint, then `case_briefs`, then ~30 tables at once found in a 2026-08-01 sweep)
  before being fixed at the root with an `alter default privileges` migration — see
  `reference_authenticated_table_grants_root_cause.md` in memory for the full mechanism, and note
  the failure mode looks like an empty result, not an error.
- **`anon`'s EXECUTE on a function is revoked via `revoke ... from public`, not `from anon`** — it
  inherits execute through the PUBLIC pseudo-role (the leading `=X/postgres` entry in
  `pg_proc.proacl`), not a direct grant. This was believed "fixed" and found still-broken multiple
  times across this project's history. See `feedback_supabase_anon_execute_gotcha.md` in memory
  before trusting any past migration's own comment that claims this is closed — re-check live with
  `has_function_privilege('anon', '<function>', 'EXECUTE')` rather than the comment.
- **pgvector lives in the `extensions` schema.** Write `extensions.vector(...)`, never a bare
  `vector(...)`, or a migration replay fails (it isn't on the migration connection's search_path).
- **`private.is_org_staff()` is the highest-leverage security function in the codebase.** It gates
  roughly 110 patient-scoped tables at once — a single wrong role admitted to it is a platform-wide
  PHI exposure, not a local bug (this happened twice for real: `corporate_admin`/`hmo_admin` in
  2026-07-16, then `pharmacist`/`lab_partner` in 2026-07-27). Treat any change to it as a change to
  the whole RLS surface and re-run `packages/db/tests/` afterward.
- **A reusable pattern for removing a shipped feature** (used for all four founder-narrowing
  removals above, worth reusing for the next one): count the affected rows first — a zero-row
  feature turns a feared data migration into a pure structural change, and the count belongs in the
  migration header so a reader can see why no conversion step exists; delete the enum VALUE, not
  just the app-code path that used it, so the feature can't silently grow back through an
  unreachable member; rewrite dependent views/policies before dropping what they reference (`DROP
  TABLE` refuses while a policy references it, and `CASCADE` can quietly leave a dependent one
  policy short); end the migration in a `DO` block of assertions so "removed" is provable rather than
  hopeful; prove any RLS change with a simulated session **and** a control in a rolled-back
  transaction, then deliberately sabotage the test once to confirm it actually discriminates rather
  than passing vacuously; reconcile `seed.sql` too (it only runs on a local `db reset`, never against
  a remote project, so anything data-only silently survives there and resurrects on a fresh
  environment); and check the payment/partner-provider side as well as the database (Paystack has no
  delete for a Plan, so "removed" there means "no live row references it anymore," not "gone").

**Pricing, entitlements, and what's shipped churn constantly.** Diaspora pricing alone was reworked
at least four times after 2026-07-29 before diaspora subscriptions were replaced entirely by a
sponsor + Care Voucher model (2026-07-31). **Do not treat any specific price, rate, plan name, or
feature-availability claim in this file's archive as current** — check the live database or the
actual running code. The archive is a record of decisions and reasoning, not a source of current
facts.

Full day-by-day detail — every migration, every bug found and fixed, every founder decision and its
exact date — is preserved losslessly in `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`.

## Platform Operating Rules

> Full business detail: `docs/FEATURE_SPEC.md`. Full brand/voice/UI: `docs/BRAND_GUIDE.md`. Marketing site: `docs/MARKETING_SITE_SPEC.md`. Competitive-intelligence feature roadmap: `docs/FULL_SPECIFICATION_V4.md`. Master operating plan (business model, **5-tier doctor ladder**, phased Phase 1/2/3 roadmap): `docs/Tarragon_Health_Master_Operating_Plan_v4.md` — authoritative on the clinical staffing model, supersedes the flat clinician/escalation-doctor language elsewhere. Clinician attribution & trust model: `docs/CLINICAL_TRUST_MODEL_SPEC.md` — still authoritative for per-touchpoint attribution UI rules (e.g. `ReviewedByDoctor`) not covered by the tier ladder. Clinical Network design/gap-analysis (provider directory, verification, availability, discovery, referral integration, org accounts): `docs/CLINICAL_NETWORK_SPEC.md` — a design doc, not a build order; defers to this file's guardrail on the specialist-matching/ranking engine. **This file is the operating contract, kept lean on purpose** — the sections below (Business, Architecture, Rules, Clinical Tier Ladder, Code Rules, Brand) change rarely and should stay short. Anything dated or historical belongs in `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`, never appended here — that discipline is what keeps this file readable (it grew past 2,600 lines once already by not following it; see the cleanup note above).

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
- **Superseded 2026-07-11 — WhatsApp is not a required interface for signup or core platform actions.** Signup, onboarding, and every core patient/clinician transaction (vitals/meds/screening/booking logging, dose tracking, etc.) happen via app or web only — no bot-driven data entry over WhatsApp, ever, and no feature may be built to depend on a WhatsApp send succeeding. WhatsApp/SMS (Termii fallback) carries reminders/alerts/confirmations only.
- **Superseded 2026-07-30 — two-way patient↔care-team conversation is in-app only, never WhatsApp.** The prior wording here ("patients may message their doctor on WhatsApp for support, with the doctor replying on WhatsApp too") is retired — patient feedback flagged it as a real trust gap (a promised conversation with no on-platform record). The real, working channel is `care_messages`/`care_message_threads` (built 2026-07-19, wired into the patient dashboard's Overview section and given a "Messages" nav entry 2026-07-30) — `MessagesFlow`/`CareMessageThread` on the patient side, `/clinician/messages` on the staff side, server-derived null-gated attribution, one `in_app`-channel notification (never whatsapp/sms/email — see the care_messages_in_app_notification_and_coordinator_copy migration) when the care team replies. The legacy WhatsApp inbound webhook + `/clinician/support-inbox` (2026-07-12) still exist and still work for a patient who texts in out of habit, but are no longer promoted anywhere as the way to reach a care team — every "message your care team" mention across marketing and the app now says "in the app."
- Phone numbers always E.164 (`+234XXXXXXXXX`). Timezone always `Africa/Lagos`.
- Every table has `organisation_id` — always filter by it. **RLS enforced at the Postgres level for every multi-tenant table — never bypass, never filter in application code instead.**
- **Doctor:patient ratio target — under review as of 2026-07-30, do not cite 1:120 as current.** It was the working figure for Tier 1–3 staffing (see Clinical Tier Ladder below); founder is now exploring how far protocol/automation design can responsibly stretch one doctor's coverage, with **1:2000 as an aspiration, not a committed number** ("where possible with good design"). No new fixed ratio is confirmed yet — don't put a specific ratio in marketing copy, UI, or business-rule text until the founder settles on one; where a ratio claim is needed, describe the mechanism (protocol-driven review, triage before a doctor sees a case) instead of a number.
- Abnormal screening result handling (Cat 2→1 upgrade): Supabase trigger → Edge Function → doctor WhatsApp alert **immediate, not scheduled** → doctor has a 4-hour contact SLA → surfaces as Priority 1 (red) on doctor dashboard.
- **Corrected 2026-08-10 — Tarragon Free consumes no doctor time; doctor time is a paid-plan feature.** A dangerous vitals/symptom reading (BP, SpO2, temperature, glucose, a red-flag symptom, the one-touch danger-symptom check) is still detected by the same deterministic thresholds on every plan, and the patient still gets the full emergency safety net (the acknowledge-gated "go to the nearest hospital now" guidance, emergency-contact auto-notify, follow-up-after-discharge check-in — none of that depends on a doctor ever seeing it) plus an immediate, specific self-care suggestion — but on Free, it no longer creates a `clinician_alerts` row or pages a clinician. Doctor escalation on a dangerous reading is gated to Prevent/Essential/Complete via the `vitals_red_flag_doctor_escalation` feature flag (`private.patient_has_feature_access`), see `20260810120000_gate_vitals_red_flag_escalation_to_paid_plans.sql`. **This explicitly does NOT touch the abnormal screening result pipeline above** — Category 2→1 still fires regardless of plan; that rule stands, this is a different, narrower carve-out for patient-logged vitals/symptoms only.

## Clinical Tier Ladder (supersedes flat clinician/escalation-doctor model — 2026-07-15)
Full detail: `docs/Tarragon_Health_Master_Operating_Plan_v4.md` §4/§7/§8. Every clinical judgment is made by a doctor; no case is closed by non-clinical staff; a case climbs only as far as its complexity requires — most stay at Tier 1/2.
- **Care Coordinator** (employed, non-clinical) — logistics only: check-ins, adherence/missed-reading tracking, lab/refill booking. Never interprets a result, adjusts medication, or closes an escalation — routes anything needing judgment to Tier 1.
- **Tier 1** Medical Officer <3yrs (employed) — first-line review of routine/stable readings under protocol; confirms/continues existing stable prescriptions; no new prescribing.
- **Tier 2** Medical Officer 3+yrs (employed) — initiates new medications, standard dose adjustment, handles Tier 1 escalations.
- **Tier 3** Senior Medical Officer (employed) — complex/multi-drug case management, standing QA/spot-audit of Tiers 1–2.
- **Tier 4** Senior Registrar (contracted, part-time retainer) — pre-referral consult, sets referral urgency, approves referrals, owns/updates clinical protocols, supervises Tiers 1–3.
- **Tier 5** Partner Specialist (contracted, referral-only, per-consult) — complex/procedural input; hands routine follow-up back to Tier 3/4 (shared care).

**Schema (layered model):** `clinical_staff.doctor_tier` (built 2026-07-15) carries clinical seniority/routing authority. `clinical_staff.role` (`clinical_director`/`clinician`/`escalation_doctor`) was retired 2026-07-15 (`20260715174500_retire_clinical_staff_role.sql`, see `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`) — replaced by `doctor_tier` plus `clinical_staff.is_clinical_director`. **`is_clinical_director` is a separate org-governance flag (protocol signing, staff verification) orthogonal to tier, not itself a rung on the ladder** — a person can hold Clinical Director status at any tier. **`profiles.user_role` (the account/login/RLS role) is unified — every tier of the ladder, 1 through 5, uses the single `clinician` account role and reaches the same `/clinician/*` dashboard** (founder decision 2026-07-31, migration `20260731020000_merge_doctor_into_clinician.sql`). This supersedes the two-way `clinician`/`doctor` account-role split built 2026-07-09 (`20260709001520_add_doctor_role.sql`) — that split had let a Tier 4/5 `doctor`-role login reach almost nothing (escalations + referrals only, no patient directory, no messaging), while accidentally acting as an undocumented clinical-authority gate on top of that. Clinical authority now lives entirely in `clinical_staff.doctor_tier`/`is_clinical_director`, enforced per-action in the DB — `private.has_prescribing_authority` (initiating a medication) and `private.can_handle_emergency_escalation` (claiming/resolving an emergency-level case, the one authority gap the account-role split had been accidentally covering — see the 2026-07-31 entry in `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`) — never by which dashboard a login can reach. Only `care_coordinator` remains a genuinely separate account value. See the "Never re-split the ACCOUNT role" rule below before reintroducing anything like the old split.

**Indemnity:** DB-enforced requirement for Clinical Director, Tier 4, and Tier 5 before activation. Tiers 1–3 are employed and covered under Tarragon's institutional policy, not tracked individually.

**Care Coordinator write access:** gets the same org-staff read access as any staff account, but must never gain write access to medications, escalation resolution, or protocol signing — enforced at the app/server-action layer (matches the existing "only Clinical Director can sign protocols" pattern), not a new RLS helper.

**Explicitly Phase 2/3, not initial launch** (confirmed 2026-07-15 — do not build functional code for these without an explicit ask): full specialist-matching engine + 8-stage referral-status pipeline, patient-initiated wellness testing catalogue. **Employer/HMO risk-stratification dashboards, Premium ParentCare as a real subscription tier, and home sample collection/medication delivery logistics were pulled forward and built 2026-07-16 on explicit ask** — see `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md` — so they're no longer on this list; everything else here still requires an explicit ask before functional code is written.

MDCN/regulatory confirmation that this tier authority split (e.g. Tier 1 confirming refills, Tier 2 initiating new medications) is compliant is an open founder item (master plan §16) — never represent the tier ladder as regulator-approved.

## Device & Wearable Integration
Bluetooth clinical devices (BP cuffs, glucometers) are **built** (2026-07-13/14, see `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`). Consumer wearable cloud sync is **corrected 2026-08-05 — the Connect UI and webhook route shipped 2026-07-31 (commit `e6b4c99`), contradicting this section's older "schema-scaffolded only" wording.** `wearable_connections`/`wearable_readings` tables + RLS exist (migration `20260714140000_wearable_connections.sql`); `apps/web/src/lib/wearables/oauth-providers.ts`'s `CloudOAuthWearableProvider` type now covers 5 cloud-OAuth providers (Oura/WHOOP/Garmin/Fitbit/Dexcom, Dexcom added since the original 4); `apps/web/src/app/(dashboard)/patient/wearable-connect-section.tsx` is a real, live, un-gated (no plan/tier check) patient-facing Connect card wired into every patient's dashboard, and `/api/wearables/{connect,callback,webhook}/[provider]` are real routes — `connect`/`callback` do a genuine OAuth round-trip and gracefully show "not yet available" for any provider with no real developer credentials configured (all 5, currently); `webhook/[provider]` is **no longer a scaffold — the notify-then-authenticated-fetch half was finished 2026-08-08**, so the whole path is credential-drop-in-ready: per-provider adapters (`src/lib/wearables/providers/`) do the follow-up API read Fitbit/WHOOP/Oura notifications require, Garmin's inline push is read directly, tokens auto-refresh (`connection-tokens.ts`), webhooks are authenticated before anything is written (`webhook-auth.ts` — Fitbit/WHOOP signatures, a shared secret for unsigned Oura/Garmin, and the GET challenge handshake Fitbit/Oura demand before they will even create a subscription), and Dexcom — poll-only, no webhook exists — is swept by `/api/cron/wearable-sync`. Every adapter was checked against each provider's *published* docs (not a live sandbox — no developer credentials exist), which caught two things worth remembering: **WHOOP removed v1 and its endpoints now 404**, so a v1 path would authenticate, resolve a connection, fetch nothing and ack 200 — a silent zero, not an error; and **Garmin has two integration modes**, Push (summaries inline, what the adapter reads) and Ping/Pull (an account plus a callbackURL to fetch, requiring OAuth 1.0a), which are structurally identical JSON, so a misregistration is detected and reported rather than looking like a patient with no data. **Live behaviour still cannot be confirmed until real credentials exist** — the field mappings are the seam to correct on first real payload. Full spec: `docs/FULL_SPECIFICATION_V4.md` §5/§9 (`app/routers/wearables.py` — still unbuilt). Contract to follow as the consumer-wearable path gets real provider credentials:
- **Ingestion boundary, not owned hardware** — TarragonHealth never talks to device firmware directly. Three ingestion paths only: (1) consumer platform sync via their cloud APIs/webhooks (built end to end, see above); (2) clinical Bluetooth devices paired via the Expo mobile app's native BLE (`apps/mobile`), which uploads parsed readings to `POST /api/mobile/device-readings` — built, per below; (3) Apple Health via the mobile app's HealthKit bridge, uploading to `POST /api/mobile/health-samples` — see the next bullet.
- **Apple Health has no cloud OAuth API at all** — HealthKit data is device-local; syncing it needs the Expo mobile app's own HealthKit bridge (same shape as the BLE clinical-device pairing, not a server-side OAuth redirect), so it's excluded from `oauth-providers.ts`'s `CloudOAuthWearableProvider` type even though `wearable_provider` (the DB enum) includes it for schema completeness. **That bridge was built 2026-08-08** (`apps/mobile/src/lib/healthkit.ts` + `health-sync.ts`, the Apple Health card on the Devices tab, and the bearer-authenticated `POST /api/mobile/health-samples`): read-only, iOS-only, incremental via a server-held cursor, covering BP, glucose, weight, SpO2, resting heart rate, HRV and steps. **Corrected 2026-08-12 — background delivery was added, both platforms, on explicit ask.** The Android peer, Health Connect, was built the same day — `apps/mobile/src/lib/health-connect.ts`, a Health Connect card on the Devices tab (`android-health-connect-card.tsx`) replacing the old disabled placeholder, and the same `POST /api/mobile/health-samples` route made provider-aware (`wearable_provider` gained `android_health_connect`, migration `20260812161742_wearable_provider_android_health_connect.sql`) rather than split into a second endpoint. Both platforms' reliable background mechanism is one shared periodic `expo-background-task` (`apps/mobile/src/lib/background-sync.ts`, BGTaskScheduler on iOS / WorkManager on Android under one JS API) — **not** either platform's own native wake, and that distinction matters: Health Connect has no wake-on-write mechanism at all (poll-only, hence the periodic task); iOS HealthKit's native background delivery (`enableBackgroundDelivery`/`configureBackgroundTypes`, flipped on via `background: true` in the `@kingstinct/react-native-healthkit` config plugin) genuinely wakes the app process, but the installed library version (14.0.2) never wires that native wake to a JS callback — confirmed by reading its vendored `BackgroundDeliveryManager.swift`, whose `setCallback`/`drainPendingEvents` are defined but never called from anywhere in the package's exposed API. iOS additionally gets `subscribeToChanges`-based live sync (near-instant, but only while the JS engine is already running — foreground or the brief post-backgrounding window, not a cold launch) layered on top of the periodic task, not instead of it. HRV is a further platform mismatch worth knowing before comparing a patient's trend across a device switch: HealthKit reports SDNN, Health Connect's `HeartRateVariabilityRmssdRecord` reports RMSSD — a different algorithm landing in the same `hrv_ms` column. **None of this — HealthKit or Health Connect, foreground or background — has ever run on a real device.** HealthKit doesn't work in Expo Go and Health Connect requires a real EAS/prebuild native binary (TurboModule, throws on import otherwise — the same class of eager-native-binding crash Nitro Modules hit for HealthKit, see the reference memory on that), so both need a real EAS development build on physical hardware before any of this can be called confirmed-working; the `expo-background-task` half specifically cannot be exercised in the iOS Simulator at all. Sleep is deliberately not read on either platform yet (category-sample aggregation is its own piece of work).
- **`wearable_readings` is a genuinely separate table from `vitals_readings`, not a "no dual source of truth" violation** — passive wearable metrics (steps, sleep stages, HRV, recovery/strain) have no `vitals_readings.vital_type` equivalent at all. Any wearable metric that *does* overlap an existing vital_type (heart rate → pulse, weight, SpO2) should go to `vitals_readings` with `source='wearable'` instead (that enum value already exists) — the additive-faster-path/no-parallel-table rule below still applies to those overlapping metrics.
- **App/web manual entry is never removed.** Device sync is an additive faster path into the same `vitals_readings` table patients already log into manually via app/web — same downstream escalation logic, same `patient_risk_scores`, same abnormal-result pipeline. No dual source-of-truth for anything that has a `vitals_readings` equivalent — `vitals_readings.source` (`manual`/`device`/`wearable`) distinguishes them, not a parallel table. WhatsApp/SMS may remind a patient to log a reading; it is not itself an entry interface.
- Every reading gets `organisation_id` + RLS like any other table.
- **Corrected 2026-08-05** — the shipped Connect UI carries no plan/tier gate at all (any patient can see it); the "diaspora/premium tier only" line here predates both the wearables build and the 2026-07-31 removal of the diaspora-premium-subscription concept itself (diaspora is a sponsor of someone else's plan now, not a patient-facing tier — see the "Care Voucher" / sponsor model above). Revisit tier-gating this feature only on an explicit ask; nothing currently restricts it.
- **Founder decision 2026-08-02 — Tarragon does NOT sell/import/bundle BP cuffs or glucometers.** The "sold as device bundles" line elsewhere in this file and in `docs/FEATURE_SPEC.md`/`docs/FULL_SPECIFICATION_V4.md` was never built (confirmed: `pricing.ts` has zero device line items, no checkout/product-listing code exists) and is now deliberately shelved, not just unbuilt. Reason: becoming a hardware importer/reseller would require Tarragon to be NAFDAC's registered "local representative" for whichever brand it bundles (Power of Attorney from the manufacturer, or import/register under Tarragon's own name) — a real business-development/regulatory commitment inappropriate for a pre-revenue solo founder to take on speculatively. **Patients buy their own BP monitor/glucometer from any existing local retailer (any brand, Bluetooth or not) and either type the reading in manually (already fully shipped, zero cost) or, once the BLE path below is proven on real hardware, pair it if it happens to be one of the two curated standard-GATT-compliant models.** Do not build a device-bundle checkout/product-listing feature without an explicit ask — this is now the same class of gate as the other Phase 2/3 items above.
- **The BLE "connecting" path itself (see 2026-07-21 GATT profile note below) is fully built but never tested against real hardware** — before recommending or documenting any specific device model to patients, buy one A&D Medical UA-651BLE (BP) and one Roche Accu-Chek Guide/Guide Me (glucose) and pair them with the real Expo app first. Both are the two models with documented, credible standard-GATT compliance (unlike Omron/iHealth, which push proprietary apps/SDKs) — see the 2026-08-02 device-sourcing research in conversation history for the full comparison. Add a "supported devices" list to the pairing screen only after that hardware test passes.
- **Weight Scale (0x2A9D) gap CLOSED 2026-07-21** — full BLE support now covers all five standard GATT clinical profiles: BP cuff (0x2A35), glucometer (0x2A18), weight scale (0x2A9D, spec-fixed 0.005 kg/0.01 lb resolutions, imperial converted to kg, 0xFFFF measurement-unsuccessful rejected), thermometer (0x2A1C, 32-bit medical FLOAT, °F converted to °C), and pulse oximeter (PLX Spot-Check 0x2A5E). `patient_device_type` gained `thermometer`/`pulse_oximeter` (migration `20260721141233`); readings land in the existing `vitals_readings` columns (`weight_kg`/`temperature_c`/`spo2_pct`) via the same device-readings API.

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
- Voice: warm and personal, not a hospital PA system. No fear-based urgency, no "WARNING:", no clinical jargon in patient-facing copy.
- **Do not use "doctor-led" as a headline/marketing claim** (retired 2026-07-18 — it reads as over-promising and unprofessional). Describe the actual clinical process instead — "clinical review and escalation", "your care team", "reviewed against care protocols" — and reference doctors concretely in process/explanation ("escalates to a doctor", "the doctors who review every case"), never as a blanket brand adjective. Don't cite a specific doctor:patient ratio in this kind of copy — see the Non-Negotiable Business Rules note above, it's under review. The operating model is unchanged (Tarragon still employs its own doctors, per `docs/CLINICAL_TRUST_MODEL_SPEC.md`); this is a public-copy/positioning rule only.

## Recent Work — See the Archive

This file used to carry every sprint's dated changelog entry inline, appended forever and never
pruned — by 2026-08-04 that had grown to roughly 2,700 lines describing on the order of 100 shipped
pieces of work (every chronic-disease pathway, the prevention/screening ladder, finance/GL tooling,
the Health-Wallet-to-Care-Voucher pivot, the sponsor/diaspora rebuild, the doctor-tier ladder and
its account-role merge, AI case briefs, the marketing site, legal/compliance drafts, and more),
several of which were later reversed or superseded by a subsequent entry. That defeats the point of
a file meant to be read every session. The full, unedited, dated record — useful when you need the
exact reasoning, migration filename, or PR behind a specific decision — now lives in
**`docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`**. Read it when historical context matters; don't assume
this shorter file repeats it. **Going forward, do not append new dated sprint entries here** —
either log genuinely new work in the archive file, or (better) keep this file's job to durable
rules and let the git history / PR descriptions be the record of what shipped when.

**Known standing follow-ups, as last recorded — verify each before acting, none of these should be
taken on faith:**
- ⚠️ **The `doctor`→`clinician` account-role merge migration
  (`20260731020000_merge_doctor_into_clinician.sql`) was applied and released to production
  2026-08-03, but the committed version of that migration is reported to be missing a policy fix it
  needed live** — it may fail on a fresh `supabase db reset`. Check the `project_doctor_clinician_role_merge_parked` memory file and diff the committed migration against what's actually applied on the
  live project before relying on a clean local reset working.
- The Diabetes (`guideline/Tarragon_Health_Diabetes_Pathway_Gap_Closure_Plan.md`) and Hypertension
  (`guideline/Tarragon_Health_Hypertension_Pathway_Gap_Closure_Plan.md`) clinical pathways each had
  a handful of items still open the last time they were reviewed — mostly Clinical Director
  sign-off/protocol activation and ops/founder localisation facts (real emergency numbers, partner
  formulary, device models, panel prices), not engineering work. Check those two files directly for
  the current checklist; they track real outstanding items and aren't otherwise linked from here.
- Two Supabase projects (`rjsxbhgqdudowlvarmzq`, `jpdwbnvrgvpntcmfefeu`) were flagged 2026-07-29 for
  owner-side deletion — confirm whether that's happened.
- `reference/tarragon-control/`'s git bundle is still the only backup of the separate v3 repo's
  history, sitting on one disk with no remote — worth pushing somewhere if that hasn't happened
  since.
- The deployed `send-pending-notifications` Edge Function has repeatedly drifted behind its own
  source across this project's history (found stale and redeployed at least half a dozen separate
  times). Before assuming any notification template works in production, check its deployed version
  against source rather than trusting a past changelog entry that says it was "just redeployed."
- Several regulatory/compliance items were still open the last time they were touched: MDCN/NMCN
  confirmation that the five-tier doctor-authority split is compliant; a Nigerian fintech counsel
  opinion on the Care Voucher structuring; NDPC registration and a DPO appointment; Meta WhatsApp
  template approval (blocked on Meta's own support process) and Termii sender-ID carrier approval
  (blocked on submitting several business documents) — both meaning WhatsApp/SMS delivery for
  several reminder templates is pending, with in-app notification as the working fallback in the
  meantime.
- A production-quality Nigerian-language voice/TTS vendor was deliberately never built — the
  platform is English-only by founder decision (2026-08-03). Revisit only on an explicit ask.
- **2026-08-26 — mobile OTA publishing is now automated, but needs one secret added before it runs.**
  `apps/mobile` had no CI path to the actual running app — EAS Update only shipped via a manual
  `eas update`, and a day's worth of merged JS-only UI work (BMW-kit rework, nav-drawer/Devices
  wiring) sat unpublished because nobody re-ran it after the one verified publish in PR #260. Added
  `.github/workflows/mobile-ota-publish.yml`: auto-publishes JS-only pushes to `main-dev` (that
  touch `apps/mobile`) to the `preview` channel, skips publishing (rather than guessing) when a push
  touches anything native-affecting — that still needs a manual `eas build` — and never auto-publishes
  to `production`. **It will fail closed until an `EXPO_TOKEN` repo secret is added** (Settings ->
  Secrets and variables -> Actions; generate at expo.dev/accounts/[account]/settings/access-tokens)
  — no agent in this sandbox has EAS/Expo credentials to add it. Confirm the secret has actually been
  added before assuming this workflow is doing anything.

### 2026-08-04 — Second occurrence: a push to `main` built on Vercel but was never promoted to production
Founder reported the live site still showed retired partner-lab/booking copy (prices for lab tests and
investigation packages, "book & pay" language implying Tarragon books and pays labs directly) days
after the self-arranged-fulfilment sweep and the clinical-intelligence-core merge were both logged as
released above. **The code was never the problem** — `main` at `e49cfb3` already had the full fix
(every "BOOK & PAY" label replaced with "YOU PAY THE LAB", every partner-lab reference removed) and
Vercel had already built it successfully (`dpl_5dS79vGfvFypfsrQ1MzhXRiYQiYU`, state `READY`). **That
build's `target` was `null`, not `"production"`** — it was never promoted, so `tarragonhealth.ng` was
still serving an earlier deployment (`dpl_Bc2WQXMMa2vnsjc2eAbqUgLpSBJa`, commit `ad4429d`, built
*before* the self-arranged-fulfilment merge landed in `main-dev`). This is the same failure mode as the
2026-07-30 "escalation-SLA page was never actually deployed" entry above — a push to `main` reaching
GitHub does not reliably reach a promoted Vercel production deployment on this project, and there is no
CI check anywhere that would have caught it. **No Vercel CLI/API token is available in this environment
to directly promote an existing ready deployment**, so the recovery was the same one used last time:
push a small, real commit to `main` to give the GitHub webhook another chance. **If this happens again,
check `list_deployments`/`get_project.latestDeployment` for a `READY` build whose `target` is not
`"production"` before assuming the code itself is wrong** — the fastest confirmation is comparing the
live page's own copy against `git show origin/main:<file>`, not against the changelog.

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
- **Never re-split the ACCOUNT role (`profiles.role`) by clinical tier.** Every doctor is `clinician` and sees the same pages (founder decision 2026-07-31, migration `20260731020000_merge_doctor_into_clinician.sql`, which retired the old `doctor` role). Clinical authority is carried by `clinical_staff.doctor_tier` + `is_clinical_director` and enforced per-action in the DB (`private.has_prescribing_authority`, `private.can_handle_emergency_escalation`) — never by which dashboard a login can reach. If a new action needs senior authority, add a tier gate on that action; do not add an account role. Keep `clinician` as the generic name too — it leaves room for NMCN-registered nurse practitioners or CHEWs under Nigeria's task-shifting policy without another enum rebuild
- Never rebuild the Annual Health Review as a parallel review record that re-does the condition reviews — it is an orchestration layer that **adopts + rolls** the patient's existing `medication_reviews` (and reuses `patient_risk_scores`/`care_plans`/Zoom `video_consultations`); condition-specific reviews must stay intact and running on their own cadence (see the 2026-07-17 entry in `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`)
- Never build functional code (not just schema scaffolding) for the full referral-matching pipeline, patient-initiated wellness testing, or Employer/HMO risk dashboards without an explicit ask — see Clinical Tier Ladder above. (Home sample collection and medication delivery logistics were the same kind of guardrail until pulled forward on explicit ask 2026-07-16 — see `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`.)
- **Superseded 2026-07-15, then corrected 2026-07-30 — Tarragon employs its own doctors, but never promise ONE continuous named doctor.** The 2026-07-15 wording ("a named doctor is the default face of the day-to-day patient relationship") is retired: patient feedback flagged that a real, shift-covered care team can't honestly promise the same individual every time without either lying or overloading one person. Care is delivered by a **team** of MDCN-registered doctors with coverage shared across the team for effective staffing (see the onboarding "How your care works here" copy and `trust-band.tsx`'s "A real care team, always accountable" for the current patient-facing wording) — never describe it as one named doctor following a patient. **What does NOT change:** per-case attribution stays real and mandatory — every doctor review, escalation resolution, or verified certificate still carries the real reviewing doctor's name via the null-gated `ReviewedByDoctor` pattern (see the rule below), and the per-case rule below is untouched. **The Dedicated Care Coordinator add-on referenced by the earlier version of this bullet no longer exists** — it was withdrawn 2026-07-31 as mis-selling (the operating model will not include dedicated per-patient staff), its `add_ons` rows are `is_active = false`, and its marketing card was removed in the same release. `docs/CLINICAL_TRUST_MODEL_SPEC.md` §1, §9 were rewritten to match this correction (PR #186).

## Where to Look
- System architecture, topology, RLS model, event pipelines, infra → `docs/ARCHITECTURE.md`
- Business model, pricing, full DB schema, 7-sprint plan, clinical protocols, launch gates → `docs/FEATURE_SPEC.md`
- Brand voice, tagline system, colour/type tokens, dashboard copy patterns → `docs/BRAND_GUIDE.md`
- Public marketing site — sitemap, page copy, design tokens, hostname routing, DoD → `docs/MARKETING_SITE_SPEC.md`
- Logo assets → `/brand/Tarragon_Health_Logo_Mark.png`, `/brand/Tarragon_Health_Logo_Lockup.png` (marketing deploy copies → `apps/web/public/brand/`)
- Competitive-intelligence feature roadmap (Health Score, wearables, symptom tracking, fee-at-risk contracts, phased Now/Phase 2/Phase 3) → `docs/FULL_SPECIFICATION_V4.md` — additive feature layer only; per its own §11 guardrail it informs the roadmap and never overrides this file's operating rules or `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`
- Clinician/doctor role architecture, per-touchpoint attribution rules, escalation→doctor review flow, `clinical_staff`/`care_team_assignment`/`protocol_versions` schema, MDCN/NMCN compliance → `docs/CLINICAL_TRUST_MODEL_SPEC.md` — authoritative on conflicts touching clinician attribution or escalation branding; its Stage/§ cross-references map to the original `docs/source/` planning docs, not `FEATURE_SPEC.md`'s Sprint numbers — see the reconciliation note at the top of the file
- Patient Health Record — section-by-section gap analysis against the platform's actual schema/code (identity, problem list, allergies, family/social history, observations, labs, imaging, medication lifecycle, encounters, timeline, versioning, search, permissions, external records, export, security), plus open founder decisions where the record spec collides with a real shipped decision (e.g. the collapsed medication dispensed/received event) → `docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md`
- 5-tier doctor ladder, Care Coordinator role, doctor-tier staffing/indemnity rules, phased Phase 1/2/3 roadmap (specialist-matching engine, wellness testing, Employer/HMO dashboards, home sample collection, medication delivery) → `docs/Tarragon_Health_Master_Operating_Plan_v4.md` — authoritative on the clinical staffing model where it conflicts with `CLINICAL_TRUST_MODEL_SPEC.md`'s older flat-role language
- Clinical Network — provider directory/verification/availability/discovery/referral-integration/org-account gap analysis against current code, phased Phase 1 (safe now) vs Phase 2/3 (needs explicit ask) recommendations → `docs/CLINICAL_NETWORK_SPEC.md` — a design/reconciliation doc; where it disagrees with the Master Operating Plan's Phase labels, that's a sign the Master Plan is stale relative to shipped work (e.g. the referral-status pipeline/waitlist), not license to build past this file's matching-engine guardrail (see its §3) without asking first
- Sprint-by-sprint build history — every migration, bug, and founder decision, dated, 2026-07-09 through 2026-08-03 → `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md` — a historical record; verify any specific fact against the live code/DB before trusting it, see "Where things actually stand" above
- Diabetes/Hypertension clinical pathway source docs + outstanding-gap tracking → `guideline/` — the `.docx` files are the signed pathway source-of-truth; `Tarragon_Health_Diabetes_Pathway_Gap_Closure_Plan.md` and `Tarragon_Health_Hypertension_Pathway_Gap_Closure_Plan.md` track exactly what the platform still owes each pathway (mostly governance sign-off + localisation facts, not code) — read these directly, they are not otherwise summarised in this file
- Shipped-feature build-plan docs, superseded by the running code and by `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`, kept for historical design rationale only → `docs/archive/`
- Diaspora growth-pitch reconciliation (gift-a-health-check, standalone video consult, group screening days, instalment payment, screening→chronic conversion, referral commissions) against what's actually shipped, plus a flagged live bug in the screening-tier video-consult trigger → `docs/DIASPORA_HEALTH_CHECK_BUSINESS_MODEL_RECONCILIATION.md` — a reconciliation doc, not a build order; its one open founder question (does `screen_core` still owe a video consult) should be answered before extending the gift flow's copy
