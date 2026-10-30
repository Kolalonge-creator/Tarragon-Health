/**
 * Pricing content for the public marketing site.
 *
 * Corrected 2026-09-02 — founder decision. The platform is now a FREE APP plus
 * PAY-PER-SERVICE. The Prevent/Essential/Complete packs (and Tarragon Free,
 * which granted nothing any gate ever read) are retired: see migration
 * 20260902221450_free_app_retire_packs_doctor_time_stays_paid.sql.
 *
 * The rule this page exists to express, because it is the actual business
 * model rather than a marketing angle:
 *
 *   free   anything with no marginal clinician cost — tracking, reminders,
 *          the screening calendar, the whole education library, lifestyle /
 *          weight / activity / nutrition, the AI Coach, the quarterly report,
 *          lab-request coordination and refill tracking.
 *
 *   paid   a doctor's time, priced per piece of work, plus Continuous
 *          Monitoring — a standing watch on the readings you log, bought
 *          prepaid for a fixed term.
 *
 * Corrected 2026-09-10 (second founder pass). Two structural changes:
 *
 *   - The laboratory catalogue is no longer sold. Tarragon's recorded cost for
 *     a test WAS the laboratory's own published retail price, so adding a
 *     margin made Tarragon dearer than the laboratory performing it, on every
 *     item in the catalogue. Deciding which tests you need stays free; reading
 *     the result is the paid product. Never reintroduce a marked-up test price
 *     without first proving a negotiated rate genuinely below public list.
 *   - The 12-week doctor-supported pack is retired and unbundled. It modelled
 *     at roughly 17% contribution, by a wide margin the worst product here,
 *     and its 50,000 naira entry price stood in front of a patient who had
 *     never bought anything. The same twelve weeks now costs less bought as
 *     Continuous Monitoring plus reviews as they fall due.
 *
 * Three standing traps, each of which this page has actually fallen into:
 *
 * 1. Do not list a product with no active `service_products` row. The diaspora
 *    tab advertised three USD packs (prevent/essential/complete_usd_pack) that
 *    never existed in the catalogue, so those prices were unbuyable fiction.
 *    The diaspora tier is retired anyway (2026-07-31: someone abroad SPONSORS
 *    another person's care, they are not a patient tier), which is why there is
 *    no currency toggle here any more. Corrected further 2026-09-02: the
 *    diaspora/USD path is removed from the app entirely, not just this page —
 *    there is no registered Stripe account behind it (needs a UK business
 *    registration that has not happened), so the onboarding currency selector
 *    and the admin diaspora-pricing screen are gone too, not repaired. Do not
 *    reintroduce a currency picker or USD price anywhere until Stripe is
 *    actually configured (`isStripeConfigured()` returns true).
 * 2. Do not describe anything as recurring, auto-renewing or cancellable, EXCEPT Membership's automatic renewal, and only through
 *    `renewalCopy` in lib/marketing/membership.ts, which follows the real switch (public.membership_auto_renew_enabled). Never type a
 *    renewal sentence into a page.
 *    Nothing on this platform charges a card twice. When something runs out you
 *    buy it again, or you don't.
 * 3. Do not promise a feature as free while a gate still blocks it. This page
 *    promised the education library free on every plan for weeks while
 *    /patient/learn gated on `health_education`, which no free product granted.
 *    If you add a "free" line here, check that the gate is actually gone.
 *
 * Updated 2026-10-27 (W-47): the platform has Free plus two paid tiers, Membership and Membership Plus (decision 2026-10-21, which
 * superseded the 2026-10-13 "one Membership price" premise). The public site may show exactly those two member prices and the upgrade
 * difference, each read from versioned config (commerce.membership_ladder; commerce.membership_prices while the ladder is off), and no
 * other naira figure and no volume wording. no-public-prices.test.ts enforces this with the ladder off and on.
 */
import { paidProductName, renewalCopy } from "@/lib/marketing/membership";

/** The name of the one paid product while the ladder is OFF (W-46). */
const P = paidProductName();

export type PricingLabel =
  | "FREE"
  | "YOU PAY THE LAB"
  | "FREE ELSEWHERE"
  | "PAID SERVICE";

export type PricingLineItem = {
  feature: string;
  label: PricingLabel;
};

/**
 * What the app gives every patient at no charge.
 *
 * The Prevent/Essential/Complete packs were retired when the platform moved to
 * a free app plus pay-per-service. Every feature with no marginal clinician
 * cost is now free to everyone, so this page has no plan tiers, no currency
 * toggle and no plan finder — there is nothing left to choose between. Adding
 * a tier back here without a matching product in service_products is how this
 * page drifted from the app in the first place.
 */
export const PRICING_LABELS: Record<
  PricingLabel,
  { title: string; description: string; className: string }
> = {
  FREE: {
    title: "Free",
    description: "Part of the app, at no charge, for every patient",
    className: "bg-brand-green/10 text-deep-forest",
  },
  // Founder decision 2026-08-21: Tarragon WILL bill for a review once a
  // laboratory is actually contracted, at one price computed for that
  // patient. Nothing is contracted yet, so every line on this page is still
  // paid straight to the provider and this label still describes reality.
  //
  // What changed here is only the scope of the claim. It used to read as a
  // standing promise about Tarragon as a company ("we take no commission");
  // it now says what is true of the items carrying THIS label, which stays
  // true after a billed-by-us label exists alongside it. Do not restore the
  // company-wide wording — the first partner-billed review would make it a
  // lie on a public page.
  // Rewritten 2026-09-10. The previous version left the door open to Tarragon
  // billing a test itself "once a laboratory is contracted". That door is now
  // deliberately shut: the reason Tarragon stopped was not the absence of a
  // contract, it was that the contracted rate turned out to be the laboratory's
  // own retail price, which makes any margin a markup on a number the patient
  // can look up. Do not restore the "we will bill for this later" wording.
  "YOU PAY THE LAB": {
    title: "You pay the laboratory",
    description:
      "We work out what is needed and write the request. You take it to whichever laboratory or pharmacy you choose and pay them directly, at their price. Tarragon adds nothing and takes no cut. We show you roughly what a test costs at a major private laboratory so you can compare before you go; smaller laboratories are often cheaper for the same test.",
    className: "bg-clinical-navy/10 text-clinical-navy",
  },
  "FREE ELSEWHERE": {
    title: "Free elsewhere",
    description: "Already free, usually through a government programme. We remind you and direct you to where it is offered.",
    className: "bg-soft-sage text-charcoal-ink",
  },
  "PAID SERVICE": {
    title: "Paid service",
    description:
      `Part of ${P}: a yearly blood test and a video call with your care team every month.`,
    className: "bg-sprout-gold/15 text-charcoal-ink",
  },
};

/**
 * Single source for the "we only ever price in Naira" claim, quoted in three
 * places (the pricing page hero, this promise list, and the /partners trust
 * page) — kept as one exported string so a future pricing-model change (this
 * repo's pricing has been reworked at least four times, per CLAUDE.md) only
 * needs updating once, not reconciled across three independently-worded
 * copies.
 */
export const NAIRA_ONLY_STATEMENT =
  "Every price is in Naira, and only Naira. There is no dollar version, no exchange-rate conversion, and no different price depending on where in the world you are paying from.";

/** The "No-Hidden-Cost Promise", shown as a banner near the top of the pricing page. */
export const pricingPromises = (autoRenews: boolean): string[] => [
  "The app is free. Tracking, reminders, your screening calendar, the whole education library, lifestyle and weight coaching, the AI Health Coach, and your quarterly report cost you nothing, with no time limit and no card required.",
  `There are two plans: Free, and ${P}. ${P} is one price for a year. You see that price and confirm it before anything is taken. No surprise charges, ever.`,
  renewalCopy(autoRenews, 0).promise,
  "We do not sell laboratory tests and take no cut of what a laboratory or pharmacy charges you. We work out which tests you need and write the request, and you pay the laboratory or pharmacy directly at their price.",
  `The ${P} price is reviewed once a year at most, and we will tell you at least 30 days before any change. A ${P} you have already paid for is honoured until it ends.`,
  NAIRA_ONLY_STATEMENT,
];

/** The promises as they read while automatic renewal is OFF (the state every page starts in). */
export const PRICING_PROMISES: string[] = pricingPromises(false);

export type FreeFeatureGroup = {
  id: string;
  title: string;
  body: string;
  items: string[];
};

export const FREE_FEATURES: FreeFeatureGroup[] = [
  {
    id: "tracking",
    title: "Record your health readings on any device",
    body: "Record your own readings and keep them in one health record that belongs to you. Every reading is checked against care protocols whatever you pay, and a dangerous reading immediately gives you clear guidance and a specific next step.",
    items: [
      "Blood pressure, blood sugar, weight, temperature and oxygen logging",
      "Medication reminders, dose tracking and adherence check-ins",
      "Connect a wearable, or pair a Bluetooth blood pressure cuff or glucometer",
      "Your full history, shown as charts, with trends over time",
      "Downloadable Health Passport PDF",
      "Emergency safety net: immediate guidance, notification of your emergency contact, and a check-in afterwards",
    ],
  },
  {
    id: "prevention",
    title: "Know which checks you need, and when",
    body: "A screening and vaccination calendar built around your age, sex and medical history, so you can see which checks are worthwhile without paying anyone to tell you.",
    items: [
      "Personal screening calendar and vaccination schedule",
      "Reminders when a check or a vaccine dose is due",
      "We work out which tests you need and write the request",
      "Results tracking over time",
      "Your children's vaccination schedules and verified certificates",
      "The 90-Day Health Reset",
    ],
  },
  {
    id: "learning",
    title: "Understand your own health",
    body: "The complete education library, not a sample of it: around two hundred plain-language articles in 14 categories, each with a short knowledge check.",
    items: [
      "Full health education library",
      "Personalised reading for your own conditions",
      "AI Health Coach for everyday questions",
      "Wellness points, badges and challenges",
    ],
  },
  {
    id: "lifestyle",
    title: "Nutrition, activity and weight",
    body: "The complete lifestyle programme, which was previously part of the most expensive plan. None of it requires a doctor's time, so none of it is charged.",
    items: [
      "Weight tracking against a goal you set",
      "Steps and activity, logged or synced from a wearable",
      "Meal and nutrition records, with estimates from a photo",
      "Structured diet and exercise tracks",
      "Your quarterly progress report",
    ],
  },
  {
    id: "coordination",
    title: "Keep your care organised",
    body: "Test requests, medicine refills and the people involved in your care. Coordination is handled by software, so it is free. What a doctor does personally is listed under the paid services below.",
    items: [
      "Lab test requests written for you, to take to any laboratory",
      "Refill-date tracking and reminders, for any pharmacy",
      "Upload any result and keep it on your record",
      "Name a next of kin, and manage the record of a child or relative",
      "The chronic programme, self-monitoring track",
    ],
  },
];

export const FREE_FEATURES_NOTE =
  "All of the above is free, with no time limit, no card required, and nothing that becomes a charge on its own. You pay laboratories and pharmacies directly for tests, medicines and vaccines, at their price. Tarragon takes no share of what they charge you.";

/** Repointed 2026-09-10: a voucher buys any paid service. The 12-week pack it
 * used to point at is retired and unbundled, so the natural thing to sponsor is
 * now Continuous Monitoring, which is both the cheapest way in and the thing
 * that keeps someone watched. */
export const CARE_VOUCHER_INTRO =
  "Someone can pay for a year of Membership for you, from Nigeria or from abroad, and you accept it when you are ready. It is not an account balance, and it cannot be exchanged for cash. The app itself is free, so a gift is only ever for Membership. Tests, medicines and vaccines are paid straight to the laboratory or pharmacy you use.";

export const CARE_VOUCHER_POINTS: { title: string; body: string }[] = [
  {
    title: "Someone can pay for it on your behalf",
    body: "A family member, in Nigeria or abroad, can give you a year of Membership. They can see that they gave it and, later, that it was used. They cannot see anything about your results. You pay for your tests at the laboratory, like any other patient.",
  },
  {
    title: "You decide whether to accept it",
    body: "A gift waits until you accept it. If you decline, or do not reply in time, the person who gave it is refunded. A gift never results in a charge to you, now or later.",
  },
  {
    title: "Refer someone you know",
    body: "Share your referral link from your dashboard. Once the person you referred becomes a Member, you both receive a reward voucher towards your care.",
  },
];

export const HMO_COMPARE_INTRO =
  "A common question is why someone with a basic HMO plan would use Tarragon as well. The two do different jobs, and they work best together.";

export const HMO_COMPARE_ROWS: { need: string; hmo: boolean; tarragon: boolean }[] = [
  { need: "Pays your hospital and treatment bills when you fall ill", hmo: true, tarragon: false },
  { need: "Checks your blood pressure and blood sugar readings against care protocols every time you record one, even when you feel well", hmo: false, tarragon: true },
  { need: "Notices a worrying pattern in your readings and refers it to a doctor before it becomes an emergency", hmo: false, tarragon: true },
  { need: "Reminds you when a test or refill is due, gives you a request to take to any laboratory or pharmacy, and tracks your results over time", hmo: false, tarragon: true },
  { need: "Keeps your whole health history in one record that your family can see (with your consent)", hmo: false, tarragon: true },
];

export const HMO_COMPARE_NOTE =
  "Keep your HMO, because you will still need it if you are admitted to hospital. Tarragon monitors your readings between hospital visits, so that day may come later or not at all. We already work alongside Nigerian HMOs, and if your employer or HMO wants Tarragon for its members, they can contact us directly.";

/**
 * "Tarragon vs a one-off checkup": the other comparison people actually make
 * before signing up — not against an HMO, but against paying for a single
 * private lab panel or annual checkup somewhere and being handed a PDF.
 * Same non-disparaging rule as HMO_COMPARE_ROWS: no named competitor, and
 * both still cost the same "you pay the lab" way, since Tarragon has no
 * contracted lab either. The difference this table draws is what happens
 * before and after the result, not who is cheaper.
 */
export const CHECKUP_COMPARE_INTRO =
  "A one-off checkup and Tarragon both send you to a laboratory you choose, and you pay that laboratory directly, at their price. The difference is what happens before and after the result.";

export const CHECKUP_COMPARE_ROWS: { need: string; oneOff: boolean; tarragon: boolean }[] = [
  { need: "Gives you a written result", oneOff: true, tarragon: true },
  { need: "Explains what the numbers mean, in plain language", oneOff: false, tarragon: true },
  { need: "A doctor follows up if something comes back abnormal", oneOff: false, tarragon: true },
  { need: "Keeps your previous results, so you can see the trend and not only the latest number", oneOff: false, tarragon: true },
  { need: "Tells you when your next check is due, and why", oneOff: false, tarragon: true },
  { need: "One record that your family can see, with your consent", oneOff: false, tarragon: true },
];

export const CHECKUP_COMPARE_NOTE =
  "A one-off checkup is a reasonable way to get a snapshot of your health. Tarragon is for people who want that snapshot to become an ongoing picture, with a clinician reading each result and following up.";

export const ALWAYS_FREE: PricingLineItem & { description: string } = {
  feature: "HPV vaccine for girls aged 9–14",
  label: "FREE ELSEWHERE",
  description:
    "Free at every government Primary Health Care (PHC) centre in Nigeria, as part of the national immunisation programme. Tarragon does not charge for this. We send a reminder and tell you the nearest PHC centre that offers it.",
};

export const ALWAYS_FREE_NOTE =
  "The education library, Health Passport and 90-Day Health Reset are free to every patient for as long as you use Tarragon, with no expiry date.";

/**
 * "Try before you commit" is now structural rather than a promotion: the app
 * itself is free with no time limit, so there is nothing to trial. The old
 * 30-day Complete Care trials are removed rather than repointed — Complete
 * Care no longer exists, and there is no trial mechanism in the schema
 * (service_purchases has no trial flag and no trial table exists), so a trial
 * offer here would have described something the platform cannot do.
 */
export const FREE_TRIAL_INTRO =
  `There is nothing to try, because there is nothing to commit to. Everything the app does is free and stays free, with no time limit and no card required. If you want a yearly blood test and a video call with your care team every month, that is ${P}, one price for a year that you see and confirm first.`;

export const FREE_TRIALS: { title: string; body: string }[] = [
  {
    title: "Start with your own readings",
    body: "Record your blood pressure, blood sugar or weight and receive your trends, your screening calendar, the education library and the AI Health Coach, at no charge. Every reading is checked against care protocols whatever plan you are on, and a dangerous reading immediately gives you guidance.",
  },
  {
    title: `Join ${P} when you want to see a doctor`,
    body: `If you want your care team to look at your numbers with you every month, and a yearly blood test, join ${P}. There is no plan to join first, and nothing carries on charging you afterwards.`,
  },
];

export const freeTrialTerms = (autoRenews: boolean): string[] => [
  "The free app has no time limit, and it stays free unless you choose to join Membership.",
  "You will always see the exact price and confirm it before anything is taken from your card.",
  renewalCopy(autoRenews, 0).trialTerm,
];

export const FREE_TRIAL_TERMS: string[] = freeTrialTerms(false);

export const BOOKING_STEPS: { title: string; body: string }[] = [
  {
    title: "Your care team tells you, or you ask",
    body: "A test, refill or vaccine is due.",
  },
  {
    title: `For ${P}, you see the exact price`,
    body: "In the app, before you are charged. The price is exact, not an estimate. Tarragon does not charge for a test, refill or vaccine, so there is no Tarragon price to show for those; see the next step.",
  },
  {
    title: "You confirm and pay, or take the request to the provider",
    body: "For Membership: by card, bank transfer, or USSD, through Paystack, in naira, from wherever you are paying. For a test, refill, or vaccine: you take our request to whichever laboratory, pharmacy, or provider you choose and pay them directly, at their price. We set no price on it and take no cut.",
  },
  {
    title: "You get a request to take with you",
    body: "It names exactly which tests to run and why, so the laboratory knows what is needed. You choose where to go and when.",
  },
  {
    title: "Your result or delivery comes back in the app",
    body: "Your result is explained in plain language, and you receive an alert so that you do not miss it. If anything needs attention, your care team calls you. This does not create a new charge.",
  },
];

export const OUR_UNDERTAKINGS: string[] = [
  "We show you the price and wait for your confirmation before we charge you anything",
  "A doctor reviews your case before any diagnosis is offered or any medicine is changed",
  "Your health information reaches a family member only with your consent",
  `There is no contract and no subscription, and your card is charged once for the ${P} you confirm`,
  "What is Membership is always labelled as Membership, and anything genuinely free (such as the HPV vaccine for girls 9–14) is always labelled as free",
  "The free app stays free, with no expiry date and nothing that turns into a charge on its own",
];

export const EMPLOYER_HMO_NOTE =
  "If you want to cover staff, members or a wider population, corporate wellness plans and HMO partnerships are priced differently, according to the size and needs of your organisation. These are not self-service plans. Speak to our team and we will prepare a clear quote for you, with the same approach of no hidden costs described above.";
