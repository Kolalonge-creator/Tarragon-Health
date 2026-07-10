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
    built: false,
  },
  {
    key: "labs",
    href: MARKETING_ROUTES.labs,
    title: "Labs",
    description: "Know what tests are due, book them, and track follow-up.",
    built: false,
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
    body: "A clinician-led team watches your trends, screens for care gaps, and follows up when something needs attention — including abnormal results.",
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
  { step: 4, title: "Nurse review", body: "A clinician-led team reviews your readings and follows up." },
  { step: 5, title: "Doctor escalation", body: "When closer care is needed, we escalate — you are never alone." },
  { step: 6, title: "Family updates", body: "Keep family informed with calm, clear updates — near or far." },
] as const;

export const AUDIENCE_BLOCKS = [
  {
    title: "For families",
    message: "Peace of mind for the people you love.",
    body: "Track Mum's blood pressure, Dad's medication, and preventive checks — with updates that feel human, not clinical.",
    cta: null,
  },
  {
    title: "For employers",
    message: "Know your workforce health risks before they become costs.",
    body: "Corporate wellness reports that surface chronic disease risk and care gaps — described clearly, acted on early.",
    cta: { label: "Request employer health plan", href: MARKETING_ROUTES.contact, source: "corporate" },
  },
  {
    title: "For HMOs",
    message: "Close care gaps. Monitor risk. Prove outcomes.",
    body: "Member monitoring, care-gap closure, and outcome evidence — so you can show what proactive care delivers.",
    cta: { label: "Talk to Tarragon Health", href: MARKETING_ROUTES.contact, source: "hmo" },
  },
] as const;

export const HOMEPAGE_FAQS = [
  {
    question: "What is Tarragon Health?",
    answer:
      "TarragonHealth is a clinician-led monitoring platform for chronic disease, preventive health, and family care coordination in Nigeria.",
  },
  {
    question: "How do I log my blood pressure or glucose?",
    answer:
      "You can log readings through WhatsApp or the app/web dashboard. Tarragon is designed so patient actions are not app-only.",
  },
  {
    question: "What happens when readings are high?",
    answer:
      "Your readings are reviewed against care protocols. If they need attention, the nurse-led team follows up and escalates to a doctor when closer care is needed.",
  },
  {
    question: "What about preventive checks and screening results?",
    answer:
      "Tarragon tracks what checks may be due, reminds you to complete them, and reviews results when they come back. An abnormal screening result triggers clinician follow-up and can upgrade you into chronic care monitoring when needed.",
  },
  {
    question: "Can I use Tarragon for my parent while I live abroad?",
    answer:
      "Yes. ParentCare is built for families who want calm updates and care coordination for loved ones in Nigeria.",
  },
  {
    question: "Do I need a smartphone?",
    answer:
      "No. WhatsApp-first workflows are part of the platform, and SMS fallback is part of Tarragon's wider delivery model.",
  },
  {
    question: "How much does it cost?",
    answer:
      "Pricing will be shown clearly with no hidden costs. Some services are included, some are book-and-pay through partners, and some are add-ons.",
  },
] as const;
