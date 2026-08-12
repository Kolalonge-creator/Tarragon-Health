/**
 * Pricing content, sourced from Tarragon_Health_Pricing_Guide_v3.docx (the
 * authoritative plans & pricing doc, regenerated 2026-07-21; it absorbs the
 * decisions below and drops v2's "nurse" wording for "doctor" platform-wide,
 * so the old nurse->doctor translation exception is retired). Keep this file
 * in sync with that guide; every price and label here should be traceable
 * back to it. v2 is kept alongside for history only.
 *
 * Superseded 2026-07-29 by two founder decisions, which this file now reflects
 * ahead of the docx (the guide needs regenerating to match):
 *
 * - INDIVIDUAL ENROLMENT ONLY. Family Lite/Plus/Premium, ParentCare and the
 *   per-extra-member add-ons are gone, in naira and in dollars. One person,
 *   one subscription. Looking after somebody else is now a consent
 *   relationship rather than a shared bill: they hold their own account, name
 *   you as next of kin so you can follow their care, and you can fund their
 *   care vouchers. Nothing here may advertise a household plan again without a
 *   migration reversing 20260729143514.
 * - ONE DIASPORA CURRENCY, AND ONE PRICE. Pounds are retired, along with
 *   Diaspora Premium (which had no naira counterpart and so could never sit on
 *   a single price list). Dollar prices are the naira price converted at an
 *   admin-set reference rate, currently ₦1,365 to the dollar, so the same
 *   plan is priced from the same naira number everywhere. The old 2.5-3.5x
 *   diaspora premium is gone with it: do not reintroduce a diaspora price
 *   band here, because private.enforce_derived_price will reject it in the
 *   database anyway.
 * - UPDATED 2026-08-02: a disclosed 10% international-card processing fee
 *   now sits on top of the converted price, on every dollar plan and add-on,
 *   monthly and yearly alike (private.expected_derived_price_minor). This is
 *   not the retired diaspora premium reintroduced under another name: it is
 *   cost-based, uniform, and shown to the buyer as its own line rather than
 *   folded silently into a bigger number (DIASPORA_PROCESSING_FEE_NOTE
 *   below). The Diaspora tab also now leads with the yearly price (one card
 *   charge a year instead of twelve), matching the onboarding/subscription
 *   pages, which already defaulted to yearly for dollars. Admin-editable at
 *   /admin/settings/diaspora-pricing; re-derive USD_TIERS's static fallback
 *   numbers if either the rate or the fee changes.
 *
 * Superseded 2026-08-02 — the old 3-tier Health Check ladder (Basic/Annual
 * Health Check/Comprehensive) is replaced by Core/Advanced/Comprehensive
 * Screen, matching new panel_bundles rows
 * 'screen_core'/'screen_advanced'/'screen_comprehensive'. "Annual Doctor
 * Review" is retired as a separate product — its doctor video consult is now
 * Comprehensive Screen's own result walkthrough, closing the two confusingly-
 * named "annual ___" products this file used to carry side by side.
 *
 * Superseded 2026-08-03 — SELF-ARRANGED FULFILMENT. Tarragon has no contracted
 * lab or pharmacy, so it no longer books, routes or bills a test. Nothing in
 * this file may quote a Tarragon price for a Screen tier or an individual test,
 * because there isn't one: the patient takes our request to whichever
 * laboratory they choose and pays that laboratory directly, and we take no
 * commission on it. The Screen tiers are a paid-plan feature covering the part
 * we actually do (deciding what is worth testing, writing the request, reading
 * the result, following up).
 *
 * Sharpened 2026-08-04 — founder decision: this file quotes NO price for any
 * test, investigation, screening, or vaccine dose, not even as a "rough guide"
 * (the old TYPICAL_PRICES table was removed for exactly this reason — a
 * budgeting estimate still reads as a Tarragon price to a visitor). The
 * platform is positioned around monitoring, prevention, and doctor review of
 * what an investigation finds, never around what it costs. Every test a
 * patient needs is requested in-app and booked and paid for by the patient
 * privately, directly with the laboratory or provider they choose. Re-check
 * this whole file against that model before reintroducing any figure.
 *
 * Corrected 2026-08-05 — founder decision, reversing the line above: routine
 * doctor review of a result a patient uploads is a paid-plan feature (Prevent
 * and above), not something available on Tarragon Free. A doctor reading an
 * uploaded result unprompted, for a patient who isn't paying for review at
 * all, costs real clinician time for no platform benefit. This does NOT
 * touch the separate, non-negotiable abnormal-result escalation pipeline
 * (Category 2→1 upgrade via the screening_results trigger), which still
 * fires regardless of plan — that is a structured-data safety net, not the
 * "have someone read what I uploaded" convenience this note is about. Same
 * pass: the async "ask a doctor" written-question reply moved from 24 to 72
 * hours (still Complete Care only), the Expedited Doctor Response add-on was
 * withdrawn (adds doctor-time pressure for a paid convenience, not a
 * clinical need), Health Education became included on every paid tier
 * instead of Complete-Care-only-plus-addon, the video consult product was
 * renamed "Online Doctor Consultation" with its doctor-acceptance window
 * widened from 24 to 48 hours, and the standalone Catch-Up HPV Vaccine card
 * was folded into the Prevent tier's vaccination line (Tarragon was never
 * charging for it, so it never needed its own priced-looking card).
 *
 * Repriced 2026-08-05 — founder-directed tier increase, argued from what a
 * Nigerian buyer is actually comparing against (Reliance HMO Basic at the old
 * ₦3,500/mo Prevent price; a private Lagos consult at ₦15–16k vs. old
 * ₦8,000/mo Essential; entry retail HMO at ₦40–120k/yr vs. old ₦15,000/mo
 * Complete): Prevent ₦3,500→₦5,000/mo (₦35,000→₦50,000/yr), Essential
 * ₦8,000→₦10,000/mo (₦80,000→₦100,000/yr), Complete ₦15,000→₦20,000/mo
 * (₦150,000→₦200,000/yr). Diaspora prices are unchanged in mechanism (still
 * the naira price ÷ reference rate × 1.10 fee) and simply move with them.
 * Two real feature additions ride alongside the increase, not just a number
 * change: Essential and Complete now also include Prevent's screening and
 * vaccination calendar and Core Screen review (previously a chronic-care
 * subscriber inherited from Tarragon Free, not Prevent, so got no preventive
 * screening at all — `essential`/`complete`'s `features` rows gained
 * `prevention_coordination` in the same migration); and Prevent's existing
 * `result_document_review` entitlement is named explicitly below as fast,
 * any-lab result reading, since that capability (`lab_report_extractions`)
 * was already built and live but never stated as a reason to pay. See
 * `raise_ngn_tier_prices_and_fold_prevention_into_chronic_plans` for the
 * migration. Every changed subscription_plans row is `is_active: false`
 * pending a "Sync now" in /admin/settings/subscriptions (Paystack Plans /
 * Stripe Prices are immutable on amount, so each needs a fresh provider
 * object) — this file's numbers are correct ahead of that step, not after it.
 *
 * Corrected 2026-08-10 — founder decision, reversing the Free tier's own
 * safety-net line below: Tarragon Free should not consume any doctor time at
 * all — that is what paying for a plan is for. A dangerous vitals or symptom
 * reading (BP, SpO2, temperature, glucose, a red-flag symptom, the one-touch
 * danger-symptom check) is still detected by the same deterministic
 * thresholds on every plan, and the patient still gets the full emergency
 * safety net ("go to the nearest hospital now" guidance, emergency-contact
 * notify, follow-up check-in) plus a specific, immediate self-care
 * suggestion — what changes on Free is that it no longer also reaches a
 * doctor. Doctor follow-up on a dangerous reading starts on Tarragon Prevent.
 * This does NOT touch the separate, non-negotiable abnormal-result escalation
 * pipeline named two paragraphs up (Category 2→1 upgrade via the
 * screening_results trigger) — that is a different, structured-data event,
 * out of scope for this decision, and still fires regardless of plan. See
 * 20260810120000_gate_vitals_red_flag_escalation_to_paid_plans.sql.
 *
 * Superseded 2026-07-15: Tarragon now directly employs its own doctors, so
 * the day-to-day touchpoints that used to be relabelled "clinician" (per the
 * earlier "clinician is the default face" rule in
 * docs/CLINICAL_TRUST_MODEL_SPEC.md §9) are back to "doctor" everywhere in
 * this file, matching the docx and the current spec. Escalation-triggered
 * doctor review (Priority doctor escalation) was already correctly attributed
 * to "doctor" and is unchanged. (The Dedicated Care Coordinator add-on, also
 * named here previously, was withdrawn 2026-07-31 — see the note further down
 * where its card used to sit.)
 */

export type PricingLabel =
  | "INCLUDED"
  | "YOU PAY THE LAB"
  | "FREE ELSEWHERE"
  | "ADD-ON";

export type PricingLineItem = {
  feature: string;
  label: PricingLabel;
};

export type PricingTier = {
  id: string;
  name: string;
  whoFor: string;
  priceMain: string;
  pricePeriod?: string;
  priceSecondary?: string;
  description: string;
  highlight?: boolean;
  items: PricingLineItem[];
  /** Plain-text clarification called out in the guide (not a line item). */
  footnote?: string;
  /** A one-line disclosure shown directly under the price, distinct from
   * `footnote` (which sits below the feature list). Used on the Diaspora tab
   * to state the processing fee as its own line rather than fold it
   * silently into priceMain/priceSecondary. */
  priceNote?: string;
};

export const PRICING_LABELS: Record<
  PricingLabel,
  { title: string; description: string; className: string }
> = {
  INCLUDED: {
    title: "Included",
    description: "Part of your plan at no extra charge",
    className: "bg-brand-green/10 text-deep-forest",
  },
  "YOU PAY THE LAB": {
    title: "You pay the lab",
    description:
      "Tarragon works out what's needed and writes the request; you take it to whichever laboratory, pharmacy, or provider you choose and pay them directly. We take no commission on it.",
    className: "bg-clinical-navy/10 text-clinical-navy",
  },
  "FREE ELSEWHERE": {
    title: "Free elsewhere",
    description: "Already free, usually from a government programme; we just remind and direct you",
    className: "bg-soft-sage text-charcoal-ink",
  },
  "ADD-ON": {
    title: "Add-on",
    description: "An optional extra you can choose to add, with its own separate price",
    className: "bg-sprout-gold/15 text-charcoal-ink",
  },
};

/** The "No-Hidden-Cost Promise", shown as a banner near the top of the pricing page. */
export const PRICING_PROMISES: string[] = [
  "We will never charge you for anything without showing you the exact price first and getting your confirmation. No surprise charges. Ever.",
  "We will always tell you clearly whether something is already included in your plan, something you'll pay the laboratory or pharmacy for directly (we set no price on it and take no cut), or something that's actually free elsewhere and we're just reminding you about it.",
  "You will always know exactly what you are paying for: every plan and every add-on is fully listed below, with nothing left out.",
  "Paying in dollars from abroad includes a disclosed 10% international card-processing fee on top of the converted naira price: a real, cost-based charge shown as its own line next to the price, never folded silently into a bigger number.",
  "You can cancel a monthly plan at any time. Annual plans are paid upfront for the year, but you can turn off auto-renewal whenever you like: no penalty, no argument, no hard sell.",
  "Naira prices are reviewed once a year to keep pace with cost changes, but we will always tell you at least 30 days before any change takes effect, and anything you've already paid for (like an annual plan) is honoured at the price you paid until it's time to renew.",
];

export const NGN_TIERS: PricingTier[] = [
  {
    id: "free",
    name: "Tarragon Free",
    whoFor: "Anyone starting to track their health",
    priceMain: "₦0",
    pricePeriod: "forever",
    description:
      "A self-tracking tool to help you understand your own numbers and build a habit. Your readings are still checked against care protocols on this plan too, and a dangerous one still gets you clear guidance and a specific next step immediately; what this plan doesn't include is a doctor on the other end of that guidance, a doctor-set care plan, or a scheduled review of any result you upload. Those start on Tarragon Prevent. Free still gets you real tools: logging, reminders, and the full education library, at no cost, forever.",
    items: [
      { feature: "Log your BP, blood sugar, and weight", label: "INCLUDED" },
      { feature: "Medication reminders", label: "INCLUDED" },
      { feature: "Wellness points, badges & challenges", label: "INCLUDED" },
      { feature: "The Tarragon 90-Day Health Reset", label: "INCLUDED" },
      { feature: "Full education library", label: "INCLUDED" },
      { feature: "Downloadable Health Passport PDF", label: "INCLUDED" },
      { feature: "Device setup guides", label: "INCLUDED" },
    ],
    footnote:
      "Not included on this plan, and available only if you upgrade: a doctor seeing a dangerous reading, a doctor-set care plan and scheduled review of your readings, doctor review of a result you upload, doctor check-in, lab test coordination, medication refill coordination, family dashboard.",
  },
  {
    id: "prevent",
    name: "Tarragon Prevent",
    whoFor: "Healthy, and planning to stay that way",
    priceMain: "₦5,000",
    pricePeriod: "per month",
    priceSecondary: "or ₦50,000/year (2 months free)",
    description:
      "The stay-healthy plan. You don't need a diagnosis to benefit from Tarragon: Prevent builds your personal screening and vaccination calendar, tells you what's due and why, and teaches you what your numbers mean. If a result ever needs attention, a doctor steps in the same day and helps you decide what's next.",
    items: [
      { feature: "Everything in Tarragon Free", label: "INCLUDED" },
      { feature: "Personal screening calendar matched to your age, sex, and history", label: "INCLUDED" },
      { feature: "Screening requests when due, with reminders and results tracking", label: "INCLUDED" },
      { feature: "Vaccination schedule, reminders, and verified certificates, including catch-up HPV dosing outside the free government age bracket", label: "INCLUDED" },
      { feature: "Personalised health education with knowledge checks", label: "INCLUDED" },
      { feature: "Doctor follow-up on any abnormal result", label: "INCLUDED" },
      { feature: "Any lab, any format: upload a result and a doctor's plain-language interpretation is sent to you in the app, with next steps suggested if anything needs attention, not just once a year", label: "INCLUDED" },
      { feature: "Screening lab tests, paid straight to the lab you choose", label: "YOU PAY THE LAB" },
      { feature: "Core Screen: we say what to get, you use any lab or upload a result you already have, and a doctor reads it", label: "INCLUDED" },
    ],
    footnote:
      "Prevent is not a chronic-care plan: a doctor-set care plan with scheduled reviews of your readings is on Essential Care and above. If a screening ever finds something, we'll help you move onto the right care programme; that's the whole point of catching it early.",
  },
  {
    id: "essential",
    name: "Essential Care",
    whoFor: "One condition: hypertension, diabetes, or weight management",
    priceMain: "₦10,000",
    pricePeriod: "per month",
    priceSecondary: "or ₦100,000/year (2 months free)",
    description: "Real clinical monitoring begins here, for one condition, and this price now also includes your full preventive screening calendar, not just chronic-condition tracking.",
    highlight: true,
    items: [
      { feature: "Everything in Tarragon Free", label: "INCLUDED" },
      { feature: "A doctor-set care plan for your condition, with a scheduled review", label: "INCLUDED" },
      { feature: "Regular doctor check-in", label: "INCLUDED" },
      { feature: "Medication adherence follow-up from your doctor", label: "INCLUDED" },
      { feature: "Message your care team directly in the app", label: "INCLUDED" },
      { feature: "Personal screening calendar and vaccination schedule, the same as Tarragon Prevent", label: "INCLUDED" },
      { feature: "Core Screen: any lab or an upload, read back to you by a doctor", label: "INCLUDED" },
      { feature: "Personalised health education with knowledge checks", label: "INCLUDED" },
      { feature: "Lab tests (HbA1c, kidney function, lipid panel, etc.)", label: "YOU PAY THE LAB" },
      { feature: "Medication refills, from any pharmacy you choose", label: "YOU PAY THE LAB" },
    ],
    footnote:
      "A month of Essential Care costs less than a single private specialist consultation in Lagos (typically ₦15,000–16,000) and buys twelve months of a doctor-set care plan, scheduled review, check-ins, adherence follow-up, and in-app messaging with your care team. If you have more than one condition, or your doctor considers you higher-risk, Complete Care gives you closer monitoring.",
  },
  {
    id: "complete",
    name: "Complete Care",
    whoFor: "More than one of the conditions we manage, or higher risk",
    priceMain: "₦20,000",
    pricePeriod: "per month",
    priceSecondary: "or ₦200,000/year (2 months free)",
    description:
      "Tarragon currently manages three chronic conditions: hypertension, diabetes, and weight management. Complete Care is for anyone managing more than one of them together (for example, blood pressure and blood sugar, or diabetes and weight), or anyone whose doctor recommends closer monitoring.",
    items: [
      { feature: "Everything in Essential Care", label: "INCLUDED" },
      { feature: "A scheduled review for each condition you manage, not just one", label: "INCLUDED" },
      { feature: "Hypertension, diabetes, and weight all managed together on one care plan", label: "INCLUDED" },
      { feature: "Priority doctor escalation", label: "INCLUDED" },
      { feature: "Ask a doctor a one-off written question, answered within 72 hours", label: "INCLUDED" },
      { feature: "Lab tests", label: "YOU PAY THE LAB" },
      { feature: "Medication refills", label: "YOU PAY THE LAB" },
    ],
    footnote:
      "The Screen tiers come with your plan. What comes with it is the part we do: working out which tests are worth doing for you, writing the request, reading the results, and following up. You pay the laboratory directly for the tests themselves, at whatever that lab charges, and we take nothing on top.",
  },
];

/** Short version for a per-card line, right under the price. Full version
 * (DIASPORA_PROCESSING_FEE_NOTE, below) sits once under the whole tier grid.
 * Exported so lib/marketing/plan-prices.ts can reuse the exact same wording
 * for the live-priced override, not just this file's static fallback. */
export const DIASPORA_PROCESSING_FEE_NOTE_SHORT = "Includes a 10% international processing fee.";

/**
 * Diaspora tab prices, annual-first.
 *
 * priceMain is now the YEARLY charge, not the monthly one: one card charge a
 * year instead of twelve, which the onboarding and /patient/subscription
 * pages already default to for dollars (see plan-selector.tsx). priceSecondary
 * carries the monthly alternative, still one tap away everywhere it's shown.
 *
 * Both numbers include the 10% processing fee (naira price / 1,365 * 1.10,
 * rounded to the cent) so this static fallback matches what checkout actually
 * charges even before fetchTierPriceOverrides' live prices load. Re-derive
 * both if the reference rate or the fee ever change.
 */
export const USD_TIERS: PricingTier[] = [
  {
    id: "diaspora-prevent",
    name: "Tarragon Prevent (Diaspora)",
    whoFor: "Healthy, and planning to stay that way",
    priceMain: "$40.29",
    pricePeriod: "per year",
    priceSecondary: "or $4.03/month",
    priceNote: DIASPORA_PROCESSING_FEE_NOTE_SHORT,
    description:
      "The stay-healthy plan, billed in dollars: a personal screening and vaccination calendar, health education, and doctor follow-up on any abnormal result. Monitoring, care-protocol checks, and education work from anywhere; a physical test or dose still needs whoever it's for to visit a laboratory or provider in Nigeria.",
    items: [
      { feature: "Everything in Tarragon Prevent (Naira plan)", label: "INCLUDED" },
      { feature: "Screening lab tests, paid to a laboratory in Nigeria", label: "YOU PAY THE LAB" },
    ],
  },
  {
    id: "diaspora-essential",
    name: "Essential Care (Diaspora)",
    whoFor: "One condition, monitored from abroad",
    priceMain: "$80.59",
    pricePeriod: "per year",
    priceSecondary: "or $8.06/month",
    priceNote: DIASPORA_PROCESSING_FEE_NOTE_SHORT,
    description: "Everything included is the same as Essential Care in Naira, billed in US dollars.",
    highlight: true,
    items: [
      { feature: "Everything in Essential Care (Naira plan)", label: "INCLUDED" },
      { feature: "Lab tests and medication refills in Nigeria", label: "YOU PAY THE LAB" },
    ],
  },
  {
    id: "diaspora-complete",
    name: "Complete Care (Diaspora)",
    whoFor: "Multiple conditions, monitored from abroad",
    priceMain: "$161.17",
    pricePeriod: "per year",
    priceSecondary: "or $16.12/month",
    priceNote: DIASPORA_PROCESSING_FEE_NOTE_SHORT,
    description: "Everything included is the same as Complete Care in Naira, billed in US dollars.",
    items: [
      { feature: "Everything in Complete Care (Naira plan)", label: "INCLUDED" },
      { feature: "Lab tests and medication refills in Nigeria", label: "YOU PAY THE LAB" },
    ],
  },
];

/**
 * The diaspora pitch, reframed.
 *
 * The old framing sold a health subscription to someone abroad and then had to
 * explain why half of it would not work for them. That is a weak sale and an
 * awkward one, and it competes on the wrong axis: against a Nigerian health app
 * for a buyer who is not in Nigeria.
 *
 * The actual job is different. Money already goes home for health, constantly,
 * and it arrives with no receipt and no way to know it reached care rather than
 * general upkeep. The competitor is not another health platform, it is a
 * transfer app plus hope. That is what this block sells, and it is the one
 * thing a transfer app structurally cannot do.
 *
 * Deliberately makes no claim about price being lower, higher or better value
 * than anything else. The plan is the same naira number everywhere, plus a
 * disclosed processing fee for a dollar card; the reason to buy is not the
 * number.
 */
export const DIASPORA_SPONSOR_PITCH = {
  title: "You already send money home for health",
  body: "What you do not get back is any way of knowing what it paid for. Buy a relative a specific check instead and there is nothing to wonder about: you know exactly what you bought, and you are told when they use it.",
  points: [
    {
      title: "A receipt, not a transfer",
      body: "You are buying a named check, not sending an amount. When they use it, you are told. You do not have to ask, and they do not have to remember to tell you.",
    },
    {
      title: "You fund the care without holding the account",
      body: "They keep their own account, their own plan and their own privacy. You see what their care costs. You do not see their readings, results or notes unless they give you that access themselves.",
    },
    {
      title: "Somebody is watching between visits",
      body: "The gap where things go wrong is the months between appointments, which is exactly the stretch you cannot cover from another time zone. A flagged reading reaches a doctor whether or not you are awake.",
    },
    {
      title: "You do not need your own plan to do it",
      body: "Funding someone else's care is not a paid feature and never has been. If a plan for yourself is not much use where you live, do not buy one.",
    },
  ],
};

export const DIASPORA_ONE_PRICE_NOTE =
  "The dollar price starts from the naira price, converted at our published rate. Tarragon runs one price list: nobody pays a different rate for the same plan because of who they are. Everyone enrols individually: if you are paying for a parent or a sibling, they hold their own account and you fund their plan; their lab tests are still paid straight to the laboratory, not through us.";

/**
 * Founder decision, 2026-08-02: an international card charge genuinely costs
 * more to process than a Paystack-in-Nigeria one, and until this date that
 * real cost was invisible (every dollar row sat at exact naira parity). This
 * states it plainly rather than folding it into a bigger number: shown once
 * here for the whole tab, and again per card as DIASPORA_PROCESSING_FEE_NOTE_
 * SHORT, right next to the price it affects.
 */
export const DIASPORA_PROCESSING_FEE_NOTE =
  "Every dollar price above already includes a 10% processing fee on top of the converted naira price. This covers what it actually costs to process an international card charge; it is the same fee whether you pay monthly or yearly, and it is never hidden in the number, it is stated here.";

/**
 * Honesty note for diaspora buyers subscribing for THEMSELVES: monitoring
 * and doctor review work anywhere, but a lab test or a medication refill
 * still means physically standing in a laboratory or pharmacy, and home
 * visits specifically still need a contracted partner we don't have yet.
 * Saying so up front costs a few conversions and buys the thing a new
 * platform needs most: trust.
 */
export const DIASPORA_SELF_USE_NOTE =
  "Being upfront: these plans are built first for watching over someone in Nigeria. If you subscribe for yourself while living abroad, the app tracking, your doctor-set care plan and scheduled reviews, in-app care team messaging, and health record all work wherever you are. A lab test or a medication refill still means physically visiting a laboratory or pharmacy of your own choosing, so those are for when you're home; home sample collection and medication delivery aren't live anywhere yet, ours or a partner's.";

/** Care vouchers buy a YEAR OF A PLAN, never a test.
 *
 * Prepaid lab vouchers are retired (public.purchase_care_voucher fails closed):
 * tests are paid straight to the laboratory, so there is nothing for Tarragon
 * to sell ahead of time. A plan is different, because it is the thing Tarragon
 * actually provides. Yearly only, and the recipient starts it themselves. */
export const CARE_VOUCHER_INTRO =
  "You can buy a year of a plan, for yourself or for someone who has linked you to their care, and pay for it in one go or bit by bit. Whoever it is for starts their year when they are ready. It is not an account balance and it is never exchangeable for cash. Tests themselves are paid straight to the laboratory you use.";

export const CARE_VOUCHER_POINTS: { title: string; body: string }[] = [
  {
    title: "Pay a little at a time",
    body: "Spread a year of a plan over as many instalments as you like. It becomes usable once it is fully paid, and nothing runs out while you are still paying toward it.",
  },
  {
    title: "Someone can buy it for you",
    body: "A family member, in Nigeria or abroad, can buy you a year. They see that they bought it and later that it was used, and nothing about your results. Your tests you pay for at the laboratory, like anyone else.",
  },
  {
    title: "Refer a friend",
    body: "Share your referral link from your dashboard. Once your friend completes their first paid order, you both get a ₦500 reward voucher toward your care.",
  },
  {
    title: "It does not quietly disappear",
    body: "A voucher lasts two years and we remind you 30 days before it runs out. If it lapses unused, ask us and we will normally put it back.",
  },
];

export type PricingAddOn = {
  id: string;
  name: string;
  price: string;
  label: PricingLabel;
  description: string;
  items?: PricingLineItem[];
  availability: string;
};

export const ADD_ONS: PricingAddOn[] = [
  {
    id: "screen-core",
    name: "Core Screen",
    price: "Included with your plan",
    label: "ADD-ON",
    description:
      "Cardiometabolic, organ-baseline and blood-borne-virus screen: HbA1c, full lipid panel, full blood count, liver/kidney/thyroid function, urinalysis, HIV, Hepatitis B, Hepatitis C, genotype and blood group (once), plus a clinician-reviewed report. If anything comes back abnormal, your doctor follows up directly, at no extra charge. Two deeper tiers are available: Advanced Screen adds age-triggered cancer screening and an ECG, and Comprehensive Screen adds imaging and a 15-minute doctor video consult to walk through your whole result set. You pay the laboratory directly for the tests; we take nothing on them. See the full breakdown on the Annual Health Check page.",
    availability: "The Screen tiers come with a paid plan, from Tarragon Prevent upward. That same paid-plan review covers a result you already have, too: uploading it and having a doctor read it is included from Prevent up, not on Tarragon Free.",
  },
  {
    id: "prevention-screening",
    name: "Prevention Screening Add-on",
    price: "₦25,000/year",
    label: "ADD-ON",
    description:
      "This pays for a reminder and coordination service. It does NOT prepay for any actual tests.",
    items: [
      { feature: "Personalised screening calendar (age, sex, family history)", label: "INCLUDED" },
      { feature: "WhatsApp reminders when a screening test becomes due", label: "INCLUDED" },
      { feature: "We work out which tests you need and write the request", label: "INCLUDED" },
      { feature: "Tracking of your results over time", label: "INCLUDED" },
      { feature: "The actual test itself, every time it's due", label: "YOU PAY THE LAB" },
    ],
    availability:
      "In plain terms: this add-on means we tell you when to go. It does not mean we pay for you to go. Already included at no extra charge on Tarragon Prevent and above; this add-on brings the same calendar and reminders to Tarragon Free without upgrading the whole plan.",
  },
  // 'care-coordinator' (Dedicated Care Coordinator, +₦30,000/month) removed
  // 2026-07-31, matching the same-date withdrawal in seed.sql and the
  // withdraw_dedicated_care_coordinator_addon migration. It advertised a named
  // human assigned to one patient; the founder confirmed the operating model
  // will not include dedicated per-patient staff. Both add_ons rows are
  // is_active = false in production, so leaving the card up would have sold a
  // product that cannot be bought.
  //
  // 'starter-kit' (BP Monitor & Glucometer Starter Kit, ₦25,000–₦45,000)
  // removed 2026-08-04. It contradicted the 2026-08-02 founder decision that
  // Tarragon does not sell/import/bundle BP cuffs or glucometers (selling a
  // specific device model in Nigeria needs NAFDAC registration, which needs
  // either manufacturer Power of Attorney or Tarragon importing under its own
  // name — a real regulatory/business-development commitment, not something
  // to take on speculatively). Confirmed no `add_ons` row for it ever
  // existed in the database — the card advertised a product with no
  // checkout path at all, the same "sold nothing that could be bought" class
  // as the Dedicated Care Coordinator removal above. Patients buy a monitor
  // from any local retailer and type readings into the vitals form manually.
  // 'expedited-response' (Expedited Doctor Response, +₦5,000/month, under-2-hour
  // non-emergency reply) removed 2026-08-05. It sold faster access to the same
  // fixed pool of doctor time a paying patient could ask for at no extra
  // charge — the founder's call was that this puts pressure on a scarce
  // clinical resource for a convenience upsell, not a clinical need. Retire
  // the matching `add_ons` rows (`expedited-response`, plus the `_usd`/`_gbp`
  // variants) to `is_active = false`, same pattern as the Dedicated Care
  // Coordinator withdrawal below.
  //
  // 'health-education' (₦5,000/month add-on) removed 2026-08-05 — Health
  // Education is now included on every paid tier (Prevent, Essential,
  // Complete; see each tier's own item list above), not Complete-Care-only
  // plus a paid add-on for everyone else. With every paid tier already
  // covered, there's no tier left for an add-on to sell into; Tarragon Free
  // still doesn't get it. Update `subscription_plans.features` for the
  // prevent/essential rows (and currency variants) to include
  // 'health_education', and retire the `health-education` add-on row(s).
  //
  // 'sponsor-statement' (₦2,000/month, a single exportable funding statement
  // across everyone a supporter funds) exists as an `add_ons` row (NGN +
  // derived USD) since 2026-08-05 but is deliberately NOT listed here yet.
  // Two real gaps stand between it and being sellable: subscription_add_ons
  // requires a patient subscription_id to attach to, which a pure supporter
  // with no plan of their own doesn't have; and no UI reads this code at all
  // (/patient/supporting has no gated feature behind it). Listing it here
  // before either exists would repeat the exact "sold nothing that could be
  // bought" mistake this file has already had to walk back twice (Dedicated
  // Care Coordinator, Starter Kit) — add it once both are real, not before.
  {
    id: "lifestyle-coaching",
    name: "Lifestyle Coaching",
    price: "₦25,000/month",
    label: "ADD-ON",
    description:
      "A guided programme for diet, activity, and weight: a personal assessment, goals you set with support, structured diet and exercise tracks, and in-app check-ins, with a progress review every three months. It's also the engine behind Tarragon's weight programme.",
    availability: "Included on Complete Care and above. Available as an add-on on Essential Care or Tarragon Free.",
  },
  // 'annual-review' (Annual Doctor Review, ₦70,000/year) retired 2026-08-02 —
  // folded into Comprehensive Screen (see 'screen-core' above), which now
  // includes the same doctor video consult as part of its own result walkthrough.
  // Two separately-named "annual ___" products was confusing; there's one now.
  {
    id: "video-visit",
    name: "Online Doctor Consultation",
    price: "₦10,000/visit",
    label: "ADD-ON",
    description:
      "A 15-minute online consultation with a doctor, over video. Pick a published time and pay to request it. Your payment is held by Tarragon and only goes through once a time is confirmed: a doctor accepts your slot or offers a different one that works, within 48 hours. If nobody can take it, you're refunded in full. Not a substitute for emergency care.",
    availability: "Available on any plan, priced per visit rather than as a subscription.",
  },
  // 'hpv-catchup' (Catch-Up HPV Vaccine) removed as a standalone pricing card
  // 2026-08-05 — Tarragon doesn't set, quote, or collect a price for it (same
  // "we take no cut" model as every other test/vaccine), so it never needed
  // its own priced-looking card. Folded into Tarragon Prevent's vaccination
  // line item above, where the rest of vaccination tracking already lives.
  // The genuinely-free version (ages 9-14, government programme) still gets
  // its own ALWAYS_FREE entry below — that one really is a distinct, no-cost
  // claim worth calling out on its own.
];

// No TYPICAL_PRICES / LAB_PARTNERS list, and none should be reintroduced.
// Founder decision 2026-08-04: the platform is structured around monitoring,
// prevention, and doctor review of what a test finds — never around what a
// test costs, since Tarragon has no contracted lab and does not set, quote,
// or collect a naira for one. A "rough guide" figure still reads as a
// Tarragon price to a visitor, and a table of illustrative prices next to
// named laboratories would present partners the platform has neither
// contracted nor inspected. If a real, contracted, accredited network is
// ever signed, that is a decision to reopen deliberately, not to slide back
// in as a "helpful estimate."

/**
 * "Tarragon vs your HMO": complementary positioning, never disparaging. HMOs
 * (including our partners) pay for treatment; Tarragon is the monitoring layer
 * that works alongside them.
 */
export const HMO_COMPARE_INTRO =
  "A common question: “Why pay for Tarragon when I already have a basic HMO plan?” Because they do different jobs, and they work best together.";

export const HMO_COMPARE_ROWS: { need: string; hmo: boolean; tarragon: boolean }[] = [
  { need: "Pays your hospital and treatment bills when you fall ill", hmo: true, tarragon: false },
  { need: "Checks your BP and blood sugar readings against care protocols every time you log one, even when you feel fine", hmo: false, tarragon: true },
  { need: "Spots a worrying pattern in your numbers and escalates it before it becomes an emergency", hmo: false, tarragon: true },
  { need: "Reminds you when a test or refill is due, hands you a request to take to any lab or pharmacy, and tracks your results over time", hmo: false, tarragon: true },
  { need: "Keeps your whole health story in one record your family can see (with your consent)", hmo: false, tarragon: true },
];

export const HMO_COMPARE_NOTE =
  "Keep your HMO: you'll still need it the day you're admitted. Tarragon is the layer that watches your numbers between hospital visits so that day comes later, or not at all. We already work alongside Nigerian HMOs, and if your employer or HMO wants Tarragon for its members, they can talk to us directly.";

export const ALWAYS_FREE: PricingLineItem & { description: string } = {
  feature: "HPV vaccine for girls aged 9–14",
  label: "FREE ELSEWHERE",
  description:
    "Free at every government Primary Health Care (PHC) centre in Nigeria, as part of the national immunisation programme. Tarragon does not charge anything for this; we simply send a reminder and tell you the nearest PHC centre offering it.",
};

export const ALWAYS_FREE_NOTE =
  "The education library, Health Passport, and 90-Day Health Reset are free on every plan, including Tarragon Free, for as long as you use Tarragon, with no expiry date.";

/** "Try Before You Commit" section: free trials of Complete Care from Tarragon Free. */
export const FREE_TRIAL_INTRO =
  "Tarragon Free stays free forever: it never expires and never turns into a paid plan on its own. But if you want to feel what it's like to have a doctor-set care plan and a real care team behind your numbers, we offer two ways to try a paid plan at no cost.";

export const FREE_TRIALS: { title: string; body: string }[] = [
  {
    title: "Milestone trial: after your 90-Day Health Reset",
    body: "Once you've completed the 90-Day Health Reset on Tarragon Free, we'll offer you 30 days of Complete Care at no charge, no card required to start. A real doctor sets your care plan and your care team is there for a month, so you can decide, with full information, whether it's worth paying for.",
  },
  {
    title: "Risk-triggered trial: when your own numbers ask for it",
    body: "If your logged readings show a pattern a doctor would want to look at (for example, several elevated blood pressure or glucose readings within 30 days), we'll proactively offer a free 30-day trial of Complete Care, so a doctor can review you before anything becomes urgent, not after.",
  },
];

export const FREE_TRIAL_TERMS: string[] = [
  "Both trials are limited to one per person and apply to Complete Care.",
  "No card is required to start a trial, and you will always see the price and confirm before you're ever charged: the trial does not roll into a paid subscription automatically.",
  "At the end of the trial, you simply return to Tarragon Free unless you choose to continue on a paid plan.",
];

export const BOOKING_STEPS: { title: string; body: string }[] = [
  {
    title: "Your doctor tells you (or you ask)",
    body: "A test, refill, or vaccine is due.",
  },
  {
    title: "For a plan or add-on, you see the exact price",
    body: "In the app, before you're ever charged. No estimates, no “roughly.” A test, refill, or vaccine isn't something Tarragon charges for at all, so there's no price of ours to show; see the next step.",
  },
  {
    title: "You confirm and pay, or take a request to the provider",
    body: "For plans and add-ons: by card, bank transfer, or USSD, through Paystack (Stripe for diaspora payments in US dollars). For a test, refill, or vaccine: you take our request to whichever laboratory, pharmacy, or provider you choose and pay them directly, at their price. We set no price on it and take no cut.",
  },
  {
    title: "You get a request to take with you",
    body: "It names exactly which tests to run and why, so the laboratory knows what to do. You choose where to go and when.",
  },
  {
    title: "Your result or delivery comes back in the app",
    body: "Explained in plain language, with a WhatsApp alert so you don't miss it. If anything needs attention, your doctor calls you; this does not create any new charge.",
  },
];

export const NEVER_DO: string[] = [
  "Never charge you without showing the price and getting your confirmation first",
  "Never diagnose you or change your medication without a doctor's review",
  "Never share your health information with a family member without your consent",
  "Never lock you into a long contract: monthly plans cancel anytime; annual plans let you turn off auto-renewal anytime",
  "Never disguise a paid add-on as something “included,” and never disguise something genuinely free (like the HPV vaccine for girls 9–14) as something you need to pay us for",
  "Never let a free trial roll into a paid plan without you confirming first, and never put an expiry date on Tarragon Free",
];

export const PRICING_FAQ: { question: string; answer: string }[] = [
  {
    question: "Which conditions does Tarragon manage, and where does weight management fit?",
    answer:
      "Tarragon currently runs chronic care programmes for three conditions: hypertension, diabetes, and weight management. Weight management is a full condition on any plan, not an extra: if that's the only one you need, Essential Care (₦10,000/month) covers it, including doctor review of your weight trend, a structured lifestyle plan, and follow-up. Managing your weight alongside blood pressure or diabetes is exactly what Complete Care (₦20,000/month) is for, and Lifestyle Coaching is already included there at no extra charge. Preventive screening now comes with both Essential Care and Complete Care as well as Tarragon Prevent, so it's covered whichever of these three plans you're on.",
  },
  {
    question: "Will my card ever be charged automatically for a test I didn't ask for?",
    answer:
      "No. Your card is never charged for a test, refill, or vaccine at all: those go straight to whichever laboratory, pharmacy, or provider you choose, and you pay them directly, at their price. The only things Tarragon itself ever charges you for are your plan and any add-on you've explicitly confirmed, always shown to you first.",
  },
  {
    question: "My test came back abnormal. Will I be billed extra automatically?",
    answer:
      "No. Your doctor will call you. If your doctor recommends moving to a higher level of care, that is entirely your choice, and you'll see the price clearly before you decide anything.",
  },
  {
    question: "What are wellness points, and are they real money?",
    answer:
      "You earn points for everyday habits, logging a reading, finishing a lesson, or completing a challenge, free on every plan including Free. Collect badges as you go, and redeem points any time for a reward voucher that comes straight off the price of your care. A reward voucher is a discount, not cash, and cannot be exchanged for money.",
  },
  {
    question: "Does Tarragon Free ever expire?",
    answer:
      "No. Tarragon Free has no time limit and never converts to a paid plan on its own. You can use it for as long as you like.",
  },
  {
    question: "I'm healthy, why would I join a health platform?",
    answer:
      "Because staying healthy is exactly what most of Tarragon does. Hypertension, diabetes, and many cancers are far cheaper and easier to deal with when they're caught early, or prevented outright. Tarragon Prevent builds your personal screening and vaccination calendar, tells you which checks are worth doing at your age, and teaches you what your numbers mean. Most members will simply get yearly confirmation that all is well; for the few where something shows up, a doctor follows up the same day and it's caught years earlier than it would have been.",
  },
  {
    question: "What's the difference between Tarragon Free and Tarragon Prevent?",
    answer:
      "Free is self-tracking: you log your own numbers and nobody books anything for you. Prevent (₦5,000/month) adds the active prevention layer: a screening and vaccination calendar built for you, bookable when checks come due, reminders, results tracking, personalised health education, and doctor follow-up on any abnormal result.",
  },
  {
    question: "How do the free trials of Complete Care work?",
    answer:
      "You'll be offered a 30-day free trial either after completing the 90-Day Health Reset, or if your logged readings suggest a doctor should take a closer look. No card is required to start, and at the end of the trial you simply return to Tarragon Free unless you choose to continue on a paid plan.",
  },
  {
    question: "Will my Naira price change without warning?",
    answer:
      "No. We review Naira pricing once a year at most, and we'll always tell you at least 30 days beforehand. Anything you've already paid for, including a prepaid annual plan, is honoured until it's time to renew.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. Paid plans renew automatically at the end of each month or year so your care never lapses, and you can turn off auto-renewal any time from your subscription page. When you do, your plan stays active until the end of the period you've already paid for and simply doesn't renew after that. You won't be charged again.",
  },
  {
    question: "Are subscriptions refundable?",
    answer:
      "Subscriptions are non-refundable. The month or year you've paid for runs to the end, and turning off auto-renewal stops the next charge rather than refunding the current period. You keep full access until that period ends.",
  },
  {
    question: "I already have an HMO. Do I still need Tarragon?",
    answer:
      "They do different jobs. Your HMO pays your treatment bills when you're ill; Tarragon watches your numbers between hospital visits, checks them against care protocols, escalates worrying patterns to a doctor early, and coordinates your labs and refills. Keep your HMO; Tarragon works alongside it.",
  },
  {
    question: "What do lab tests actually cost?",
    answer:
      "We don't know, and we deliberately don't quote a figure: Tarragon has no contracted laboratory, so every lab sets its own price and you pay that laboratory directly. Tarragon never charges you for a test. It's worth asking two or three labs before you go, since prices vary by lab and city.",
  },
  {
    question: "What's the difference between Core, Advanced, and Comprehensive Screen?",
    answer:
      "They're one cumulative ladder, so each tier includes everything in the one below it. Core Screen is a full cardiometabolic and organ-baseline workup, plus HIV/Hepatitis B/Hepatitis C. Advanced Screen adds age-triggered cancer screening and an ECG, with a personalised screening calendar. Comprehensive Screen adds imaging, a syphilis screen, and a 15-minute doctor video consult to walk through your whole result set, which is the same doctor review that used to be a separate Annual Doctor Review product. All three come with a paid plan. What you pay for is the tests themselves, straight to whichever laboratory you use, so the cost depends on the lab rather than on us.",
  },
  {
    question: "What if I need a test that isn't listed here?",
    answer: "Message your care team in the app. We'll tell you if it's worth doing and write you a request for it; you take that to any laboratory you like and pay them directly, exactly like every other test.",
  },
  {
    question: "Is my payment information safe?",
    answer:
      "Yes. All payments are processed through Paystack (Nigeria) or Stripe (diaspora). Tarragon does not store your card details.",
  },
  {
    question: "How do I place an order for a test, refill, or add-on?",
    answer:
      "Tap the relevant button in the app (“Request a Test,” “Request Refill,” “Add a Service”). For an add-on, you'll always see Tarragon's exact price before confirming. For a test or refill, the app gives you a request to take to whichever laboratory or pharmacy you choose, and you pay them directly; if your doctor flags something first, you'll get a WhatsApp reminder pointing you to the right place in the app.",
  },
  {
    question: "What is a care voucher?",
    answer:
      "When you buy a year of a plan ahead of time, you get a care voucher for that plan. It is for that plan and for the person named on it: it cannot be transferred, and it is never exchangeable for cash. You can pay for it in instalments, a family member can buy one for you, and whoever it is for starts their year when they are ready. Tests themselves are paid straight to the laboratory. Referring a friend earns you both a ₦500 reward voucher once they complete their first paid order.",
  },
  {
    question: "Can I track my children's vaccinations too?",
    answer:
      "Yes. Add a child from your dashboard, even one who's too young to have their own login, and their schedule lives on your account: their own vaccination schedule, reminders, and doctor-verified certificates, on the same record as the rest of their care. This is included on every plan, including Free.",
  },
  {
    question: "Can I speak to a doctor directly, not just wait for my scheduled review?",
    answer:
      "Yes, two ways. Send a written question through the app and get a doctor's reply within 72 hours, included free on Complete Care. Or book a 15-minute online consultation with a doctor for ₦10,000 on any plan: payment is only taken once a doctor accepts your slot, with a full refund if none can.",
  },
];

export const EMPLOYER_HMO_NOTE =
  "If you're looking to cover staff, members, or a population, corporate wellness plans and HMO partnerships are priced differently, based on the size and needs of your organisation. These aren't self-service plans; speak to our team directly and we'll build a clear, transparent quote for you, with the same no-hidden-cost approach you see above.";
