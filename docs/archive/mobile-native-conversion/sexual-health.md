# Sexual Health — Native Conversion Scope

> Paste this entire file as your first message in a fresh Claude Code
> session in this repo. It is self-contained. Read
> `apps/mobile/src/lib/weight-management.ts` +
> `apps/mobile/src/screens/sections/weight-management-screen.tsx` first —
> they're the reference implementation for the pattern this doc assumes.
> Also read `apps/mobile/src/screens/sections/care-support-screen.tsx`
> (around the `ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER` handling) — it's the
> reference for the paywall/browser-handoff pattern this feature reuses.
> Section id for this feature: `sexualHealth`.
>
> **This is the largest and most sensitive remaining section (~2,500 web
> lines). Read the "Reproductive-Health Safety Notes" section in full
> before writing any code that touches these tables.**

## Summary

The Sexual & Reproductive Health hub (`/patient/sexual-health`, spec §47)
is a private, PIN-gated area covering: an optional STI risk/symptom
check-in with automatic test recommendations; self-service STI test
booking (HIV, syphilis, Hep B, Hep C, a combined blood-borne-virus panel);
a positive-case follow-up tracker with an optional partner-notification
flow; an emergency-contraception fast-track request; a routine
contraception method browse-and-request flow; a fertility self-assessment
that can auto-open a specialist referral; a "Sexual Wellness"
sexual-dysfunction screening flow (4 short instruments: erectile function,
low libido, painful sex, premature ejaculation); a filtered slice of the
Learn library; and a dedicated "confidential message" composer that is
hidden even from a supporter who normally has clinical access, gated
behind a ₦2,500 per-message credit. Every part of the module is explicitly
designed so nothing here is ever visible to a family member, employer, or
HMO — only the patient and their care team.

## File Inventory (web)

All paths under `apps/web/src/app/(dashboard)/patient/sexual-health/`:

| File | Lines | Role |
|---|---|---|
| `page.tsx` | 46 | Server component: auth/org check, wraps hub in privacy gate |
| `sexual-health-hub.tsx` | 356 | Client shell: tabs, privacy banner, confidential-message CTA, Learn tab |
| `sexual-health-privacy-gate.tsx` | 136 | Optional PIN lock screen (shared-device privacy, not a security boundary) |
| `sexual-health-privacy-settings-card.tsx` | 139 | Set/change/remove the privacy PIN |
| `sti-risk-check-form.tsx` | 201 | STI risk/symptom check-in form |
| `sti-actions.ts` | 204 | Server actions: risk-check scoring+insert, partner-notification |
| `sti-testing-panel.tsx` | 104 | Self-bookable STI test catalogue + book&pay |
| `sti-case-status-card.tsx` | 287 | Positive-case episode tracker + partner-notify UI |
| `emergency-contraception-card.tsx` | 92 | EC fast-track request card |
| `emergency-contraception-actions.ts` | 91 | Server action: EC request insert + deterministic guidance text |
| `contraception-panel.tsx` | 188 | Method browse + request + "my plans" list |
| `contraception-actions.ts` | 55 | Server action: contraception method request insert |
| `fertility-assessment-form.tsx` | 121 | Fertility check-in form |
| `fertility-assessment-result.tsx` | 52 | Result copy component (pure presentation) |
| `fertility-actions.ts` | 98 | Server action: scoring + insert, conditionally opens `specialist_referrals` |
| `sexual-wellness-panel.tsx` | 193 | Concern picker + 4 Likert instruments + result |
| `sexual-wellness-actions.ts` | 97 | Server action: scoring + insert |
| `confidential-message-action.ts` | 53 | Server action: `start_care_thread` RPC wrapper, always `p_confidential=true` |
| **Total** | **2,513** | |

Shared lib reused, not duplicated by the hub:
- `apps/web/src/lib/queries/sexual-health-privacy.ts` (72) — PIN status/set/verify/clear hooks
- `apps/web/src/lib/queries/sti-case-episodes.ts` (71) — patient + org case-episode reads
- `apps/web/src/lib/queries/sti-partner-notifications.ts` (32)
- `apps/web/src/lib/queries/contraception.ts` (87)
- `apps/web/src/lib/queries/emergency-contraception.ts` (46) — **org/clinician worklist only; there is no patient-side "my EC requests" read hook today.** The web card is submit-only, no history view — match this unless explicitly asked to add one.
- `../lab-tests/actions.ts`'s `createAndPayForPartnerLabOrder` (reused for STI test booking)
- `apps/web/src/lib/billing/purchase-service-product.ts` (reused for the confidential-message credit purchase)
- `apps/web/src/lib/queries/health-education.ts`'s `useHealthEducationLibrary` (Learn tab)

This is the largest section ported so far — budget accordingly.

## Data Model

| Table / RPC | Purpose | R/W | Classification | Access-control mechanism |
|---|---|---|---|---|
| `sexual_health_privacy_settings` (read `failed_attempts, locked_until`) | PIN-lock status | Read | **Safe direct** | `pin_hash` has no client-facing SELECT grant (column-level, `20260829120300`); row existence alone = "PIN is set" |
| `set_sexual_health_pin(p_pin)` RPC | Set/change PIN | Write | **Safe direct** | Plain upsert RPC, `auth.uid()`-scoped internally, no old-PIN confirmation needed |
| `clear_sexual_health_pin()` RPC | Remove/reset PIN | Write | **Safe direct** | Same, deletes the row |
| `verify_sexual_health_pin(p_pin)` RPC | Check a PIN guess | — | **Safe direct** | Returns true/false; raises errcode `55006` on lockout — catch this specific code, not a message match |
| `sti_risk_checks` | STI risk/symptom check-in | Write | **Needs API route** | No client-facing INSERT policy at all (`20260829090100`) — service-role insert. Score computed server-side, never client-trusted. |
| `clinician_alerts` (conditional insert) | Symptom/high-risk escalation | Write | **Needs API route** | Same service-role call, same action — a symptom report or high risk always raises a `clinician_review` alert server-side |
| `sti_partner_notifications` (self_notify) | Records patient opened "notify a partner myself," returns copy-paste SMS/WhatsApp templates | Write | **Safe direct** | RLS already restricts to caller's own `patient_id` on an owned episode — plain client, no service role. Tarragon never sends anything itself. |
| `sti_partner_notifications` (clinician_assisted) | Hands a contact detail to the care team | Write | **Safe direct** | Same RLS policy, same no-service-role shape |
| `sti_partner_notifications` (read) | History for a case episode | Read | **Safe direct** | Patient-self-or-org-staff RLS, no supporter path (`20260829090200`) |
| `sti_case_episodes` (read, own) | Positive-case follow-up tracker | Read | **Safe direct** | "Confidential by construction... patient-self or org staff only, never a sponsor/supporter" |
| `emergency_contraception_requests` | EC fast-track request | Write | **Safe direct** | Plain client (own session) — RLS permits own `patient_id`/`organisation_id` with `status='pending'`. 1-hour-SLA clinician alert raised by the DB's own `ec_requests_raise_alert` trigger — nothing further after the insert. Guidance text computed server-side but this doesn't need service role, only RLS. |
| `contraception_methods` (read) | Method catalogue | Read | **Safe direct** | Global, admin-editable reference table, readable by any authenticated user |
| `contraception_plans` (read, own) | Patient's own requested/active plans | Read | **Safe direct** | Caller's own rows or org staff |
| `contraception_plans` (insert, `status='requested'`) | Request a method | Write | **Safe direct** | RLS restricts to caller's own `patient_id`/`organisation_id` with `status='requested'`, `prescribed_by null` — plain client, no service role |
| `fertility_assessments` | Fertility self-assessment | Write | **Needs API route** | No client-facing INSERT policy — service-role insert. Age read from profile server-side. Recommendation computed server-side, never client-trusted. |
| `specialist_referrals` (conditional insert) | Auto-opened when recommendation = `specialist_referral` | Write | **Needs API route** | Always staff/trigger-created, never patient-writable — must go through the same service-role path as the fertility assessment |
| `sexual_health_screens` | Sexual-dysfunction screening | Write | **Needs API route** | No client-facing INSERT policy (same discipline as `mental_health_screens`). Score/severity/cardiometabolic flag computed server-side. |
| `start_care_thread(p_subject, p_body, p_confidential=true)` RPC | Opens a confidential care-team thread | Write | **Safe direct RPC, but needs a paywall wrapper — see below** | `SECURITY DEFINER` RPC (`20260902211500_confidential_care_message_threads.sql`), resolves patient/org from `auth.uid()` internally. As of `20260907132010_paid_confidential_and_clinical_messaging.sql`, a trigger raises `'Buy a confidential message credit to send this...'` when no `confidential_message_credit` is available. The RPC call is safe direct; the credit purchase is what needs special handling. |
| Confidential-message credit purchase (Paystack) | Buys `confidential_message_credit` service product | Write | **Route via system browser, no new API route** | Same mechanism the existing native Care & Support screen already handles for the Ask-a-Doctor credit gate — mobile opens the web checkout page in the system browser (`WebBrowser.openBrowserAsync`), never replicates checkout |
| STI test booking + payment (`createAndPayForPartnerLabOrder`) | Book & pay for a test | Write | **Payment — route via browser or link to Labs, see below** | Same booking/payment class as any other lab order |
| `useHealthEducationLibrary(...)` | Learn tab reading list | Read | Safe direct, but see "link out" | Public reference content |

## Recommended New API Routes

Build under `apps/web/src/app/api/mobile/sexual-health/`, each a thin,
verbatim wrapper — same auth pattern as
`apps/web/src/app/api/mobile/mental-health-screen/route.ts`
(`createBearerClient(accessToken)` → `supabase.auth.getUser(accessToken)`):

1. **`POST /api/mobile/sexual-health/sti-risk-check`** — wraps
   `submitStiRiskCheck` (score + service-role insert into
   `sti_risk_checks` + conditional `clinician_alerts` insert). No client
   INSERT policy on `sti_risk_checks`; escalation logic must not be
   duplicated/trusted client-side.
2. **`POST /api/mobile/sexual-health/fertility-assessment`** — wraps
   `submitFertilityAssessment` (age lookup, scoring, service-role insert
   into `fertility_assessments`, conditional insert into
   `specialist_referrals`). Neither table has a client INSERT policy, and
   the referral auto-open must stay server-controlled per the platform's
   standing "referral table is staff/trigger-created only" guardrail.
3. **`POST /api/mobile/sexual-health/sexual-wellness-screen`** — wraps
   `submitSexualHealthScreen` (per-instrument validation, scoring,
   service-role insert). No client INSERT policy, scoring must not be
   client-trusted (same discipline as `mental_health_screens`).

Do **not** build a route for: PIN RPCs, partner-notification inserts, EC
request insert, contraception plan insert, or `start_care_thread` — all
plain RLS-scoped calls, safe directly, same as `weight-management.ts`'s
`createPersonalisedGoal`/`resolvePersonalisedGoal`. Also do not build a new
payment route for STI test booking or the confidential-message credit —
both reuse the existing browser-handoff pattern instead.

## Recommended Mobile Files

Given the size, split into one lib file per sub-domain plus one screen with
internal tabs (mirroring the web hub's own tab structure):

**Lib files** (`apps/mobile/src/lib/`):
- `sexual-health-privacy.ts` — PIN status/set/verify/clear
- `sti.ts` — risk-check submit (new API route), STI case episode read,
  partner-notification read/write (direct), STI test catalogue read +
  booking hookup (reuse existing lab-orders mobile equivalent if one
  exists, else link out)
- `contraception.ts` — method catalogue read, plan read/insert (direct), EC
  request insert (direct)
- `fertility.ts` — assessment submit (new API route)
- `sexual-wellness.ts` — screen submit (new API route)
- `confidential-message.ts` — thin wrapper around `start_care_thread` RPC
  with `p_confidential: true`, catching the credit-gate error text the same
  way `care-support.ts` catches `ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER`

**Screen files** (`apps/mobile/src/screens/sections/`):
- `sexual-health-screen.tsx` — top-level with the privacy PIN gate (render
  nothing until status resolves, same as web) wrapping an internal tab bar
  mirroring web's 6 tabs (`testing`/`results`/`contraception`/`fertility`/
  `wellness`/`learn`), plus the always-visible confidential-message CTA at
  the bottom
- Consider splitting `testing` (risk-check + test booking + case-status
  tracker + partner-notify) into its own file — it alone is ~800 web lines
  — e.g. `sexual-health-testing-tab.tsx`

**Recommended build order** (safest/simplest first):
1. Privacy PIN gate + settings (self-contained, sets the pattern)
2. Contraception panel (plain RLS only, no new routes, no payment)
3. Emergency contraception card (plain RLS write only)
4. Fertility assessment (first API-route-backed piece — validates the
   pattern before the two higher-stakes ones)
5. STI risk-check (API-route-backed + escalation — higher stakes than
   fertility because of the `clinician_alerts` side effect)
6. Sexual wellness screening (API-route-backed, most UI among these)
7. STI case-status tracker + partner-notify (plain reads/writes, but the
   most stateful/branching UI)
8. Confidential message CTA + credit-gate browser handoff (do last)
9. STI test booking (payment) — see recommendation below; likely a
   link-out rather than full native port this pass
10. Learn tab — trivial link-out, whenever convenient

## Wiring

- `sections.ts`: `sexualHealth` entry already exists — remove
  `webviewPath` once the native screen is ready.
- `home-shell.tsx`: add `{section === "sexualHealth" && <SexualHealthScreen
  userId={userId} organisationId={organisationId} />}` — **`userId`, never
  `subjectId`/an acting-for beneficiary id** (see safety notes below). Add
  a line to the shell's own doc comment alongside "Messages stays on
  userId"/"Care & support stays on userId": *"Sexual & reproductive health
  stays on userId: every table this module touches ... is
  patient-self-or-org-staff only by construction, with no
  profile_access/supporter/can_act_for path at all — there is nothing for
  an acting-for resolution to route to even if implemented."*

## Reproductive-Health Safety Notes (read before writing any code)

**This is the single most important section of this document.**

1. **The governing rule, from CLAUDE.md:** *"`reproductive_health` is one
   of eight values in the `care_access_category` enum, and
   `private.has_emergency_access` deliberately excludes it from break-glass
   ... Never copy an RLS shape from an older sibling table for anything
   touching menstrual/pregnancy/fertility/contraception data — write the
   category-scoped check fresh, and prove with a simulated
   caregiver/emergency session that access is actually refused, not just
   that the policy compiles."* This port **writes no RLS and no new
   tables** — it only calls existing, already-audited tables/RPCs/routes
   exactly as web already does. Do not add a `subjectId`/`p_patient_id`
   parameter to any call in this module "for consistency" with other
   screens — there is no server-side path that would honor it.

2. **Confirmed: unconditionally userId-only, no exceptions found anywhere
   in the module.** Evidence:
   - The web page's own doc comment: *"Plain auth/profile fetch, mirroring
     patient/lifestyle/page.tsx, not getPatientDashboardContext's 'acting
     for' resolution: every table this module reads is
     patient-self-or-org-staff only by construction, with no
     profile_access/supporter path at all... a supporter 'acting for'
     someone else could never see this data anyway, and every server
     action already built for this module writes under auth.uid()
     directly, never a subject id."*
   - Every server action (`sti-actions.ts`, `contraception-actions.ts`,
     `emergency-contraception-actions.ts`, `fertility-actions.ts`,
     `sexual-wellness-actions.ts`, `confidential-message-action.ts`) calls
     `createClient()` + `supabase.auth.getUser()` and inserts with
     `patient_id: user.id` — never a form-supplied or prop-supplied id.
   - Every query hook takes `patientId` as "the current user's own id"
     only, never resolved through any acting-for/dashboard-context
     mechanism.
   - **Build every mobile lib function to take `patientId`/`organisationId`
     as the device owner's own ids only (same as `care-support.ts`'s
     `submitAsyncConsult`/`loadMyAsyncConsults`) — never plumb through
     `getActingFor()`'s result.**

3. **Per-table access mechanism to reuse verbatim (never re-derive):**
   - `sti_risk_checks`, `fertility_assessments`, `sexual_health_screens`:
     **no client INSERT policy at all** — the only legitimate write path is
     the existing service-role server action logic, ported into the three
     new `/api/mobile/*` routes above. Never attempt a direct
     `supabase.from(...).insert(...)` against these three tables from the
     mobile client.
   - `sti_partner_notifications`, `contraception_plans`,
     `emergency_contraception_requests`: plain patient-scoped RLS INSERT
     policies — direct client calls are correct and intended, matching the
     corresponding web actions (`createClient()`, not service role).
   - `sti_case_episodes`, `contraception_plans` (read),
     `sti_partner_notifications` (read): patient-self-or-org-staff SELECT
     RLS.
   - `sexual_health_privacy_settings`: `pin_hash` excluded from client
     SELECT (column-level grant); everything else routes through the three
     RPCs, safe to call directly.
   - `start_care_thread`: `SECURITY DEFINER` RPC, resolves the caller's own
     patient/org internally from `auth.uid()` — safe direct call, pass
     `p_confidential: true` always. The credit gate is enforced by a
     DB-side trigger, not app code — do not pre-check credit balance
     client-side, just catch the specific error text ("confidential
     message credit") the same way `messages-flow.tsx`/
     `sexual-health-hub.tsx` already do on web.

4. **Payment/credit-gate handling — reuse the existing native pattern.**
   `apps/mobile/src/screens/sections/care-support-screen.tsx` (~line
   145-155) already solves "a plan-gated doctor-time action needs a paid
   credit and mobile has no Paystack SDK": on the specific error text, show
   an inline card and a button that calls
   `WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/...`)`, sending
   the patient to the web checkout in an in-app browser, then lets them
   return and retry. Reuse this exact mechanism for the confidential-
   message credit gate (open `${PLATFORM_URL}/patient/sexual-health`)
   instead of building a new checkout-URL API route.

## Parts to Keep as WebView / Link-Out (recommended for this first pass)

Given the size, recommend porting the check-in/tracking/request flows
natively but **deliberately NOT** porting STI test booking (payment) or the
Learn tab in this first pass:

- **STI test booking (`sti-testing-panel.tsx` →
  `createAndPayForPartnerLabOrder`)**: a Paystack checkout flow, identical
  in kind to any other lab-order booking. Rather than a bespoke payment
  route for this one panel: check the current state of the native Labs
  screen for generic panel-bundle booking support first. If it exists,
  link out to it. If it doesn't, treat "native lab-order booking + payment"
  as its own separate, reusable piece of work — **do not build a second,
  parallel payment route just for STI panels.**
- **Learn tab**: trivial link-out ("Browse in Learn," `onNavigate('learn')`
  or WebView per the standing Learn rule) — the web tab itself does
  nothing but filter three categories and link to `/patient/learn` for the
  actual reading experience.
- Everything else (privacy gate/settings, risk-check, case tracker +
  partner-notify, EC request, contraception browse/request, fertility
  assessment, sexual wellness screening, confidential message) should be
  ported natively this pass — none of it involves payment, and every
  access-control mechanism is fully documented above.
