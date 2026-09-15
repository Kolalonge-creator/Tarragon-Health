# Healthy Ageing — Native Conversion Scope

> Paste this entire file as your first message in a fresh Claude Code
> session in this repo. It is self-contained. Read
> `apps/mobile/src/lib/weight-management.ts` +
> `apps/mobile/src/screens/sections/weight-management-screen.tsx` first —
> they're the reference implementation for the pattern this doc assumes
> throughout. Section id for this feature: `healthyAgeing`.

## Summary

The "Healthy Ageing" section (spec §50) gives an older-adult patient (or
their caregiver, acting-for) one coordinated view across five things: a
scan-friendly stat snapshot (active conditions, medications/polypharmacy,
falls risk, check-in progress), a cross-condition "coordinated care" action
list that never duplicates a condition's own care plan, a 9-domain
comprehensive ageing check-in (mobility, falls, cognition, nutrition,
vision, hearing, social support, functional independence, frailty) with
deliberately non-diagnostic outcome language, a falls-risk pathway the
patient/caregiver can only *start* (clinical staff own every later stage), a
social-determinants screening that auto-triggers a care-coordinator
follow-up when any flag is true, and a home-visit request that is internal
record-keeping only (no live home-visit partner exists yet). It also embeds
the shared `VitalsTrendChart` and links out to Emergency card, Lifestyle,
Prevention, and Family.

This is a comparatively small, low-risk section — no service-role client,
no AI, no reproductive-health tables. Good candidate to do first.

## File Inventory (web)

| Path | Lines |
|---|---|
| `apps/web/src/app/(dashboard)/patient/(sections)/healthy-ageing/page.tsx` | 78 |
| `apps/web/src/app/(dashboard)/patient/healthy-ageing-snapshot-tile.tsx` | 64 |
| `apps/web/src/app/(dashboard)/patient/coordinated-care-summary-card.tsx` | 44 |
| `apps/web/src/app/(dashboard)/patient/ageing-assessment-section.tsx` | 65 |
| `apps/web/src/app/(dashboard)/patient/ageing-assessment-form.tsx` (client) | 79 |
| `apps/web/src/app/(dashboard)/patient/falls-risk-section.tsx` | 44 |
| `apps/web/src/app/(dashboard)/patient/falls-risk-form.tsx` (client) | 42 |
| `apps/web/src/app/(dashboard)/patient/social-determinants-section.tsx` | 41 |
| `apps/web/src/app/(dashboard)/patient/social-determinants-form.tsx` (client) | 42 |
| `apps/web/src/app/(dashboard)/patient/home-care-request-section.tsx` | 38 |
| `apps/web/src/app/(dashboard)/patient/home-care-request-form.tsx` (client) | 25 |
| `apps/web/src/app/(dashboard)/patient/healthy-ageing-actions.ts` ("use server" mutations) | 170 |
| `apps/web/src/lib/healthy-ageing/loaders.ts` (all reads) | 264 |
| `apps/web/src/lib/healthy-ageing/types.ts` (enums, labels, safe-copy maps) | 85 |
| `apps/web/src/lib/healthy-ageing/falls-risk-display.ts` | 37 |
| `apps/web/src/lib/validation/healthy-ageing.ts` (Zod schemas) | 50 |
| `apps/web/src/components/vitals-trend-chart.tsx` (shared, 393 lines) | — see "link out" |

**Core, healthy-ageing-specific total: ~1,068 lines.** Comparable to or
smaller than weight-management. Clinician-side counterparts
(`healthy-ageing-clinician-panel.tsx` etc.) are **out of scope** — patient
mobile only.

## Data model

| Table / RPC | Purpose | R/W | Classification |
|---|---|---|---|
| `ageing_assessments` | Header row per check-in episode (status, started/completed/next_review_due) | Read + Insert + Upsert-adjacent | **Safe direct client** |
| `ageing_assessment_domain_results` | One row per domain answered | Read + Upsert (`onConflict: "assessment_id,domain"`) | **Safe direct client** |
| `falls_risk_assessments` | Falls-risk pathway entry (5 boolean factors → `risk_level` defaulted server-side by trigger; `pathway_stage`) | Read + Insert only | **Safe direct client** |
| `social_determinant_screenings` | 5 boolean flags → `needs_navigation_support` (generated column) + `follow_up_status` (trigger-computed) | Read + Insert only | **Safe direct client** |
| `home_care_requests` | Home-visit eligibility/request record | Read + Insert only | **Safe direct client** |
| `patient_conditions` | Active/uncontrolled/under-investigation condition count | Read only | **Safe direct client — but see flag below (RLS gap)** |
| `medications` | Active medication count → polypharmacy flag | Read only | **Safe direct client** |
| `can_act_for` (RPC) | Acting-for grant check | Read (RPC) | Already implemented in `apps/mobile/src/lib/acting.ts` — no new work |

No AI call sites, no service-role client, no clinical scoring beyond two
simple, already-in-the-database triggers
(`private.default_falls_risk_level`, `private.default_social_navigation_follow_up`)
— both run server-side on INSERT regardless of caller, so a direct client
insert gets the same computed values web does. **Every mutation in
`healthy-ageing-actions.ts` is a plain insert/upsert on the caller's own
RLS-scoped Supabase client** (per the file's own header comment) — there is
no RPC wrapping any of these four tables, mobile should call
`.insert()`/`.upsert()` directly too.

RLS confirmed directly in migrations (not guessed):
- `ageing_assessments`/`ageing_assessment_domain_results`: SELECT/INSERT/
  UPDATE(while in_progress) all include `patient_id = auth.uid() OR
  private.can_act_for(patient_id)` (`20260829121740_ageing_assessments.sql`,
  patched in `20260902181722_healthy_ageing_caregiver_select_access.sql`).
- `falls_risk_assessments`: SELECT/INSERT same `can_act_for` gate, INSERT
  is `with check (... and pathway_stage = 'risk_identified')` — a
  patient/caregiver can only ever create the first stage; UPDATE is
  `is_org_staff` only. `risk_level` defaults from a `before insert` trigger
  (≥3 factors→high, 2→moderate, else low) unless explicitly set
  (`20260829121803_falls_risk_pathway.sql`).
- `social_determinant_screenings`: SELECT/INSERT `can_act_for`-gated
  (append-only). `needs_navigation_support` is a generated column;
  `follow_up_status` set by a `before insert` trigger to `'pending'` if any
  flag is true, else `'none_needed'` — never client-set
  (`20260829121834_social_determinants_and_home_care.sql`).
- `home_care_requests`: same shape — INSERT restricted to
  `status = 'eligibility_pending'`; UPDATE staff-only. Table comment: *"No
  live external home-visit partner is wired up yet... Do not build
  dispatch/logistics against a real provider here without an explicit ask."*
- All four tables' `logged_by_profile_id` is stamped server-side by the
  `stamp_acting_supporter` trigger from `auth.uid()`, never client-supplied.

## Recommended new API routes

**None.** Every mutation is a plain RLS-scoped insert/upsert with no
service-role client, no AI, and no un-duplicable server-side scoring logic.

## Recommended mobile files

**`apps/mobile/src/lib/healthy-ageing.ts`** (new, mirror `loaders.ts` +
`healthy-ageing-actions.ts` + `types.ts` combined into one file per the
`weight-management.ts` precedent):
- Re-export/redeclare view types (`AgeingAssessmentView`, `FallsRiskView`,
  `SocialDeterminantView`, `HomeCareRequestView`, `CoordinatedCareSummary`)
  using `Enums<...>`/`Tables<...>` from `@tarragon/shared`.
- `loadLatestAgeingAssessment`, `missingDomains`, `loadOpenFallsRisk`,
  `loadLatestSocialDeterminantScreening`, `loadOpenHomeCareRequest`,
  `loadCoordinatedCareSummary` — direct ports of the six loader functions,
  wrapped in `QueryResult<T>`.
- `submitAgeingAssessmentDomains`, `submitFallsRiskCheck`,
  `submitSocialDeterminantsCheck`, `submitHomeCareRequest` — direct ports
  of the four action functions as plain client calls (validate inline as
  strictly as `apps/web/src/lib/validation/healthy-ageing.ts`: `note`/
  `reason` max 500 chars, `reason` non-empty). Reuse the exact
  "find-or-create in-progress assessment then upsert domain rows onConflict
  'assessment_id,domain'" two-step for the ageing-assessment submit — that
  logic only lives in the server action today, replicate it client-side.
- Port `fallsRiskDisplay()` verbatim (pure function).
- Port the constant maps from `types.ts`: `AGEING_ASSESSMENT_DOMAINS`,
  `DOMAIN_LABEL`, `OUTCOME_COPY` (safe non-diagnostic copy — reuse
  verbatim, do not rewrite), `FALLS_RISK_LEVEL_LABEL`,
  `FALLS_PATHWAY_STAGE_LABEL`, `POLYPHARMACY_THRESHOLD`/`isPolypharmacy()`,
  `HOME_CARE_STATUS_LABEL`.

**`apps/mobile/src/screens/sections/healthy-ageing-screen.tsx`** (new,
mirror `weight-management-screen.tsx`'s structure):
- Props: `{ patientId: string; onNavigate: (section: SectionId) => void }`
  — **use `patientId = subjectId`** (see wiring below).
- Age-framing copy switch: fetch the subject's `date_of_birth` (one extra
  `profiles` select) and call `ageFromDateOfBirth` from `@tarragon/shared`
  to reproduce the `HEALTHY_AGEING_AGE_THRESHOLD = 60` framing switch.
- Snapshot stats block (4 stats), coordinated-care action list, comprehensive
  check-in (read-only answered domains + inline multi-domain form for
  `missingDomains()`), falls-risk card (open-pathway display + 5-checkbox
  form when none), social-determinants card (badge when
  `needsNavigationSupport` + always-shown 5-checkbox form), home-visit card
  (open-request status + reason textarea) — each ported from its web
  counterpart 1:1.
- "Related" link-out list: `onNavigate("emergency")`, `onNavigate("lifestyle")`,
  `onNavigate("prevention")`, `onNavigate("family")`.
- Vitals trend — **do not port; link out instead** (see below).

## Wiring

- `sections.ts`: remove `webviewPath: "/patient/healthy-ageing"` from the
  `healthyAgeing` entry.
- `home-shell.tsx`: add import + `{section === "healthyAgeing" &&
  <HealthyAgeingScreen patientId={subjectId} onNavigate={handleSelect} />}`.
  **Use `subjectId`, not `userId`** — all five tables above are
  `can_act_for`-gated for read (and insert, where patient/caregiver-writable
  at all), same group as Overview/Vitals/Medications/Health Passport/My
  actions. Add a bullet to home-shell.tsx's own doc comment documenting this
  per-table check, following its existing format (note: that comment block
  predates `weightManagement`/`wellbeing`/`healthCheck`/`findASpecialist`/
  `financialProfile` and none of those five got a bullet added either — a
  pre-existing gap, not something to silently perpetuate).

## Safety / clinical-sensitivity flags

- **`falls_risk_assessments` and `social_determinant_screenings` are
  append-only from the patient/caregiver side by design** — no edit/resubmit
  affordance for an existing open entry; a changed situation is a new row.
- **`falls_risk_assessments.pathway_stage` progression past
  `risk_identified` is clinical-staff-only** — RLS blocks it outright. Don't
  build UI implying the patient/caregiver can advance the pathway.
- **`ageing_assessment_domain_results.outcome` must only render through
  `OUTCOME_COPY`** — the enum has no diagnostic values by design. Never
  write new copy for these outcomes.
- **`home_care_requests` is deliberately NOT live dispatch.** Copy must stay
  "we'll be in touch," never a booking confirmation.
- **Pre-existing platform gap, inherited not introduced:** `patient_conditions`'s
  SELECT policy (`20260827203653_patient_conditions_problem_list.sql`) is
  `patient_id = auth.uid() OR is_org_staff(organisation_id)` only — **no
  `can_act_for` clause**, unlike `medications`. A caregiver acting for a
  supported person will see `activeConditionCount: 0` even with real active
  conditions. Web has this exact bug today too — worth a one-line flag in
  the PR description, not in scope to fix here.

## Parts that should stay WebView / link-out

- **`VitalsTrendChart` — do not port.** 393-line, heavily-shared `recharts`
  component. Mobile has **no charting library or chart component anywhere
  yet** (confirmed: `vitals-screen.tsx` has zero chart code today).
  **Replace `<VitalsTrendChart>` with a "See your vitals trends →" link via
  `onNavigate("vitals")`.** Flag mobile charting as separate future work if
  ever wanted — not scoped here.
- Learn and Privacy — not touched by this page, but reiterating: never port
  either.
- Everything else on the page should be ported, not linked out — no
  existing native equivalent to duplicate.
