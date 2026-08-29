# Diaspora Health Check Business Model — Reconciliation & Build Plan

> Written 2026-08-29 against a 7-point growth pitch (diaspora gifting, standalone video
> consult, group screening days, instalment payment, screening→chronic conversion, referral
> commissions). Checked against the live `koiplnmbgnqnbywhpjlf` project and current `main`, not
> against changelog claims — see CLAUDE.md's standing warning that pricing/entitlements here
> churn constantly. Reconciliation only; nothing in this doc has been built as a result of it
> except where explicitly marked.

## Executive summary

**5 of the 7 pitched initiatives are already substantially or fully shipped.** The pitch reads
like it was written against a blank platform; it wasn't checked against `main`. Two things are
real gaps worth engineering time, and one of those two surfaced a live product bug along the way
that needs a founder call, not an engineering guess.

| # | Pitch item | Status |
|---|---|---|
| 1 | Diaspora-funded "Gift a Health Check" | **Partial** — every primitive exists, nothing is assembled into one product. See §1. |
| 2 | Unbundle video consult as standalone low-ticket product | **Shipped.** `video_visit_requests` (`20260723120000`), `general_checkin` context, its own price book, Paystack refund-on-decline cron. UI: `patient/video-visit/`. Nothing to add. |
| 3 | Group/community screening days | **Gap — not built.** See §2. |
| 4 | Instalment/thrift-style payment for the annual check | **Shipped**, and more general than proposed. `care_voucher_payments` layaway ("pay small small") lets a payer fund a voucher in any number of instalments of any size (above a configurable floor), not a fixed weekly plan. Native Paystack recurring subscriptions also exist separately for actual subscription plans. Nothing to add. |
| 5 | Convert screening results into chronic care | **Shipped as infrastructure**, conversion funnel itself is a GTM/comms question, not code. The Category 2→1 escalation pipeline (abnormal result → clinician alert, 4-hour SLA) is the platform's own highest-priority event per CLAUDE.md and already exists; `patient_risk_scores` and the screening ladder's subscriber discount already give a paid-plan incentive at the moment a result comes back. What's not built: a deliberate "you're pre-diabetic, here's Control tier" upsell touchpoint at the result-reveal moment. Small, worth a follow-up ask if wanted — not attempted here. |
| 6 | Referral commissions | **Shipped.** Generic `commissions` table, `commission_type`/`rate_type` (flat or %), admin dashboard at `admin/settings/commissions/`. Already correctly excludes partner-billed orders (e.g. Synlab) from double-counting commission against revenue (`20260821193144_switch_on_synlab.sql`). Nothing to add. |

Numbering above follows the pitch's own numbering (it started at 3, presumably continuing an
external list); "Diaspora-funded annual health check" is item 1 by position.

## §1 — Diaspora "Gift a Health Check": what exists, what doesn't

All four building blocks are real and live:

- **A standalone diaspora-payer account that doesn't require a full patient signup.**
  `/signup?intent=support` (`apps/web/src/app/signup/`) creates a `profiles` row with
  `account_purpose = 'support'` (`20260801093000_supporter_accounts.sql`) — no DOB, sex, or
  telehealth consent required, just Terms of Service. This is exactly "I'm abroad, I want to pay
  for my parent's checkup" with no friction. **No marketing page links to it** — every gift/CTA
  on the site points at generic `/login` or `/signup`.
- **A voucher mechanism that already supports gifting a lab-panel-plus-consult package, not
  just a subscription year.** `public.purchase_care_voucher(p_beneficiary, p_panel_bundle_id,
  p_gift_message)` (`20260731215226_care_vouchers_purchase_and_layaway.sql`) reserves a
  non-transferable, single-purpose, price-frozen voucher against any `self_bookable` panel
  bundle. **It has never been wired to a server action or any UI.** The only voucher-purchase
  action that exists, `buyCareVoucher` in `patient/vouchers/actions.ts`, calls the sibling RPC
  `purchase_subscription_voucher` and its own comment says plainly: *"tests are paid straight to
  the laboratory now, so there is nothing for Tarragon to sell ahead of time
  (`public.purchase_care_voucher` fails closed)."* **That comment is stale.** It was accurate
  under the 2026-08-03 self-arranged-fulfilment model, but `20260821193144_switch_on_synlab.sql`
  (Aug 21) reversed that for Synlab specifically: Synlab is now a partner-billed lab, Tarragon
  collects the full price and keeps the margin, and `purchase_care_voucher` does **not**
  fail closed for a self-bookable Synlab panel — it was simply never reconnected to the UI after
  the reversal. Confirmed live: `panel_bundles` currently has 12 active, self-bookable,
  Synlab-priced rows, from `screen_core` (₦227,500, the flagship annual tier) down to single
  tests (HIV, hepatitis, thyroid, etc.) — any of them is a valid `p_panel_bundle_id` today.
- **A checkout path already wired for GBP/USD.** `care_voucher_payments` accepts `NGN`, `GBP`,
  `USD`; Stripe handles GBP/USD sponsor-funded checkout, Paystack handles NGN.
- **A redemption path already wired to lab orders.** The redemption RPC in
  `20260731215326_care_vouchers_redemption.sql` redeems a `prepaid_service` voucher against a
  `lab_orders` row for the exact bundle it was bought for.

**What's actually missing** is assembly, not invention:

1. No server action calls `purchase_care_voucher`. Add one alongside `buyCareVoucher` in
   `patient/vouchers/actions.ts` (or a sponsor-side equivalent in `patient/supporting/actions.ts`,
   since a diaspora purchaser is a supporter, not a patient) that lets a supporter pick a
   self-bookable panel bundle for their linked person and reserve a voucher against it. Reuse the
   existing `payTowardVoucher` instalment action unchanged — it is already generic over any
   `voucher_id`.
2. The `/gift` marketing page (`apps/web/src/app/(marketing)/gift/`) only pitches gifting a
   subscription year ("Complete Care" / "Prevent"), never a one-off screening package. Add the
   screening-bundle option alongside it, and repoint its CTAs at `/signup?intent=support` instead
   of generic `/signup`/`/login` so a diaspora payer lands in the frictionless supporter flow.
3. The homepage's `?channel=diaspora` hero variant (`(marketing)/_content/channel-heroes.ts`)
   currently sends its CTA to `/pricing` — a subscription price list, not a gift flow. Repoint it
   once the above exists.
4. **A live bug surfaced while checking this, needs a founder decision before it's touched:**
   `private.handle_screen_tier_resulted()` (the trigger that's supposed to auto-book the doctor
   video consult when a screening panel's results come back) still hardcodes
   `v_bundle_code in ('screen_core', 'screen_advanced', 'screen_comprehensive')` and only inserts
   a `video_consultations` row when the code is specifically `screen_comprehensive`. The Aug 21
   tier restructure **deactivated `screen_comprehensive`** and made `screen_core` (₦227,500) the
   new flagship self-bookable tier — so completing today's actual top-tier annual health check no
   longer auto-books a video consult. `screen_core`'s own live description still says "A doctor
   reads every result with you," which is ambiguous between a live video consult and the
   asynchronous doctor-review pipeline built the same week as clinical-intelligence-core
   (lab-report extraction, clinician alerts on abnormal values). **This determines whether "gift a
   SYNLAB test + video consult" is even an accurate description of what `screen_core` delivers
   today** — worth a direct founder answer (intentional shift to async review, or a regression
   from the restructure that should re-fire the trigger on `screen_core`) before wiring the gift
   flow's copy or before touching the trigger function itself. Not fixed in this pass on purpose.

## §2 — Group/community screening days: genuinely unbuilt

Searched migrations and app code for `screening_day`, `bulk`, or any multi-patient booking
concept: none exists. What's there is `employer_roster_members`
(`20260715162958_employer_roster_members.sql`) — individual self-enrolment against a roster,
staff add phone numbers one at a time, each employee self-claims at their own signup. That is not
"bring 30 people, get a discounted rate, we send the phlebotomist and do video consults after."

This is a real net-new feature, not an assembly job, and it raises product questions worth
answering before writing schema: who creates a screening day (a corporate/church/association
admin, or Tarragon ops on their behalf?), how is the bulk discount rate expressed (a flat % off
`screen_core`/`know_your_basics`, or a separate negotiated SKU?), does payment happen upfront by
one payer for the whole cohort or per-attendee on the day, and does phlebotomist dispatch need
new scheduling infrastructure or is it operationally manual for now (a person is told "be at X
church on Y date," no in-app logistics). None of these are guarded by CLAUDE.md's Phase 2/3
restrictions (those cover the specialist-matching engine, the wellness-testing catalogue, and
Employer/HMO risk dashboards — this is closer to the already-built employer roster, just
group-oriented instead of individual), but the shape of the feature genuinely depends on answers
only the founder has. Not started in this pass.

## Recommended next step

Given 5 of 7 items need no engineering work at all, the highest-leverage next PR is §1's assembly
work (new server action + `/gift` page addition + CTA repoints) — it's small, reuses proven
payment/voucher code paths, and turns "the primitives all exist" into an actual product a
diaspora Facebook group could be pointed at. It should follow, not precede, a founder answer on
the `screen_core` video-consult question above, since that answer determines what the new gift
option is allowed to promise. §2 (group screening days) is a separate, larger piece of work that
needs its own scoping conversation before any schema gets written.
