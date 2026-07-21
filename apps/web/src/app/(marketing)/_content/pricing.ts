/**
 * Pricing content, sourced from Tarragon_Health_Pricing_Guide_v3.docx (the
 * authoritative plans & pricing doc, regenerated 2026-07-21 — it absorbs the
 * decisions below and drops v2's "nurse" wording for "doctor" platform-wide,
 * so the old nurse->doctor translation exception is retired). Keep this file
 * in sync with that guide; every price and label here should be traceable
 * back to it. v2 is kept alongside for history only.
 *
 * Pricing decisions 2026-07-21 (now reflected in the v3 docx):
 * - ParentCare (NGN) repriced ₦20,000 → ₦25,000/month (₦200,000 → ₦250,000
 *   yearly; extra parent +₦7,000 → +₦8,000/month) so the per-parent price no
 *   longer undercuts the Dedicated Care Coordinator add-on it bundles.
 * - "Annual Health Review" renamed "Annual Doctor Review" to stop the
 *   near-collision with the "Annual Health Check" screening product.
 * - Annual Health Check aligned to the live partner-lab bundle price
 *   (₦65,000 — the DB `panel_bundles.annual_health_check` row is the source
 *   of truth; marketing previously said ₦60,000).
 * - Family Lite's "every member gets Complete Care–level monitoring" promise
 *   reworded to needs-matched monitoring (the old wording contractually
 *   over-promised the loss-making case).
 * - Typical partner-lab prices (TYPICAL_PRICES) mirror the live `lab_tests`/
 *   `panel_bundles` catalogue — re-derive from the DB when partners reprice.
 * - Diaspora Family plans are now real, self-service tiers (were
 *   quote-only), and the ENTIRE diaspora price book was rebased ~50% lower
 *   the same day (founder decision): the care is delivered to the person in
 *   Nigeria (same cost base as NGN), and a new platform without brand trust
 *   cannot carry the old 6-9x NGN premium. Now ~2.5-3.5x NGN: Essential
 *   £15/mo, Complete £29/mo, Premium £49/mo, ParentCare £59/mo (2 parents),
 *   Family Lite £290 / Plus £430 / Premium £620 per year (USD ~1.3x GBP:
 *   $19/$39/$79/mo, family $390/$570/$820/yr). Extra member +£60/£80/£120
 *   ($80/$110/$160); extra parent +£19/mo ($25). Still ~80-85% gross margin
 *   — diaspora remains the margin engine, at a price that converts.
 *
 * Superseded 2026-07-15: Tarragon now directly employs its own doctors, so
 * the day-to-day touchpoints that used to be relabelled "clinician" (per the
 * earlier "clinician is the default face" rule in
 * docs/CLINICAL_TRUST_MODEL_SPEC.md §9) are back to "doctor" everywhere in
 * this file, matching the docx and the current spec. Escalation-triggered
 * doctor review (Priority doctor escalation) and explicitly paid/booked
 * doctor appointments (Dedicated Care Coordinator, Family Premium, diaspora
 * Premium) were already correctly attributed to "doctor" and are unchanged.
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
      "A self-tracking tool to help you understand your own numbers and build a habit. No doctor reviews your readings on this plan; if something looks concerning, we'll encourage you to see a doctor and show you how to upgrade.",
    items: [
      { feature: "Log your BP, blood sugar, and weight", label: "INCLUDED" },
      { feature: "Medication reminders", label: "INCLUDED" },
      { feature: "The Tarragon 90-Day Health Reset", label: "INCLUDED" },
      { feature: "Full education library", label: "INCLUDED" },
      { feature: "Downloadable Health Passport PDF", label: "INCLUDED" },
      { feature: "Device setup guides", label: "INCLUDED" },
    ],
    footnote:
      "Not included on this plan, and available only if you upgrade: doctor review, doctor check-in, lab test coordination, medication refill coordination, family dashboard.",
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
      { feature: "Monthly doctor review of your BP or glucose readings", label: "INCLUDED" },
      { feature: "Monthly doctor check-in over WhatsApp", label: "INCLUDED" },
      { feature: "Medication adherence follow-up from your doctor", label: "INCLUDED" },
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
      { feature: "Weekly doctor review (instead of monthly)", label: "INCLUDED" },
      { feature: "Support for multiple conditions on one care plan", label: "INCLUDED" },
      { feature: "Priority doctor escalation", label: "INCLUDED" },
      { feature: "Lab tests", label: "BOOK & PAY" },
      { feature: "Medication refills", label: "BOOK & PAY" },
    ],
    footnote:
      "The Annual Health Check (full body screening) is not bundled free into Complete Care. It's a ₦65,000/year add-on available on any plan, so the price you see is the price you actually pay.",
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
      { feature: "Monitoring matched to each member: Complete Care–level for members with a chronic condition, prevention tracking for everyone else", label: "INCLUDED" },
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
      { feature: "A named family doctor coordinator, not a rotating team", label: "INCLUDED" },
      { feature: "Priority escalation across all members, every time, not only for abnormal readings", label: "INCLUDED" },
      { feature: "One Annual Health Check included free each year, for one member of your choice (a ₦65,000 value)", label: "INCLUDED" },
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
      { feature: "A named doctor coordinator plus a scheduled, booked monthly doctor appointment for every member", label: "INCLUDED" },
      { feature: "Quarterly PDF health report, in addition to the monthly summary", label: "INCLUDED" },
      { feature: "Expedited doctor response (under 2 hours) for every member, on any non-emergency question", label: "INCLUDED" },
      { feature: "Two Annual Health Checks included free each year, for members of your choice (up to ₦130,000 value)", label: "INCLUDED" },
      { feature: "Lab tests and medication refills beyond what's included", label: "BOOK & PAY" },
    ],
    footnote: "Extra members: +₦55,000/year each, up to 6 people total.",
  },
  {
    id: "parentcare",
    name: "ParentCare",
    whoFor: "Keeping close watch over your parent's health, even from a distance",
    priceMain: "₦25,000",
    pricePeriod: "per month",
    priceSecondary: "or ₦250,000/year (2 months free) — covers up to 2 parents",
    description:
      "A dedicated plan for monitoring a parent's health: a named doctor coordinator, scheduled doctor review, and a quarterly report, built specifically for this relationship rather than a general family group.",
    items: [
      { feature: "Named doctor coordinator for your parent(s)", label: "INCLUDED" },
      { feature: "Scheduled doctor review of their readings", label: "INCLUDED" },
      { feature: "Priority escalation if something needs closer attention", label: "INCLUDED" },
      { feature: "Quarterly PDF family report", label: "INCLUDED" },
      { feature: "Lab tests and medication refills", label: "BOOK & PAY" },
    ],
    footnote: "Extra parent: +₦80,000/year, or +₦8,000/month.",
  },
];

export const GBP_TIERS: PricingTier[] = [
  {
    id: "diaspora-essential",
    name: "Essential Care (Diaspora)",
    whoFor: "One condition, monitored from abroad",
    priceMain: "£15",
    pricePeriod: "per month",
    priceSecondary: "or £150/year",
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
    priceMain: "£29",
    pricePeriod: "per month",
    priceSecondary: "or £290/year",
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
    priceMain: "£49",
    pricePeriod: "per month",
    priceSecondary: "or £490/year",
    description:
      "Complete Care, plus a named doctor coordinator, a scheduled monthly doctor appointment (not just WhatsApp), and a quarterly PDF report: our closest level of care for a parent you can't check on in person. You are not just paying for WhatsApp check-ins, you're paying for peace of mind that someone is watching over your family while you're not there.",
    items: [
      { feature: "Everything in Complete Care (Naira plan)", label: "INCLUDED" },
      { feature: "A named doctor coordinator", label: "INCLUDED" },
      { feature: "A scheduled, booked monthly doctor appointment, not just WhatsApp", label: "INCLUDED" },
      { feature: "A quarterly PDF report", label: "INCLUDED" },
      { feature: "Lab tests and medication refills in Nigeria", label: "BOOK & PAY" },
    ],
  },
  {
    id: "family-lite-gbp",
    name: "Family Lite",
    whoFor: "Your whole family back home, on one plan",
    priceMain: "£290",
    pricePeriod: "per year",
    priceSecondary: "covers up to 4 people",
    description:
      "One plan and one bill for your family in Nigeria: monitoring matched to each member, a shared dashboard you can check from anywhere, and a monthly family report.",
    items: [
      { feature: "Monitoring matched to each member: Complete Care–level for members with a chronic condition, prevention tracking for everyone else", label: "INCLUDED" },
      { feature: "Shared family dashboard you can read from abroad", label: "INCLUDED" },
      { feature: "One combined bill in pounds", label: "INCLUDED" },
      { feature: "Monthly family report", label: "INCLUDED" },
      { feature: "Lab tests and medication refills in Nigeria, per member", label: "BOOK & PAY" },
    ],
    footnote: "Extra members: +£60/year each, up to 6 people total.",
  },
  {
    id: "family-plus-gbp",
    name: "Family Plus",
    whoFor: "Families who want fewer gaps between check-ins",
    priceMain: "£430",
    pricePeriod: "per year",
    priceSecondary: "covers up to 4 people",
    description:
      "Everything in Family Lite, plus a named family doctor coordinator, priority escalation for every member, and one Annual Health Check included each year.",
    items: [
      { feature: "Everything in Family Lite", label: "INCLUDED" },
      { feature: "A named family doctor coordinator, not a rotating team", label: "INCLUDED" },
      { feature: "Priority escalation across all members, every time", label: "INCLUDED" },
      { feature: "One Annual Health Check included free each year, for one member of your choice (a ₦65,000 value)", label: "INCLUDED" },
      { feature: "Lab tests and medication refills in Nigeria, per member", label: "BOOK & PAY" },
    ],
    footnote: "Extra members: +£80/year each, up to 6 people total.",
  },
  {
    id: "family-premium-gbp",
    name: "Family Premium",
    whoFor: "Our closest level of family monitoring, from abroad",
    priceMain: "£620",
    pricePeriod: "per year",
    priceSecondary: "covers up to 4 people",
    description:
      "Everything in Family Plus, plus a scheduled monthly doctor appointment for every member, quarterly PDF reports, expedited response, and two Annual Health Checks a year.",
    items: [
      { feature: "Everything in Family Plus", label: "INCLUDED" },
      { feature: "A named doctor coordinator plus a scheduled, booked monthly doctor appointment for every member", label: "INCLUDED" },
      { feature: "Quarterly PDF health report, in addition to the monthly summary", label: "INCLUDED" },
      { feature: "Expedited doctor response (under 2 hours) for every member", label: "INCLUDED" },
      { feature: "Two Annual Health Checks included free each year, for members of your choice (up to ₦130,000 value)", label: "INCLUDED" },
      { feature: "Lab tests and medication refills in Nigeria, beyond what's included", label: "BOOK & PAY" },
    ],
    footnote: "Extra members: +£120/year each, up to 6 people total.",
  },
  {
    id: "parentcare-gbp",
    name: "ParentCare",
    whoFor: "Both your parents, watched over from abroad",
    priceMain: "£59",
    pricePeriod: "per month",
    priceSecondary: "or £590/year — covers up to 2 parents",
    description:
      "Built specifically for monitoring a parent's health rather than a general family group: a named doctor coordinator, scheduled doctor review, and a quarterly report, covering up to 2 parents on one subscription.",
    items: [
      { feature: "Named doctor coordinator for your parent(s)", label: "INCLUDED" },
      { feature: "Scheduled doctor review of their readings", label: "INCLUDED" },
      { feature: "Priority escalation if something needs closer attention", label: "INCLUDED" },
      { feature: "Quarterly PDF family report", label: "INCLUDED" },
      { feature: "Lab tests and medication refills in Nigeria", label: "BOOK & PAY" },
    ],
    footnote: "Extra parent: +£190/year, or +£19/month.",
  },
];

export const DIASPORA_FAMILY_NOTE =
  "All diaspora plans are also available in US dollars inside the app. Family bigger than 6 people, or something unusual? Message our team and we'll build you a custom quote — same no-hidden-cost approach.";

/**
 * Honesty note for diaspora buyers subscribing for THEMSELVES: monitoring
 * and doctor review work anywhere, but the partner network (labs, pharmacies,
 * home visits) is physically in Nigeria. Saying so up front costs a few
 * conversions and buys the thing a new platform needs most — trust.
 */
export const DIASPORA_SELF_USE_NOTE =
  "Being upfront: these plans are built first for watching over someone in Nigeria. If you subscribe for yourself while living abroad, the app tracking, doctor review of your readings, WhatsApp access, and health record all work wherever you are — but lab bookings, medication refills, and home visits happen through our partner network in Nigeria, so those are for when you're home.";

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
    price: "₦65,000/year",
    label: "ADD-ON",
    description:
      "A full metabolic panel (fasting blood sugar, lipid profile, kidney and liver function), BP/weight/BMI check, one age- and sex-relevant cancer screening test, and a doctor consultation to walk you through your results. If anything comes back abnormal, your doctor follows up directly, with no automatic extra charge.",
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
      { feature: "One named doctor coordinator (not a rotating team)", label: "INCLUDED" },
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
      "A guided programme for diet, activity, and weight: a personal assessment, goals you set with support, structured diet and exercise tracks, and in-app check-ins, with a progress review every three months.",
    availability: "Included on Complete Care and above. Available as an add-on on Essential Care or Tarragon Free.",
  },
  {
    id: "annual-review",
    name: "Annual Doctor Review",
    price: "₦70,000/year",
    label: "ADD-ON",
    description:
      "Once a year, your doctor sits down with your whole year of care: health questionnaires, a broad set of labs, a medication review, an updated risk score and care plan, and a short video consultation to talk through the year behind you and the plan ahead. Different from the Annual Health Check above: the Check is a day of screening tests; the Doctor Review is your whole year of care, reviewed with your doctor.",
    availability: "Included on the comprehensive plans (Complete Care, Family, and ParentCare). Available as an add-on on lower plans.",
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
  { item: "HbA1c (3-month blood sugar)", price: "from ₦8,000" },
  { item: "Lipid panel (cholesterol)", price: "from ₦9,000" },
  { item: "Kidney function (U&E + eGFR)", price: "from ₦8,000" },
  { item: "Urinalysis", price: "from ₦3,000" },
  { item: "Diabetes panel (HbA1c + kidney + urine)", price: "from ₦18,500" },
  { item: "Hypertension panel (kidney + cholesterol + urine)", price: "from ₦22,000" },
  { item: "PSA (prostate screening)", price: "from ₦12,000" },
  { item: "Cervical smear", price: "from ₦18,000" },
  { item: "HIV screening", price: "from ₦6,000" },
  { item: "Hepatitis B screening", price: "from ₦7,000" },
];

export const TYPICAL_PRICES_NOTE =
  "These are the current prices at our partner labs, so you can budget before you ever book. Your exact price (including your chosen lab and location) is always shown before you confirm — and if it ever differs from what you see here, the price at booking is the one that counts, and you can simply decline.";

/**
 * "Tarragon vs your HMO" — complementary positioning, never disparaging. HMOs
 * (including our partners) pay for treatment; Tarragon is the monitoring layer
 * that works alongside them.
 */
export const HMO_COMPARE_INTRO =
  "A common question: “Why pay ₦8,000/month for Tarragon when a basic HMO plan costs ₦3,500?” Because they do different jobs — and they work best together.";

export const HMO_COMPARE_ROWS: { need: string; hmo: boolean; tarragon: boolean }[] = [
  { need: "Pays your hospital and treatment bills when you fall ill", hmo: true, tarragon: false },
  { need: "A doctor reviews your BP and blood sugar readings every month, even when you feel fine", hmo: false, tarragon: true },
  { need: "Spots a worrying pattern in your numbers and escalates it before it becomes an emergency", hmo: false, tarragon: true },
  { need: "Reminds you, books your labs and refills, and tracks your results over time", hmo: false, tarragon: true },
  { need: "Keeps your whole health story in one record your family can see (with your consent)", hmo: false, tarragon: true },
];

export const HMO_COMPARE_NOTE =
  "Keep your HMO — you'll still need it the day you're admitted. Tarragon is the layer that watches your numbers between hospital visits so that day comes later, or not at all. We already work alongside Nigerian HMOs, and if your employer or HMO wants Tarragon for its members, they can talk to us directly.";

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
    body: "Explained in plain language. If anything needs attention, your doctor calls you; this does not create any new charge.",
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
      "No. Your doctor will call you. If your doctor recommends moving to a higher level of care, that is entirely your choice, and you'll see the price clearly before you decide anything.",
  },
  {
    question: "Does Tarragon Free ever expire?",
    answer:
      "No. Tarragon Free has no time limit and never converts to a paid plan on its own. You can use it for as long as you like.",
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
      "Yes. Monthly plans can be cancelled anytime and simply end at the close of your current billing period. Annual plans are prepaid for the year, but you can turn off auto-renewal at any time; you just won't be billed again next year.",
  },
  {
    question: "I already have an HMO. Do I still need Tarragon?",
    answer:
      "They do different jobs. Your HMO pays your treatment bills when you're ill; Tarragon watches your numbers between hospital visits — a doctor reviews your readings, escalates worrying patterns early, and coordinates your labs and refills. Keep your HMO; Tarragon works alongside it.",
  },
  {
    question: "What do lab tests actually cost?",
    answer:
      "Typical partner-lab prices are listed on this page (for example, HbA1c from ₦8,000 and a lipid panel from ₦9,000), and your exact price is always shown before you confirm any booking. Nothing is ever charged without your confirmation.",
  },
  {
    question: "What's the difference between the Annual Health Check and the Annual Doctor Review?",
    answer:
      "The Annual Health Check (₦65,000/year) is a day of screening tests: bloods, BP, BMI, one cancer screening, and a doctor consultation about the results. The Annual Doctor Review (₦70,000/year, already included on Complete Care, Family, and ParentCare plans) is your whole year of care reviewed with your doctor: questionnaires, labs, a medication review, an updated care plan, and a video consultation.",
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
      "Tap the relevant button in the app (“Book a Test,” “Request Refill,” “Add a Service”). You'll always see the price before confirming — if your clinician flags something first, you'll get a WhatsApp reminder pointing you to the right place in the app.",
  },
];

export const EMPLOYER_HMO_NOTE =
  "If you're looking to cover staff, members, or a population, corporate wellness plans and HMO partnerships are priced differently, based on the size and needs of your organisation. These aren't self-service plans; speak to our team directly and we'll build a clear, transparent quote for you, with the same no-hidden-cost approach you see above.";
