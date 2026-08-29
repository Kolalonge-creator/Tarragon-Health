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
4. **Resolved 2026-08-29 — vestigial dead code, not a broken promise.** `private.handle_screen_tier_resulted()`
   still hardcodes `v_bundle_code in ('screen_core', 'screen_advanced', 'screen_comprehensive')`
   and only inserts a `video_consultations` row when the code is specifically
   `screen_comprehensive` — dead since the Aug 21 tier restructure deactivated that bundle. This
   was flagged above as needing a founder call before being touched. Investigation found it
   doesn't need one: nothing user-facing was ever depending on that insert for `screen_core`. The
   real, complete, already-shipped mechanism behind `screen_core`'s "a doctor reads every result
   with you" is the `annual_health_checks` async review pipeline — a clinician "Review &
   communicate" step (`health-check-review.tsx` → `completeHealthCheckReview`) that writes a
   `review_summary`, gated on a red-flag attestation, surfaced to the patient with reviewer
   attribution and a downloadable PDF (`patient/health-check/page.tsx`) — plus the separate
   abnormal-result escalation path (clinician alert + WhatsApp, unaffected by any of this). Every
   patient-facing surface (booking copy, the results page, `pricing.ts`, `annual-health-check/`)
   already ties "15-minute doctor video consult" only to the dormant Comprehensive tier and
   describes Core Screen as a written, clinician-reviewed report — so the live copy already
   matches the live behaviour; the dead trigger branch just never got removed in the same pass
   that fixed the identical hardcoded-list pattern in two sibling trigger functions. **Left as
   found (not deleted) since it's inert, not incorrect** — a cleanup pass can drop the dead branch
   whenever someone is next in that function for another reason.
   **Consequence for the gift flow (§1's build plan, in progress):** a "Gift a Health Check"
   product should not claim a bundled video consult, because `screen_core` doesn't have one and
   inventing one would be the exact kind of overclaim the self-arranged-fulfilment marketing sweep
   spent an entire pass removing. The correct honest assembly is the panel voucher (async
   clinician review, matches what's real) plus the already-real, already-standalone
   `video_visit_requests`/`general_checkin` product offered as a separate, optional add-on — which
   also happens to satisfy the original pitch's "test + video consult" framing without
   misrepresenting either product.

## §2 — Group/community screening days: genuinely unbuilt

Searched migrations and app code for `screening_day`, `bulk`, or any multi-patient booking
concept: none exists. What's there is `employer_roster_members`
(`20260715162958_employer_roster_members.sql`) — individual self-enrolment against a roster,
staff add phone numbers one at a time, each employee self-claims at their own signup. That is not
"bring 30 people, get a discounted rate, we send the phlebotomist and do video consults after."

This is a real net-new feature, not an assembly job. Founder decisions on 2026-08-29 (recorded
here rather than re-litigated in a future session):

- **Who creates a screening day: both.** A self-serve request path (any authenticated user
  submits host/date/location/headcount) AND a manual ops-created path (staff sets one up directly
  after a phone/WhatsApp negotiation). Modelled as one RPC pair rather than two features — a
  request row either comes in through self-serve or is inserted directly by staff, then staff
  confirm either way.
- **Discount: a flat percentage off an existing self-bookable panel bundle** (e.g. `screen_core`
  or `know_your_basics`), not a separately negotiated per-event rate. Reuses the existing
  `panel_bundles` price list rather than inventing a parallel one.
- **Payment: one payer covers the whole cohort upfront.** Matches the pitch's own "cash upfront,
  no procurement cycle" framing — a single bulk charge before the event, not per-attendee payment
  on the day.
- **Logistics: booking only.** Phlebotomist dispatch (actually getting Synlab's phlebotomist to
  the venue) stays a manual ops task outside the app, matching how lab-order transmission to
  Synlab already works today (`public.mark_lab_order_transmitted` records a reference; nothing
  automated contacts the lab).

**Design chosen to minimise new plumbing:** reuse `care_vouchers` for the actual per-attendee
entitlement rather than inventing a second prepaid-service concept. A new `screening_days` header
row holds the event/discount/bulk-payment bookkeeping (mirrors the bulk-payment side of
`care_voucher_payments`'s AFTER-INSERT-trigger-on-`payment_transactions` pattern, so no Edge
Function needs redeploying), and a `screening_days_slots` table pre-registers attendees by
name/phone the same way `employer_roster_members` already does. Once an attendee has (or gets) a
real Tarragon profile, staff issue them one ordinary `care_vouchers` row — already fully paid,
because the group's bulk payment covers it — through the exact same non-transferable,
single-purpose, price-frozen machinery every other voucher uses. This does not weaken the
voucher's non-transferability guarantee: each one is still issued to one named, real beneficiary
and immutable from that point on; it only changes where the money came from.

None of this is guarded by CLAUDE.md's Phase 2/3 restrictions (those cover the specialist-matching
engine, the wellness-testing catalogue, and Employer/HMO risk dashboards — this is closer to the
already-built employer roster, just group-oriented instead of individual, and it charges a real
discounted price rather than adding a new commercial concept).

## Recommended next step

Both remaining gaps are now scoped and being built in this pass: §1's assembly work (new server
action + `/gift` page addition + CTA repoints, honestly describing the panel-plus-optional-video-
visit combination per the resolved finding above) and §2's `screening_days`/`screening_day_slots`
schema plus a minimal admin confirm/issue UI and self-serve request form. See git history for what
actually landed — this doc is the reconciliation record, not a live status board.
