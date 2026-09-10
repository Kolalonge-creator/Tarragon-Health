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
 * Every price below is a fallback string; live prices are read from
 * service_products at request time by lib/marketing/plan-prices.ts.
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
      "A doctor's time, priced per piece of work. You see the price and confirm before anything is charged.",
    className: "bg-sprout-gold/15 text-charcoal-ink",
  },
};

/** The "No-Hidden-Cost Promise", shown as a banner near the top of the pricing page. */
export const PRICING_PROMISES: string[] = [
  "The app is free. Tracking, reminders, your screening calendar, the whole education library, lifestyle and weight coaching, the AI Health Coach, and your quarterly report cost you nothing, with no time limit and no card required.",
  "Beyond the free app, we charge by the piece: a doctor's time, plus Continuous Monitoring and one optional AI Coach top-up. You see the exact price and confirm it before anything is taken. No surprise charges, ever.",
  "Nothing auto-renews. Continuous Monitoring is paid once for a fixed term and then simply stops, and we tell you before it does. There is no subscription, no card kept on file, and no cancellation to remember.",
  "We do not sell laboratory tests and take no cut of what a laboratory or pharmacy charges you. We work out which tests you need and write the request, free, and you pay the laboratory directly at their price. We tell you roughly what to expect it to cost so you can compare before you go.",
  "Naira prices are reviewed once a year at most, and we will tell you at least 30 days before any change. Anything you have already paid for is honoured until it runs out.",
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
  "All of the above is free, with no time limit, no card required, and nothing that turns into a charge on its own. You pay laboratories and pharmacies directly for tests, medicines and vaccines, at their price. Tarragon never takes a cut of what they charge you.";

/**
 * What actually costs money: a doctor's time, priced per piece of work.
 *
 * Every entry maps to a live row in public.service_products. Prices are read
 * from there at request time (lib/marketing/plan-prices.ts) and fall back to
 * the strings here, so a repricing migration does not need a code change.
 * Do NOT list something here that has no active service_products row — that is
 * exactly how the diaspora tab ended up advertising three products nobody
 * could buy.
 */
export type PaidService = {
  id: string;
  /** service_products.code — the row this is sold from. */
  code: string;
  name: string;
  price: string;
  description: string;
  availability: string;
  /** What the price is actually made of, shown as a short breakdown under
   * the description. Only the programme uses this — the one-off credits are
   * already a single unit of work, so there is nothing to break down. */
  breakdown?: string[];
  /** A "you pay the lab" style note distinct from `breakdown`: something
   * genuinely optional, that can be paid either straight to a laboratory or,
   * where a contracted partner offers it, billed by Tarragon instead — see
   * that field's own comment below for which. Kept separate from the
   * description so it can be styled and read as its own disclosure rather
   * than buried in prose. */
  optionalNote?: string;
  /** Per-condition detail, used by the lead card only. */
  conditions?: { condition: string; body: string }[];
  /** Small caption after the price on the lead card, e.g. "for three months".
   * Was hardcoded as "for the full twelve weeks" in pricing-services.tsx,
   * which silently became a lie the moment the lead product changed. */
  priceCaption?: string;
  /** Longer terms of the same product, cheapest per month last. */
  terms?: { code: string; label: string; price: string; perMonth: string }[];
};

export const PAID_SERVICES: PaidService[] = [
  {
    id: "continuous-monitoring",
    code: "continuous_monitoring_3m",
    name: "Continuous Monitoring",
    price: "₦7,500",
    priceCaption: "for three months",
    description:
      "Every reading you log is checked against care protocols whatever you pay. What this adds is that a dangerous one is put in front of a doctor on your care team, rather than sitting on your record waiting to be noticed. It also carries entry to the doctor-supported track of the chronic programme if you are managing hypertension or diabetes, and the twelve-month term includes your annual review. Paid once, for the term you choose, and then it stops. There is no card kept on file and nothing to cancel.",
    breakdown: [
      "Every blood pressure, glucose, oxygen, temperature and pulse reading checked as you log it",
      "A dangerous reading raised to a doctor, not just flagged on your record",
      "Entry to the doctor-supported track if you are managing hypertension or diabetes",
      "We tell you before it runs out, so it never lapses without you knowing",
    ],
    terms: [
      { code: "continuous_monitoring_3m", label: "3 months", price: "₦7,500", perMonth: "₦2,500 a month" },
      { code: "continuous_monitoring_6m", label: "6 months", price: "₦12,000", perMonth: "₦2,000 a month" },
      { code: "continuous_monitoring_12m", label: "12 months", price: "₦18,000", perMonth: "₦1,500 a month, and includes your annual review" },
    ],
    conditions: [
      {
        condition: "Hypertension",
        body: "Your blood pressure trend is tracked against your target, and a reading in the dangerous range reaches a doctor the same day rather than waiting for your next review.",
      },
      {
        condition: "Diabetes",
        body: "Your glucose readings are checked as you log them, and a dangerous high or low reaches a doctor rather than sitting on your record.",
      },
    ],
    availability:
      "Buy it again when the term ends. Nothing renews on its own and no card is stored.",
  },
  {
    id: "written-result-interpretation",
    code: "written_result_interpretation",
    name: "Written Result Interpretation",
    price: "₦7,500",
    description:
      "Upload any laboratory or imaging result, from any provider anywhere in Nigeria, and a doctor will read it and write back what it means in plain language: which figures are outside the normal range, what that does and does not indicate, and what you should do next. You do not need to have ordered the test through us. The result and the interpretation both stay on your record, so next year's result is a trend rather than another isolated number.",
    availability: "One-off. No programme needed, and no connection to where you had the test done.",
  },
  {
    id: "chronic-care-review",
    code: "chronic_care_review_credit",
    name: "Chronic Care Review",
    price: "₦7,500",
    description:
      "A doctor reviews the readings you have logged since your last review, checks them against your care plan and the protocol for your condition, adjusts the plan where it needs adjusting, and writes back what changed and why. This is the review at the centre of managing hypertension or diabetes well. You buy one when it falls due rather than a block of them in advance.",
    availability: "One-off. Most people managing a condition buy one every four to six weeks.",
  },
  {
    id: "medication-review",
    code: "medication_review_credit",
    name: "Medication Review",
    price: "₦12,000",
    description:
      "A senior doctor reviews everything you are taking together: whether each medicine is still the right one, whether the doses still match your numbers, whether anything interacts, and whether something should start or stop. Priced above a standard review because it requires a doctor with prescribing authority.",
    availability: "One-off. Worth doing whenever your medicines change or a new condition is added.",
  },
  {
    id: "ask-a-doctor",
    code: "async_consult_credit",
    name: "Ask a Doctor (written)",
    price: "₦2,500",
    description:
      "One written question, answered by a doctor on your care team, usually within 72 hours.",
    availability: "One-off. No programme needed.",
  },
  {
    id: "prescription-renewal",
    code: "prescription_renewal_credit",
    name: "Prescription Renewal Review",
    price: "₦5,000",
    description:
      "A doctor reviews and signs off on renewing one of your existing prescriptions.",
    availability: "One-off. No programme needed.",
  },
  {
    id: "video-visit",
    code: "video_visit_credit",
    name: "Video or audio visit",
    price: "₦10,000",
    description:
      "A one-off online consultation with a doctor. Pick an open slot from the next two weeks and it is confirmed on booking, with no waiting for a doctor to accept. Not a substitute for emergency care.",
    availability: "One-off, per visit.",
  },
  {
    id: "second-opinion",
    code: "second_opinion_credit",
    name: "Second Opinion Review",
    price: "₦10,000",
    description:
      "A senior doctor reviews an existing result or diagnosis and writes back their own assessment. No visit needed.",
    availability: "One-off. No programme needed.",
  },
  {
    id: "result-consultation",
    code: "result_interpretation_credit",
    name: "Result Consultation",
    price: "₦15,000",
    description:
      "A fifteen-minute video consultation in which a doctor takes you through a specific laboratory or imaging result: what each figure means, what it does and does not indicate, and what to do next. Choose this over the written interpretation when you would rather ask questions as you go.",
    availability: "One-off. No programme needed.",
  },
  {
    id: "senior-case-review",
    code: "senior_case_review_credit",
    name: "Senior Case Review",
    price: "₦25,000",
    description:
      "A senior doctor coordinates your case across every condition you are managing and delivers a single written plan in the app.",
    availability: "One-off. No programme needed.",
  },
  {
    id: "ai-coach-pass",
    code: "ai_coach_daily_pass_30d",
    name: "AI Coach Daily Pass",
    price: "₦5,000",
    description:
      "The AI Health Coach itself is free. This raises your daily message limit for 30 days if you are using it heavily.",
    availability: "Optional. Buy it again any time; nothing renews on its own.",
  },
];

/**
 * Supervised Weight Management, kept separate from PAID_SERVICES because it is
 * a different kind of thing: a course of medical supervision rather than a
 * piece of work, and it needs its own disclosure about what Tarragon does and
 * does not do.
 *
 * The disclosure is not marketing softening. Tarragon supervises people who
 * obtain the medicine themselves; it does not prescribe or supply it, and the
 * database refuses to enrol anyone on a medicine Tarragon started
 * (private.enforce_weight_management_supervision_only). Do not write copy here
 * that implies otherwise.
 */
export const WEIGHT_MANAGEMENT = {
  id: "weight-management",
  name: "Supervised Weight Management",
  price: "₦75,000",
  priceCaption: "for three months",
  description:
    "Medical supervision while you are losing weight on medication you obtain yourself. A doctor confirms you are a suitable candidate, agrees the dose-escalation plan with you, watches for the side effects that matter, and reviews your progress every month. Your blood pressure, weight and glucose are monitored throughout, and a dangerous reading reaches a doctor. Continuous Monitoring is included for the length of the programme.",
  disclosure:
    "Tarragon does not prescribe, sell or supply weight-loss medication, and is not a pharmacy. You obtain your own prescription and your own medicine. What you are paying for is a doctor taking responsibility for how it is used: whether it is right for you, at what dose, and what to do when something changes.",
  includes: [
    "A suitability assessment before anything starts, and an honest answer if the answer is no",
    "A dose-escalation plan agreed with a doctor, not copied off a leaflet",
    "A tolerability check-in every two weeks, read by a clinician",
    "A doctor review every month, in writing",
    "Continuous Monitoring of your blood pressure, weight and glucose throughout",
  ],
  terms: [
    { code: "weight_management_3m", label: "3 months", price: "₦75,000", perMonth: "₦25,000 a month" },
    { code: "weight_management_6m", label: "6 months", price: "₦132,000", perMonth: "₦22,000 a month, and covers the full escalation for most people" },
    { code: "weight_management_12m", label: "12 months", price: "₦240,000", perMonth: "₦20,000 a month" },
  ],
} as const;



/** Repointed 2026-09-10: a voucher buys any paid service. The 12-week pack it
 * used to point at is retired and unbundled, so the natural thing to sponsor is
 * now Continuous Monitoring, which is both the cheapest way in and the thing
 * that keeps someone watched. */
export const CARE_VOUCHER_INTRO =
  "You can buy a paid service up front, for yourself or for someone who has linked you to their care, and pay for it in one go or bit by bit. Whoever it is for uses it when they are ready. It is not an account balance and it is never exchangeable for cash. The app itself is free, so a voucher is only ever for a doctor's time. Tests are paid straight to the laboratory you use.";

export const CARE_VOUCHER_POINTS: { title: string; body: string }[] = [
  {
    title: "Pay a little at a time",
    body: "Spread a paid service, such as twelve months of Continuous Monitoring or a course of Supervised Weight Management, over as many instalments as you like. It becomes usable once it is fully paid, and nothing runs out while you are still paying toward it.",
  },
  {
    title: "Someone can buy it for you",
    body: "A family member, in Nigeria or abroad, can buy one for you. This is what sponsoring someone's care means here: they see that they bought it and later that it was used, and nothing about your results. Your tests you pay for at the laboratory, like anyone else.",
  },
  {
    // The ₦500 figure is fixed in code, not DB-configured: redeem_referral_code
    // hardcodes reward_kobo = 50000 (migration 20260724113718). If that function
    // is ever repriced, update this line (and the FAQ + gift page) with it.
    title: "Refer a friend",
    body: "Share your referral link from your dashboard. Once your friend completes their first paid order, you both get a ₦500 reward voucher toward your care.",
  },
  {
    title: "It does not quietly disappear",
    body: "A voucher lasts two years and we remind you 30 days before it runs out. If it lapses unused, ask us and we will normally put it back.",
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
  "There is nothing to try, because there is nothing to commit to. Everything the app does is free and stays free, with no time limit and no card required. You only ever pay when you want a doctor to do a specific piece of work for you, and you see that price and confirm it first.";

export const FREE_TRIALS: { title: string; body: string }[] = [
  {
    title: "Start with your own numbers",
    body: "Log your blood pressure, blood sugar or weight and get your trends, your screening calendar, the education library and the AI Health Coach, at no charge. Every reading is checked against care protocols whatever you pay, and a dangerous one gets you immediate guidance and the full emergency safety net.",
  },
  {
    title: "Buy a doctor's time only when you want it",
    body: "If you want a doctor to read a result, answer a question, or keep watch on your readings for a few months, buy that one thing. There is no plan to join first, and nothing carries on charging you afterwards.",
  },
];

export const FREE_TRIAL_TERMS: string[] = [
  "The free app has no time limit and never turns into a charge on its own.",
  "You will always see the exact price and confirm it before anything is taken from your card.",
  "Nothing renews automatically. When a paid service runs out, you buy it again only if you want to.",
];

export const BOOKING_STEPS: { title: string; body: string }[] = [
  {
    title: "Your doctor tells you (or you ask)",
    body: "A test, refill, or vaccine is due.",
  },
  {
    title: "For a paid service, you see the exact price",
    body: "In the app, before you're ever charged. No estimates, no “roughly.” A test, refill, or vaccine isn't something Tarragon charges for at all, so there's no price of ours to show; see the next step.",
  },
  {
    title: "You confirm and pay, or take a request to the provider",
    body: "For paid services: by card, bank transfer, or USSD, through Paystack, in naira, from wherever you are paying. For a test, refill, or vaccine: you take our request to whichever laboratory, pharmacy, or provider you choose and pay them directly, at their price. We set no price on it and take no cut.",
  },
  {
    title: "You get a request to take with you",
    body: "It names exactly which tests to run and why, so the laboratory knows what to do. You choose where to go and when.",
  },
  {
    title: "Your result or delivery comes back in the app",
    body: "Explained in plain language, with an alert so you don't miss it. If anything needs attention, your doctor calls you; this does not create any new charge.",
  },
];

export const NEVER_DO: string[] = [
  "Never charge you without showing the price and getting your confirmation first",
  "Never diagnose you or change your medication without a doctor's review",
  "Never share your health information with a family member without your consent",
  "Never lock you into a contract or a subscription, and never charge your card a second time on its own",
  "Never disguise a paid service as something free, and never disguise something genuinely free (like the HPV vaccine for girls 9–14) as something you need to pay us for",
  "Never put an expiry date on the free app, and never turn it into a charge on its own",
];

/**
 * Live price strings keyed by service_products.code, as produced by
 * lib/marketing/plan-prices.ts's fetchServicePriceOverrides(). Optional
 * everywhere it is accepted: with no map (or a code missing from it) the
 * fallback prices declared on PAID_SERVICES above are used, so this file
 * stays the single source of the default numbers.
 */
export type ResolvedServicePrices = Record<string, string>;

/** Resolve one service's display price: live override first, then the
 * fallback declared on PAID_SERVICES. The empty-string fallback is
 * unreachable while every code passed below exists in PAID_SERVICES —
 * kept only so a future typo degrades to a missing price, not a crash. */
export function servicePrice(code: string, overrides?: ResolvedServicePrices): string {
  return overrides?.[code] ?? PAID_SERVICES.find((s) => s.code === code)?.price ?? "";
}

/**
 * The pricing FAQ, with every naira figure resolved through the same
 * override map the service cards use, so a DB repricing can never leave the
 * FAQ contradicting the card above it on the same page. Callers with no live
 * prices (or none for a given code) get the defaults from PAID_SERVICES.
 */
export function getPricingFaq(
  overrides?: ResolvedServicePrices,
): { question: string; answer: string }[] {
  const p = (code: string) => servicePrice(code, overrides);
  return [
  {
    question: "What does it actually cost to use Tarragon?",
    answer:
      "Nothing, unless you ask a doctor to do something specific for you. Tracking your blood pressure, blood sugar and weight, medication reminders, your screening and vaccination calendar, the whole education library, lifestyle and weight coaching, the AI Health Coach and your quarterly report are all free, with no time limit and no card required. You pay only for a doctor's time, priced per piece of work, and you see that price and confirm it before anything is charged.",
  },
  {
    question: "What exactly do I pay for, then?",
    answer: `A doctor's time, priced per piece of work, plus a standing watch on your readings. One-off: a written question to a doctor (${p("async_consult_credit")}), having any laboratory result read and explained in writing (${p("written_result_interpretation")}), a chronic care review (${p("chronic_care_review_credit")}), a prescription renewal review (${p("prescription_renewal_credit")}), a video or audio visit (${p("video_visit_credit")}), a second opinion (${p("second_opinion_credit")}), a medication review (${p("medication_review_credit")}), a result consultation over video (${p("result_interpretation_credit")}), or a senior case review (${p("senior_case_review_credit")}). Ongoing: Continuous Monitoring from ${p("continuous_monitoring_3m")} for three months, where a dangerous reading reaches a doctor instead of sitting on your record, and Supervised Weight Management from ${p("weight_management_3m")} for three months. We also issue doctor-signed documents, priced by type from ${p("verified_document_fit_to_work")}. The one paid item that isn't a doctor's time is the optional AI Coach Daily Pass (${p("ai_coach_daily_pass_30d")}), which raises the free AI Health Coach's daily message limit for 30 days.`,
  },
  {
    question: "There used to be Prevent, Essential and Complete Care plans. What happened to them?",
    answer:
      "They are gone. We looked at what those plans were actually charging for and found most of it cost us nothing to provide: an education library, a screening calendar, weight and activity tracking, an AI coach. Charging a monthly fee for software while calling it healthcare was not honest, so we stopped. Everything that used to sit behind those plans is now free, and we charge only for the part that genuinely costs something, which is a doctor's time. If you are part-way through a plan you already bought, it keeps working exactly as it did until it runs out.",
  },
  {
    question: "Is the free version limited, or does it expire?",
    answer:
      "It is not limited and it does not expire. There is no trial, no countdown, and nothing that turns into a charge on its own. This is the whole app.",
  },
  {
    question: "If I log a dangerous reading and I have not paid anything, what happens?",
    answer:
      "You get the full emergency safety net, and it never depended on payment: immediate, specific guidance to get to a hospital, your emergency contact notified, and a check-in with you afterwards. Your readings are checked against the same care protocols whatever you pay. What Continuous Monitoring adds is that a Tarragon doctor is alerted to it as well, and follows up with you personally.",
  },
  {
    question: "Which conditions does Tarragon manage, and where does weight management fit?",
    answer: `Hypertension and diabetes. Continuous Monitoring (from ${p("continuous_monitoring_3m")}) puts a doctor behind your readings, and a Chronic Care Review (${p("chronic_care_review_credit")}) is where one actually reviews your numbers, adjusts your care plan and writes back. Most people managing a condition buy a review every four to six weeks alongside their monitoring. Weight is different: managing it alongside hypertension or diabetes is part of the same review at no extra charge, weight and lifestyle coaching on their own stay free, and Supervised Weight Management (from ${p("weight_management_3m")}) exists only for people taking weight-loss medication they have obtained themselves and who want a doctor supervising how it is used.`,
  },
  {
    question: "Will my card ever be charged automatically?",
    answer:
      "No. There is no subscription and nothing renews. Your card is never charged for a test, refill, or vaccine at all: those go straight to whichever laboratory, pharmacy, or provider you choose, and you pay them directly, at their price. The only things Tarragon ever charges you for are paid services you have explicitly confirmed.",
  },
  {
    question: "My test came back abnormal. Will I be billed extra automatically?",
    answer:
      "No. Nothing is ever added to your bill because of a result. If your result suggests you would benefit from a doctor managing your condition with you, we will say so and show you the price, and it is entirely your choice.",
  },
  {
    question: "What do lab tests actually cost?",
    answer:
      "We deliberately don't quote a figure for the self-arranged route: every lab sets its own price, and you pay that laboratory directly with nothing added by us. It's worth asking two or three labs before you go, since prices vary by lab and city. The exception is a named screening bundle, where you can opt in to have us arrange it with our partner laboratory: there you see one Tarragon price up front and confirm it before anything is charged.",
  },
  {
    question: "What are wellness points, and are they real money?",
    answer:
      "You earn points for everyday habits: logging a reading, finishing a lesson, or completing a challenge. Collect badges as you go, and redeem points any time for a reward voucher that comes off the price of a paid service. A reward voucher is a discount, not cash, and cannot be exchanged for money.",
  },
  {
    question: "I'm healthy. Why would I use a health platform at all?",
    answer:
      "Because it costs you nothing to find out what you should be checking. Hypertension, diabetes and many cancers are far cheaper and easier to deal with when caught early, or prevented outright. Your screening and vaccination calendar, built around your age, sex and history, is free, as is the reading that explains what your numbers mean. Most people will simply get confirmation that all is well.",
  },
  {
    question: "Are paid services refundable?",
    answer:
      "A paid service is non-refundable once the doctor's work has begun. Continuous Monitoring runs to the end of the term you paid for and you keep it for all of it; it just stops afterwards rather than renewing.",
  },
  {
    question: "I already have an HMO. Do I still need Tarragon?",
    answer:
      "They do different jobs. Your HMO pays your treatment bills when you're ill; Tarragon watches your numbers between hospital visits, checks them against care protocols, and escalates worrying patterns early. Since the app is free, using it alongside your HMO costs you nothing to try.",
  },
  {
    question: "Can I track my children's vaccinations too?",
    answer:
      "Yes, free. Add a child from your dashboard, even one who's too young to have their own login, and their schedule lives on your account: their own vaccination schedule, reminders, and doctor-verified certificates, on the same record as the rest of their care.",
  },
  {
    question: "What if I need a test that isn't listed here?",
    answer:
      "Ask in the app. We'll tell you if it's worth doing and write you a request for it, free; you take that to any laboratory you like and pay them directly, exactly like every other test.",
  },
  {
    question: "Is my payment information safe?",
    answer:
      "Yes. All payments are processed through Paystack. Tarragon does not store your card details.",
  },
  {
    question: "What is a care voucher?",
    answer:
      "It is a paid service bought up front, for you or for someone who has linked you to their care. It is for that service and for the person named on it: it cannot be transferred, and it is never exchangeable for cash. You can pay for it in instalments, and a family member abroad can buy one for you, which is what sponsoring someone's care means here. Referring a friend earns you both a ₦500 reward voucher once they complete their first paid order.",
  },
  {
    question: "I live abroad. Can I pay for a relative's care in Nigeria?",
    answer:
      "Yes, by sponsoring them: you buy a paid service for someone in Nigeria who has linked you to their care, and they use it when they're ready. You see that you bought it, and later that it was used, and nothing about their results. There is no separate diaspora plan to join, and the app they use is free either way.",
  },
  ];
}

export const EMPLOYER_HMO_NOTE =
  "If you're looking to cover staff, members, or a population, corporate wellness plans and HMO partnerships are priced differently, based on the size and needs of your organisation. These aren't self-service plans; speak to our team directly and we'll build a clear, transparent quote for you, with the same no-hidden-cost approach you see above.";
