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
    description: "Find care gaps early, complete overdue checks, and act before crisis.",
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
    value: "4",
    label: "priority programmes",
    detail: "Hypertension, diabetes, ParentCare, and preventive health.",
  },
  {
    value: "2",
    label: "ways to log",
    detail: "WhatsApp and app/web, so care is not app-only.",
  },
  {
    value: "4",
    label: "escalation levels",
    detail: "Routine follow-up through doctor escalation.",
  },
  {
    value: "1",
    label: "shared record",
    detail: "Chronic care, prevention, labs, and family updates together.",
  },
] as const;

export const WHAT_YOU_GET = [
  {
    title: "Monitor",
    body: "Log BP, glucose, medication, and preventive checks through WhatsApp or app — all in one health record.",
  },
  {
    title: "Review",
    body: "A doctor-led team watches your trends, screens for care gaps, and follows up when something needs attention — including abnormal results.",
  },
  {
    title: "Coordinate",
    body: "Preventive checks, labs, medication, doctor escalation, and family updates stay connected instead of scattered.",
  },
] as const;

/** Preventive health is a platform wedge — not a secondary add-on (FEATURE_SPEC Cat 2→1 upgrade). */
export const PREVENTION_CALLOUT = {
  title: "Preventive health is core to how Tarragon works",
  body:
    "Screening and care-gap closure are not extras bolted onto chronic care. They share the same patient record, and when a result needs attention, Tarragon closes the loop into follow-up and chronic management — not a forgotten lab report.",
} as const;

export const HOW_IT_WORKS_STEPS = [
  { step: 1, title: "Sign up", body: "Create your account in minutes — for yourself or a loved one." },
  { step: 2, title: "Onboard", body: "Share your health history and what you want Tarragon to watch." },
  { step: 3, title: "Monitor", body: "Log vitals, take medication, and complete preventive checks." },
  { step: 4, title: "Doctor review", body: "A doctor-led team reviews your readings and follows up." },
  { step: 5, title: "Doctor escalation", body: "When closer care is needed, we escalate — you are never alone." },
  { step: 6, title: "Family updates", body: "Keep family informed with calm, clear updates — near or far." },
] as const;

export type AudienceStat = {
  label: string;
  value: string;
  pill?: { text: string; tone: "green" | "amber" | "red" };
};

export type AudienceTab = {
  key: "patient" | "family" | "corporate" | "hmo";
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
    body: "Blood pressure, blood sugar, medication, lab checks, and preventive reminders — in one secure place, with a doctor behind it when you need one.",
    points: [
      "BP and glucose logging with trend review",
      "Medication reminders and refill alerts",
      "Monthly doctor check-in, doctor escalation when needed",
    ],
    stats: [
      { label: "Blood pressure", value: "124 / 79", pill: { text: "In range", tone: "green" } },
      { label: "Medication adherence", value: "92%" },
      { label: "Next lab due", value: "HbA1c · 3 wks" },
      { label: "Care gap", value: "", pill: { text: "1 overdue", tone: "amber" } },
    ],
    cta: null,
  },
  {
    key: "family",
    tabLabel: "For families",
    title: "Know how your parent is doing, even from far away.",
    body: "Track Mum's blood pressure, Dad's medication, and preventive checks — with updates that feel human, not clinical.",
    points: [
      "Is my parent okay today? Green, amber, or red.",
      "Are they taking their medication?",
      "Is anything overdue — labs, refills, review?",
    ],
    stats: [
      { label: "Dad — today's status", value: "", pill: { text: "Stable", tone: "green" } },
      { label: "Medication", value: "Taken, 8:02am" },
      { label: "This week's readings", value: "Stable trend" },
      { label: "Overdue", value: "", pill: { text: "Nothing", tone: "green" } },
    ],
    cta: null,
  },
  {
    key: "corporate",
    tabLabel: "For employers",
    title: "Know your workforce health risks before they become costs.",
    body: "Corporate wellness reports that surface chronic disease risk and care gaps — described clearly, acted on early.",
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
    title: "We don't just manage chronic disease. We catch it earlier — and prove it.",
    body: "Member monitoring, care-gap closure, and outcome evidence — so you can show what proactive care delivers.",
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

export const HOMEPAGE_FAQS = [
  {
    question: "What is Tarragon Health?",
    answer:
      "TarragonHealth is a doctor-led monitoring platform for chronic disease, preventive health, and family care coordination in Nigeria.",
  },
  {
    question: "How do I log my blood pressure or glucose?",
    answer:
      "You log readings through the Tarragon app or web dashboard, so your record stays accurate and secure. WhatsApp and SMS send you reminders and alerts, and you can message your care team on WhatsApp for support — but logging itself happens on app or web.",
  },
  {
    question: "What happens when readings are high?",
    answer:
      "Your readings are reviewed against care protocols. If they need attention, the doctor-led team follows up and escalates to a doctor when closer care is needed.",
  },
  {
    question: "What about preventive checks and screening results?",
    answer:
      "Tarragon tracks what checks may be due, reminds you to complete them, and reviews results when they come back. An abnormal screening result triggers doctor follow-up and can upgrade you into chronic care monitoring when needed.",
  },
  {
    question: "Can I use Tarragon for my parent while I live abroad?",
    answer:
      "Yes. ParentCare is built for families who want calm updates and care coordination for loved ones in Nigeria.",
  },
  {
    question: "Do I need a smartphone?",
    answer:
      "You need a smartphone or computer to use the app or web dashboard, where your health record and care actions live. WhatsApp and SMS still bring you reminders, alerts, and a way to message your care team for support.",
  },
  {
    question: "How much does it cost?",
    answer:
      "Pricing will be shown clearly with no hidden costs. Some services are included, some are book-and-pay through partners, and some are add-ons.",
  },
] as const;
