import type { MarketingRouteKey } from "@/lib/marketing/routes";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { paidProductName } from "@/lib/marketing/membership";

export type ServiceCard = {
  key: MarketingRouteKey;
  href: string;
  title: string;
  description: string;
  built: boolean;
};

export const SERVICE_CARDS: ServiceCard[] = [
  {
    key: "hypertension",
    href: MARKETING_ROUTES.hypertension,
    title: "Hypertension",
    description: "Keep high blood pressure under control and lower your risk of stroke and heart disease.",
    built: true,
  },
  {
    key: "diabetes",
    href: MARKETING_ROUTES.diabetes,
    title: "Diabetes",
    description: "Keep glucose readings, HbA1c, medication and test results in one record.",
    built: true,
  },
  {
    key: "obesity",
    href: MARKETING_ROUTES.obesity,
    title: "Weight Health",
    description: "Weight tracking, a lifestyle plan and doctor review on one record.",
    built: true,
  },
  {
    key: "parentcare",
    href: MARKETING_ROUTES.parentcare,
    title: "Caring for a parent",
    description: "Follow your parent's health, even when you cannot be with them every day.",
    built: true,
  },
  {
    key: "prevention",
    href: MARKETING_ROUTES.prevention,
    title: "Preventive Health",
    description: "For people who feel well: screenings, vaccinations and yearly checks that find problems early.",
    built: true,
  },
  {
    key: "medication",
    href: MARKETING_ROUTES.medication,
    title: "Medication",
    description: "Take your medication on time and never run out.",
    built: true,
  },
  {
    key: "labs",
    href: MARKETING_ROUTES.labs,
    title: "Laboratory tests",
    description: "Know which tests are due, use any laboratory, and have every result followed up.",
    built: true,
  },
];

/**
 * Rewritten 2026-09-22. The previous four entries ("4 priority programmes",
 * "1 place to message your care team", "4 escalation levels", "1 shared
 * record") were internal architecture facts formatted as stat tiles. Two of
 * them had the value "1", which is not a statistic, and "escalation levels"
 * / "shared record" are words from the build spec rather than words a
 * patient would use or care about.
 *
 * This platform is pre-launch, so there are no volume numbers to show and
 * none may be invented (same discipline as the empty testimonials and the
 * single-entry partner strip). The honest substitute for popularity is a
 * specific, checkable promise, so each entry below is one commitment a
 * visitor can hold Tarragon to:
 *
 *   - "Free"      the app, founder decision 2026-09-02 (_content/pricing.ts).
 *   - "12 hrs"    escalation_slas v8, the live active config: 720 minutes for
 *                 a critical screening result, 1440 for any other abnormal
 *                 one. Verified live 2026-09-22 — re-read the active row
 *                 before changing this number, never the value in CLAUDE.md.
 *   - "Any lab"   self-arranged fulfilment (2026-08-03): Tarragon decides
 *                 which test you need, you take the request anywhere.
 *   - "Next of kin" emergency_event channel sequence, which contacts the
 *                 named next of kin when a dangerous reading is not
 *                 acknowledged.
 */
export const PROOF_STATS = [
  {
    value: "Free",
    label: "to join",
    detail: `The app is free, with no time limit. ${paidProductName()} includes a yearly blood test collected for you and a monthly video call with your care team.`,
  },
  {
    value: "12 hrs",
    label: "on a critical result",
    detail: "A critical test result gets doctor follow-up within 12 hours, and any other abnormal result within 24.",
  },
  {
    value: "Any lab",
    label: "near you",
    detail: "We work out which test you need. You take the request to whichever lab you like and pay them directly.",
  },
  {
    value: "Next of kin",
    label: "told in an emergency",
    detail: "If a dangerous reading goes unacknowledged, the person you named is contacted too.",
  },
] as const;

/** Everything the shared record actually watches (services page capability
 * cloud + homepage marquee). Real capabilities only, matching what's built
 * per CLAUDE.md; never add an item that isn't actually tracked. */
export const WHAT_WE_TRACK = [
  "blood pressure",
  "blood sugar & HbA1c",
  "weight & BMI",
  "cholesterol",
  "kidney function",
  "medication adherence",
  "refills before you run out",
  "connected devices & wearables",
  "cervical screening",
  "breast screening",
  "prostate (PSA) screening",
  "colorectal screening",
  "HIV, Hepatitis B & Hepatitis C checks",
  "blood group & genotype",
  "vaccinations",
  "symptoms you report",
  "hospital admissions",
  "annual health checks",
  "cardiovascular risk",
  "online doctor consultations",
  "ask-a-doctor messages",
] as const;

/**
 * The detailed sequence, used on /services where a visitor has already
 * chosen to read about how the platform works.
 *
 * Relabelled 2026-09-22: the step titles used to be the pipeline's own
 * internal stage names ("Onboard", "Monitor", "Care protocol checks",
 * "Escalation"), which read as a state machine rather than as something
 * happening to a person. The sequence itself is unchanged, and the homepage
 * now uses the shorter HOME_HOW_IT_WORKS below instead of this list.
 *
 * Corrected in the same pass: step 5 promised doctor alerting "on the
 * doctor-supported programme", naming `chronic_doctor_supported_pack`, which
 * is_active = false in service_products (retired and unbundled 2026-09-10,
 * see _content/pricing.ts). The product that actually grants
 * `vitals_red_flag_doctor_escalation` today is Continuous Monitoring
 * (verified live 2026-09-22).
 */
export const HOW_IT_WORKS_STEPS = [
  { step: 1, title: "Create your account", body: "Sign-up takes a few minutes, whether the account is for you or for someone you look after." },
  { step: 2, title: "Tell us about your health", body: "Add your conditions, your medication and any relevant medical history." },
  { step: 3, title: "Record your readings", body: "Enter your blood pressure, blood sugar, weight and medication doses, or let a connected cuff, phone or watch send them." },
  { step: 4, title: "Every reading is checked", body: "Each reading is compared automatically against your care protocols, rather than simply stored." },
  {
    step: 5,
    title: "A reading is dangerous",
    body: "A dangerous reading brings you clear guidance straight away, alerts the person you named, and is followed up. With Continuous Monitoring, a doctor is alerted as well.",
  },
  {
    step: 6,
    title: "A family member stays informed",
    body: "Name a next of kin who can follow your care and who is contacted first in an emergency.",
  },
] as const;

/**
 * The homepage version: three steps, not six. A visitor on the homepage has
 * not yet decided they care how the machinery works, and a numbered
 * six-stage pipeline on a first visit reads as documentation. Same truth,
 * told from the reader's side, with the detail left to /services.
 */
export const HOME_HOW_IT_WORKS = [
  {
    title: "Tell us about your health",
    body: "Add your conditions, your medication and your age. It takes about five minutes, for yourself or for a parent.",
  },
  {
    title: "Record your readings",
    body: "Enter your blood pressure, blood sugar, weight and medication doses, or let a connected cuff, phone or watch send them for you.",
  },
  {
    title: "We contact you when it matters",
    body: "When your readings are stable, you hear very little from us. A worrying reading brings you clear guidance straight away and alerts the person you named. An abnormal test result is passed to a doctor.",
  },
] as const;

export type AudienceStat = {
  label: string;
  value: string;
  pill?: { text: string; tone: "green" | "amber" | "red" };
};

export type AudienceTab = {
  key: "patient" | "healthy" | "family" | "corporate" | "hmo";
  tabLabel: string;
  title: string;
  body: string;
  points: string[];
  stats: AudienceStat[];
  cta: { label: string; href: string; source?: string } | null;
};

export const AUDIENCE_TABS: AudienceTab[] = [
  {
    key: "patient",
    tabLabel: "For you",
    title: "Monitor your health with clinical support behind you.",
    body: "Blood pressure, blood sugar, weight, medication and laboratory tests are kept in one secure record, with a doctor available when you need one.",
    points: [
      "Blood pressure, glucose and weight recording, with trend review",
      "Medication reminders and refill alerts",
      "Scheduled doctor check-ins, and referral to a doctor when needed",
    ],
    stats: [
      { label: "Blood pressure", value: "124 / 79", pill: { text: "In range", tone: "green" } },
      { label: "Medication adherence", value: "92%" },
      { label: "Next lab due", value: "HbA1c · 3 wks" },
      { label: "Care gap", value: "", pill: { text: "1 overdue", tone: "amber" } },
    ],
    cta: { label: "See what Tarragon does for you", href: MARKETING_ROUTES.forYou },
  },
  {
    key: "healthy",
    tabLabel: "For staying healthy",
    title: "You do not need a diagnosis to use Tarragon.",
    body: "Tarragon builds a personal screening and vaccination calendar matched to your age, sex and medical history, reminds you when checks are due, and explains your results. In most years, the outcome is reassurance that you are well.",
    points: [
      "A screening and vaccination calendar matched to you",
      "A yearly Health Check that takes minutes to request",
      "Doctor follow-up within a day if a result needs it",
    ],
    stats: [
      { label: "Next screening due", value: "Cervical · 4 mths" },
      { label: "Vaccinations", value: "", pill: { text: "Up to date", tone: "green" } },
      { label: "Last Health Check", value: "All clear" },
      { label: "Education completed", value: "3 of 5 topics" },
    ],
    cta: { label: "Explore preventive health", href: MARKETING_ROUTES.prevention },
  },
  {
    key: "family",
    tabLabel: "For families",
    title: "Follow your parent's health, even from far away.",
    body: "See your mother's blood pressure, your father's medication and their preventive checks without taking over their record. They keep their own account and name you as next of kin, so everything you see is something they chose to share.",
    points: [
      "How is my parent today? A clear green, amber or red status.",
      "Are they taking their medication?",
      "Is anything overdue, such as tests, refills or a review?",
    ],
    stats: [
      { label: "Dad: today's status", value: "", pill: { text: "Stable", tone: "green" } },
      { label: "Medication", value: "Taken, 8:02am" },
      { label: "This week's readings", value: "Stable trend" },
      { label: "Overdue", value: "", pill: { text: "Nothing", tone: "green" } },
    ],
    cta: { label: "Caring for a parent", href: MARKETING_ROUTES.parentcare },
  },
  {
    key: "corporate",
    tabLabel: "For employers",
    title: "Understand your workforce's health risks before they become costs.",
    body: "Corporate wellness reports that show chronic disease risk and gaps in care, presented clearly so that you can act early.",
    points: [
      "Staff enrolment and annual health checks",
      "Anonymised risk dashboard by cohort",
      "Screening completion reports for HR",
    ],
    stats: [
      { label: "Pre-diabetic (workforce)", value: "", pill: { text: "12%", tone: "amber" } },
      { label: "Uncontrolled blood pressure", value: "", pill: { text: "8%", tone: "red" } },
      { label: "Cervical screening overdue", value: "60 employees" },
      { label: "Urgent follow-up needed", value: "25 employees" },
    ],
    cta: { label: "See corporate health plans", href: MARKETING_ROUTES.corporate },
  },
  {
    key: "hmo",
    tabLabel: "For HMOs",
    title: "We manage chronic disease, detect it earlier, and show the evidence.",
    body: "Member monitoring, closure of gaps in care, and outcome data that demonstrate what proactive care delivers.",
    points: [
      "Population risk stratification, live",
      "Care gap closure tracked to completion",
      "Outcome reports designed for renewal discussions",
    ],
    stats: [
      { label: "Members monitored", value: "4,820" },
      { label: "Care gaps closed (90d)", value: "", pill: { text: "+31%", tone: "green" } },
      { label: "Abnormal results caught early", value: "146" },
      { label: "Claims impact", value: "Reporting live" },
    ],
    cta: { label: "See HMO support", href: MARKETING_ROUTES.hmo },
  },
];

// Ordered most-asked first within each category; the homepage surfaces the
// top 4 and links out to the rest (pricing FAQ + contact). `category` splits
// the FAQ page into "General" (practicalities, cost, comfort with tech) vs.
// "Clinical" (doctor involvement, escalation, what the review actually is) —
// the second group exists to answer the skeptical-reader questions before
// they have to be asked out loud, not just how the product works.
export const HOMEPAGE_FAQS = [
  {
    category: "general",
    question: "What is Tarragon Health?",
    answer:
      "TarragonHealth is a health monitoring platform in Nigeria for chronic disease (hypertension, diabetes and weight management), preventive health and family care coordination. Every reading is checked against clinical protocols, and a doctor reviews anything that needs attention.",
  },
  {
    category: "general",
    question: "I am healthy. Is Tarragon for me?",
    answer:
      "Yes. Prevention is half of what Tarragon does. A personal screening and vaccination calendar, a yearly health check and education matched to you all help you stay well. The app is free, and you pay for the yearly check only when you take it. In most years the result is reassurance. If a check does find something, a doctor follows up within a day, or within 12 hours if the result is critical.",
  },
  {
    category: "general",
    question: "Can I use Tarragon for my parent while I live abroad?",
    answer:
      "Yes. Your relative holds their own free Tarragon account and names you as next of kin, so you can follow their care and be contacted first if something urgent happens. You can pay for their health checks and their doctor's time from anywhere. Tests and refills are still paid directly to the laboratory or pharmacy they use in Nigeria, at its own price.",
  },
  {
    category: "general",
    question: "Can I add a family member or caregiver to help manage my care?",
    answer:
      "Yes. You can invite someone you trust, such as a spouse, an adult child or a caregiver. Depending on what you allow, they can follow your appointments and readings, or help with bookings and refills. You choose what they can see and do, they must accept before access begins, and you can change or withdraw their access at any time. This is not a shared plan or a joint account. Each of you keeps your own free Tarragon account.",
  },
  {
    category: "general",
    question: "How much does it cost?",
    answer:
      `The app is free, with no time limit. ${paidProductName()} is one price for a year and includes a yearly blood test collected for you and a video call with your care team every month. You pay pharmacies directly for medicines. See the pricing page for the ${paidProductName()} price.`,
  },
  {
    category: "general",
    question: "How do I log my blood pressure, glucose, or weight?",
    answer:
      "You record readings in the Tarragon app or on the web dashboard, which keeps your record accurate and secure. Reminders and alerts arrive in the app, and you can message your care team there at any time.",
  },
  {
    category: "general",
    question: "Can I connect a fitness tracker, smartwatch, or Bluetooth device?",
    answer:
      "Yes, this is part of the platform, and we are bringing connections online one at a time: Apple Health, Health Connect, and trackers including Fitbit, Garmin, Oura, WHOOP and Dexcom. Manual entry works today for everyone and takes only seconds, so you do not need to wait for a connection to keep your record current.",
  },
  {
    category: "general",
    question: "Do I need a smartphone?",
    answer:
      "Yes, you need a smartphone or a computer. Your health record, your care actions and your messages with your care team are all in the app and on the web dashboard, and reminders and alerts arrive there too.",
  },
  {
    category: "general",
    question: "Is there a Tarragon app?",
    answer:
      "Tarragon works in any phone browser today, and you can add it to your home screen so that it opens like an app. It is the same secure record as the web dashboard, so you can move between your phone and a computer without losing anything. Native apps for iPhone and Android are being built, and we will announce them here when they are available to download.",
  },
  {
    category: "general",
    question: "Will my health data be kept private?",
    answer:
      "Your health record is protected by access controls enforced at the database level. Only your own care team can see it, and it is shared with an employer, insurer or anyone else only with your consent. If a relative or institution can see your care, it is because you granted that access.",
  },
  {
    category: "general",
    question: "What if I am not comfortable with health technology?",
    answer:
      "You do not need to be. Signing up takes about a minute, recording a reading takes seconds, and the app reminds you when something is due. If you get stuck, you can message your care team in the app and a person will reply.",
  },
  {
    category: "general",
    question: "I do not have time for another health app.",
    answer:
      "It needs very little time. Recording a blood pressure reading, a glucose check or your weight takes under a minute. The app tells you when something is due, and your care team does the reviewing, not you.",
  },
  {
    category: "clinical",
    question: "What happens when readings are high?",
    answer:
      "Your readings are reviewed against clinical protocols. If they need attention, your care team contacts you and refers you to a doctor when closer care is needed.",
  },
  {
    category: "clinical",
    question: "What is the difference between my Health Score and my Annual Health Check?",
    answer:
      "Your Health Score is a quick, non-diagnostic summary of several things already on your record: blood pressure control, HbA1c, weight, smoking status, and whether your screenings and vaccinations are up to date. It changes whenever you add something new, so it reflects what you are doing from day to day. Your Annual Health Check (or Comprehensive Screen) is a fuller yearly panel that covers what the Health Score is not built to track, so that nothing is missed. Anything it flags reaches a doctor within a day, or within 12 hours if the result is critical.",
  },
  {
    category: "clinical",
    question: "What about preventive checks and screening results?",
    answer:
      "Tarragon keeps track of which checks are due, reminds you to complete them, and reviews the results when they return. An abnormal screening result prompts doctor follow-up and, where needed, moves you into chronic care monitoring.",
  },
  {
    category: "clinical",
    question: "Does Tarragon replace my doctor?",
    answer:
      "No. Tarragon supports you between visits by recording your numbers, reviewing them against clinical protocols, and coordinating laboratories, pharmacies and specialist referrals on one record. Every review and referral is the clinical judgement of a doctor working to Tarragon's care protocols, not the output of an app or an algorithm on its own.",
  },
  {
    category: "clinical",
    question: "Is a real doctor actually reviewing my results?",
    answer:
      "Yes. Any result, referral or verified document that shows a doctor's name reflects a genuine review by that doctor on the date shown. Care is provided by a team that shares coverage across shifts, so it will not always be the same individual, but each review is that doctor's own.",
  },
] as const;

export const FAQ_CATEGORY_LABEL: Record<(typeof HOMEPAGE_FAQS)[number]["category"], string> = {
  general: "General",
  clinical: "Clinical & trust",
};
