# Revenue Architecture and Earnings Plan — Reconciliation

> **Status: proposal under founder review, partially built.** This reconciles an incoming strategy
> document ("Tarragon Health Ltd — Revenue Architecture and Earnings Plan," prepared 27 August 2026,
> internal, "supersedes the subscription-led revenue model") against what actually exists in the
> codebase, corrects several claims in that document that don't match the live platform, and records
> what shipped from it. Subordinate to `CLAUDE.md`, which remains authoritative on scope-gating
> language and on any conflict. **Every price and revenue figure in the source document is explicitly
> self-described as "a proposal for decision, not a live price" and "a structural illustration, not a
> forecast."** Treat this file the same way — check the live DB/code before citing a number as
> current, per `CLAUDE.md`'s own repeated warning about pricing churn.
>
> **2026-08-29 — engine E3 (Results Interpretation) shipped as a standalone one-off product.** See
> §4 for what actually landed and where. Nothing else in the plan has founder sign-off yet — §5 lists
> what's still an open decision, with a recommendation for each.

## 1. What this document is

On 27 August 2026 a strategy document was handed in proposing a sequencing inversion for Tarragon's
revenue model: instead of acquiring Nigerian consumers first and monetising them, sell to diaspora
payers first (highest revenue per patient, lowest operational burden, reachable through the founder's
own network at zero acquisition cost), fund Nigerian consumer products from that revenue, then move to
employers, then HMOs/payers — "the same destination as before... a different order of arrival."

The document's headline evidence: Tarragon has zero paying patients, zero signed institutional
pilots, and exactly one real inbound lead in its history — from Coventry, UK. It argues the ₦5,000/
month consumer subscription failed on price and legibility, not on the billing cycle (WellaHealth
sells ₦700–2,000/month plans at real scale); that a health-check product is a losing fight against
better-resourced labs (Healthtracka, Clinix); and that what Tarragon can sell and a laboratory
structurally cannot is *the twelve months after the test* — continuity of care.

## 2. The nine proposed engines

| Engine | Time to first revenue | Verdict |
|---|---|---|
| E1 Diaspora Care Subscription ("Family Watch") | 30–60 days | BUILD FIRST |
| E2 Annual Care Pass (Nigerian consumer) | 60–90 days | BUILD NOW |
| E3 Results Interpretation | 30–60 days | BUILD NOW — **shipped 2026-08-29, see §4** |
| E4 Workforce Health Risk Report (digital B2B) | 90–120 days | BUILD NOW |
| E5 Lab/pharmacy facilitation fee (flat, provider-invoiced, never a % of the clinical price) | 6–9 months | BUILD AT VOLUME |
| E6 Fixed-duration chronic programmes (12-week course) | 6–9 months | STAGE 2 |
| E7 Per-covered-life institutional contracts | 12–18 months | STAGE 3 |
| E8 Wearable band device sales | Gated on OEM | CONTINUE, DECOUPLED (no change — already tracked separately) |
| E9 White-label/embedded technology | 18+ months | OPTIONAL, LATER |

**Proposed price list** (NGN unless noted; every figure "a proposal for decision"):

- Tarragon Free — ₦0 forever
- Results Interpretation — ₦7,500 one-off *(shipped at this price, see §4)*
- Care Pass, 12 months — ₦36,000 paid once, no auto-renewal
- Care Pass, 6 months — ₦21,000 paid once
- 12-week hypertension / diabetes programme — ₦30,000 / ₦35,000 one-off
- Monthly plan, on request only — ₦4,000/month, not promoted
- Family Watch (diaspora, one relative) — £25/month or £250/year
- Family Watch Plus — £45/month or £450/year (adds a monthly video review + health-check coordination)
- Additional relative — £15/month each
- Workforce Health Risk Report — ₦4,000/employee, min 50 employees, ₦200,000 floor
- Workforce follow-up programme — ₦25,000/employee enrolled
- Control (per covered life, institutional) — ₦9,000/life/year at pilot scale, ₦6,000 above 5,000 lives

## 3. Audit corrections — claims in the source document that don't match live code

A full codebase audit (2026-08-29) found several things the source document states or implies as
fact that are not true of the live `apps/web` platform. These matter because the document is written
for internal and eventually external (counsel, investor) use — worth correcting before it travels
further.

- **"The clinical accountability model already designed with a switchable tech-layer and provider
  configuration" — this does not exist in the live platform.** It only exists in the dormant,
  explicitly-superseded v3 spec (`reference/tarragon-control/docs/tarragon-build-spec-v3.md`), and
  `docs/legal/cover-memo-to-counsel.md:32-34` already states plainly: "We do **not** operate the
  'tech_layer' vs. 'provider' accountability-model switch v2 described — that mechanism does not
  exist in the live platform." Live clinical staffing is the five-tier doctor ladder (`CLAUDE.md`
  Clinical Tier Ladder section), a structurally different thing. If this plan reaches counsel or an
  investor, this line needs to be struck or rewritten.
- **"The Control SKU... unchanged in design" — no such thing exists anywhere in the repository.**
  There is no product, table, or code path named "Control SKU." The closest historical match is the
  v3 spec's `programme_code` enum (`'control' | 'concierge'`), a *patient programme tier* concept,
  not a per-covered-life institutional pricing SKU — and that enum lived only in the dormant v3
  schema, never in `apps/web`. Per-covered-life institutional billing (E7) has no implementation:
  `hmo_contracts` (capitation) was deliberately deleted per the no-capitation-ever rule (I8);
  `corporate_contracts` exists in schema but is dead, unreferenced code. E7 is not "unchanged," it is
  unbuilt from zero.
- **"Concierge tier (shelved)" is accurate but only as a v3-era artifact** — it never existed in
  `apps/web`, live migrations, or seed data. Nothing in the live platform needs "un-shelving."
- **The diaspora billing rail is USD-derived from NGN, not GBP.** GBP was fully retired as a
  patient-facing currency on 2026-07-29 (`pricing.ts`'s own header documents this). Every dollar
  figure Family Watch proposes in £ has zero existing Stripe/billing infrastructure to build on — a
  live GBP rail is a real, unbuilt prerequisite, not a resume of something dormant.
- **"The reviewed document" (illustrative model of ~10,000 patients / ~833 clinical hours a month)
  and "the Osogbo associate" do not appear anywhere in this repository** — code, docs, migrations, or
  seed data. If they're real, they're tracked outside this codebase (company Drive, per the source
  document's own citation list); this reconciliation can't verify or correct claims about either.
- **The kill list (source document §6) partially conflicts with work `CLAUDE.md` already records as
  shipped on explicit founder ask.** "Physical health hubs," "community/corporate physical screening
  days," and "aggregate data licensing" are killed as out-of-scope-for-now — correct as written, they
  don't conflict with anything live. But `CLAUDE.md`'s Clinical Tier Ladder section records that
  **Employer/HMO risk-stratification dashboards were pulled forward and built 2026-07-16 on explicit
  founder ask** — a materially different, already-live product from the kill list's framing of a
  from-scratch decision. Worth the founder knowing this exists (see §5, E4 below) before deciding
  whether E4 (Workforce Health Risk Report) duplicates it, extends it, or is a deliberately different
  shape.

## 4. What shipped — E3 Results Interpretation (2026-08-29)

The mechanism this sells already existed: a patient uploads a lab result document, and a doctor
writes a plain-language interpretation — built 2026-07-20 (`lab_result_documents`), gated to paid
plans only since 2026-08-05 (`20260804232022_gate_result_document_review_to_paid_plans.sql`). What
didn't exist was a way to buy that review as a single ₦7,500 purchase without a subscription. Built
using the same pattern already proven by the ₦10,000/visit video-consultation product
(`video_visit_requests`) rather than the subscription-add-on mechanism (`subscription_add_ons`),
which only supports recurring-interval billing attached to an existing subscription — not a genuine
one-off charge.

**What was built:**

- `results_interpretation_prices` / `results_interpretation_requests` tables, RLS, and a
  price-pinning trigger (server-derived charge amount, never client-sent) —
  `supabase/migrations/20260829004312_results_interpretation_one_off.sql`.
- `'results_interpretation'` added as a new `BookingOrderType`, reusing the existing generic
  booking-checkout machinery (`lib/billing/checkout-metadata.ts`, `lib/billing/booking-ownership.ts`)
  and both deployed webhook Edge Functions (`supabase/functions/paystack-webhook`,
  `supabase/functions/stripe-webhook`) — **the Edge Functions need redeploying for their copy of the
  booking-table map to pick this up; a migration alone does not activate real payment confirmation.**
  See the standing follow-up in `CLAUDE.md` about Edge Functions drifting behind source — check the
  deployed version before assuming this is live.
- `private.handle_lab_result_document()` redefined (third time; same trigger) to also accept a spent
  one-off credit as review access when the patient has no subscription/add-on-based access — consumes
  the oldest unspent, paid-for credit FIFO, only ever *raising* access, never lowering what the
  2026-08-05 gate already grants.
- Server action + UI: `app/(dashboard)/patient/results-interpretation-actions.ts`,
  `buy-results-interpretation.tsx`, wired into `result-documents.tsx` — shown only to a patient who
  doesn't already have paid-plan review access (`RequiresEntitlement` fallback).
- Marketing copy: a new `ADD_ONS` entry in `pricing.ts` ("any plan, pay-per-use," matching how
  video-visit is already presented), and a new row in the diaspora-facing coverage page
  (`lib/coverage/what-works-where.ts`).

**₦7,500 is a placeholder**, the same status the video-visit price book launched at — adjustable via
the `results_interpretation_prices` table (or a future admin control) without a migration. Not
promoted anywhere beyond what's listed above until the founder confirms it.

**Explicitly not built**: the source document's description also promises a "cardiovascular and
diabetes risk score" and "twelve-month plan" as part of this product. Neither exists as an automated
artifact tied to this flow — the shipped version is the doctor's written interpretation only, the same
scope the existing paid-plan review already had. Building a risk-score/12-month-plan generator is a
separate, unscoped piece of clinical product work, not implied by "wire up a checkout."

## 5. What's gated on a founder decision — not built, with a recommendation for each

Building these without sign-off risks guessing at unapproved architecture or business commitments
that are hard to unwind (a live GBP payment rail, a public price change, a restructured entitlement
model) — consistent with `CLAUDE.md`'s standing rule not to build speculative product/institutional
features without an explicit ask.

- **E1 Family Watch (diaspora GBP subscription).** Blocked on real prerequisites the source document
  itself lists as founder-only, non-engineering action items: indemnity cover (quote drafted, unsent
  since 10 August per `CLAUDE.md`'s standing follow-ups), Nigerian counsel engagement, and — per the
  document's own Stage 0/1 sequencing — a working GBP payment rail reviewed by counsel *before* it's
  built, because a UK payer paying for care delivered to a third party in Nigeria has cross-border
  payment-structuring implications neither this reconciliation nor the source document's own legal
  coverage fully resolves (see the critique below: UK-side payments/e-money perimeter advice isn't
  mentioned at all, only Nigerian counsel). **Recommendation: do not build GBP billing infrastructure
  until the founder confirms indemnity + counsel are moving and names who reviews the UK side.** The
  source document's own Stage 0 channel is manual ("the founder's personal network, worked
  directly") — the first customers may not need a self-serve product at all.
- **Care Pass (E2) / retiring the ₦5,000/month plan.** The plan's "Care Pass" doesn't map cleanly
  onto the live three-tier entitlement system (Prevent/Essential/Complete), which gates materially
  different feature sets, not just a price point — collapsing them into one "Care Pass" product is a
  product-architecture decision, not a repricing. Separately: the "₦5,000/month plan to retire" **is**
  the current Prevent tier, but all three paid tiers (Prevent/Essential/Complete) are currently
  `is_active = false` — nothing paid is actually purchasable on the live site right now, pending a
  Paystack/Stripe re-sync, so there's no live-customer disruption risk either way. **Recommendation:
  founder decides whether Care Pass replaces a tier, wraps one (e.g. sell Essential at ₦36,000/yr
  under the "Care Pass" name), or stays a separate product. The redeemed subscription-voucher
  mechanism already built for sponsors (`subscription_care_vouchers`, 2026-08-03) already produces
  "paid once, no auto-renewal" — worth reusing rather than inventing a parallel mechanism.**
- **E4 Workforce Health Risk Report.** As flagged in §3, the live employer/HMO dashboards
  (`(dashboard)/dashboard/corporate/`, `.../dashboard/hmo/`) are a different shape — aggregate-only,
  a byproduct of *ongoing* employee enrolment and monitoring, not a bounded one-time assessment SKU
  with its own per-employee price and floor fee. **Recommendation: founder confirms whether E4 is
  meant to be a genuinely separate, cheaper, digital-only entry product ahead of full enrolment (as
  the source document describes), or whether the existing dashboard already serves this need and the
  gap is packaging/pricing, not a new build.**
- **E7 Control (per-covered-life institutional).** No implementation exists at all (§3). Building
  real per-covered-life billing is a significant schema + billing-integration effort in its own
  right, explicitly Stage 3 in the source document's own sequencing (after a measured clinical
  outcome exists). **Recommendation: not started; revisit only once Stage 2's gate (a documented
  blood-pressure-control outcome over a sustained window) is actually met.**
- **E5 Provider facilitation fee (flat, invoiced to the lab/pharmacy, never a % of the clinical
  transaction).** No occurrence of this mechanism in code. The reasoning behind it (avoiding a
  financial interest in ordering tests, which the platform has already publicly renounced — see the
  self-arranged-fulfilment / "YOU PAY THE LAB" model already shipped) is sound and consistent with
  existing platform commitments. **Recommendation: Stage 2, per the source document's own gating
  ("only becomes worth building when Tarragon is sending enough volume to be worth invoicing for") —
  not started.**

## 6. A critique worth carrying into the founder decision

Independent of the audit, a few things in the source document are worth the founder weighing before
treating it as settled, beyond what's in §3:

- The diaspora pivot is a genuine strategic redirect being justified on n=1 (one unconverted lead).
  That's a reasonable, cheap hypothesis to test (which is exactly what the document's own Stage 0
  does — sell to ~10 people manually before building anything) — but §1's framing ("she is the
  customer this plan starts with") overstates the evidence for what is really a ~£150–400/month bet.
- Family Watch's £25/month pricing is benchmarked against Nigerian recurring-health-plan pricing
  logic (WellaHealth), but the buyer is a UK wallet — the real competitive comparison a UK-based payer
  makes is against UK private-GP subscriptions or international health/travel-insurance products, not
  a Nigerian community-pharmacy plan. Worth stress-testing willingness-to-pay against UK comparables
  before committing to a number.
- Cross-border payment/regulatory risk is gated behind "Nigerian counsel" only (§10 of the source
  document); nothing addresses UK-side payments perimeter or cross-border healthcare marketing rules,
  which a UK-resident founder billing UK cards for care delivered abroad plausibly also needs.

## 7. Source

Original document: "Tarragon Health Ltd — Revenue Architecture and Earnings Plan," prepared 27 August
2026, uploaded to this session as a `.docx`. Not checked into this repository in its original form —
this file is a reconciliation, not a verbatim copy; consult the founder's own copy (company Drive) for
the complete original text, including its full sourced-appendix and the section-by-section detail not
reproduced here (§8 unit-economics/clinician-minute-budget discipline, §9 the full staged plan and
kill criteria, §12 the next-90-days task list).
