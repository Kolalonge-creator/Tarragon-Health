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
      "Tarragon helps you log blood pressure readings, spot trends early, and get clinician review when numbers drift. Reminders keep follow-up consistent — between doctor visits, not just at them.",
    included: [
      "BP logging via WhatsApp or app",
      "Trend view for you and your care team",
      "Medication and follow-up reminders",
      "Nurse review when readings drift",
      "Doctor escalation when closer care is needed",
    ],
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
    included: [
      "Glucose and HbA1c tracking",
      "Medication reminders and adherence support",
      "Lab result follow-up in the same record",
      "Complication screening prompts",
      "Clinician review when trends need attention",
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
    included: [
      "Parent health profile and monitoring goals",
      "Vitals, medication, and preventive check tracking",
      "Calm family updates for loved ones near or abroad",
      "Nurse follow-up when readings or care gaps need attention",
      "Escalation support when closer care is needed",
    ],
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
  prevention: {
    slug: "prevention",
    headline: "Find care gaps early and know what checks may be due.",
    campaignLine: "The best emergency is the one you prevent.",
    intro:
      "Preventive health is one of Tarragon's four priority programmes — not an optional extra. We track overdue screenings, remind you what checks are due, review results when they return, and connect abnormal findings into chronic care follow-up on the same health record.",
    included: [
      "Preventive screening calendar and care-gap tracking",
      "Reminders for cancer, metabolic, infectious, and reproductive checks",
      "Lab coordination when tests are due",
      "Clinician review when results need attention",
      "Upgrade path into chronic disease monitoring when follow-up is needed",
    ],
    howItWorks: [
      {
        title: "Know what's due",
        body: "See which preventive checks are overdue or coming up — based on your age, history, and risk profile.",
      },
      {
        title: "Complete and track",
        body: "Book labs through Tarragon's partner network and log results in one record — no more lost reports.",
      },
      {
        title: "Close the loop",
        body: "When a result needs attention, a clinician-led team follows up immediately and connects you to chronic care if needed.",
      },
    ],
    metadata: {
      title: "Preventive Health — TarragonHealth",
      description:
        "Find care gaps early, complete overdue screenings, and get clinician follow-up when results need attention — on the same record as chronic care.",
    },
  },
};

export function getProductPage(slug: string): ProductPageContent | undefined {
  return PRODUCT_PAGES[slug];
}

export const PRICING_HREF = MARKETING_ROUTES.pricing;
