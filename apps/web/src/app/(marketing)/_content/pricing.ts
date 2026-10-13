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
 * 2. Do not describe anything as recurring, auto-renewing or cancellable.
 *    Nothing on this platform charges a card twice. When something runs out you
 *    buy it again, or you don't.
 * 3. Do not promise a feature as free while a gate still blocks it. This page
 *    promised the education library free on every plan for weeks while
 *    /patient/learn gated on `health_education`, which no free product granted.
 *    If you add a "free" line here, check that the gate is actually gone.
 *
 * The platform has two plans: Free and Membership. No other price is shown on the public site (decision 2026-10-13); the one
 * Membership price is read from versioned config by the pricing page.
 */
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
    title: "You pay the lab",
    description:
      "We work out what is needed and write the request. You take it to whichever laboratory or pharmacy you choose and pay them directly, at their price. Tarragon adds nothing and takes no cut. We show you roughly what a test costs at a major private laboratory so you can compare before you go; smaller laboratories are often cheaper for the same test.",
    className: "bg-clinical-navy/10 text-clinical-navy",
  },
  "FREE ELSEWHERE": {
    title: "Free elsewhere",
    description: "Already free, usually from a government programme; we just remind and direct you",
    className: "bg-soft-sage text-charcoal-ink",
  },
  "PAID SERVICE": {
    title: "Paid service",
    description:
      "Part of Membership: a yearly blood test and a video call with your care team every month.",
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
export const PRICING_PROMISES: string[] = [
  "The app is free. Tracking, reminders, your screening calendar, the whole education library, lifestyle and weight coaching, the AI Health Coach, and your quarterly report cost you nothing, with no time limit and no card required.",
  "There are two plans: Free, and Membership. Membership is one price for a year. You see that price and confirm it before anything is taken. No surprise charges, ever.",
  "Nothing auto-renews. Membership lasts a year and then simply ends, and we remind you before it does. There is no card kept on file and no cancellation to remember.",
  "We do not sell laboratory tests and take no cut of what a laboratory or pharmacy charges you. We work out which tests you need and write the request, and you pay the laboratory or pharmacy directly at their price.",
  "The Membership price is reviewed once a year at most, and we will tell you at least 30 days before any change. A Membership you have already paid for is honoured until it ends.",
  NAIRA_ONLY_STATEMENT,
];

export type FreeFeatureGroup = {
  id: string;
  title: string;
  body: string;
  items: string[];
};

export const FREE_FEATURES: FreeFeatureGroup[] = [
  {
    id: "tracking",
    title: "Track everything, on any device",
    body: "Log your own numbers and keep them in one record that stays yours. Every reading is checked against care protocols whatever you pay, and a dangerous one gets you clear guidance and a specific next step immediately.",
    items: [
      "Blood pressure, blood sugar, weight, temperature and oxygen logging",
      "Medication reminders, dose tracking and adherence check-ins",
      "Connect a wearable, or pair a Bluetooth BP cuff or glucometer",
      "Your full history, charted, with trends over time",
      "Downloadable Health Passport PDF",
      "Emergency safety net: immediate guidance, your emergency contact notified, and a check-in afterwards",
    ],
  },
  {
    id: "prevention",
    title: "Know what to check, and when",
    body: "A screening and vaccination calendar built around your age, sex and history, so you find out what is worth doing without paying anyone to tell you.",
    items: [
      "Personal screening calendar and vaccination schedule",
      "Reminders when a check or a dose comes due",
      "We work out which tests you need and write the request",
      "Results tracking over time",
      "Your children's vaccination schedules and verified certificates",
      "The 90-Day Health Reset",
    ],
  },
  {
    id: "learning",
    title: "Understand your own health",
    body: "The whole education library, not a teaser of it: a couple of hundred plain-language articles across 14 categories, with short knowledge checks.",
    items: [
      "Full health education library",
      "Personalised reading for your own conditions",
      "AI Health Coach for everyday questions",
      "Wellness points, badges and challenges",
    ],
  },
  {
    id: "lifestyle",
    title: "Diet, activity and weight",
    body: "The whole lifestyle programme, which used to sit behind the most expensive plan. None of it needs a doctor's time, so none of it costs you anything.",
    items: [
      "Weight tracking against a goal you set",
      "Steps and activity, logged or synced from a wearable",
      "Meal and nutrition logging, with photo estimation",
      "Structured diet and exercise tracks",
      "Your quarterly progress report",
    ],
  },
  {
    id: "coordination",
    title: "Keep your care organised",
    body: "Requests, refills and the people around your care. Coordination is software, so it is free; what a doctor personally does is on the paid list below.",
    items: [
      "Lab test requests written for you, to take to any laboratory",
      "Refill-date tracking and reminders, for any pharmacy",
      "Upload any result and keep it on your record",
      "Name a next of kin, and manage a child's or a relative's record",
      "The chronic programme, self-monitoring track",
    ],
  },
];

export const FREE_FEATURES_NOTE =
  "All of the above is free, with no time limit, no card required, and nothing that turns into a charge on its own. You pay laboratories and pharmacies directly for tests, medicines and vaccines, at their price. Tarragon takes no cut of what they charge you.";

/** Repointed 2026-09-10: a voucher buys any paid service. The 12-week pack it
 * used to point at is retired and unbundled, so the natural thing to sponsor is
 * now Continuous Monitoring, which is both the cheapest way in and the thing
 * that keeps someone watched. */
export const CARE_VOUCHER_INTRO =
  "Someone can pay for a year of Membership for you, from Nigeria or from abroad, and you accept it when you are ready. It is not an account balance, and it cannot be exchanged for cash. The app itself is free, so a gift is only ever for Membership. Tests, medicines and vaccines are paid straight to the laboratory or pharmacy you use.";

export const CARE_VOUCHER_POINTS: { title: string; body: string }[] = [
  {
    title: "Someone can give it to you",
    body: "A family member, in Nigeria or abroad, can give you a year of Membership. They see that they gave it and later that it was used, and nothing about your results. Your tests you pay for at the laboratory, like anyone else.",
  },
  {
    title: "You choose to accept it",
    body: "A gift waits for you to accept it. If you decline, or do not answer in time, the person who gave it is refunded. Nothing about a gift ever bills you, then or later.",
  },
  {
    title: "Refer a friend",
    body: "Share your referral link from your dashboard. Once your friend becomes a Member, you both get a reward voucher towards your care.",
  },
];

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
  "A one-off checkup and Tarragon both send you to a laboratory you choose, and you pay that laboratory directly, at their price. What's different is everything around the result.";

export const CHECKUP_COMPARE_ROWS: { need: string; oneOff: boolean; tarragon: boolean }[] = [
  { need: "Gives you a written result", oneOff: true, tarragon: true },
  { need: "Explains what the numbers actually mean, in plain language", oneOff: false, tarragon: true },
  { need: "A doctor follows up if something comes back abnormal", oneOff: false, tarragon: true },
  { need: "Keeps last time's result so you can see the trend, not just today's number", oneOff: false, tarragon: true },
  { need: "Tells you when your next check is actually due, and why", oneOff: false, tarragon: true },
  { need: "One record your family can see, with your consent", oneOff: false, tarragon: true },
];

export const CHECKUP_COMPARE_NOTE =
  "Nothing here is a claim that a one-off checkup is a bad idea; it's a fine way to get a snapshot. Tarragon is for when you want that snapshot to turn into an ongoing picture, with someone actually reading it and following up.";

export const ALWAYS_FREE: PricingLineItem & { description: string } = {
  feature: "HPV vaccine for girls aged 9–14",
  label: "FREE ELSEWHERE",
  description:
    "Free at every government Primary Health Care (PHC) centre in Nigeria, as part of the national immunisation programme. Tarragon does not charge anything for this; we simply send a reminder and tell you the nearest PHC centre offering it.",
};

export const ALWAYS_FREE_NOTE =
  "The education library, Health Passport, and 90-Day Health Reset are free to every patient, for as long as you use Tarragon, with no expiry date.";

/**
 * "Try before you commit" is now structural rather than a promotion: the app
 * itself is free with no time limit, so there is nothing to trial. The old
 * 30-day Complete Care trials are removed rather than repointed — Complete
 * Care no longer exists, and there is no trial mechanism in the schema
 * (service_purchases has no trial flag and no trial table exists), so a trial
 * offer here would have described something the platform cannot do.
 */
export const FREE_TRIAL_INTRO =
  "There is nothing to try, because there is nothing to commit to. Everything the app does is free and stays free, with no time limit and no card required. If you want a yearly blood test and a video call with your care team every month, that is Membership, one price for a year that you see and confirm first.";

export const FREE_TRIALS: { title: string; body: string }[] = [
  {
    title: "Start with your own numbers",
    body: "Log your blood pressure, blood sugar or weight and get your trends, your screening calendar, the education library and the AI Health Coach, at no charge. Every reading is checked against care protocols whatever plan you are on, and a dangerous one gets you immediate guidance.",
  },
  {
    title: "Join Membership when you want a doctor",
    body: "If you want your care team to look at your numbers with you every month, and a yearly blood test, join Membership. There is no plan to join first, and nothing carries on charging you afterwards.",
  },
];

export const FREE_TRIAL_TERMS: string[] = [
  "The free app has no time limit, and it stays free unless you choose to join Membership.",
  "You will always see the exact price and confirm it before anything is taken from your card.",
  "Nothing renews automatically. When your Membership ends you join again only if you want to.",
];

export const BOOKING_STEPS: { title: string; body: string }[] = [
  {
    title: "Your care team tells you (or you ask)",
    body: "A test, refill, or vaccine is due.",
  },
  {
    title: "For Membership, you see the exact price",
    body: "In the app, before you are ever charged. No estimates, no “roughly.” A test, refill, or vaccine is not something Tarragon charges for at all, so there is no price of ours to show; see the next step.",
  },
  {
    title: "You confirm and pay, or take a request to the provider",
    body: "For Membership: by card, bank transfer, or USSD, through Paystack, in naira, from wherever you are paying. For a test, refill, or vaccine: you take our request to whichever laboratory, pharmacy, or provider you choose and pay them directly, at their price. We set no price on it and take no cut.",
  },
  {
    title: "You get a request to take with you",
    body: "It names exactly which tests to run and why, so the laboratory knows what to do. You choose where to go and when.",
  },
  {
    title: "Your result or delivery comes back in the app",
    body: "Explained in plain language, with an alert so you do not miss it. If anything needs attention, your care team calls you; this does not create any new charge.",
  },
];

export const OUR_UNDERTAKINGS: string[] = [
  "We show you the price and wait for your confirmation before we charge you anything",
  "A doctor reviews your case before any diagnosis is offered or any medicine is changed",
  "Your health information reaches a family member only with your consent",
  "There is no contract and no subscription, and your card is charged once for the Membership you confirm",
  "What is Membership is always labelled as Membership, and anything genuinely free (such as the HPV vaccine for girls 9–14) is always labelled as free",
  "The free app stays free, with no expiry date and nothing that turns into a charge on its own",
];

export const EMPLOYER_HMO_NOTE =
  "If you're looking to cover staff, members, or a population, corporate wellness plans and HMO partnerships are priced differently, based on the size and needs of your organisation. These aren't self-service plans; speak to our team directly and we'll build a clear, transparent quote for you, with the same no-hidden-cost approach you see above.";
