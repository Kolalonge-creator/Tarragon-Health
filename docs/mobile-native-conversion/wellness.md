# Wellness Rewards — Native Conversion Scope

> Paste this entire file as your first message in a fresh Claude Code
> session in this repo. It is self-contained. Read
> `apps/mobile/src/lib/weight-management.ts` +
> `apps/mobile/src/screens/sections/weight-management-screen.tsx` first —
> they're the reference implementation for the pattern this doc assumes.
> `apps/mobile/src/lib/receipts.ts` +
> `apps/mobile/src/screens/sections/receipts-screen.tsx` are a good
> reference for a simpler, mostly-read-only section. Section id for this
> feature: `wellness`.

## Summary

The Wellness hub (`apps/web/src/app/(dashboard)/patient/wellness/page.tsx`)
is a free, plan-gate-free habit/engagement layer. Patients earn **wellness
points** automatically (via DB triggers, not user action) for logging
vitals, meals, medication check-ins, completing education lessons, hitting
lifestyle goals, finishing time-boxed **challenges**, and attending
**workout classes**. They collect cosmetic **badges** as milestones, and
can **redeem points at any time for a real Care Voucher** (a discount
voucher usable toward paid care — not cash, not a wallet credit). The page
also embeds a large, unrelated **Meal Log** feature (`NutritionFlow`,
AI photo-based meal logging) which is **out of scope** for this pass (see
below). Everything in scope — points balance/ledger, redemption, badges,
challenges, enrolment, progress, classes/registrations — is plain
RLS-scoped Supabase client calls and `SECURITY DEFINER` RPCs granted to
`authenticated` only, with **no service-role client and no Paystack/payment
call anywhere in this feature**. Redemption mints a `care_vouchers` row
directly via RPC; it does not take payment. The "Workout classes"
sub-feature is currently **dormant** (only a placeholder, inactive
provider/class seeded).

## File inventory

| Path | Lines | Notes |
|---|---|---|
| `apps/web/src/app/(dashboard)/patient/wellness/page.tsx` | 65 | Page shell: header + points card + badges grid + challenges + embedded meal log (out of scope) + classes |
| `apps/web/src/app/(dashboard)/patient/wellness/points-card.tsx` | 131 | Points balance, ledger (last 8), redeem-to-voucher form |
| `apps/web/src/app/(dashboard)/patient/wellness/badges-grid.tsx` | 54 | Badge catalogue vs. earned, grid display |
| `apps/web/src/app/(dashboard)/patient/wellness/challenges-section.tsx` | 124 | Active enrolments w/ progress bars, available challenges, "Join" |
| `apps/web/src/app/(dashboard)/patient/wellness/classes-section.tsx` | 105 | Upcoming classes, register, mark-attended (dormant data) |
| `apps/web/src/lib/queries/wellness.ts` | 463 | All hooks — patient-facing (~lines 1–288) + admin catalogue (~290–463, **not for mobile**) |
| `apps/web/src/app/(dashboard)/patient/wellness-points-summary.tsx` | 34 | Compact teaser used elsewhere (e.g. Overview) — not part of this section itself; a native Overview teaser linking to `onNavigate('wellness')` is a nice-to-have follow-up, not required here |
| `apps/web/src/app/(dashboard)/patient/nutrition-flow.tsx` | 577 | Meal log w/ AI vision + meal-plan generation — **distinct feature, out of scope** |
| `apps/web/src/app/(dashboard)/admin/settings/wellness/*` | 310 | Admin-only catalogue CRUD — **not part of the patient mobile app** |

**Total for the in-scope rewards feature: ~750 lines** — comparable to
weight-management, larger than Receipts. Expect roughly
weight-management-level effort, but flatter (four independent card
sections, no cross-table joins, no multi-step wizards).

## Data model

| Table / RPC | Purpose | R/W | Classification |
|---|---|---|---|
| `wellness_points_balances` | Current balance + lifetime earned | Read | **Safe direct client** — RLS: `patient_id = auth.uid() or is_org_staff(...)`. Row only exists after first award (null balance = 0, not an error) |
| `wellness_points_ledger` | Points history (earn/redeem entries with `reason`) | Read | **Safe direct client** |
| `public.redeem_wellness_points(p_points integer)` | Converts N points into a Care Voucher, decrements balance, writes ledger + `wellness_points_redemptions` row | Write (RPC) | **Safe direct client RPC** — `SECURITY DEFINER`, `auth.uid()`-scoped internally, granted `authenticated` only. **Not a payment/checkout** — mints a voucher from the patient's own points, no money moves, no Paystack. Returns `{ok, error?, balance?, kobo_credited?, voucher_id?}` |
| `wellness_badges` | Badge catalogue (active only) | Read | **Safe direct client** |
| `patient_wellness_badges` | Badges this patient has earned (joined) | Read | **Safe direct client** |
| `wellness_challenges` | Challenge catalogue (active only) | Read | **Safe direct client** |
| `patient_challenge_enrolments` | This patient's enrolments (joined) | Read | **Safe direct client** |
| `public.enrol_in_wellness_challenge(p_challenge_id uuid)` | Enrol in a challenge | Write (RPC) | **Safe direct client RPC** — `SECURITY DEFINER`, `auth.uid()`, `authenticated` only |
| `public.wellness_challenge_progress(p_enrolment_id uuid)` | Live progress `{progress, target}` | Read (RPC) | **Safe direct client RPC** — enforces caller owns the enrolment or is org staff |
| `wellness_class_providers` | Active class providers (**currently all seeded rows are inactive/placeholder**) | Read | **Safe direct client** |
| `wellness_classes` | Upcoming classes joined to provider | Read | **Safe direct client** |
| `wellness_class_registrations` | This patient's registrations (joined) | Read | **Safe direct client** |
| `wellness_class_registrations` (insert) | Register for a class | Write | **Safe direct client insert** — RLS requires `patient_id = auth.uid() and organisation_id = current_org_id()` |
| `wellness_class_registrations` (update `status='attended'`) | Self-report attendance (triggers a points award) | Write | **Safe direct client update** — same self-or-org-staff RLS shape |
| `wellness_points_config` | Points-to-kobo conversion rate | Read only, staff-write | Not directly queried by any patient hook — `redeem_wellness_points` reads it server-side. Admin-only write, out of scope |

No table/RPC here requires a service-role client, and none is a real
financial transaction.

## Recommended new API routes

**None needed.** Every patient-facing read/write is a plain RLS-scoped
table query or a `SECURITY DEFINER` RPC already granted to `authenticated`,
safe to call directly (same pattern as `weight-management.ts`'s
`create_personalised_lifestyle_goal`/`resolve_personalised_lifestyle_goal`).

## Recommended mobile files

- `apps/mobile/src/lib/wellness.ts` — mirrors the patient-facing half of
  `lib/queries/wellness.ts` (skip the admin functions entirely). Suggested
  exports, `QueryResult<T>` pattern throughout:
  - `loadWellnessPointsBalance(patientId)`
  - `loadWellnessPointsLedger(patientId, limit?)`
  - `redeemWellnessPoints(points)` → `redeem_wellness_points` RPC
  - `loadWellnessBadgesCatalogue()`
  - `loadMyWellnessBadges(patientId)`
  - `loadWellnessChallengesCatalogue()`
  - `loadMyChallengeEnrolments(patientId)`
  - `enrolInWellnessChallenge(challengeId)` → `enrol_in_wellness_challenge` RPC
  - `loadWellnessChallengeProgress(enrolmentId)` → `wellness_challenge_progress` RPC
  - `loadUpcomingWellnessClasses()`
  - `loadMyClassRegistrations(patientId)`
  - `registerForWellnessClass(patientId, organisationId, classId)`
  - `markWellnessClassAttended(registrationId)`

- `apps/mobile/src/screens/sections/wellness-screen.tsx` —
  `WellnessScreen({ patientId, organisationId, onNavigate })`, four
  sub-sections (single file, matching the `financial-profile-screen.tsx`/
  `weight-management-screen.tsx` convention):
  1. **Points card**: balance, lifetime earned, recent ledger (reuse the
     `REASON_LABEL` copy map from `points-card.tsx` verbatim), redeem form
     (points input + "Redeem" calling `redeemWellnessPoints`), success
     message formatted with `koboToNaira` from `@tarragon/shared` exactly
     as web does. **After a successful redemption, add a link to
     `onNavigate('financialProfile')`** so the patient can see the new
     voucher immediately (Financial Profile already renders
     `care_vouchers` — see below), since Wellness itself has no voucher
     list.
  2. **Badges grid**: catalogue vs. earned, simple grid, greyed-out
     unearned badges (mirror `badges-grid.tsx`'s `isEarned` styling).
  3. **Challenges section**: active enrolments with a progress bar
     (`progress`/`target` from `wellness_challenge_progress`), available
     challenges with "Join," status badges.
  4. **Classes section**: upcoming classes, "Register"/"Mark attended,"
     empty state copy ("Nothing scheduled yet…") — **an empty class list
     reflects real seed data, not a bug.**

No new lib file for the meal log — excluded from scope.

## Wiring

- `sections.ts`: `wellness` entry already exists — remove
  `webviewPath: "/patient/wellness"`.
- `home-shell.tsx`: add `import { WellnessScreen } from
  "@/screens/sections/wellness-screen";`, replace the `WebViewHubScreen`
  block for `wellness` with `<WellnessScreen patientId={userId}
  organisationId={organisationId} onNavigate={handleSelect} />` (matches
  the `weightManagement` wiring exactly — `userId`/`organisationId`/
  `handleSelect` are already in scope).

## Safety / payment-policy flags

- **Confirmed compliant with the "system browser, never native IAP/
  checkout" rule.** Points redemption is **not a payment/checkout flow at
  all** — an internal points-ledger debit that mints a `care_vouchers` row
  via `private.issue_reward_voucher`. No money changes hands, no Paystack
  call, no Apple/Google IAP surface. Safe as a plain native form + direct
  RPC call, unlike Screening Days' "Pay" or Financial Profile's "Pay my
  share" (which do move real money and correctly route to the browser).
- **Do not confuse this with *spending* a Care Voucher** to pay for a
  service — that downstream flow (wherever it lives) is a real
  payment-adjacent transaction and is **out of scope for Wellness**.
  Wellness only ever *creates* a voucher, never *spends* one.
- No AI call site, no clinical-safety scoring, no service-role client
  anywhere in this feature.

## Parts that should stay WebView / link-out / out of scope

- **Meal Log (`NutritionFlow`, 577 lines)** — embedded on the same web
  page but structurally distinct (AI photo meal-vision, AI meal-plan
  generation, its own state machine). Do not port as part of "Wellness."
  If/when it needs native conversion, it should be its own effort (likely
  needing `/api/mobile/*` routes wrapped in `runGovernedAi()`, since the
  AI-vision/meal-plan calls are server-side AI gated by
  `isMealVisionConfigured()`/`isMealPlanGenerationConfigured()`). For this
  pass, either omit it entirely or add a small "Log a meal" link opening
  the existing web flow as a stopgap — must not silently disappear without
  a decision being made.
- **Voucher display/spending** — don't build any voucher list or "use this
  voucher" UI here. `apps/mobile/src/lib/financial-profile.ts`'s
  `loadFinancialProfile()` already reads `care_vouchers` and
  `financial-profile-screen.tsx` already displays them natively. Link out
  via `onNavigate('financialProfile')` after redemption instead.
- **Admin catalogue management** — staff-only, not part of the patient
  mobile app, do not port under any circumstances.
- **Workout classes** — real, safe-to-port code, but the underlying data
  is currently dormant (one inactive placeholder provider/class). Port it
  anyway for parity with web; expect an empty state for every real patient
  until a provider goes live, same caveat web's own copy already carries.
