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
    title: "Obesity & Weight",
    description: "A structured, doctor-reviewed programme to manage weight and related conditions.",
    built: true,
  },
  {
    key: "parentcare",
    href: MARKETING_ROUTES.parentcare,
    title: "ParentCare",
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
    description: "Know what tests are due, book them, and track follow-up.",
    built: true,
  },
];

export const PROOF_STATS = [
  {
    value: "5",
    label: "priority programmes",
    detail: "Hypertension, diabetes, obesity, ParentCare, and preventive health.",
  },
  {
    value: "2",
    label: "ways to reach your care team",
    detail: "Message on WhatsApp or use the app/web dashboard, so support is never far away.",
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

export const WHAT_YOU_GET = [
  {
    title: "Monitor",
    body: "Log BP, glucose, weight, medication, and preventive checks through the app or web, all in one health record.",
  },
  {
    title: "Review",
    body: "Your care team watches your trends, screens for care gaps, and follows up when something needs attention, including abnormal results.",
  },
  {
    title: "Coordinate",
    body: "Preventive checks, labs, medication, and doctor escalation stay connected instead of scattered.",
  },
] as const;

/** Platform capabilities that sit alongside the 5 core programmes rather than
 * being a programme themselves — surfaced on the homepage as "More than
 * monitoring" so they're not buried inside a single product page. */
export const PLATFORM_EXTRAS = [
  {
    title: "The Health Wallet",
    body: "Top up a little at a time toward your Annual Health Check or care plan, or let a family member — in Nigeria or abroad — fund it for you directly. Refer a friend and you both get ₦500 wallet credit once they complete their first paid order.",
  },
  {
    title: "Talk to a doctor, your way",
    body: "Send a written question and get a doctor's reply within 24 hours, or book a 15-minute telemedicine video visit for a set time (₦10,000) — a video call, never an in-person visit. Your payment is only taken once a doctor accepts your slot, and refunded in full if none can.",
  },
  {
    title: "Take it with you",
    body: "Add Tarragon to your phone's home screen straight from your browser, so your dashboard opens like an app — no app store required.",
  },
] as const;

/** Preventive health is a platform wedge, not a secondary add-on (FEATURE_SPEC Cat 2→1 upgrade).
 * Framed for the HEALTHY visitor first (prevention-first repositioning,
 * 2026-07-23): staying well is the aspiration; catching things early is the
 * safety net, not a fear pitch. */
export const PREVENTION_CALLOUT = {
  title: "Healthy? Tarragon is built for you too",
  body:
    "You don't need a diagnosis to belong here. Tarragon Prevent gives you a personal screening and vaccination calendar, a yearly Health Check, and education that makes sense of your numbers — so most years, you simply get confirmation that all is well. And if a check ever finds something, a doctor follows up the same day and it's caught years earlier, when it's easiest to treat.",
} as const;

export const HOW_IT_WORKS_STEPS = [
  { step: 1, title: "Sign up", body: "Create your account in minutes, for yourself or a loved one." },
  { step: 2, title: "Onboard", body: "Share your health history and what you want Tarragon to watch." },
  { step: 3, title: "Monitor", body: "Log vitals, take medication, and complete preventive checks." },
  { step: 4, title: "Doctor review", body: "Your care team reviews your readings and follows up." },
  { step: 5, title: "Doctor escalation", body: "When closer care is needed, we escalate; you are never alone." },
  {
    step: 6,
    title: "Family updates (optional)",
    body: "On ParentCare, family can opt in to calm, clear updates about a loved one, near or far. Not on by default, and only for those who choose it.",
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
      "Monthly doctor check-in, doctor escalation when needed",
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
    body: "Tarragon Prevent builds a personal screening and vaccination calendar matched to your age, sex, and history, books the checks when they're due, and explains what your results mean. Most years, that's simply confirmation you're doing fine.",
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
    cta: { label: "Explore Tarragon Prevent", href: MARKETING_ROUTES.prevention },
  },
  {
    key: "family",
    tabLabel: "For families",
    title: "Know how your parent is doing, even from far away.",
    body: "With ParentCare, track Mum's blood pressure, Dad's medication, and preventive checks, with opt-in updates that feel human, not clinical. Family updates are a ParentCare feature you choose, not something every plan sends.",
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
    cta: { label: "Explore ParentCare", href: MARKETING_ROUTES.parentcare },
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

// Ordered most-asked first: the homepage surfaces the top 4 and links out to
// the rest (pricing FAQ + contact); the full set stays here as the source.
export const HOMEPAGE_FAQS = [
  {
    question: "What is Tarragon Health?",
    answer:
      "TarragonHealth is a health monitoring platform for chronic disease (hypertension, diabetes, and obesity), preventive health, and family care coordination in Nigeria, with clinical review and escalation built in.",
  },
  {
    question: "I'm healthy — is Tarragon for me?",
    answer:
      "Yes — prevention is half of what Tarragon does. A personal screening and vaccination calendar, a yearly health check, and education matched to you keep healthy people healthy. Most members just get confirmation each year that all is well; if a check ever finds something, a doctor follows up the same day.",
  },
  {
    question: "What happens when readings are high?",
    answer:
      "Your readings are reviewed against care protocols. If they need attention, your care team follows up and escalates to a doctor when closer care is needed.",
  },
  {
    question: "Can I use Tarragon for my parent while I live abroad?",
    answer:
      "Yes. ParentCare is built for families who want calm updates and care coordination for loved ones in Nigeria.",
  },
  {
    question: "How much does it cost?",
    answer:
      "Pricing is shown clearly with no hidden costs. Some services are included, some are book-and-pay through partners, and some are add-ons. See the pricing page for every plan and add-on in full.",
  },
  {
    question: "How do I log my blood pressure, glucose, or weight?",
    answer:
      "You log readings through the Tarragon app or web dashboard, so your record stays accurate and secure. WhatsApp and SMS send you reminders and alerts, and you can message your care team on WhatsApp for support. Logging itself happens on app or web.",
  },
  {
    question: "What about preventive checks and screening results?",
    answer:
      "Tarragon tracks what checks may be due, reminds you to complete them, and reviews results when they come back. An abnormal screening result triggers doctor follow-up and can upgrade you into chronic care monitoring when needed.",
  },
  {
    question: "Do I need a smartphone?",
    answer:
      "You need a smartphone or computer to use the app or web dashboard, where your health record and care actions live. WhatsApp and SMS still bring you reminders, alerts, and a way to message your care team for support.",
  },
  {
    question: "Is there a Tarragon app?",
    answer:
      "Yes — open Tarragon in your phone's browser and add it to your home screen (Safari's Share menu on iPhone, Chrome's Install option on Android). It opens like a regular app, with no app-store download needed.",
  },
] as const;
