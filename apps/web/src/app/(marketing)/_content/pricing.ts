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
 *   paid   a doctor's time, priced per piece of work — the 12-week
 *          doctor-supported programme, and eight one-off clinical credits.
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
  "YOU PAY THE LAB": {
    title: "You pay the lab",
    description:
      "Tarragon works out what's needed and writes the request; you take it to whichever laboratory, pharmacy, or provider you choose and pay them directly. Tarragon takes no cut of what they charge you for it.",
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
  "Beyond the free app, we charge by the piece: a doctor's time, plus one optional AI Coach top-up. You see the exact price and confirm it before anything is taken. No surprise charges, ever.",
  "Nothing auto-renews. There is no subscription, no cancellation to remember, and nothing that charges your card a second time on its own. When something runs out, you buy it again if you want to.",
  "Tarragon takes no cut of what a laboratory or pharmacy charges you. For most tests you pay them directly, at their price. For a few screening bundles you can opt in to have us arrange it with our partner laboratory and bill you one price instead.",
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
      "The 12-week chronic programme, self-monitoring track",
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
  /** Per-condition detail, only for the programme (which is scoped to
   * hypertension and diabetes specifically — weight/lifestyle already has
   * its own free coaching track elsewhere on the platform, so it doesn't
   * need a paid doctor-supported product of its own). */
  conditions?: { condition: string; body: string }[];
};

export const PAID_SERVICES: PaidService[] = [
  {
    id: "chronic-programme",
    code: "chronic_doctor_supported_pack",
    name: "12-week doctor-supported programme",
    price: "₦50,000",
    description:
      "Twelve weeks of actual clinical management for hypertension and diabetes: a doctor sets your care plan, reviews your readings, adjusts your medication, and is alerted when one of your readings is dangerous. It also covers asking a doctor questions in writing and having your uploaded results read back to you for the length of the programme. Managing weight alongside either condition is part of the same review, at no extra charge. Weight and lifestyle coaching on their own are already free, see above. The self-monitoring track of the same programme, with no doctor attached, stays free.",
    // The ₦10,000 component figures are founder-set pieces of the programme's
    // structure (migration 20260902231345_reprice_chronic_programme_50k...),
    // not service_products rows, so there is no live price to read for them —
    // the override map is keyed by product code and these have none. If the
    // programme is ever repriced, edit these lines in the same change.
    breakdown: [
      "Three doctor reviews across the twelve weeks, ₦10,000 each",
      "One medication review, ₦10,000",
      "Ongoing coordination and monitoring for the full twelve weeks, ₦10,000",
    ],
    conditions: [
      {
        condition: "Hypertension",
        body: "Your doctor tracks your BP trend against your target, adjusts your antihypertensive as needed, and checks for the warning signs that matter most in the first weeks of a new or changed dose.",
      },
      {
        condition: "Diabetes",
        body: "Your doctor tracks your blood glucose trend, reviews your HbA1c when you have one, and adjusts your antidiabetic medication and dose as your numbers move.",
      },
    ],
    optionalNote:
      "Essential bloods before you start are optional, and recommended so your doctor has a real baseline. You can take the request to any laboratory you choose and pay them directly (Tarragon adds nothing on top) or, where we have a contracted partner lab, opt in to have Tarragon bill it directly for you instead. Either way you see the exact price before anything is charged.",
    availability: "The one recurring thing we sell. Buy it again when it ends; nothing renews on its own.",
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
    price: "₦3,500",
    description:
      "A doctor reviews and signs off on renewing one of your existing prescriptions.",
    availability: "One-off. No programme needed.",
  },
  {
    id: "verified-document",
    code: "verified_document_credit",
    name: "Verified Digital Document",
    price: "₦4,000",
    description:
      "A doctor-attested fit-to-work letter or travel health certificate, delivered as a signed PDF.",
    availability: "One-off. No programme needed.",
  },
  {
    id: "video-visit",
    code: "video_visit_credit",
    name: "Video or audio visit",
    price: "₦5,000",
    description:
      "A one-off online consultation with a doctor. Pick an open slot from the next two weeks and it is confirmed on booking, with no waiting for a doctor to accept. Not a substitute for emergency care.",
    availability: "One-off, per visit.",
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
  {
    id: "second-opinion",
    code: "second_opinion_credit",
    name: "Second Opinion Review",
    price: "₦7,500",
    description:
      "A doctor reviews an existing result or diagnosis and writes back their own assessment. No visit needed.",
    availability: "One-off. No programme needed.",
  },
  {
    id: "result-interpretation",
    code: "result_interpretation_credit",
    name: "Result Interpretation Session",
    price: "₦10,000",
    description:
      "A 15-minute doctor walkthrough of a specific lab or imaging result, over video.",
    availability: "One-off. No programme needed.",
  },
  {
    id: "senior-case-review",
    code: "senior_case_review_credit",
    name: "Senior Case Review",
    price: "₦15,000",
    description:
      "A senior doctor coordinates your case across every condition you are managing and delivers a single written plan in the app.",
    availability: "One-off. No programme needed.",
  },
];


/** Repointed 2026-09-02: a voucher used to buy "a year of a plan". There are no
 * plans left, so it buys a paid service — in practice the 12-week
 * doctor-supported programme, which is the only recurring thing sold. */
export const CARE_VOUCHER_INTRO =
  "You can buy a paid service up front, for yourself or for someone who has linked you to their care, and pay for it in one go or bit by bit. Whoever it is for uses it when they are ready. It is not an account balance and it is never exchangeable for cash. The app itself is free, so a voucher is only ever for a doctor's time. Tests are paid straight to the laboratory you use.";

export const CARE_VOUCHER_POINTS: { title: string; body: string }[] = [
  {
    title: "Pay a little at a time",
    body: "Spread a paid service, such as the 12-week doctor-supported programme, over as many instalments as you like. It becomes usable once it is fully paid, and nothing runs out while you are still paying toward it.",
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
    body: "If you want a doctor to read a result, answer a question, or manage a condition with you over twelve weeks, buy that one thing. There is no plan to join first, and nothing carries on charging you afterwards.",
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
    answer: `A doctor's time. That comes two ways. One-off: a written question to a doctor (${p("async_consult_credit")}), a prescription renewal review (${p("prescription_renewal_credit")}), a verified document (${p("verified_document_credit")}), a video or audio visit (${p("video_visit_credit")}), a second opinion (${p("second_opinion_credit")}), a result interpretation session (${p("result_interpretation_credit")}), or a senior case review (${p("senior_case_review_credit")}). Or ongoing: the 12-week doctor-supported programme for hypertension or diabetes (${p("chronic_doctor_supported_pack")}, three doctor reviews plus one medication review across the twelve weeks), where a doctor sets your care plan, adjusts your medication, and is alerted if one of your readings is dangerous. The one paid item that isn't a doctor's time is the optional AI Coach Daily Pass (${p("ai_coach_daily_pass_30d")}), which raises the free AI Health Coach's daily message limit for 30 days.`,
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
      "You get the full emergency safety net, and it never depended on payment: immediate, specific guidance to get to a hospital, your emergency contact notified, and a check-in with you afterwards. Your readings are checked against the same care protocols whatever you pay. What the 12-week doctor-supported programme adds is that a Tarragon doctor is alerted to it as well, and follows up with you personally.",
  },
  {
    question: "Which conditions does Tarragon manage, and where does weight management fit?",
    answer: `Hypertension and diabetes. The 12-week doctor-supported programme (${p("chronic_doctor_supported_pack")}) is where a doctor actually manages either condition with you: reviewing your readings, adjusting your medication, and staying alert to a dangerous one. If you're managing your weight alongside hypertension or diabetes, that's part of the same review at no extra charge. Weight management on its own has its own free coaching track (see above), not a paid doctor-supported one, since it doesn't need a doctor's time the way medication adjustment does.`,
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
      "A paid service is non-refundable once the doctor's work has begun. The 12-week programme runs to the end of its twelve weeks and you keep full access for all of it; it just doesn't renew on its own afterwards.",
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
