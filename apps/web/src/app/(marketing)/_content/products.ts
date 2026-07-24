import type { Metadata } from "next";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export type ProductPageContent = {
  slug: string;
  headline: string;
  campaignLine?: string;
  intro: string;
  included: string[];
  howItWorks: { title: string; body: string }[];
  metadata: Metadata;
};

export const PRODUCT_PAGES: Record<string, ProductPageContent> = {
  hypertension: {
    slug: "hypertension",
    headline: "Stay ahead of high blood pressure before it causes complications.",
    campaignLine: "High blood pressure needs follow-up, not guesswork.",
    intro:
      "Tarragon helps you log blood pressure readings, spot trends early, and get doctor review when numbers drift. Reminders keep follow-up consistent between doctor visits, not just at them.",
    included: [
      "BP logging via app or web",
      "Trend view for you and your care team",
      "Medication and follow-up reminders",
      "Doctor review when readings drift",
      "Doctor escalation when closer care is needed",
    ],
    howItWorks: [
      {
        title: "Log readings easily",
        body: "Record blood pressure via app or web; readings stay in one secure record.",
      },
      {
        title: "See your trend",
        body: "Track how your numbers change over weeks, not just single visits.",
      },
      {
        title: "Doctor review & escalation",
        body: "When readings need attention, your care team follows up and escalates to a doctor if needed.",
      },
    ],
    metadata: {
      title: "Hypertension Monitoring",
      description:
        "Blood pressure monitoring with reminders, trend tracking, and escalation when closer care is needed.",
    },
  },
  diabetes: {
    slug: "diabetes",
    headline: "Track glucose, HbA1c, medication, labs, and complications in one place.",
    campaignLine: "Diabetes care is more than sugar checks.",
    intro:
      "Tarragon brings glucose logs, HbA1c tracking, medication adherence, and lab coordination into one platform, with doctor review when your numbers need a closer look.",
    included: [
      "Glucose and HbA1c tracking",
      "Medication reminders and adherence support",
      "Lab result follow-up in the same record",
      "Complication screening prompts",
      "Doctor review when trends need attention",
    ],
    howItWorks: [
      {
        title: "Monitor what matters",
        body: "Log glucose, track HbA1c results, and keep medication on schedule.",
      },
      {
        title: "Coordinate labs",
        body: "Know when tests are due and follow up on results without losing track.",
      },
      {
        title: "Escalate when needed",
        body: "Persistent highs or missed follow-ups trigger doctor review, calm, not alarming.",
      },
    ],
    metadata: {
      title: "Diabetes Monitoring",
      description:
        "Track glucose, HbA1c, medication, and labs in one platform, with escalation when closer care is needed.",
    },
  },
  obesity: {
    slug: "obesity",
    headline: "A supported, doctor-reviewed programme to manage weight and the health that comes with it.",
    campaignLine: "Weight is a health condition, managed with real support.",
    intro:
      "Tarragon's obesity programme brings weight tracking, a lifestyle plan, related-condition monitoring, and doctor review onto one record. It's a structured, followed-up programme, not a diet, with your care team checking in and escalating when closer care is needed.",
    included: [
      "Weight and waist tracking on one record",
      "A personalised lifestyle and activity plan",
      "Monitoring for related conditions like blood pressure and blood sugar",
      "Regular check-ins and progress reviews",
      "Doctor review, with escalation when closer care is needed",
    ],
    howItWorks: [
      {
        title: "Set a plan together",
        body: "Your care team reviews your history and helps set realistic goals on a structured programme.",
      },
      {
        title: "Track and stay supported",
        body: "Log weight and habits, get check-ins, and keep related conditions monitored on the same record.",
      },
      {
        title: "Review and escalate",
        body: "Progress is reviewed against care protocols, and closer care is arranged through a defined pathway when it's needed.",
      },
    ],
    metadata: {
      title: "Obesity & Weight Management",
      description:
        "A structured, doctor-reviewed obesity programme: weight tracking, a lifestyle plan, related-condition monitoring, and escalation when closer care is needed.",
    },
  },
  parentcare: {
    slug: "parentcare",
    headline: "Know how your parent is doing, even when you are not there every day.",
    campaignLine: "Your parents looked after you. Now help look after them.",
    intro:
      "ParentCare keeps you connected to Mum or Dad's health: vitals, medication, preventive checks, and calm updates, whether you live in Lagos or London.",
    included: [
      "Parent health profile and monitoring goals",
      "Vitals, medication, and preventive check tracking",
      "Calm family updates for loved ones near or abroad",
      "Doctor follow-up when readings or care gaps need attention",
      "Escalation support when closer care is needed",
    ],
    howItWorks: [
      {
        title: "Set up their care profile",
        body: "Onboard your parent with their conditions, medications, and what you want monitored.",
      },
      {
        title: "Stay informed",
        body: "Receive clear updates on readings, reminders, and doctor follow-ups.",
      },
      {
        title: "Escalate with confidence",
        body: "When something needs attention, Tarragon's team handles review and escalation; you stay in the loop.",
      },
    ],
    metadata: {
      title: "ParentCare",
      description:
        "Dedicated care coordination for your loved ones: vitals, medication, and calm family updates, near or far.",
    },
  },
  prevention: {
    slug: "prevention",
    headline: "Healthy today? Let's keep it that way.",
    campaignLine: "The best emergency is the one you prevent.",
    intro:
      "You don't need a diagnosis to use Tarragon: prevention is one of our five priority programmes, built for people who feel fine and want to stay that way. A screening and vaccination calendar matched to your age, sex, and history; a yearly Health Check; and education that makes sense of your numbers. Most years, you'll simply get confirmation that all is well. If a check ever finds something, a doctor follows up the same day, years earlier than it would otherwise have been caught.",
    included: [
      "Personal screening calendar: cancer, metabolic, infectious, and reproductive checks matched to you",
      "Vaccination schedule, booking, and doctor-verified certificates",
      "The Annual Health Check (₦65,000): full-body screening, bookable by anyone on any plan",
      "Personalised health education with short knowledge checks",
      "Doctor follow-up the same day on any result that needs attention",
      "A seamless path into chronic care monitoring in the rare case follow-up is needed: same record, no starting over",
    ],
    howItWorks: [
      {
        title: "Know what's due",
        body: "Two minutes on your health profile builds your personal calendar: which checks and vaccines matter for you, and when.",
      },
      {
        title: "Complete and track",
        body: "Book screenings at partner labs near you, see exact prices before you confirm, and keep every result in one record; no more lost reports.",
      },
      {
        title: "Stay confidently well",
        body: "Most results confirm you're on track. When one doesn't, your care team follows up immediately, and because it's caught early, your options are better and cheaper.",
      },
    ],
    metadata: {
      title: "Preventive Health",
      description:
        "Prevention for healthy people: a personal screening and vaccination calendar, yearly health checks, and education, with doctor follow-up the same day if a result needs attention.",
    },
  },
  medication: {
    slug: "medication",
    headline: "Reduce missed doses and avoid running out of medication.",
    intro:
      "Tarragon keeps your medication schedule in the same record as your vitals and labs: reminders on WhatsApp or app, refill alerts before you run out, and a care team that follows up when doses are missed.",
    included: [
      "Medication schedule built into your health record",
      "WhatsApp and app reminders for every dose",
      "Refill alerts before you run out",
      "Pharmacy partner network for booking a refill",
      "Doctor follow-up when doses are missed",
    ],
    howItWorks: [
      {
        title: "Set up your medication list",
        body: "Add what you take and when, as part of onboarding or any time your prescription changes.",
      },
      {
        title: "Get reminded, log it in the app",
        body: "A WhatsApp or app reminder lands at the right time; logging your dose in the app takes seconds and keeps your record accurate.",
      },
      {
        title: "Never run out, never go quiet",
        body: "Refill alerts arrive before you're out, and a doctor checks in if doses are consistently missed.",
      },
    ],
    metadata: {
      title: "Medication Support",
      description:
        "Medication reminders, refill alerts, and adherence follow-up, on WhatsApp or app, in the same record as the rest of your care.",
    },
  },
  labs: {
    slug: "labs",
    headline: "Know what tests are due, book them, and track follow-up.",
    intro:
      "Lab work is where care between visits most often goes quiet. Tarragon keeps a running calendar of what's due, books it through a trusted partner network, and makes sure every result is reviewed, not just filed away.",
    included: [
      "Lab calendar synced to your chronic and preventive record",
      "Booking through Tarragon's trusted lab partner network",
      "Results explained in plain language, not jargon",
      "Immediate doctor alert for abnormal results",
      "Follow-up tracked until the loop is closed",
    ],
    howItWorks: [
      {
        title: "Know what's due",
        body: "Your lab calendar reflects your conditions and screening timeline; no guessing what's overdue.",
      },
      {
        title: "Book with a trusted lab",
        body: "Book through Tarragon's partner network and keep every result in one record instead of scattered reports.",
      },
      {
        title: "Never lose a result",
        body: "A doctor reviews every result. Abnormal findings trigger immediate follow-up; never a forgotten report.",
      },
    ],
    metadata: {
      title: "Lab Coordination",
      description:
        "Know what lab tests are due, book them through a trusted partner network, and get doctor follow-up on every result.",
    },
  },
};

export function getProductPage(slug: string): ProductPageContent | undefined {
  const page = PRODUCT_PAGES[slug];
  if (!page) return undefined;
  // Inject the per-page canonical from the slug so every programme page
  // self-canonicalises (the slug matches its marketing route: /hypertension …).
  return {
    ...page,
    metadata: { ...page.metadata, alternates: { canonical: `/${page.slug}` } },
  };
}

export const PRICING_HREF = MARKETING_ROUTES.pricing;
