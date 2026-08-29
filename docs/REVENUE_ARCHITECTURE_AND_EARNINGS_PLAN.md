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
> **2026-08-29 — five of the nine engines are built: E2 Care Pass, E3 Results Interpretation, E1
> Family Watch, E4 Workforce Health Risk Report, and E7 Control all shipped on explicit founder
> direction ("build") the same day this reconciliation was first written, along with retiring
> Prevent/Essential/Complete entirely.** See §4 for what actually landed, where, and what's
> deliberately still missing from each. §5 covers what's still not started (E5, E6, E9, the
> workforce follow-up add-on, the additional-relative discount) and the real prerequisites — mostly
> non-engineering — standing between what's built and it being safe to actually charge real money
> through it.

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
| E1 Diaspora Care Subscription ("Family Watch") | 30–60 days | BUILD FIRST — **shipped 2026-08-29 (USD, not GBP — see §4), needs indemnity/counsel before real launch** |
| E2 Annual Care Pass (Nigerian consumer) | 60–90 days | BUILD NOW — **shipped 2026-08-29, replaces Prevent/Essential/Complete (retired)** |
| E3 Results Interpretation | 30–60 days | BUILD NOW — **shipped 2026-08-29, see §4** |
| E4 Workforce Health Risk Report (digital B2B) | 90–120 days | BUILD NOW — **shipped 2026-08-29, no self-service (see §4)** |
| E5 Lab/pharmacy facilitation fee (flat, provider-invoiced, never a % of the clinical price) | 6–9 months | BUILD AT VOLUME — not started |
| E6 Fixed-duration chronic programmes (12-week course) | 6–9 months | STAGE 2 — not started |
| E7 Per-covered-life institutional contracts | 12–18 months | STAGE 3 — **shipped 2026-08-29 ahead of the plan's own Stage 3 gate, on explicit founder direction; see §4/§5 for the capitation distinction** |
| E8 Wearable band device sales | Gated on OEM | CONTINUE, DECOUPLED (no change — already tracked separately) |
| E9 White-label/embedded technology | 18+ months | OPTIONAL, LATER — not started |

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

## 4. What shipped, 2026-08-29

### E2 Care Pass — replaces Prevent/Essential/Complete entirely

Founder direction: "removing subscription based plan totally." Tarragon Prevent, Essential Care and
Complete Care are deactivated (`is_active = false`, kept not deleted — their code strings are
referenced by name across sponsor checkout, voucher purchase, and historical `subscriptions` rows).
Family/FamilyPlus/FamilyPremium/ParentCare needed no action: already fully **deleted** (not just
deactivated) by `20260729143514_individual_enrolment_only.sql`, confirmed by that migration's own
assertions — a fact this reconciliation's first pass got right, but only after nearly stating
otherwise; worth remembering that this codebase's migration history is not always where you'd expect
a given fact to live.

Care Pass (`care_pass_12mo` ₦36,000, `care_pass_6mo` ₦21,000) grants the full union of what the three
retired tiers offered between them — one product, not a ladder. Built by reusing the shape of the
self-purchased subscription-voucher mechanism rather than inventing new payment plumbing: a new
`'care_pass_purchase'` checkout kind, recognised only by a `payment_transactions` AFTER INSERT
trigger (the same deploy-free idiom as `voucher_payment`/`sponsored_subscription` — no Edge Function
redeploy needed for this one, unlike E3). A new `subscription_plans.term_months` column carries the
real coverage length, since `subscriptions.interval` only has `monthly`/`yearly`, which can't express
a 6-month non-renewing term.

**Found and fixed along the way**: `private.activate_sponsored_subscription` — the trigger behind
"put my mother on Complete Care and bill my card monthly," which `CLAUDE.md` itself calls "the most-
asked-for diaspora action" — has a guard (`if new.processed_at is null then return new`) that checks
a column only ever set by a *later* webhook `.update()`, never present on the `INSERT` the trigger
actually fires on. Every other trigger of this shape correctly reads `event_type`/`raw_payload`
directly. **Net effect until this fix: that feature has silently never activated a single subscription
in production**, however long it's been live. Fixed to match the working pattern; Family Watch below
depends on this fix being correct.

`care_pass_12mo`/`care_pass_6mo` are excluded from both existing places a plan could otherwise be
selected through the wrong recurring-billing flow (the patient's own plan switcher, the sponsor "pay
their plan" card) — Care Pass's one-off activation trigger doesn't know those flows' period-end math
or `cancel_at_period_end` semantics, and routing it through them would silently mis-grant either.

**A follow-up sweep of the whole codebase for stale references to the retired tiers** found three
more real functional bugs beyond copy: a crash in the `/for-you` marketing page (a non-null-asserted
`.find()` for the removed `"essential"` tier id), a dead live-price sync on the public pricing page
for Care Pass (an admin price change would never show up), and — the serious one — the 90-Day Health
Reset free trial RPC hardcoded `'complete'`/`'complete_usd' and is_active`, so retiring Complete Care
silently broke every trial claim. All three fixed; see the commit history for the full list of
copy updated alongside them (`upgrade-prompt.tsx`, the FAQ, several marketing pages, one admin
screen, `docs/MARKETING_SITE_SPEC.md`).

**Found and fixed a second time, checking Care Pass's features array against
`packages/db/tests/gate_second_condition_review_to_complete_care.sql` rather than assuming "full
union" was actually complete**: Care Pass was missing `vitals_red_flag_doctor_escalation` (gates
whether a dangerous BP/SpO2/temperature reading pages a clinician at all — granted to every paid
tier, not Complete-exclusive) and `multi_condition_review` (Complete-only: a second concurrent
condition getting a scheduled review immediately, not just an upgrade nudge). Both fixed in
`20260829014047_care_pass_missing_features_fix.sql`. The first is the one that mattered: without it,
a Care Pass patient would have had the same doctor-escalation behaviour on a dangerous reading as
Tarragon Free, despite paying for full chronic-care cover.

### E3 Results Interpretation (2026-08-29)

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

### E1 Family Watch (diaspora, 2026-08-29)

Built priced in **USD, not GBP**. The source document's £25/£45 pricing runs into a real,
deliberate guardrail: `subscription_plans_no_gbp`/`add_ons_no_gbp` CHECK constraints from
2026-07-29, added alongside a proven, assertion-tested decision retiring GBP as a currency
platform-wide. Given the choice between reversing that constraint or pricing in dollars instead, the
founder chose dollars (asked directly mid-build, since this was a real fork in the design, not a
detail). $30/mo or $300/yr for Family Watch, $55/mo or $550/yr for Plus — round numbers following
this codebase's existing "annual = 10x monthly" convention, not a literal £-to-$ conversion; still
"a proposal for decision, not a live price" in the same sense every other figure in this document is.

Deliberately **not** a `derived_from_code` row like every other USD plan on the platform. Every one
of those (`essential_usd`, `complete_usd`, ...) exists specifically so a diaspora buyer pays the same
care at the naira price converted, never a markup (see `DIASPORA_ONE_PRICE_NOTE`, rewritten as part
of this change since it no longer holds universally). Family Watch's entire commercial thesis is the
opposite — the whole engine only earns anything if the diaspora premium is real, not FX-converted
away — so this is a deliberate, scoped exception, confined to this one product family; nothing about
the no-GBP rule or `private.expected_derived_price_minor` was touched.

No new checkout or activation code at all: reuses `lib/billing/sponsored-subscription-checkout.ts` +
the just-fixed `private.activate_sponsored_subscription` exactly as already built. A new "Fund Family
Watch from abroad" card on the supported-people page reuses the existing `paySomeonesPlan` action
unchanged (it already read `currency` from form data generically — nothing hardcoded it to NGN).

**Explicitly not built**: the "Additional relative" discount (£15/mo each in the source document).
Funding a second relative today means a second, full-price Family Watch subscription — the sponsor
checkout already takes one beneficiary per call, so this works, just without the multi-relative
discount, which would need a cross-person `subscription_add_ons` attachment this doesn't build.

**Before this is promoted anywhere for real money**: the source document's own Stage 0/1 sequencing
lists indemnity cover and Nigerian counsel engagement as prerequisites that come *before* a live
payment rail, because a UK payer paying for care delivered to a third party in Nigeria has
cross-border payment-structuring implications — and (per the critique in §6) UK-side payments/e-money
perimeter advice isn't addressed anywhere in the source document at all, only the Nigerian side. Being
technically built does not mean these are resolved; they weren't asked for as part of this build and
aren't addressed by it.

### E4 Workforce Health Risk Report (2026-08-29)

No new questionnaire or scoring engine — employees complete the assessment through the risk-assessment
intake already built (`risk_assessment_responses` + `prevention_risk_scores`, the configurable
questionnaire engine from 2026-08-27). This ships the commercial wrapper only:
`workforce_risk_engagements` (₦4,000/employee, ₦200,000 floor, 50-employee minimum, server-pinned)
and a suppressed aggregate reader (`loadWorkforceRiskReport`) scoped to the engagement's assessment
window, built on the same `requireInstitutionAggregateAccess` doorway every other corporate/HMO
aggregate already goes through — no new patient-data access path was created.

Per §3's finding that this risked duplicating the already-shipped (2026-07-16) employer/HMO
risk-stratification dashboards: it doesn't, but the two are genuinely close enough that the founder
should know both now exist and decide how they're positioned against each other. The dashboards are a
byproduct of *ongoing* enrolment and monitoring, continuously updated, with no separate price of their
own. This is a bounded, one-time, priced engagement sold *before* an employer has committed to
ongoing monitoring at all. Whether that's the right wedge, or whether it just adds a confusing second
"employer risk" product, is a positioning call this build doesn't make for you.

**No self-service checkout**, matching the existing "corporate wellness plans and HMO partnerships are
priced differently... speak to our team directly" convention: creation and status changes are
admin-only RPCs (`create_workforce_risk_engagement`, `advance_workforce_risk_engagement`), usable
today via direct SQL/an admin script, no UI built.

**Explicitly not built**: the "workforce follow-up programme" (₦25,000/employee, sold only to the
subset flagged for follow-up) — needs a follow-up-eligible-subset selection this doesn't build.

### E7 Control (2026-08-29)

Shipped ahead of the source document's own Stage 3 gate ("open institutional conversations only once
a measured clinical outcome exists"), on explicit founder direction to build it now rather than wait.
₦9,000/life/year at pilot scale, ₦6,000 above 5,000 lives, server-pinned from covered-life count.

Built by **reviving `public.corporate_contracts`** rather than creating a new table: confirmed dead
schema since 2026-07-05 — present, RLS-configured, referenced by zero queries/actions/UI anywhere —
with exactly the shape this needed already (`organisation_id`/`per_employee_per_year_kobo`/
`employee_count`/`status`/`effective_from`/`effective_to`) and RLS already correctly scoped
(`is_org_staff`-gated, so the buying institution never reads it directly, matching the
`outcomes_contracts` "quoted manually" precedent). Despite its name it now serves any institutional
buyer — employer, HMO, or state — which is what the source document's own framing for Control needs.

**This is explicitly not capitation, and the distinction is load-bearing, not cosmetic**, given how
deliberately I8 ("no capitation, ever," 2026-07-29) was reinforced — found and re-affirmed twice in
this codebase's history, per `CLAUDE.md`'s own "Standing engineering lessons." Capitation means
Tarragon is paid a fixed fee per member to bear the *financial risk* of that member's actual care
costs. Control is a flat fee for a bounded, protocol-driven coordination service instead — sized
against the source document's own clinician-minute budget (~45 minutes/life/year at this price) —
where Tarragon never pays a claim and lab/pharmacy/specialist costs are still paid directly by the
covered life or their institution, same as every other product on the platform. That's a real,
structural difference in this build's design, not just a naming choice — but **the founder should
look at this personally before Control is sold under this name to an HMO or state buyer**, given how
sensitive I8 has proven to be historically.

No self-service checkout or UI, matching `outcomes_contracts`' own precedent — `create_control_contract`
is an admin-only RPC, usable today without a UI.

## 5. What's gated on a founder decision — not built, with a recommendation for each

All five gated engines from the previous version of this document (E1, E2, E4, E7, and the tier
retirement) shipped 2026-08-29 on explicit founder direction — see §4. What's left, genuinely not
built, with the same reasoning as before for why it isn't:

- **E5 Provider facilitation fee** (flat, invoiced to the lab/pharmacy, never a % of the clinical
  transaction). No occurrence of this mechanism in code. The reasoning behind it (avoiding a
  financial interest in ordering tests, which the platform has already publicly renounced — see the
  self-arranged-fulfilment / "YOU PAY THE LAB" model already shipped) is sound and consistent with
  existing platform commitments. **Recommendation: Stage 2, per the source document's own gating
  ("only becomes worth building when Tarragon is sending enough volume to be worth invoicing for") —
  not started.**
- **E6 Fixed-duration chronic programmes** (12-week hypertension/diabetes course, ₦30,000/₦35,000
  one-off). No implementation. The source document itself gates this on a second verified clinician
  ("a programme with a promised response time cannot rest on one part-time doctor") — a staffing
  prerequisite, not an engineering one. **Recommendation: not started; revisit once that hire is
  real.**
- **E9 White-label/embedded technology.** No implementation, explicitly "genuinely far away" per the
  source document's own text — needs an engineering team and a product stable enough to support
  somebody else's business. **Not started, not recommended yet.**
- **The "Additional relative" discount** (Family Watch, £15/mo each in the source document) and the
  **"workforce follow-up programme"** (₦25,000/employee, Workforce Health Risk Report) are both
  documented gaps inside otherwise-shipped engines — see their notes in §4 for exactly what each
  needs.
- **The Control (E7) capitation distinction** (§4) is a founder-attention item, not a build gap: the
  schema and pricing are shipped, but given how sensitive the no-capitation-ever rule (I8) has proven
  historically, this is worth the founder's own read before Control is sold to an HMO or state buyer
  under that name.
- **Family Watch (E1) going live for real money** is blocked on the same non-engineering
  prerequisites as before it was built: indemnity cover (quote drafted, unsent since 10 August per
  `CLAUDE.md`'s standing follow-ups), Nigerian counsel engagement, and — per the critique in §6 —
  UK-side payments/e-money perimeter advice the source document never addresses. Being technically
  built does not mean these are resolved.

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
