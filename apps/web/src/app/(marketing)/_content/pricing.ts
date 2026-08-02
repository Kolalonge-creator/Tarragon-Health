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
 *   admin-set reference rate, currently ₦1,365 to the dollar, so the same plan
 *   costs the same everywhere. The old 2.5-3.5x diaspora premium is gone with
 *   it: do not reintroduce a diaspora price band here, because
 *   private.enforce_derived_price will reject it in the database anyway.
 *
 * Superseded 2026-08-02 — the old 3-tier Health Check ladder (Basic/Annual
 * Health Check/Comprehensive, ₦15k/₦65k/₦75k) is replaced by Core/Advanced/
 * Comprehensive Screen (₦65k/₦95k/₦149k), matching new panel_bundles rows
 * 'screen_core'/'screen_advanced'/'screen_comprehensive'. "Annual Doctor
 * Review" is retired as a separate product — its doctor video consult is now
 * Comprehensive Screen's own result walkthrough, closing the two confusingly-
 * named "annual ___" products this file used to carry side by side. Active
 * subscribers get 15% off any Screen tier. TYPICAL_PRICES mirrors the live
 * lab_tests/panel_bundles catalogue (re-derive when partners reprice).
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

export type PricingLabel = "INCLUDED" | "BOOK & PAY" | "FREE ELSEWHERE" | "ADD-ON";

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
  "BOOK & PAY": {
    title: "Book & pay",
    description: "Available through Tarragon; you see the exact price and confirm before we book it",
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
  "We will always tell you clearly whether something is already included in your plan, something you need to book and pay for, or something that's actually free elsewhere and we're just reminding you about it.",
  "You will always know exactly what you are paying for: every plan and every add-on is fully listed below, with nothing left out.",
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
      "A self-tracking tool to help you understand your own numbers and build a habit. No doctor reviews your readings routinely on this plan. But if a test you book through us comes back abnormal, that still raises a real alert to our doctors on every plan, including this one: we do not hold back an abnormal result behind a paywall.",
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
      "Not included on this plan, and available only if you upgrade: doctor review, doctor check-in, lab test coordination, medication refill coordination, family dashboard.",
  },
  {
    id: "prevent",
    name: "Tarragon Prevent",
    whoFor: "Healthy, and planning to stay that way",
    priceMain: "₦3,500",
    pricePeriod: "per month",
    priceSecondary: "or ₦35,000/year (2 months free)",
    description:
      "The stay-healthy plan. You don't need a diagnosis to benefit from Tarragon: Prevent builds your personal screening and vaccination calendar, books the checks when they come due, and teaches you what your numbers mean. If a result ever needs attention, a doctor steps in the same day and helps you decide what's next.",
    items: [
      { feature: "Everything in Tarragon Free", label: "INCLUDED" },
      { feature: "Personal screening calendar matched to your age, sex, and history", label: "INCLUDED" },
      { feature: "Book screenings when due, with reminders and results tracking", label: "INCLUDED" },
      { feature: "Vaccination schedule, booking, and verified certificates", label: "INCLUDED" },
      { feature: "Personalised health education with knowledge checks", label: "INCLUDED" },
      { feature: "Doctor follow-up on any abnormal result", label: "INCLUDED" },
      { feature: "Screening lab tests (HbA1c from ₦8,000, etc.)", label: "BOOK & PAY" },
      { feature: "Core Screen (₦65,000, full-body health check)", label: "BOOK & PAY" },
    ],
    footnote:
      "Prevent is not a chronic-care plan: routine doctor reviews of your readings are on Essential Care and above. If a screening ever finds something, we'll help you move onto the right care programme; that's the whole point of catching it early.",
  },
  {
    id: "essential",
    name: "Essential Care",
    whoFor: "One condition: hypertension, diabetes, or weight management",
    priceMain: "₦8,000",
    pricePeriod: "per month",
    priceSecondary: "or ₦80,000/year (2 months free)",
    description: "Real clinical monitoring begins here, for one condition.",
    highlight: true,
    items: [
      { feature: "Everything in Tarragon Free", label: "INCLUDED" },
      { feature: "Monthly doctor review of your BP, glucose, or weight readings", label: "INCLUDED" },
      { feature: "Monthly doctor check-in", label: "INCLUDED" },
      { feature: "Medication adherence follow-up from your doctor", label: "INCLUDED" },
      { feature: "Message your care team directly in the app", label: "INCLUDED" },
      { feature: "Lab tests (HbA1c, kidney function, lipid panel, etc.)", label: "BOOK & PAY" },
      { feature: "Medication refills through partner pharmacies", label: "BOOK & PAY" },
    ],
    footnote:
      "If you have more than one condition, or your doctor considers you higher-risk, Complete Care gives you closer monitoring.",
  },
  {
    id: "complete",
    name: "Complete Care",
    whoFor: "More than one of the conditions we manage, or higher risk",
    priceMain: "₦15,000",
    pricePeriod: "per month",
    priceSecondary: "or ₦150,000/year (2 months free)",
    description:
      "Tarragon currently manages three chronic conditions: hypertension, diabetes, and weight management. Complete Care is for anyone managing more than one of them together (for example, blood pressure and blood sugar, or diabetes and weight), or anyone whose doctor recommends closer monitoring.",
    items: [
      { feature: "Everything in Essential Care", label: "INCLUDED" },
      { feature: "Weekly doctor review (instead of monthly)", label: "INCLUDED" },
      { feature: "Hypertension, diabetes, and weight all managed together on one care plan", label: "INCLUDED" },
      { feature: "Priority doctor escalation", label: "INCLUDED" },
      { feature: "Ask a doctor a one-off written question, answered within 24 hours", label: "INCLUDED" },
      { feature: "Lab tests", label: "BOOK & PAY" },
      { feature: "Medication refills", label: "BOOK & PAY" },
    ],
    footnote:
      "Core Screen (full body health check) is not bundled free into Complete Care. It's a ₦65,000/year add-on available on any plan, so the price you see is the price you actually pay — subscribers get 15% off.",
  },
];

export const USD_TIERS: PricingTier[] = [
  {
    id: "diaspora-prevent",
    name: "Tarragon Prevent (Diaspora)",
    whoFor: "Healthy, and planning to stay that way",
    priceMain: "$2.56",
    pricePeriod: "per month",
    priceSecondary: "or $25.64/year",
    description:
      "The stay-healthy plan, billed in dollars: a personal screening and vaccination calendar, health education, and doctor follow-up on any abnormal result. Screenings and vaccinations are done at partner facilities in Nigeria; monitoring and education work from anywhere.",
    items: [
      { feature: "Everything in Tarragon Prevent (Naira plan)", label: "INCLUDED" },
      { feature: "Screening lab tests in Nigeria", label: "BOOK & PAY" },
    ],
  },
  {
    id: "diaspora-essential",
    name: "Essential Care (Diaspora)",
    whoFor: "One condition, monitored from abroad",
    priceMain: "$5.86",
    pricePeriod: "per month",
    priceSecondary: "or $58.61/year",
    description: "Everything included is the same as Essential Care in Naira, billed in US dollars.",
    highlight: true,
    items: [
      { feature: "Everything in Essential Care (Naira plan)", label: "INCLUDED" },
      { feature: "Lab tests and medication refills in Nigeria", label: "BOOK & PAY" },
    ],
  },
  {
    id: "diaspora-complete",
    name: "Complete Care (Diaspora)",
    whoFor: "Multiple conditions, monitored from abroad",
    priceMain: "$10.99",
    pricePeriod: "per month",
    priceSecondary: "or $109.89/year",
    description: "Everything included is the same as Complete Care in Naira, billed in US dollars.",
    items: [
      { feature: "Everything in Complete Care (Naira plan)", label: "INCLUDED" },
      { feature: "Lab tests and medication refills in Nigeria", label: "BOOK & PAY" },
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
 * than anything else. The plans cost the same everywhere; the reason to buy is
 * not the number.
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
  "The dollar price is the naira price, converted. Tarragon runs one price list, so the same plan costs the same whether it is paid for from Lagos or from London. Everyone enrols individually: if you are paying for a parent or a sibling, they hold their own account and you buy their checks for them.";

/**
 * Honesty note for diaspora buyers subscribing for THEMSELVES: monitoring
 * and doctor review work anywhere, but the partner network (labs, pharmacies,
 * home visits) is physically in Nigeria. Saying so up front costs a few
 * conversions and buys the thing a new platform needs most: trust.
 */
export const DIASPORA_SELF_USE_NOTE =
  "Being upfront: these plans are built first for watching over someone in Nigeria. If you subscribe for yourself while living abroad, the app tracking, doctor review of your readings, in-app care team messaging, and health record all work wherever you are, but lab bookings, medication refills, and home visits happen through our partner network in Nigeria, so those are for when you're home.";

/** Care vouchers: you buy a named service at a fixed price and hold an
 * entitlement to that service. Deliberately not a balance. Non-transferable,
 * single-purpose, never exchangeable for cash, valid 24 months. */
export const CARE_VOUCHER_INTRO =
  "You can pay for a health check ahead of time and use it whenever you are ready. You get a care voucher for that specific check, valid for two years. It is not an account balance and it is never exchangeable for cash: it is the check itself, already paid for.";

export const CARE_VOUCHER_POINTS: { title: string; body: string }[] = [
  {
    title: "Pay a little at a time",
    body: "Pay for a check in as many instalments as you like. It becomes usable once it is fully paid, and nothing runs out while you are still paying toward it.",
  },
  {
    title: "Let someone else buy it",
    body: "A family member, in Nigeria or abroad, can buy a check for you. They see that they bought it and later that it was used, and nothing about your results.",
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
    price: "₦65,000/year",
    label: "ADD-ON",
    description:
      "Cardiometabolic, organ-baseline and blood-borne-virus screen: HbA1c, full lipid panel, full blood count, liver/kidney/thyroid function, urinalysis, HIV, Hepatitis B, Hepatitis C, genotype and blood group (once), plus a clinician-reviewed report. If anything comes back abnormal, your doctor follows up directly, with no automatic extra charge. Two deeper tiers are available: Advanced Screen (₦95,000/year) adds age-triggered cancer screening and an ECG, and Comprehensive Screen (₦149,000/year) adds imaging and a 15-minute doctor video consult to walk through your whole result set — see the full breakdown on the Annual Health Check page.",
    availability: "Available to anyone, on any plan, including Tarragon Free. Active subscribers get 15% off list.",
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
      { feature: "Booking coordination with a partner lab", label: "INCLUDED" },
      { feature: "Tracking of your results over time", label: "INCLUDED" },
      { feature: "The actual test itself, every time it's due", label: "BOOK & PAY" },
    ],
    availability:
      "In plain terms: this add-on means we tell you when to go. It does not mean we pay for you to go. Already included at no extra charge on Tarragon Prevent and above — this add-on brings the same calendar and reminders to Tarragon Free without upgrading the whole plan.",
  },
  // 'care-coordinator' (Dedicated Care Coordinator, +₦30,000/month) removed
  // 2026-07-31, matching the same-date withdrawal in seed.sql and the
  // withdraw_dedicated_care_coordinator_addon migration. It advertised a named
  // human assigned to one patient; the founder confirmed the operating model
  // will not include dedicated per-patient staff. Both add_ons rows are
  // is_active = false in production, so leaving the card up would have sold a
  // product that cannot be bought.
  {
    id: "starter-kit",
    name: "BP Monitor & Glucometer Starter Kit",
    price: "₦25,000–₦45,000",
    label: "ADD-ON",
    description: "A home blood pressure monitor, a glucometer with starter test strips, and a short doctor call to walk you through using both correctly.",
    availability: "One-time purchase; can be paid in 3 monthly instalments if you prefer.",
  },
  {
    id: "expedited-response",
    name: "Expedited Doctor Response",
    price: "+₦5,000/month",
    label: "ADD-ON",
    description: "Moves your doctor response time for non-emergency questions to under 2 hours, instead of the standard same-day/next-day response.",
    availability: "Available on any paid plan.",
  },
  {
    id: "health-education",
    name: "Health Education",
    price: "₦5,000/month",
    label: "ADD-ON",
    description:
      "Personalised learning built around your own conditions, reviewed by our clinical team, with short knowledge checks so you can see what's sticking.",
    availability: "Already included at no extra charge on Complete Care and above. This add-on brings it to Essential Care or Tarragon Free.",
  },
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
    name: "Video Doctor Visit",
    price: "₦10,000/visit",
    label: "BOOK & PAY",
    description:
      "A 15-minute video consultation with a doctor, never an in-person visit. Pick a published time and pay to request it. Your payment is held by Tarragon and only goes through once a time is confirmed — a doctor accepts your slot or offers a different one that works, within 24 hours. If nobody can take it, you're refunded in full. Not a substitute for emergency care.",
    availability: "Available on any plan, priced per visit rather than as a subscription.",
  },
  {
    id: "hpv-catchup",
    name: "Catch-Up HPV Vaccine",
    price: "Typically ₦35,000–₦55,000/dose (2–3 doses needed)",
    label: "BOOK & PAY",
    description: "For women aged 15–45, outside the free government age bracket. Full price confirmed before you book.",
    availability: "Price shown at time of booking. See What's Always Free below for the free version, ages 9–14.",
  },
];

/**
 * Typical prices for the most common BOOK & PAY items, mirrored from the live
 * partner-lab catalogue (`lab_tests`/`panel_bundles`). "From" phrasing because
 * partner prices vary slightly by lab and location; the exact price is always
 * shown before booking.
 */
export const TYPICAL_PRICES: { item: string; price: string }[] = [
  { item: "Core Screen (cardiometabolic + organ baseline + HIV/Hep B/Hep C)", price: "₦65,000" },
  { item: "Advanced Screen (Core + cancer screening + ECG)", price: "₦95,000" },
  { item: "Comprehensive Screen (Advanced + imaging + doctor video consult)", price: "₦149,000" },
  { item: "HbA1c (3-month blood sugar)", price: "from ₦8,000" },
  { item: "Lipid panel (cholesterol)", price: "from ₦9,000" },
  { item: "Diabetes panel (HbA1c + cholesterol)", price: "from ₦18,500" },
  { item: "Hypertension panel (cholesterol + HbA1c)", price: "from ₦22,000" },
  { item: "PSA (prostate screening)", price: "from ₦12,000" },
  { item: "Cervical smear", price: "from ₦18,000" },
  { item: "HIV screening", price: "from ₦6,000" },
  { item: "Hepatitis B screening", price: "from ₦7,000" },
  { item: "Hepatitis C screening", price: "from ₦7,000" },
  { item: "Blood group & genotype", price: "from ₦6,500" },
];

/**
 * The labs these prices are actually quoted from. Named deliberately: for a
 * first-time visitor deciding whether a young brand can be trusted with a
 * blood test, a recognised lab name does more work than any amount of copy
 * about our process.
 *
 * Must stay a true reflection of the live lab_providers table. Do not add a
 * partner here to look bigger than we are; if a partnership ends, this list
 * shrinks. Every price in TYPICAL_PRICES above is the cheapest live
 * lab_tests row across exactly these four.
 */
export const LAB_PARTNERS = [
  "Synlab Nigeria",
  "Cerba Lancet",
  "Healthtracka",
  "Afriglobal Medicare",
];

export const TYPICAL_PRICES_NOTE =
  "Every price here is the lowest current price across our partner labs, so you can budget before you ever book. Your exact price, for the lab you pick, is always shown before you confirm. If it ever differs from what you see here, the price at booking is the one that counts, and you can simply decline.";

/**
 * "Tarragon vs your HMO": complementary positioning, never disparaging. HMOs
 * (including our partners) pay for treatment; Tarragon is the monitoring layer
 * that works alongside them.
 */
export const HMO_COMPARE_INTRO =
  "A common question: “Why pay for Tarragon when I already have a basic HMO plan?” Because they do different jobs, and they work best together.";

export const HMO_COMPARE_ROWS: { need: string; hmo: boolean; tarragon: boolean }[] = [
  { need: "Pays your hospital and treatment bills when you fall ill", hmo: true, tarragon: false },
  { need: "A doctor reviews your BP and blood sugar readings every month, even when you feel fine", hmo: false, tarragon: true },
  { need: "Spots a worrying pattern in your numbers and escalates it before it becomes an emergency", hmo: false, tarragon: true },
  { need: "Reminds you, books your labs and refills, and tracks your results over time", hmo: false, tarragon: true },
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
  "Tarragon Free stays free forever: it never expires and never turns into a paid plan on its own. But if you want to feel what it's like to have a real doctor actually watching your numbers, we offer two ways to try a paid plan at no cost.";

export const FREE_TRIALS: { title: string; body: string }[] = [
  {
    title: "Milestone trial: after your 90-Day Health Reset",
    body: "Once you've completed the 90-Day Health Reset on Tarragon Free, we'll offer you 30 days of Complete Care at no charge, no card required to start. A real doctor reviews your numbers for a month so you can decide, with full information, whether it's worth paying for.",
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
    title: "You see the exact price",
    body: "In the app, before anything is booked. No estimates, no “roughly.”",
  },
  {
    title: "You confirm and pay",
    body: "By card, bank transfer, or USSD, through Paystack (Stripe for diaspora payments in US dollars).",
  },
  {
    title: "We book it with our partner",
    body: "A lab, pharmacy, or clinic, and send you everything you need: where to go, what to bring, and any preparation required.",
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
      "Tarragon currently runs chronic care programmes for three conditions: hypertension, diabetes, and weight management. Weight management is a full condition on any plan, not an extra: if that's the only one you need, Essential Care (₦8,000/month) covers it, including doctor review of your weight trend, a structured lifestyle plan, and follow-up. Managing your weight alongside blood pressure or diabetes is exactly what Complete Care (₦15,000/month) is for, and Lifestyle Coaching is already included there at no extra charge. Preventive screening is separate and available to everyone, whatever your conditions.",
  },
  {
    question: "Will my card ever be charged automatically for a test I didn't ask for?",
    answer:
      "No. Every single lab test, refill, or vaccine requires you to see the price and confirm before anything is booked or charged.",
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
      "Because staying healthy is exactly what most of Tarragon does. Hypertension, diabetes, and many cancers are far cheaper and easier to deal with when they're caught early, or prevented outright. Tarragon Prevent builds your personal screening and vaccination calendar, books the right checks at the right ages, and teaches you what your numbers mean. Most members will simply get yearly confirmation that all is well; for the few where something shows up, a doctor follows up the same day and it's caught years earlier than it would have been.",
  },
  {
    question: "What's the difference between Tarragon Free and Tarragon Prevent?",
    answer:
      "Free is self-tracking: you log your own numbers and nobody books anything for you. Prevent (₦3,500/month) adds the active prevention layer: a screening and vaccination calendar built for you, bookable when checks come due, reminders, results tracking, personalised health education, and doctor follow-up on any abnormal result.",
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
      "They do different jobs. Your HMO pays your treatment bills when you're ill; Tarragon watches your numbers between hospital visits, where a doctor reviews your readings, escalates worrying patterns early, and coordinates your labs and refills. Keep your HMO; Tarragon works alongside it.",
  },
  {
    question: "What do lab tests actually cost?",
    answer:
      "Typical partner-lab prices are listed on this page (for example, HbA1c from ₦8,000 and a lipid panel from ₦9,000), and your exact price is always shown before you confirm any booking. Nothing is ever charged without your confirmation.",
  },
  {
    question: "What's the difference between Core, Advanced, and Comprehensive Screen?",
    answer:
      "They're one cumulative ladder, so each tier includes everything in the one below it. Core Screen (₦65,000/year) is a full cardiometabolic and organ-baseline workup, plus HIV/Hepatitis B/Hepatitis C. Advanced Screen (₦95,000/year) adds age-triggered cancer screening and an ECG, with a personalised screening calendar. Comprehensive Screen (₦149,000/year) adds imaging, a syphilis screen, and a 15-minute doctor video consult to walk through your whole result set — the same doctor review that used to be a separate Annual Doctor Review product. Active subscribers get 15% off any tier.",
  },
  {
    question: "What if I need a test that isn't listed here?",
    answer: "Ask your doctor on WhatsApp. We'll tell you if it's available, and you'll see the price before booking, exactly like every other test.",
  },
  {
    question: "Is my payment information safe?",
    answer:
      "Yes. All payments are processed through Paystack (Nigeria) or Stripe (diaspora). Tarragon does not store your card details.",
  },
  {
    question: "How do I place an order for a test, refill, or add-on?",
    answer:
      "Tap the relevant button in the app (“Book a Test,” “Request Refill,” “Add a Service”). You'll always see the price before confirming; if your clinician flags something first, you'll get a WhatsApp reminder pointing you to the right place in the app.",
  },
  {
    question: "What is a care voucher?",
    answer:
      "When you pay for a health check ahead of time, you get a care voucher for that exact check. It is for that service and for you alone: it cannot be transferred, and it is never exchangeable for cash. You can pay for it in instalments, a family member can buy one for you, and it lasts two years. Referring a friend earns you both a ₦500 reward voucher once they complete their first paid order.",
  },
  {
    question: "Can I track my children's vaccinations too?",
    answer:
      "Yes. Add a child to your family from your dashboard, even one who's too young to have their own login, and they get their own vaccination schedule, reminders, booking, and doctor-verified certificates, on the same record as the rest of your family's care. This is included on every plan, including Free.",
  },
  {
    question: "Can I speak to a doctor directly, not just wait for my scheduled review?",
    answer:
      "Yes, two ways. Send a written question through the app and get a doctor's reply within 24 hours, included free on Complete Care. Or book a 15-minute video consultation with a doctor for ₦10,000 on any plan: payment is only taken once a doctor accepts your slot, with a full refund if none can.",
  },
];

export const EMPLOYER_HMO_NOTE =
  "If you're looking to cover staff, members, or a population, corporate wellness plans and HMO partnerships are priced differently, based on the size and needs of your organisation. These aren't self-service plans; speak to our team directly and we'll build a clear, transparent quote for you, with the same no-hidden-cost approach you see above.";
