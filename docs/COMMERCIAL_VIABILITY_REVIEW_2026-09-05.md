# Commercial Viability Review — 2026-09-05

A grounded assessment of whether Tarragon Health can make money while delivering real value,
written against the live `koiplnmbgnqnbywhpjlf` database and `origin/main-dev` at `7f9357ca`.
Every figure below is a live row count or a cited market source, not a projection.

**This is an analysis document, not an operating decision.** Nothing here overrides `CLAUDE.md`.
Where it recommends a change, that change still needs the founder's explicit go-ahead.

---

## Verdict

The platform is real and the per-transaction margins are mostly sound. The commercial problem is
not pricing. It is that **the one recurring paid product cannot be bought by a patient at all** (a
clinician must enrol them first), and **the thing that makes it worth paying for does not switch
on when you pay** (see §2). Meanwhile nothing has ever been sold, and five Nigerian web sessions
exist in the entire history of the site.

Fix the entitlement dead-end, put a price on the ask, make the programme self-serve, then stop
building and go sell twenty by hand.

---

## 1. Ground truth: what has ever actually happened

| Thing | Rows |
|---|---|
| `profiles` (all roles) | 38 (19 `patient`, all QA accounts) |
| `clinical_staff` | 8, of which **one real person** (Kola Longe, tier 4, Clinical Director) |
| `payment_transactions` | 3, all **Stripe test** webhooks from Aug 2026. **Zero Paystack transactions, ever** |
| `programme_purchases` | **0** |
| `subscriptions`, `invoices`, `appointments`, `video_consultations`, `async_consults`, `chronic_programme_enrolments`, `screening_results`, `leads`, `employer_accounts`, `screening_days`, `health_passport_issuances`, `protocol_api_licenses`, `api_keys` | **0 each** |
| `vitals_readings` | **4** |
| `web_events` | ~132 sessions since 27 Jul. **Nigeria: 5 sessions, 50 views, total** |

Nothing has been sold. Nothing has been marketed. Everything below is a model, not an observation.

---

## 2. The two defects that matter more than any pricing question

### 2a. A patient cannot buy the recurring product

`useEnrolChronicProgramme` (`apps/web/src/lib/queries/chronic-programmes.ts:122`) carries its own
comment: *"Chronic enrolment is clinician-initiated — the insert RLS is org-staff-only."* Its only
callers are clinician and admin surfaces. `chronic-programme-timeline.tsx:261` then renders the
₦50,000 upsell **only when `enrolment.track === "self_monitoring"`**, i.e. only once a clinician
has already enrolled the patient on the free track.

So the funnel for the one recurring paid product is: patient signs up, nothing happens, a doctor
must find them and enrol them, and only then does an upgrade button appear. With one doctor, that
funnel has never fired. `chronic_programme_enrolments = 0` is not an accident.

### 2b. The paid product does not grant what it promises

`private.patient_has_feature_access` grants the doctor-time features, **including
`vitals_red_flag_doctor_escalation`**, only from an active `programme_purchases` row. But
`programme_purchases` has 0 rows and **nothing in `apps/web/src` ever writes to it**. The real
purchase path writes `service_purchases`, and `chronic_doctor_supported_pack.features` is
`['chronic_doctor_supported_track']` only. Every product that used to carry the escalation feature
has been `is_active = false` since the 2026-09-02 subscription retirement.

**Consequence:** the seven live red-flag handlers all gate doctor escalation on a feature that no
purchasable product can grant. A patient who pays ₦50,000 still evaluates to `false`. This is a
clinical-safety gap first and a commercial one second.

The patient-facing emergency safety net is plan-independent and still fires correctly. It is the
doctor-paging half that is dark.

---

## 3. Unit economics

**Cost of a doctor-minute (estimated).** A Tier 1/2 medical officer at ~₦400k/month, ~₦520k fully
loaded, 173h/month, 70% clinical utilisation ≈ **₦72 per productive minute**. Tier 3/4 ≈ **₦120**.

| Product | Price | Est. doctor-min | Contribution | Margin |
|---|---|---|---|---|
| Ask a Doctor (written) | ₦2,500 | 10-20 | ₦920-1,640 | 37-66% |
| Prescription renewal | ₦3,500 | 6-12 | ₦2,490-2,920 | 71-83% |
| Verified document | ₦4,000 | 6-12 | ₦2,980-3,410 | 75-85% |
| Video visit | ₦5,000 | 25-35 | ₦2,300-3,020 | 46-60% |
| Result interpretation | ₦10,000 | 25-35 | ₦7,230-7,950 | **72-80%** |
| Second opinion | ₦7,500 | 30-50 @₦120 | ₦1,290-3,690 | **17-49%** |
| Senior case review | ₦15,000 | 45-90 @₦120 | ₦3,875-9,275 | 26-62% |
| **AI Coach pass** | ₦5,000 | 0 | **-₦16,500** | **negative** |
| 12-week programme | ₦50,000 | 210-280 | ₦28,150-33,400 | 56-67% |

### Named problems

1. **`ai_coach_daily_pass_30d` loses money outright.** It sells 100 Claude-backed messages/day for
   30 days for ₦5,000. At this repo's own token profile in `docs/AI_COST_ANALYSIS.md`, 3,000 turns
   costs roughly ₦21,300. **Break-even is about 23 messages/day, 23% of what is advertised.** Meter
   it, cut the cap to 30/day, or price it at ₦20,000.
2. **Second opinion and senior case review are adversely selected.** Fixed price for unbounded
   senior work, requested precisely when the case is hard. At 50 minutes of Tier 4 time the second
   opinion earns ₦1,290, less than the written consult costing a quarter as much.
3. **Two live prices for one video visit.** `service_products.video_visit_credit` says ₦5,000;
   `video_visit_prices` says ₦10,000. Which one a patient pays depends on which of two booking
   paths they take. Lagos market for a 15-minute private visit is about ₦16,000. Pick ₦10,000 and
   delete the other.
4. **One doctor-hour is priced three ways.** `pricing.ts:237-241` builds the programme as
   4 x ₦10,000 doctor reviews plus coordination, so internally a review is ₦10,000. But a
   standalone 20-minute video visit is ₦5,000 and a 15-minute result walkthrough is ₦10,000.

### Capacity

A monitored chronic patient consumes an estimated **350-550 doctor-minutes/year**. At 20 clinical
hours/week the founder can personally carry **110-175 such patients**. One full-time medical
officer has ~87,000 productive minutes/year, about **350 programme cycles = ₦17.4M revenue against
₦6.2M loaded salary**. The programme economics work per doctor. The constraint is demand, not price.

---

## 4. Willingness to pay

- Out-of-pocket is **71-75% of Nigerian health spending** — Nigerians do pay cash. But OOP spend is
  only about **$48 per capita per year (~₦64,000)**.
- Private GP consult: **₦5,000-₦15,000**; Lagos average for a 15-minute private visit **₦16,058**.
- Individual HMO cover: **Avon Life Plus ₦65,429/year**; the market spans ₦60k-₦300k/year.
- Healthtracka full-body checkup: **Bronze ₦40,000, Gold (female) ₦200,000**.
- Diaspora remittances: **$21.8bn in 2025**, healthcare and family maintenance named as drivers.

**Sound:** ₦2,500 written consult, ₦3,500 renewal, ₦4,000 document, **₦10,000 result interpretation
(make this the hero product)**.
**Underpriced:** ₦5,000 video visit, by about 2x.
**At the edge:** ₦50,000 for 12 weeks is 76% of a full year's Avon premium. It will sell to the
Lagos professional class and to diaspora sponsors. Model it as **one-shot, once ever**, never as a
quarterly repeat.

### The cancer-screening SKUs are a live problem

Four SKUs sit in production priced ₦62,000 to **₦432,500**, inserted 2026-09-03 by PR #469 which is
**still open**. `grep` finds zero references to those codes in `apps/web/src`. So production carries
a ₦432,500 price row nothing can sell, and if it ever did sell it would contradict the public
pricing page's standing "**You pay the lab, Tarragon takes no cut**" promise.

₦432,500 is **6.6x a full annual HMO premium** and about **6.8 years of the average Nigerian's
entire out-of-pocket health spending**. The cause is traceable: `lab_tests` prices mirror SynLab's
retail list, in which **FIT alone is ₦161,600** — 37% of the women's package. A FIT is a cheap
lateral-flow assay; that single number is an outlier the whole product line was built on.
**Recommendation: deactivate all four.** The "you pay the lab" model is the right one.

---

## 5. The diaspora sponsor model is the strongest wedge

It moves the payer. A UK-based nurse paying £30 for her mother's result interpretation is not making
a ₦10,000 decision against a ₦64,000 annual health budget. The money already flows ($21.8bn/year),
sponsors buy **proof**, and margins are better because sponsors buy discrete high-margin items.
`/gift`, instalments, `care_vouchers` and the sponsor/beneficiary consent graph are already built.

Four things block it:

1. **The beneficiary must already be on Tarragon.** `/gift/page.tsx:29` says "already linked to you
   on Tarragon". The sponsor is the motivated party; the mother in Ibadan will not download an app
   first. **Buy-for-a-phone-number is the single highest-value change in this document.**
2. **The headline gift earns ₦0.** "Buy them a Core Screen" is a `panel_bundles` row under the
   you-pay-the-lab model. Lead with the ₦10,000 result interpretation instead.
3. **You cannot take the sponsor's money in their currency.** Stripe is gone, Paystack is NGN-only.
   Check whether Paystack can enable GBP/USD collection on this account before assuming a UK entity
   is required.
4. **There is no proof-of-care artefact to send back.** Wire one branded PDF the sponsor receives,
   subject to the beneficiary's consent, and the product sells itself.

---

## 6. What to cut

Each of these carries maintenance and clinical-liability surface with no revenue:

1. Second opinion and senior case review products (0 requests ever, adversely selected).
2. The four cancer-screening SKUs (unreferenced, unbuyable, contradict the pricing promise).
3. Health Passport — no verifier network exists to make a credential worth paying for.
4. Protocol API — 0 licenses, 0 keys, and it puts Tarragon on the clinical hook for other
   companies' patients.
5. Payer and provider-org platforms — leave dormant, but stop *maintaining* 40+ tables for a
   counterparty that does not exist.
6. Population health / clinical-trials matching — correctly gated, stop touching it.
7. **The 20-queue clinician worklist.** 46 clinician routes and 20 work queues for one doctor. Every
   extra queue is a place for a paying patient's work to get lost. Collapse to three: urgent alerts,
   paid work owed, and a weekly digest.
8. **Stop routing 35 of the 44 alert generators to a doctor.** Abnormal screening results must stay.
   Missed-reading sweeps, engagement decline, sleep and alcohol flags should batch into a weekly
   digest. A free user with a wearable can currently generate unlimited unpaid doctor work.

Also: stop adding to the 29 open PRs. There is more unmerged work than product-market fit.

---

## 7. Ninety-day plan

1. **Fix the entitlement dead-end (§2b). One day.** Clinical safety first, commerce second. Write
   the test that proves the gate **opens** for a buyer, not just that it closes for everyone else.
   That missing assertion is exactly why this went unnoticed.
2. **Make the 12-week programme self-serve, and put a price on every ask. Three days.** Nine
   purchase CTAs exist and only one shows a naira figure. Worst case, `medications-list.tsx:704`
   fires the Paystack redirect from a mutation's `onError` handler, so the patient reaches a payment
   page having never been shown ₦3,500. Add a confirm step. Move "My services" out of the account
   drawer (currently the 27th of 32 sidebar entries) into primary nav.
3. **Reprice, then freeze the catalogue. Half a day.** Video visit to ₦10,000 with one source of
   truth. AI Coach pass to 30 msgs/day or ₦20,000. Deactivate the losers. Then stop: this catalogue
   has been repriced at least four times since July.
4. **Prove one naira can move. One day.** There has never been a completed Paystack transaction.
   Buy a ₦2,500 written consult from a real phone on a real card and watch the entitlement open.
   Until that round-trip is proven, nothing else matters.
5. **Build diaspora buy-for-a-phone-number. One week.** Plus the proof-of-care PDF back to the
   sponsor.
6. **Sell twenty by hand. Weeks 4-10.** Not marketing, selling. Twenty diaspora Nigerians in the
   founder's own network with a parent on BP or diabetes medication. *"₦10,000 / £8, a doctor reads
   your mother's last results and writes her a plan, and you get a copy."* Twenty conversations
   about why people said no is worth more than the rest of the backlog.
7. **Run one group screening day. Weeks 10-12.** One church, company or estate association. 30
   people at ₦10,000 in one Saturday. `screening_days` and its checkout are built and have never
   been used. It is the only mechanism that acquires many Nigerians at once, and it produces the
   first real cohort of `vitals_readings`, of which the platform currently has four.

### Needs a resource that does not exist

- Any HMO, insurer, hospital-group or corporate contract needs a BD person and 9-18 months.
- Specialist matching, referral pipeline and imaging partners need partner-onboarding capacity, not
  code.
- MDCN confirmation, NDPC registration, a DPO, and fintech counsel on the Care Voucher structure all
  need money and a lawyer. Real, and they will block scale, but none of them blocks selling twenty
  result interpretations to your own network.

---

## Uncertainties worth naming

- **Doctor-minute costs are estimates** from published salary ranges and a 70% utilisation
  assumption. Nothing in the codebase records actual consultation durations, so if real unit
  economics matter, start logging touchpoint duration.
- **Alert volume per patient is modelled, not observed.** With four vitals readings ever, the
  100-200 min/yr triage estimate could be 2x off in either direction.
- **Whether Paystack live keys are configured could not be verified** from the repo. Item 4 settles
  it.

## Sources

World Bank (Nigeria OOP % of health expenditure) · CJID (Out-of-Pocket and Out of Reach) ·
Expatistan (Lagos doctor visit) · lagos.cool (Lagos hospital costs and HMO plans 2026) ·
Bastion HMO (Avon alternatives with prices) · Nairacompare (top health insurance plans) ·
ClinikEHR and Profolio (Nigerian doctor salary guides) · GoDoctor (SynLab price list, 25 Jun 2026) ·
Healthtracka (full body checkup) · Vanguard (diaspora remittances $21.8bn) · NgnRates (CBN USD/NGN)
