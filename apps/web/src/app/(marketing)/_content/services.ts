import type { MarketingRouteKey } from "@/lib/marketing/routes";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { EXAMPLE_DATA_NOTE } from "./b2b";

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
    description: "Take your medication on time, with a reminder before your supply runs low.",
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
 * happening to a person. The sequence itself is unchanged. (The homepage has
 * its own five-step journey since the 2026-11-05 redesign, in home-sections.tsx.)
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
    body: "A dangerous reading brings you clear guidance straight away, alerts the person you named, and is followed up. On Membership, a doctor on your care team is alerted as well.",
  },
  {
    step: 6,
    title: "A family member stays informed",
    body: "Name a next of kin who can follow your care and who is contacted first in an emergency.",
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
  /** Caption under the stat panel when the figures are made up to show the shape of the report, not real client data. */
  statsNote?: string;
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
      { label: "Overdue checks", value: "", pill: { text: "1 overdue", tone: "amber" } },
    ],
    statsNote: EXAMPLE_DATA_NOTE,
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
    statsNote: EXAMPLE_DATA_NOTE,
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
      { label: "Your father, today", value: "", pill: { text: "Stable", tone: "green" } },
      { label: "Medication", value: "Taken, 8:02am" },
      { label: "This week's readings", value: "Stable trend" },
      { label: "Overdue", value: "", pill: { text: "Nothing", tone: "green" } },
    ],
    statsNote: EXAMPLE_DATA_NOTE,
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
    statsNote: EXAMPLE_DATA_NOTE,
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
    statsNote: EXAMPLE_DATA_NOTE,
    cta: { label: "See HMO support", href: `${MARKETING_ROUTES.corporate}#insurers` },
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
    question: "What is TarragonHealth?",
    answer:
      "TarragonHealth is a health monitoring platform in Nigeria for chronic disease (hypertension, diabetes and weight management), preventive health and family care coordination. Every reading is checked against care protocols. An abnormal screening result goes to a doctor on every plan, and with Membership a doctor on your care team reviews anything that needs attention.",
  },
  {
    category: "general",
    question: "I am healthy. Is Tarragon for me?",
    answer:
      "Yes. Prevention is half of what Tarragon does. A personal screening and vaccination calendar, a yearly health check and education matched to you all help you stay well. The app is free. For your yearly check, you take our request to any reputable laboratory and pay them directly, then upload the report. In most years the result is reassurance. If a check does find something, a doctor follows up within 24 hours, or within 12 hours if the result is critical.",
  },
  {
    category: "general",
    question: "Can I use Tarragon for my parent while I live abroad?",
    answer:
      "Yes. Your relative holds their own free Tarragon account and names you as next of kin, so you can follow their care and be contacted first if something urgent happens. You can give them a year of Membership from anywhere, paid once in naira. Tests and refills are still paid directly to the laboratory or pharmacy they use in Nigeria, at its own price.",
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
      "The app is free, with no time limit. Membership is one price for a year of care with your care team, including an online meeting with a doctor every month. You pay laboratories directly for tests and pharmacies directly for medicines. See the pricing page for the prices.",
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
      "We are bringing connections online one at a time: Apple Health, Health Connect, and trackers including Fitbit, Garmin, Oura, WHOOP and Dexcom. Manual entry works today for everyone and takes only seconds, so you do not need to wait for a connection to keep your record current.",
  },
  {
    category: "general",
    question: "Do I need a smartphone?",
    answer:
      "You need a smartphone or a computer with internet access. Your health record, your care actions and your messages with your care team are all in the app and on the web dashboard, and reminders and alerts arrive there too.",
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
      "You do not need to be. Signing up takes a few minutes, recording a reading takes seconds, and the app reminds you when something is due. If you get stuck, you can message your care team in the app and a person will reply.",
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
      "Every reading is checked against care protocols. A dangerous reading brings you clear guidance straight away, on every plan. With Membership, a doctor on your care team contacts you when a trend needs attention and arranges closer care if it is needed.",
  },
  {
    category: "clinical",
    question: "What is the difference between my health by area and my Annual Health Check?",
    answer:
      "Your health by area groups what is already on your record into a few areas, such as heart and circulation, blood sugar, kidneys, blood count, screening, and weight. For each result it shows the latest value, the range it is compared with, which way it has moved since last time, and anything still to do. There is no overall score. It changes whenever you add something new, and it does not replace a doctor's assessment. Your yearly health check, at a laboratory you choose, adds the tests your record does not yet have, so that nothing is missed. Anything it flags reaches a doctor within 24 hours, or within 12 hours if the result is critical.",
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
