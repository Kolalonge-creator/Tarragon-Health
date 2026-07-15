/**
 * Pricing content, sourced from Tarragon_Health_Pricing_Guide_v2.docx (the
 * authoritative plans & pricing doc). Keep this in sync with that guide;
 * every price and label here should be traceable back to it.
 *
 * Deliberate exceptions (carried forward from the v1 doc, still true of v2):
 * - The docx repeatedly says "nurse" (nurse review, named nurse coordinator,
 *   etc.), but this file uses "clinician" instead, per an explicit
 *   platform-wide nurse->clinician terminology decision.
 * - The docx sells "Monthly doctor check-in" as a routine included feature
 *   on every paid plan. Per docs/CLINICAL_TRUST_MODEL_SPEC.md §9 ("the
 *   clinician, not a doctor, is the default face of the day-to-day patient
 *   relationship... doctor attribution is earned per-case, never applied
 *   uniformly"), routine recurring touchpoints are relabelled "clinician
 *   check-in" here. Genuine scheduled/booked doctor appointments (the
 *   Dedicated Care Coordinator add-on, Family Premium, diaspora Premium) and
 *   escalation-triggered doctor review stay attributed to "doctor" — those
 *   are real, earned, or explicitly paid doctor time, not a uniform branding
 *   layer.
 * If the docx is revised again, keep re-deriving prices from it but keep
 * both of the above substitutions.
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
      "A self-tracking tool to help you understand your own numbers and build a habit. No clinician reviews your readings on this plan; if something looks concerning, we'll encourage you to see a doctor and show you how to upgrade.",
    items: [
      { feature: "Log your BP, blood sugar, and weight", label: "INCLUDED" },
      { feature: "Medication reminders", label: "INCLUDED" },
      { feature: "The Tarragon 90-Day Health Reset", label: "INCLUDED" },
      { feature: "Full education library", label: "INCLUDED" },
      { feature: "Downloadable Health Passport PDF", label: "INCLUDED" },
      { feature: "Device setup guides", label: "INCLUDED" },
    ],
    footnote:
      "Not included on this plan, and available only if you upgrade: clinician review, doctor check-in, lab test coordination, medication refill coordination, family dashboard.",
  },
  {
    id: "essential",
    name: "Essential Care",
    whoFor: "One condition: hypertension or diabetes",
    priceMain: "₦8,000",
    pricePeriod: "per month",
    priceSecondary: "or ₦80,000/year (2 months free)",
    description: "Real clinical monitoring begins here, for one condition.",
    highlight: true,
    items: [
      { feature: "Everything in Tarragon Free", label: "INCLUDED" },
      { feature: "Monthly clinician review of your BP or glucose readings", label: "INCLUDED" },
      { feature: "Monthly clinician check-in over WhatsApp", label: "INCLUDED" },
      { feature: "Medication adherence follow-up from your clinician", label: "INCLUDED" },
      { feature: "Direct WhatsApp access to your care team", label: "INCLUDED" },
      { feature: "Lab tests (HbA1c, kidney function, lipid panel, etc.)", label: "BOOK & PAY" },
      { feature: "Medication refills through partner pharmacies", label: "BOOK & PAY" },
    ],
    footnote:
      "If you have more than one condition, or your doctor considers you higher-risk, Complete Care gives you closer monitoring.",
  },
  {
    id: "complete",
    name: "Complete Care",
    whoFor: "Multiple conditions or higher risk",
    priceMain: "₦15,000",
    pricePeriod: "per month",
    priceSecondary: "or ₦150,000/year (2 months free)",
    description:
      "For patients managing more than one condition together, or anyone whose doctor recommends closer monitoring.",
    items: [
      { feature: "Everything in Essential Care", label: "INCLUDED" },
      { feature: "Weekly clinician review (instead of monthly)", label: "INCLUDED" },
      { feature: "Support for multiple conditions on one care plan", label: "INCLUDED" },
      { feature: "Priority doctor escalation", label: "INCLUDED" },
      { feature: "Lab tests", label: "BOOK & PAY" },
      { feature: "Medication refills", label: "BOOK & PAY" },
    ],
    footnote:
      "The Annual Health Check (full body screening) is not bundled free into Complete Care. It's a ₦60,000/year add-on available on any plan, so the price you see is the price you actually pay.",
  },
  {
    id: "family-lite",
    name: "Family Lite",
    whoFor: "Households or the whole family",
    priceMain: "₦150,000",
    pricePeriod: "per year",
    priceSecondary: "covers up to 4 people",
    description: "One plan, one bill, for your whole household, including a parent you want to keep an eye on.",
    items: [
      { feature: "Every member gets Complete Care–level monitoring", label: "INCLUDED" },
      { feature: "Shared family dashboard", label: "INCLUDED" },
      { feature: "One combined bill instead of separate subscriptions", label: "INCLUDED" },
      { feature: "Monthly family report", label: "INCLUDED" },
      { feature: "Lab tests and medication refills per member", label: "BOOK & PAY" },
    ],
    footnote:
      "Extra members: +₦30,000/year each, up to 6 people total. Billed annually only; for monthly billing per person, Essential Care or Complete Care works the same way.",
  },
  {
    id: "family-plus",
    name: "Family Plus",
    whoFor: "Families who want fewer gaps between check-ins",
    priceMain: "₦220,000",
    pricePeriod: "per year",
    priceSecondary: "covers up to 4 people",
    description: "Everything in Family Lite, plus a closer layer of coordination for your whole household.",
    items: [
      { feature: "Everything in Family Lite", label: "INCLUDED" },
      { feature: "A named family clinician coordinator, not a rotating team", label: "INCLUDED" },
      { feature: "Priority escalation across all members, every time, not only for abnormal readings", label: "INCLUDED" },
      { feature: "One Annual Health Check included free each year, for one member of your choice (a ₦60,000 value)", label: "INCLUDED" },
      { feature: "Lab tests and medication refills for each additional member", label: "BOOK & PAY" },
    ],
    footnote: "Extra members: +₦40,000/year each, up to 6 people total.",
  },
  {
    id: "family-premium",
    name: "Family Premium",
    whoFor: "Diaspora families keeping watch over parents from abroad",
    priceMain: "₦320,000",
    pricePeriod: "per year",
    priceSecondary: "covers up to 4 people",
    description: "Our closest level of family monitoring: everything in Family Plus, plus dedicated doctor time for every member.",
    items: [
      { feature: "Everything in Family Plus", label: "INCLUDED" },
      { feature: "A named clinician coordinator plus a scheduled, booked monthly doctor appointment for every member", label: "INCLUDED" },
      { feature: "Quarterly PDF health report, in addition to the monthly summary", label: "INCLUDED" },
      { feature: "Expedited clinician response (under 2 hours) for every member, on any non-emergency question", label: "INCLUDED" },
      { feature: "Two Annual Health Checks included free each year, for members of your choice (up to ₦120,000 value)", label: "INCLUDED" },
      { feature: "Lab tests and medication refills beyond what's included", label: "BOOK & PAY" },
    ],
    footnote: "Extra members: +₦55,000/year each, up to 6 people total.",
  },
];

export const GBP_TIERS: PricingTier[] = [
  {
    id: "diaspora-essential",
    name: "Essential Care (Diaspora)",
    whoFor: "One condition, monitored from abroad",
    priceMain: "£25",
    pricePeriod: "per month",
    priceSecondary: "or £250/year",
    description: "Everything included is the same as Essential Care in Naira, billed in British Pounds.",
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
    priceMain: "£59",
    pricePeriod: "per month",
    priceSecondary: "or £590/year",
    description: "Everything included is the same as Complete Care in Naira, billed in British Pounds.",
    items: [
      { feature: "Everything in Complete Care (Naira plan)", label: "INCLUDED" },
      { feature: "Lab tests and medication refills in Nigeria", label: "BOOK & PAY" },
    ],
  },
  {
    id: "diaspora-premium",
    name: "Premium Care (Diaspora)",
    whoFor: "Parents you can't check on in person",
    priceMain: "£99",
    pricePeriod: "per month",
    priceSecondary: "or £990/year",
    description:
      "Complete Care, plus a named clinician coordinator, a scheduled monthly doctor appointment (not just WhatsApp), and a quarterly PDF report: our closest level of care for a parent you can't check on in person. You are not just paying for WhatsApp check-ins, you're paying for peace of mind that someone is watching over your family while you're not there.",
    items: [
      { feature: "Everything in Complete Care (Naira plan)", label: "INCLUDED" },
      { feature: "A named clinician coordinator", label: "INCLUDED" },
      { feature: "A scheduled, booked monthly doctor appointment, not just WhatsApp", label: "INCLUDED" },
      { feature: "A quarterly PDF report", label: "INCLUDED" },
      { feature: "Lab tests and medication refills in Nigeria", label: "BOOK & PAY" },
    ],
  },
];

export const DIASPORA_FAMILY_NOTE =
  "Want a Family Plan billed in GBP for multiple relatives back home? Message our team directly and we'll quote you: this is the one case where we ask you to talk to us first, simply because family sizes vary and we want to get the number right for you before you commit to anything.";

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
    id: "annual-health-check",
    name: "Annual Health Check",
    price: "₦60,000/year",
    label: "ADD-ON",
    description:
      "A full metabolic panel (fasting blood sugar, lipid profile, kidney and liver function), BP/weight/BMI check, one age- and sex-relevant cancer screening test, and a clinician consultation to walk you through your results. If anything comes back abnormal, your clinician follows up directly, with no automatic extra charge.",
    availability: "Available to anyone, on any plan, including Tarragon Free.",
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
    availability: "In plain terms: this add-on means we tell you when to go. It does not mean we pay for you to go.",
  },
  {
    id: "care-coordinator",
    name: "Dedicated Care Coordinator",
    price: "+₦30,000/month",
    label: "ADD-ON",
    description:
      "Turns Complete Care (₦15,000/month) into a fully dedicated service at ₦45,000/month total. Built for a parent or relative who needs closer, more personal attention, especially popular with diaspora families. If you're covering your whole family, Family Premium bundles this level of service at a lower blended cost.",
    items: [
      { feature: "One named clinician coordinator (not a rotating team)", label: "INCLUDED" },
      { feature: "A scheduled, booked monthly doctor appointment", label: "INCLUDED" },
      { feature: "Quarterly PDF health report sent to the family", label: "INCLUDED" },
      { feature: "Priority escalation", label: "INCLUDED" },
    ],
    availability: "Added to Complete Care.",
  },
  {
    id: "extra-family-member",
    name: "Extra Family Member",
    price: "+₦30,000–₦55,000/year",
    label: "ADD-ON",
    description:
      "Adds one more person to your Family Plan (up to 6 people total), at the same level of monitoring as everyone else on your tier: +₦30,000/year on Family Lite, +₦40,000/year on Family Plus, or +₦55,000/year on Family Premium.",
    availability: "Family Lite, Family Plus, or Family Premium only.",
  },
  {
    id: "starter-kit",
    name: "BP Monitor & Glucometer Starter Kit",
    price: "₦25,000–₦45,000",
    label: "ADD-ON",
    description: "A home blood pressure monitor, a glucometer with starter test strips, and a short clinician call to walk you through using both correctly.",
    availability: "One-time purchase; can be paid in 3 monthly instalments if you prefer.",
  },
  {
    id: "expedited-response",
    name: "Expedited Clinician Response",
    price: "+₦5,000/month",
    label: "ADD-ON",
    description: "Moves your clinician response time for non-emergency questions to under 2 hours, instead of the standard same-day/next-day response.",
    availability: "Available on any paid plan.",
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
  "Tarragon Free stays free forever: it never expires and never turns into a paid plan on its own. But if you want to feel what it's like to have a real clinician actually watching your numbers, we offer two ways to try a paid plan at no cost.";

export const FREE_TRIALS: { title: string; body: string }[] = [
  {
    title: "Milestone trial: after your 90-Day Health Reset",
    body: "Once you've completed the 90-Day Health Reset on Tarragon Free, we'll offer you 30 days of Complete Care at no charge, no card required to start. A real clinician reviews your numbers for a month so you can decide, with full information, whether it's worth paying for.",
  },
  {
    title: "Risk-triggered trial: when your own numbers ask for it",
    body: "If your logged readings show a pattern a clinician would want to look at (for example, several elevated blood pressure or glucose readings within 30 days), we'll proactively offer a free 30-day trial of Complete Care, so a clinician can review you before anything becomes urgent, not after.",
  },
];

export const FREE_TRIAL_TERMS: string[] = [
  "Both trials are limited to one per person and apply to Complete Care.",
  "No card is required to start a trial, and you will always see the price and confirm before you're ever charged: the trial does not roll into a paid subscription automatically.",
  "At the end of the trial, you simply return to Tarragon Free unless you choose to continue on a paid plan.",
];

export const BOOKING_STEPS: { title: string; body: string }[] = [
  {
    title: "Your clinician tells you (or you ask)",
    body: "A test, refill, or vaccine is due.",
  },
  {
    title: "You see the exact price",
    body: "On the app or on WhatsApp. No estimates, no “roughly.”",
  },
  {
    title: "You confirm and pay",
    body: "By card, bank transfer, or USSD, through Paystack (Stripe for diaspora payments in GBP).",
  },
  {
    title: "We book it with our partner",
    body: "A lab, pharmacy, or clinic, and send you everything you need: where to go, what to bring, and any preparation required.",
  },
  {
    title: "Your result or delivery comes back on WhatsApp",
    body: "Explained in plain language. If anything needs attention, your clinician calls you; this does not create any new charge.",
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
    question: "Will my card ever be charged automatically for a test I didn't ask for?",
    answer:
      "No. Every single lab test, refill, or vaccine requires you to see the price and confirm before anything is booked or charged.",
  },
  {
    question: "My test came back abnormal. Will I be billed extra automatically?",
    answer:
      "No. Your clinician will call you. If your doctor recommends moving to a higher level of care, that is entirely your choice, and you'll see the price clearly before you decide anything.",
  },
  {
    question: "Does Tarragon Free ever expire?",
    answer:
      "No. Tarragon Free has no time limit and never converts to a paid plan on its own. You can use it for as long as you like.",
  },
  {
    question: "How do the free trials of Complete Care work?",
    answer:
      "You'll be offered a 30-day free trial either after completing the 90-Day Health Reset, or if your logged readings suggest a clinician should take a closer look. No card is required to start, and at the end of the trial you simply return to Tarragon Free unless you choose to continue on a paid plan.",
  },
  {
    question: "Will my Naira price change without warning?",
    answer:
      "No. We review Naira pricing once a year at most, and we'll always tell you at least 30 days beforehand. Anything you've already paid for, including a prepaid annual plan, is honoured until it's time to renew.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. Monthly plans can be cancelled anytime and simply end at the close of your current billing period. Annual plans are prepaid for the year, but you can turn off auto-renewal at any time; you just won't be billed again next year.",
  },
  {
    question: "What if I need a test that isn't listed here?",
    answer: "Ask your clinician on WhatsApp. We'll tell you if it's available, and you'll see the price before booking, exactly like every other test.",
  },
  {
    question: "Is my payment information safe?",
    answer:
      "Yes. All payments are processed through Paystack (Nigeria) or Stripe (diaspora). Tarragon does not store your card details.",
  },
  {
    question: "How do I place an order for a test, refill, or add-on?",
    answer:
      "Reply on your Tarragon WhatsApp thread, or tap the relevant button in the app (“Book a Test,” “Request Refill,” “Add a Service”). You'll always see the price before confirming.",
  },
];

export const EMPLOYER_HMO_NOTE =
  "If you're looking to cover staff, members, or a population, corporate wellness plans and HMO partnerships are priced differently, based on the size and needs of your organisation. These aren't self-service plans; speak to our team directly and we'll build a clear, transparent quote for you, with the same no-hidden-cost approach you see above.";
