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
| 1 | Diaspora-funded "Gift a Health Check" | **Built and verified 2026-08-29.** Every primitive existed, but the key one (`purchase_care_voucher`) turned out to be deliberately disabled, not just unwired — see §1 and the status note at the end of this doc. |
| 2 | Unbundle video consult as standalone low-ticket product | **Shipped.** `video_visit_requests` (`20260723120000`), `general_checkin` context, its own price book, Paystack refund-on-decline cron. UI: `patient/video-visit/`. Nothing to add. |
| 3 | Group/community screening days | **Built and verified 2026-08-29.** Genuinely net-new — see §2 and the status note at the end of this doc. |
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
  just a subscription year — corrected 2026-08-29, this was more broken than first thought.**
  `public.purchase_care_voucher(p_beneficiary, p_panel_bundle_id, p_gift_message)`
  (`20260731215226_care_vouchers_purchase_and_layaway.sql`) was designed to reserve a
  non-transferable, single-purpose, price-frozen voucher against any `self_bookable` panel
  bundle. **This reconciliation originally said it "has never been wired to a server action or
  any UI," reading only the 2026-07-31 migration file.** The live function definition told a
  different story: `20260803134416_self_arranged_consistency_sweep.sql` had **replaced its entire
  body with an unconditional `raise exception`**, permanently during the self-arranged-fulfilment
  sweep, with an explicit `⚠️ FOUNDER` comment flagging that the prepaid-voucher SKU was being
  removed on purpose (a voucher bought then meant an order that was ₦0 and could never reach
  `pending_payment` — genuinely unredeemable). Wiring a UI onto it, as this reconciliation
  originally planned, would have shipped a purchase button that failed every time. Caught only
  when the first real end-to-end test (a rolled-back transaction against production, not a UI
  click) hit the live exception. `20260821193144_switch_on_synlab.sql` (Aug 21) removed the
  premise for a self-bookable, partner-billed bundle specifically — Synlab is a real, priced,
  active partner now, and booking one produces exactly the payable `pending_payment` order the
  Aug 3 stub said couldn't exist — but nobody revisited the stub for eight days. **Re-enabled** in
  `20260829201533_reenable_purchase_care_voucher_for_partner_billed_bundles.sql`: same body as the
  original 2026-07-31 function, plus two guards mirrored from the real order-creation path
  (`private.set_lab_order_computed_price`, `private.enforce_lab_order_region`) so nothing can be
  sold as a voucher the beneficiary couldn't actually redeem — a region check (refuses a state
  with no active lab coverage, exactly like a real order would) and a priceable check (refuses a
  bundle where every test is already excluded for that specific beneficiary — sex, on file, an
  unmet gate — which would price the real order at nothing). Verified end-to-end via a
  rolled-back SQL transaction against production (see the verification note at the end of this
  section) rather than trusted on inspection alone, given how wrong the first read of this
  function turned out to be. Confirmed live: `panel_bundles` currently has 12 active,
  self-bookable, Synlab-priced rows, from `screen_core` (₦227,500, the flagship annual tier) down
  to single tests (HIV, hepatitis, thyroid, etc.) — any of them is a valid `p_panel_bundle_id`
  today, in a region Synlab covers, for a beneficiary who still needs at least one test in it.
- **A checkout path already wired for GBP/USD, as of this doc's original date.** `care_voucher_payments`
  accepts `NGN`, `GBP`, `USD`; Stripe handled GBP/USD sponsor-funded checkout, Paystack handled NGN.
  **Corrected 2026-09-03 — Stripe was removed entirely** (there was never a registered Stripe
  account behind it, so no non-NGN payment could ever actually complete; the one historical
  Stripe/USD row was confirmed test data and deleted). A diaspora sponsor funds a gift in naira via
  Paystack today, same as anyone else — see `apps/web/src/lib/billing/voucher-checkout.ts` and
  `screening-day-checkout.ts`, both NGN-only now.
- **A redemption path already wired to lab orders.** The redemption RPC in
  `20260731215326_care_vouchers_redemption.sql` redeems a `prepaid_service` voucher against a
  `lab_orders` row for the exact bundle it was bought for.

**What was actually missing**, and what landed for each:

1. No server action called `purchase_care_voucher` — and the RPC itself was disabled (see the
   correction above). Added `buyHealthCheckVoucher` in `patient/vouchers/actions.ts`, wired into a
   "Buy a health check" option on `care-vouchers-card.tsx` alongside the existing plan-gifting
   form, reusing the existing `payTowardVoucher` instalment action unchanged. Also wired
   `RedeemVoucherButton` into `annual-health-check-booking.tsx`'s pending-payment card — it already
   existed (built for pharmacy orders) and already supported `orderType: 'lab'`, but was never
   rendered next to a lab order's pay button, so a voucher would have had no way to be spent even
   once purchase worked.
2. The `/gift` marketing page (`apps/web/src/app/(marketing)/gift/`) only pitched gifting a
   subscription year ("Complete Care" / "Prevent"), never a one-off screening package. Added the
   screening-bundle option alongside it, and repointed its CTAs (hero, personalizer, closing band)
   at `/signup?intent=support` instead of generic `/signup`/`/login`.
3. The homepage's `?channel=diaspora` hero variant (`(marketing)/_content/channel-heroes.ts`) sent
   its CTA to `/pricing` — a subscription price list, not a gift flow. Repointed at `/gift`.
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

## Status: both gaps built and verified end-to-end (2026-08-29)

Both landed in this pass. Given how wrong the first read of `purchase_care_voucher` turned out to
be from a migration file alone, both flows were proven against the live schema before being called
done — not just typechecked/linted/built, which only proves the TypeScript compiles, never that
the RPCs it calls behave as assumed.

**Verification method:** a Supabase branch would have been the clean way to do this (a full,
disposable copy of the schema) but branching isn't available on this project's plan. Instead, each
flow was run as a single SQL transaction against production, simulating each real caller's
`auth.uid()` via `request.jwt.claims`, then rolled back — nothing persists, no row survives, no
notification-worthy state change (checked first: no `pg_net`/webhook trigger sits on any table or
status transition either flow touches). This is the same discipline this codebase's own history
describes for RLS changes ("prove any RLS change with a simulated session... in a rolled-back
transaction"), extended here to full RPC call sequences.

**Diaspora Gift-a-Health-Check, proven end-to-end:** a supporter account buys a `screen_core`
voucher for a linked patient (`purchase_care_voucher`) → pays in full, simulating the Paystack
webhook's own insert into `payment_transactions` → voucher activates → a real partner-billed
`pending_payment` lab order is created for the patient → the patient redeems the voucher against it
(`redeem_care_voucher`) → the order flips to `payment_confirmed`, the voucher to `redeemed`. Negative
paths also verified: a caller with no `profile_access` grant is refused the purchase; a beneficiary
in a state with no active lab coverage is refused (the new region guard); a bundle with nothing left
to deliver for that specific beneficiary — tested with a male patient against the cervical-smear
bundle — is refused (the new priceable guard).

**Group screening days, proven end-to-end:** a patient self-serve requests one
(`request_screening_day`) → a non-staff confirm attempt is correctly refused → an admin confirms it
with a 10% discount (`confirm_screening_day`), and the frozen price/total/default-payer all compute
correctly → the payer pays in full, simulating the same webhook insert → an attendee slot is
registered (`add_screening_day_slot`) → the admin issues that attendee their own prepaid voucher
(`issue_screening_day_voucher`), already fully paid via the group's bulk payment. Negative paths
verified: confirming an already-confirmed day is refused; registering a slot beyond
`slots_confirmed` is refused; issuing a voucher for an already-issued slot is refused.

**Browser-verified:** the public half of this (`/gift`, and the `?channel=diaspora` homepage hero)
was loaded in a real headless-Chromium session against the live project — both render cleanly with
zero console errors, the personalizer's dynamic copy updates correctly, and every CTA that should
now point at `/signup?intent=support` does. The authenticated dashboard pages
(`/patient/screening-days`, `/admin/settings/screening-days`, the care-vouchers-card additions)
were not click-tested in a browser — no test account exists on production and creating one there
was judged not worth the data-hygiene risk given the SQL-level proof above already exercises every
code path those pages call, including the auth checks. Said explicitly rather than silently
skipped, per this repo's own standard for UI verification.

**What would still make this more robust, not attempted here:** a Jest suite for the new
`actions.ts`/`screening-day-checkout.ts` files was deliberately skipped — this codebase's own
convention (checked: zero `actions.ts` files anywhere in the patient/admin dashboards have test
files) is to unit-test pure `lib/` logic, not thin RPC-wrapping server actions, and the real
business logic here lives in SQL, which the rolled-back-transaction proof above already covers more
rigorously than a mocked-Supabase-client Jest test would. A live click-through with a real
diaspora/admin test account, once one exists, is the one thing this pass could not substitute for.
