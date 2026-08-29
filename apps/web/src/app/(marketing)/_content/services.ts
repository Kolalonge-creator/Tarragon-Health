import type { MarketingRouteKey } from "@/lib/marketing/routes";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

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
    description: "Stay ahead of high blood pressure before it causes complications.",
    built: true,
  },
  {
    key: "diabetes",
    href: MARKETING_ROUTES.diabetes,
    title: "Diabetes",
    description: "Track glucose, HbA1c, medication, labs, and complications in one place.",
    built: true,
  },
  {
    key: "obesity",
    href: MARKETING_ROUTES.obesity,
    title: "Weight Health",
    description: "Weight tracking, a lifestyle plan, and doctor review, together on one record.",
    built: true,
  },
  {
    key: "parentcare",
    href: MARKETING_ROUTES.parentcare,
    title: "Caring for a parent",
    description: "Know how your parent is doing, even when you are not there every day.",
    built: true,
  },
  {
    key: "prevention",
    href: MARKETING_ROUTES.prevention,
    title: "Preventive Health",
    description: "For healthy people: screenings, vaccinations, and yearly checks that keep you that way.",
    built: true,
  },
  {
    key: "medication",
    href: MARKETING_ROUTES.medication,
    title: "Medication",
    description: "Reduce missed doses and avoid running out of medication.",
    built: true,
  },
  {
    key: "labs",
    href: MARKETING_ROUTES.labs,
    title: "Labs",
    description: "Know what tests are due, take the request to any lab, and track follow-up.",
    built: true,
  },
];

export const PROOF_STATS = [
  {
    value: "4",
    label: "priority programmes",
    detail: "Hypertension, diabetes, weight management, and preventive health.",
  },
  {
    value: "1",
    label: "place to message your care team",
    detail: "Send a message any time in the app and a real person on your care team replies there, no separate number to remember.",
  },
  {
    value: "4",
    label: "escalation levels",
    detail: "Routine review through emergency escalation, matched to what's needed.",
  },
  {
    value: "1",
    label: "shared record",
    detail: "Chronic care, prevention, medication, and labs together, in one place.",
  },
] as const;

/** Preventive health is a platform wedge, not a secondary add-on (FEATURE_SPEC Cat 2→1 upgrade).
 * Framed for the HEALTHY visitor first (prevention-first repositioning,
 * 2026-07-23): staying well is the aspiration; catching things early is the
 * safety net, not a fear pitch. */
export const PREVENTION_CALLOUT = {
  title: "Healthy? Tarragon is built for you too",
  body:
    "You don't need a diagnosis to belong here. Care Pass builds you and your children a personal screening and vaccination calendar and a yearly Health Check: most years, that's simply confirmation you're doing fine, and if something's ever found, a doctor follows up the same day.",
} as const;

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

export const HOW_IT_WORKS_STEPS = [
  { step: 1, title: "Sign up", body: "Create your account in minutes, for yourself or a loved one." },
  { step: 2, title: "Onboard", body: "Share your health history and what you want Tarragon to watch." },
  { step: 3, title: "Monitor", body: "Log vitals, take medication, and complete preventive checks." },
  { step: 4, title: "Care protocol checks", body: "Every reading you log is checked against care protocols automatically." },
  { step: 5, title: "Doctor escalation", body: "When closer care is needed, we escalate; you are never alone." },
  {
    step: 6,
    title: "Family updates (optional)",
    body: "Name someone as your next of kin and they can follow your care and be called first if something urgent comes up. You choose, and you can withdraw it at any time.",
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
    title: "Track your health without carrying it alone.",
    body: "Blood pressure, blood sugar, weight, medication, lab checks, and preventive reminders, in one secure place, with a doctor behind it when you need one.",
    points: [
      "BP, glucose, and weight logging with trend review",
      "Medication reminders and refill alerts",
      "Scheduled doctor check-in, doctor escalation when needed",
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
    title: "You don't need a diagnosis to belong here.",
    body: "Care Pass builds a personal screening and vaccination calendar matched to your age, sex, and history, books the checks when they're due, and explains what your results mean. Most years, that's simply confirmation you're doing fine.",
    points: [
      "Screening and vaccination calendar, built for you",
      "Yearly Health Check, booked in minutes",
      "Doctor follow-up the same day, if a result ever needs it",
    ],
    stats: [
      { label: "Next screening due", value: "Cervical · 4 mths" },
      { label: "Vaccinations", value: "", pill: { text: "Up to date", tone: "green" } },
      { label: "Last Health Check", value: "All clear" },
      { label: "Education completed", value: "3 of 5 topics" },
    ],
    cta: { label: "Explore preventive care", href: MARKETING_ROUTES.prevention },
  },
  {
    key: "family",
    tabLabel: "For families",
    title: "Know how your parent is doing, even from far away.",
    body: "Follow Mum's blood pressure, Dad's medication and their preventive checks without taking over their record. They keep their own account and name you as next of kin, so what you can see is something they chose to share.",
    points: [
      "Is my parent okay today? Green, amber, or red.",
      "Are they taking their medication?",
      "Is anything overdue: labs, refills, review?",
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
    title: "Know your workforce health risks before they become costs.",
    body: "Corporate wellness reports that surface chronic disease risk and care gaps, described clearly, acted on early.",
    points: [
      "Staff enrolment and annual health checks",
      "Anonymised risk dashboard by cohort",
      "Screening compliance reporting for HR",
    ],
    stats: [
      { label: "Pre-diabetic (workforce)", value: "", pill: { text: "12%", tone: "amber" } },
      { label: "Uncontrolled BP", value: "", pill: { text: "8%", tone: "red" } },
      { label: "Cervical screening overdue", value: "60 employees" },
      { label: "Urgent follow-up needed", value: "25 employees" },
    ],
    cta: { label: "See corporate health plans", href: MARKETING_ROUTES.corporate },
  },
  {
    key: "hmo",
    tabLabel: "For HMOs",
    title: "We don't just manage chronic disease. We catch it earlier, and prove it.",
    body: "Member monitoring, care-gap closure, and outcome evidence, so you can show what proactive care delivers.",
    points: [
      "Population risk stratification, live",
      "Care gap closure tracked to completion",
      "Outcome reporting built for renewal conversations",
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
      "TarragonHealth is a health monitoring platform for chronic disease (hypertension, diabetes, and weight management), preventive health, and family care coordination in Nigeria, with clinical review and escalation built in.",
  },
  {
    category: "general",
    question: "I'm healthy, is Tarragon for me?",
    answer:
      "Yes: prevention is half of what Tarragon does. A personal screening and vaccination calendar, a yearly health check, and education matched to you keep healthy people healthy. Most members just get confirmation each year that all is well; if a check ever finds something, a doctor follows up the same day.",
  },
  {
    category: "general",
    question: "Can I use Tarragon for my parent while I live abroad?",
    answer:
      "Yes. Your relative holds their own Tarragon account and names you as next of kin, so you can follow their care and be contacted first if something urgent comes up. You can pay for their plan from anywhere; the tests and refills themselves are still paid directly to whichever laboratory or pharmacy they use in Nigeria, at their price.",
  },
  {
    category: "general",
    question: "How much does it cost?",
    answer:
      "Pricing is shown clearly with no hidden costs. Some services are included, some you pay directly to a laboratory or pharmacy you choose (we take nothing on those), and some are add-ons. See the pricing page for every plan and add-on in full.",
  },
  {
    category: "general",
    question: "How do I log my blood pressure, glucose, or weight?",
    answer:
      "You log readings through the Tarragon app or web dashboard, so your record stays accurate and secure. WhatsApp and SMS send you reminders and alerts, and you can message your care team any time in the app for support. Logging itself happens on app or web.",
  },
  {
    category: "general",
    question: "Can I connect a fitness tracker, smartwatch, or Bluetooth device?",
    answer:
      "That's part of the platform, and we're bringing connections online one at a time: Apple Health, Health Connect, and trackers including Fitbit, Garmin, Oura, WHOOP, and Dexcom. Manual logging works today, in seconds, on every plan, so you're never waiting on a connection to keep your record current.",
  },
  {
    category: "general",
    question: "Do I need a smartphone?",
    answer:
      "You need a smartphone or computer to use the app or web dashboard, where your health record, care actions, and messages with your care team all live. WhatsApp and SMS still bring you reminders and alerts.",
  },
  {
    category: "general",
    question: "Is there a Tarragon app?",
    answer:
      "Yes. Open Tarragon in your phone's browser and add it to your home screen (Safari's Share menu on iPhone, Chrome's Install option on Android). It opens like a regular app, with no app-store download needed.",
  },
  {
    category: "general",
    question: "Will my health data be kept private?",
    answer:
      "Your health record is protected by access controls enforced at the database level: only your own care team can see it, and it's never shared with an employer, insurer, or anyone else without your consent. If a relative or institution has visibility into your care, it's because you specifically granted it, not by default.",
  },
  {
    category: "general",
    question: "What if I'm not comfortable with health tech?",
    answer:
      "You don't need to be. Adding Tarragon to your home screen takes one tap and no app-store account, logging a reading takes seconds, and WhatsApp or SMS will still remind you when something's due. If you ever get stuck, you can message your care team directly in the app and a person answers.",
  },
  {
    category: "general",
    question: "I don't have time for another health app.",
    answer:
      "You won't need much. Logging a blood pressure reading, a glucose check, or your weight takes under a minute in the app. WhatsApp or SMS tells you when something's due, and your care team does the reviewing in the background, not you. There's no daily routine to keep up, just a few seconds whenever a reading's due.",
  },
  {
    category: "clinical",
    question: "What happens when readings are high?",
    answer:
      "Your readings are reviewed against care protocols. If they need attention, your care team follows up and escalates to a doctor when closer care is needed.",
  },
  {
    category: "clinical",
    question: "What's the difference between my Health Score and my Annual Health Check?",
    answer:
      "Your Health Score is a quick, non-diagnostic read on a handful of things already on your record: blood pressure control, HbA1c, weight, smoking status, and whether you're keeping up with screenings and vaccinations. It updates whenever you log something new, so you can see the effect of what you're actually doing day to day. Your Annual Health Check (or Comprehensive Screen) is the wider, once-a-year safety net: a fuller panel covering areas your Health Score isn't built to see, so nothing important gets missed just because it wasn't one of the things being tracked daily. Anything it flags reaches a doctor the same day.",
  },
  {
    category: "clinical",
    question: "What about preventive checks and screening results?",
    answer:
      "Tarragon tracks what checks may be due, reminds you to complete them, and reviews results when they come back. An abnormal screening result triggers doctor follow-up and can upgrade you into chronic care monitoring when needed.",
  },
  {
    category: "clinical",
    question: "Does Tarragon replace my doctor?",
    answer:
      "No. Tarragon is the layer that keeps watching between visits: logging your numbers, reviewing them against care protocols, and coordinating labs, pharmacies, and specialist referrals on one record. Every review and escalation is still a real doctor's clinical judgement, made by the team of MDCN-registered doctors Tarragon employs, not an app or an algorithm on its own.",
  },
  {
    category: "clinical",
    question: "Is a real doctor actually reviewing my results?",
    answer:
      "Yes. Any result, escalation, or verified document that shows a doctor's name reflects a real review by a real doctor on that date, never a placeholder. Care is delivered by a team with coverage shared across shifts, so it won't always be the same individual, but every review is still genuinely theirs.",
  },
] as const;

export const FAQ_CATEGORY_LABEL: Record<(typeof HOMEPAGE_FAQS)[number]["category"], string> = {
  general: "General",
  clinical: "Clinical & trust",
};
