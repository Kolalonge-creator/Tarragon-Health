import type { Metadata } from "next";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export type ProductPageContent = {
  slug: string;
  headline: string;
  campaignLine?: string;
  intro: string;
  howItWorks: { title: string; body: string }[];
  metadata: Metadata;
};

export const PRODUCT_PAGES: Record<string, ProductPageContent> = {
  hypertension: {
    slug: "hypertension",
    headline: "Stay ahead of high blood pressure before it causes complications.",
    campaignLine: "High blood pressure needs follow-up, not guesswork.",
    intro:
      "Tarragon helps you log blood pressure readings, spot trends early, and get clinician review when numbers drift. Reminders keep follow-up consistent — between doctor visits, not just at them.",
    howItWorks: [
      {
        title: "Log readings easily",
        body: "Record blood pressure via app or WhatsApp — readings stay in one secure record.",
      },
      {
        title: "See your trend",
        body: "Track how your numbers change over weeks, not just single visits.",
      },
      {
        title: "Clinician review & escalation",
        body: "When readings need attention, a nurse-led team follows up and escalates to a doctor if needed.",
      },
    ],
    metadata: {
      title: "Hypertension Monitoring — TarragonHealth",
      description:
        "Clinician-led blood pressure monitoring with reminders, trend tracking, and escalation when closer care is needed.",
    },
  },
  diabetes: {
    slug: "diabetes",
    headline: "Track glucose, HbA1c, medication, labs, and complications in one place.",
    campaignLine: "Diabetes care is more than sugar checks.",
    intro:
      "Tarragon brings glucose logs, HbA1c tracking, medication adherence, and lab coordination into one platform — with nurse review when your numbers need a closer look.",
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
        body: "Persistent highs or missed follow-ups trigger clinician review — calm, not alarming.",
      },
    ],
    metadata: {
      title: "Diabetes Monitoring — TarragonHealth",
      description:
        "Track glucose, HbA1c, medication, and labs in one clinician-led platform with escalation when closer care is needed.",
    },
  },
  parentcare: {
    slug: "parentcare",
    headline: "Know how your parent is doing, even when you are not there every day.",
    campaignLine: "Your parents looked after you. Now help look after them.",
    intro:
      "ParentCare keeps you connected to Mum or Dad's health — vitals, medication, preventive checks, and calm updates — whether you live in Lagos or London.",
    howItWorks: [
      {
        title: "Set up their care profile",
        body: "Onboard your parent with their conditions, medications, and what you want monitored.",
      },
      {
        title: "Stay informed",
        body: "Receive clear updates on readings, reminders, and clinician follow-ups.",
      },
      {
        title: "Escalate with confidence",
        body: "When something needs attention, Tarragon's team handles review and escalation — you stay in the loop.",
      },
    ],
    metadata: {
      title: "ParentCare — TarragonHealth",
      description:
        "Dedicated care coordination for your loved ones — vitals, medication, and calm family updates, near or far.",
    },
  },
};

export function getProductPage(slug: string): ProductPageContent | undefined {
  return PRODUCT_PAGES[slug];
}

export const PRICING_HREF = MARKETING_ROUTES.pricing;
