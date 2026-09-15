# Health Check (Annual Health Check) — Native Conversion Scope

> Paste this entire file as your first message in a fresh Claude Code
> session in this repo. It is self-contained. Read
> `apps/mobile/src/lib/weight-management.ts` +
> `apps/mobile/src/screens/sections/weight-management-screen.tsx` first —
> they're the reference implementation for the pattern this doc assumes
> throughout (the `QueryResult<T>` shape, the `/api/mobile/*` bearer-auth
> route pattern, the `sections.ts`/`home-shell.tsx` wiring convention).
> Section id for this feature: `healthCheck`.

## Summary

"Health Check" (`/patient/health-check`) is the patient's yearly Annual
Health Check (AHC) journey: a 5-stage checklist (health profile, mental
wellbeing, measurements, screenings, immunisations), the lab-panel/screening
booking surface that fuels stage 4, lipid/risk-signal read-only summaries, a
doctor "review & communicate" card with a PDF report download, a bundled
video-consult slot-picker, and a mental-wellbeing check-in form
(PHQ-9/GAD-7/AUDIT-C/EPDS). It is currently a WebView section on mobile
(`webviewPath: "/patient/health-check"` in `apps/mobile/src/lib/sections.ts`,
rendered by `WebViewHubScreen`). Most of the constituent work (vitals
logging, risk assessment, screening booking, lipids/labs, mental health
screening) already has a dedicated home elsewhere in the app — native or
WebView-hub — so this page is best understood as an **orchestration/
dashboard layer**, not a standalone data-entry feature.

## File Inventory (web)

| Path | Lines | Role |
|---|---|---|
| `apps/web/src/app/(dashboard)/patient/health-check/page.tsx` | 289 | Page: opens this year's check, computes 5-stage state, renders everything below |
| `apps/web/src/app/(dashboard)/patient/annual-health-check-booking.tsx` | 405 | Lab/screening package booking (self-arranged + partner-billed), upload, vouchers |
| `apps/web/src/app/(dashboard)/patient/health-check-video-consult-card.tsx` | 96 | Client card: pick/confirm a doctor-offered video-consult slot |
| `apps/web/src/app/(dashboard)/patient/health-check-video-consult-actions.ts` | 65 | `"use server"` action: confirms slot + creates Zoom meeting (service-role) + notification |
| `apps/web/src/app/api/patient/health-check/report/route.ts` | 47 | GET route: renders the "Smart Report" PDF (react-pdf, cookie-auth) |
| `apps/web/src/app/(dashboard)/patient/mental-health-form.tsx` | 192 | Client form: PHQ-9/GAD-7/AUDIT-C/(opt-in EPDS) |
| `apps/web/src/app/(dashboard)/patient/mental-health-actions.ts` | 158 | `"use server"` action: scores + service-role insert + crisis/alcohol escalation |
| `apps/web/src/components/mental-health-summary.tsx` | 90 | Read-only latest-screen summary card |
| `apps/web/src/components/patient/lipid-profile-card.tsx` | 114 | Read-only lipid panel display |
| `apps/web/src/app/(dashboard)/patient/risk-signals-card.tsx` | 108 | Read-only "what your care team is watching" + AI explainer button |
| `apps/web/src/lib/screening/health-check-stage-state.ts` | 86 | Pure fail-safe stage-state logic (done/todo/neutral) — port verbatim, client-side, no server needed |
| `apps/web/src/lib/queries/lab-orders.ts` | 463 | React Query hooks: catalogue, orders, prices, screen-type details, region availability |
| `apps/web/src/lib/queries/lipids.ts` | 73 | Hook: latest lipid readings from `lab_analyte_readings` |
| `apps/web/src/lib/queries/health-score.ts` | 73 | Hook: `patient_risk_scores` reads |
| `apps/web/src/lib/queries/mental-health.ts` | 33 | Hook: latest `mental_health_screens` per instrument |
| `apps/web/src/app/(dashboard)/patient/lab-tests/actions.ts` | 161 | `createAndPayForPartnerLabOrder` — Paystack checkout redirect (service-role + payment) |
| `apps/web/src/lib/patient-explainer/actions.ts` + `generate.ts` | 76 + 336 | `explainPatientResultAction` — governed AI call (AI-003, already registered) |
| **Already built for mobile:** `apps/web/src/app/api/mobile/mental-health-screen/route.ts` | 147 | Existing bearer route wrapping `mental-health-actions.ts` verbatim — **reuse as-is** |

## Critical finding: most of this page is already native or already wired for mobile

Before scoping new work, note what must NOT be rebuilt:

1. **Mental wellbeing check-in (PHQ-9/GAD-7/AUDIT-C/EPDS) is already fully
   native.** `apps/mobile/src/screens/sections/wellbeing-screen.tsx` already
   contains `MentalHealthScreenForm` and `MentalHealthSummaryCard`, backed
   by `apps/mobile/src/lib/mental-health.ts` (question text +
   `loadLatestMentalHealthScreens`) and `apps/mobile/src/lib/api.ts`'s
   `postMentalHealthScreen()`, which already calls
   `/api/mobile/mental-health-screen`. **Do not rebuild this. Link out to
   the `wellbeing` section.**
2. **Lab ordering/upload is partially native, and the ordering/payment half
   is deliberately kept in a WebView modal even inside the native Labs
   section.** `apps/mobile/src/screens/sections/labs-screen.tsx` has native
   camera-capture upload but punts "orders, results, trends" (i.e. exactly
   what `annual-health-check-booking.tsx` does: catalogue browsing,
   self-arranged vs. partner-billed booking, Paystack checkout, vouchers,
   specimen tracking) to a `WebViewScreen path="/patient/labs"` inside a
   Modal. **Do the same for Health Check** rather than reimplement
   `AnnualHealthCheckBooking`'s 405 lines + dependency tree natively.
   - **Stale-comment flag:** `labs-screen.tsx`'s own comment claims
     self-book/facility-selection are "suspended platform-wide" — per
     CLAUDE.md, partner billing (Synlab) was reactivated 2026-08-21 and
     expanded 2026-08-29, and `annual-health-check-booking.tsx` actively
     uses `createAndPayForPartnerLabOrder`/`LabLocationPicker`/
     `PartnerLabBillingOption`. That mobile comment is stale — don't trust
     it when deciding what the WebView fallback should say.
3. **Prevention (risk assessment, screenings, vaccinations) is partially
   native with the same pattern**: `apps/mobile/src/screens/sections/
   prevention-screen.tsx` natively handles the screening calendar
   (confirm-done/decline) but defers "generating a lab request for a due
   screening, the AHC journey, vaccinations, and risk assessment" to its
   own WebView fallback.
4. **Vitals is fully native already** — stage 3 ("Your measurements") links
   there.

Given this, the Health Check native screen's real, non-duplicated job is:
**the 5-stage dashboard/checklist itself, the doctor review/report card,
the video-consult slot picker, and (optionally) the lipid/risk read-only
cards** — everything else is a link-out.

## Data model

| Table / RPC | Purpose | R/W | Classification |
|---|---|---|---|
| `annual_health_checks` | This year's check row: `created_at`, `reviewed_at`, `reviewed_by`, `review_summary`, `status`, `lab_order_id`, `video_consultation_id` | Read | **Safe direct client** — plain `select ... eq(patient_id,...).eq(year,...)`, RLS-scoped |
| `public.open_health_check()` RPC | Idempotently creates/returns this year's row for the caller | Write (RPC) | **Safe direct client** — `SECURITY DEFINER`, `authenticated`-only, scoped to `auth.uid()` internally |
| `prevention_risk_scores` | Count only, for stage 1 | Read | Safe direct |
| `mental_health_screens` | Count / latest-per-instrument | Read | Safe direct (already ported) |
| `vitals_readings` | Count by `vital_type` since check opened, stage 3 | Read | Safe direct |
| `screening_schedules` | Count pending/overdue, stage 4 | Read | Safe direct |
| `clinical_staff` | Reviewer's `full_name` by `reviewed_by` | Read | Safe direct |
| `lab_orders`/`panel_bundles` (joined) | Tier name at top of page | Read | Safe direct |
| `video_consultations` (joined `proposed_slots`, `scheduled_at`) | Video-consult offer state | Read | Safe direct |
| `public.confirm_health_check_video_slot(p_consultation_id, p_slot)` RPC | Atomic ownership + offered-slot validation | Write (RPC) | Safe as an RPC, **but the real action wraps more — see API route below** |
| `lab_analyte_readings` | Lipid values | Read | Safe direct |
| `patient_risk_scores` | Risk-signal gloss | Read | Safe direct |
| `patient_result_explanations` | AI-explainer cache | R/W (server-side only) | **No — governed AI call, out of scope, see below** |
| `lab_orders`, `panel_bundles`, `screen_types`, `lab_providers`, `lab_result_interpretations` | Full booking/catalogue for `AnnualHealthCheckBooking` | R/W | Mostly safe reads; **`createAndPayForPartnerLabOrder` (Paystack) is not** — recommend not porting this surface, link to Labs instead |

## Recommended new API routes

Only **one**, and it's optional-but-recommended (small, high value):

- **`apps/web/src/app/api/mobile/health-check/confirm-video-slot/route.ts`**
  (new) — wraps `confirmHealthCheckVideoConsultSlot` from
  `apps/web/src/app/(dashboard)/patient/health-check-video-consult-actions.ts`
  **verbatim**. Why: the underlying RPC alone is callable directly, but the
  *action* also creates a real Zoom meeting (needs Zoom API creds), writes
  `zoom_meeting_id`/`join_url`/`host_start_url` via a **service-role**
  client, and sends a booked-confirmation notification. None of that is
  possible from an RLS-scoped mobile client. Auth pattern same as
  `mental-health-screen/route.ts`. Body: `{ consultId: string, slot: string
  (ISO datetime) }`. Response: `{ error }` or `{ success: true }`.

**Not recommended for this pass:** a route for `explainPatientResultAction`
(the "Help me understand this" AI button). It's a legitimately *registered*
governed AI call site (AI-003, confirmed in
`supabase/migrations/20260829100025_ai_governance_register_running_systems.sql`),
so wrapping it would be allowed per CLAUDE.md's AI rule (not a new
unregistered call site) — but it's a stretch goal, not core.

**Explicitly should NOT be built:** anything reimplementing
`createAndPayForPartnerLabOrder` or the partner-billing/voucher/
location-picker machinery natively.

## Recommended mobile files

- **`apps/mobile/src/lib/health-check.ts`** (new, ~150-200 lines)
  - `loadHealthCheckState(patientId)`: opens the check
    (`supabase.rpc("open_health_check")`), then reads `annual_health_checks`
    (joined `panel_bundle.name`, `video_consult`), `prevention_risk_scores`
    count, `mental_health_screens` count, `vitals_readings` (by type, since
    `vitalsWindowStart`), `screening_schedules` count, and
    `clinical_staff.full_name` for the reviewer — all plain RLS-scoped
    reads, mirroring `page.tsx`'s `Promise.all`.
  - Port `screeningStageState`/`countStageState` from
    `apps/web/src/lib/screening/health-check-stage-state.ts` **verbatim**
    (pure functions) — keep the same fail-safe "neutral vs. done vs. todo"
    semantics, don't simplify.
  - `confirmVideoSlot(consultId, slot)`: thin call to the new
    `/api/mobile/health-check/confirm-video-slot` route via `api.ts`'s
    `request<T>()` (add `postConfirmHealthCheckVideoSlot` there).
  - Optionally: `loadLipidProfile(patientId)` and `loadRiskSignals(patientId)`
    (direct reads) if the read-only cards are in v1.

- **`apps/mobile/src/screens/sections/health-check-screen.tsx`** (new,
  ~300-400 lines, shape like `weight-management-screen.tsx`)
  - Header + year/tier line.
  - 5-stage checklist card, each row navigating via `onNavigate`:
    stage 1 → `prevention`, stage 2 → `wellbeing`, stage 3 → `vitals`,
    stage 4 → `prevention`, stage 5 → `prevention`.
  - "Health checks & screenings" card: **do not port
    `AnnualHealthCheckBooking`** — a `CalloutCard` opening a WebView modal
    (same pattern as Labs' "View orders & results"), path `/patient/labs`
    or `/patient/health-check` (verify which renders standalone booking UI
    cleanly).
  - Lipid profile + risk-signals cards (optional v1): simple read-only
    renders, no AI explainer button in v1.
  - "Review & communicate" card: reviewed/not-reviewed states, reviewer
    name, review summary, PDF download — check `health-passport-screen.tsx`/
    `health-passport.ts` first for the existing mobile PDF-download pattern
    (this endpoint is a thin wrapper around the same Health Passport
    renderer), likely `expo-file-system`/`expo-sharing` fetching
    `${API_BASE_URL}/api/patient/health-check/report` with the bearer token.
  - Video-consult card: slot buttons calling `confirmVideoSlot`. For a
    scheduled consult, check whether a mobile video-visit route/section
    exists — if not, **flag this as needing a decision** (may need to stay
    WebView deep link `/patient/video-visit/[id]`).
  - No mental-health form/summary on this screen — replace with a
    `CalloutCard` → `onNavigate("wellbeing")`.

## Wiring

- `sections.ts`: remove `webviewPath: "/patient/health-check"` from the
  `healthCheck` entry.
- `home-shell.tsx`: replace the `WebViewHubScreen` block for `healthCheck`
  with `<HealthCheckScreen patientId={userId} organisationId={organisationId}
  onNavigate={handleSelect} />` (mirror `WellbeingScreen`/
  `WeightManagementScreen`'s call signature) + import.

## Safety / clinical-sensitivity flags

- **Mental-health crisis pathway is already live on mobile** — do not
  re-add a second mental-health form here; that would create two divergent
  implementations of a self-harm-detection surface.
- **`open_health_check()` and `confirm_health_check_video_slot()` are both
  `SECURITY DEFINER`** — verify live `pg_get_functiondef` matches the
  migration before relying on "safe direct RPC."
- **Video-consult confirmation is not a pure RPC call** — real side effects
  (Zoom meeting, notification) must stay server-side. Don't shortcut to a
  direct RPC call just because the RPC alone is technically callable.
- No reproductive-health-adjacent or novel-RLS tables here — every table is
  a standard patient-scoped table with proven RLS reused unchanged.
- AI governance: AI-003 is legitimately registered — not a "never build"
  case, just out of scope for v1. Never register a *new* AI system.

## Parts that should stay WebView / link-out

| Component | Recommendation | Reasoning |
|---|---|---|
| `AnnualHealthCheckBooking` (405 lines) | Link out — WebView modal or `onNavigate("labs")` | Payment/partner-billing, already has a proven WebView-modal home in Labs |
| `MentalHealthScreenForm` + `MentalHealthSummary` | Link out — `onNavigate("wellbeing")` | Already fully native there, including the crisis pathway |
| Stage 1 (health profile) | Link out — `onNavigate("prevention")` | Prevention's WebView fallback owns the risk-assessment questionnaire |
| Stage 3 (measurements) | Link out — `onNavigate("vitals")` | Vitals is fully native |
| Stage 4/5 (screenings/immunisations) | Link out — `onNavigate("prevention")` | Screening calendar is native in Prevention; vaccination review isn't native anywhere yet |
| `ResultExplainer` AI button | Defer (not WebView, just out of v1) | Registered AI call site, but secondary |
| Video-visit itself (post-confirmation) | Needs a decision | Not covered by the confirmed-native list; check before assuming WebView is the only option |
