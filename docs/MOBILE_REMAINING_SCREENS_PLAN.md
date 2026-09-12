# Mobile: remaining web-only patient screens (2026-09-12)

Re-audited the "10 web-only screens" list against current main-dev rather than trusting the
earlier grep, which mistook action-only directories for real pages. Actual state:

## Real, reachable, worth building natively
1. **Timeline** — full paginated activity history. Real page, linked from Overview's
   "View full timeline".
2. **Adolescent health** — the private whole-life check-in for teens. Real page, linked
   prominently from Overview for the adolescent age band.
3. **Insurance** — HMO policy/benefits/claims/pre-auth self-service. Real, functioning,
   RLS-backed feature -- but **not linked from patient nav anywhere on web**, no dormant-feature
   comment anywhere (unlike pharmacy below). Looks like an honest gap, not a withheld feature.
   Building the native screen regardless since the data/RPCs are real; flagging the missing web
   nav link separately.
4. **Exercise programmes** — readiness screening + enrolment. Real page, linked from the
   Lifestyle hub. Previously flagged in the lifestyle-tracker PR as "a bigger piece of work,
   revisit separately" -- this is that follow-up.
5. **Video visit waiting room** — reached only after a paid video visit. Not a checkout page
   itself (the checkout that gets a patient here stays a browser hand-off, see below). Building
   scoped down: visit details, prep questions, Join button (opens Zoom same as Overview's
   existing pattern), published visit summary. Explicitly NOT porting the web page's live
   getUserMedia camera-preview device test -- Zoom's own client does its own device check on
   join, and building a native camera/mic preview is out of proportion to the value here.

## Small additions to existing native screens
6. **Testimonials** — a feedback form embedded in web's `/patient/care`, which the mobile
   `care-support-screen.tsx` already explicitly defers ("lower priority than the content above").
   No payment involved. Adding as a small section on care-support-screen.
7. **Vouchers** — `/patient/vouchers` has no standalone page on web either; it's actions
   (`buyCareVoucher`, `redeemServiceVoucher`, `payTowardVoucher`) consumed by `CareVouchersCard`
   on `/patient/care`. Viewing owned vouchers and redeeming one against a service carries no
   payment; adding that to care-support-screen. Buying a voucher stays a browser hand-off (below).

## Not building, and why
- **Pharmacy** — no standalone page on web. `PharmacyOrdersList`/`PharmacyCatalogue` are
  explicitly commented as "dormant while no pharmacy partner is contracted... kept unmounted
  rather than deleted." Building a native UI for a feature the founder deliberately keeps
  unmounted on web would be ahead of the founder's own decision, not native parity.
- **Lab-tests** — no standalone page on web either; `lab-tests/actions.ts` is checkout logic
  consumed by the Annual Health Check booking flow (already native via health-check-screen) and
  the lab catalogue. Nothing to mirror as a distinct screen.
- **Quick-log/[type]** — a real page, but it exists specifically as the destination for a
  WhatsApp/SMS reminder link (see its own header comment), not something reached via in-app
  navigation. A native equivalent would mean wiring push-notification deep links to a preset
  vitals type, which is a deep-linking task, not a missing screen -- out of scope here.

## The App Store 3.1.1 boundary (already established, re-confirmed here)
`lab-tests`, `vouchers` (buying), and `pharmacy` (if ever un-dormant) all call
`initiateBookingCheckout`/`initiateVoucherPaymentCheckout` -- Paystack redirects. Per the existing
documented reasoning in `care-support-screen.tsx`, any one-off Paystack checkout stays a system-
browser hand-off on native, never embedded. Nothing in this pass changes that.
