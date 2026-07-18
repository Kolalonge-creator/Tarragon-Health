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
    headline: "Find care gaps early and know what checks may be due.",
    campaignLine: "The best emergency is the one you prevent.",
    intro:
      "Preventive health is one of Tarragon's four priority programmes, not an optional extra. We track overdue screenings, remind you what checks are due, review results when they return, and connect abnormal findings into chronic care follow-up on the same health record.",
    included: [
      "Preventive screening calendar and care-gap tracking",
      "Reminders for cancer, metabolic, infectious, and reproductive checks",
      "Lab coordination when tests are due",
      "Doctor review when results need attention",
      "Upgrade path into chronic disease monitoring when follow-up is needed",
    ],
    howItWorks: [
      {
        title: "Know what's due",
        body: "See which preventive checks are overdue or coming up, based on your age, history, and risk profile.",
      },
      {
        title: "Complete and track",
        body: "Book labs through Tarragon's partner network and log results in one record; no more lost reports.",
      },
      {
        title: "Close the loop",
        body: "When a result needs attention, your care team follows up immediately and connects you to chronic care if needed.",
      },
    ],
    metadata: {
      title: "Preventive Health",
      description:
        "Find care gaps early, complete overdue screenings, and get doctor follow-up when results need attention, on the same record as chronic care.",
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
  return PRODUCT_PAGES[slug];
}

export const PRICING_HREF = MARKETING_ROUTES.pricing;
