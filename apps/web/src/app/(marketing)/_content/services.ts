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
  {
    key: "prevention",
    href: MARKETING_ROUTES.prevention,
    title: "Prevention",
    description: "Find care gaps early and know what checks may be due.",
    built: false,
  },
];

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
