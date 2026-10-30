import type { Metadata } from "next";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

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
    headline: "Keep high blood pressure under control and lower your risk of stroke and heart disease.",
    campaignLine: "Hypertension is managed by regular measurement and review, not by guesswork.",
    intro:
      "Record your blood pressure at home, watch how it changes over weeks, and have a doctor review any readings that begin to rise. Reminders keep follow-up regular between clinic visits.",
    included: [
      "Home blood pressure recording through the app or website",
      "A trend chart that you and your care team can both read",
      "Reminders for medication and follow-up appointments",
      "Doctor review when your readings begin to rise",
      "Referral to a doctor for closer care when it is needed",
    ],
    howItWorks: [
      {
        title: "Record your readings",
        body: "Enter each blood pressure reading in the app or on the website. Every reading is stored in one secure record.",
      },
      {
        title: "Follow the trend",
        body: "One clinic reading says little. A run of readings over several weeks shows how well your blood pressure is controlled.",
      },
      {
        title: "A doctor steps in when needed",
        body: "If your readings stay high, your care team contacts you and refers you to a doctor.",
      },
    ],
    metadata: {
      title: "Hypertension Monitoring",
      description:
        "Home blood pressure monitoring with reminders, trend charts, and doctor review when readings stay high.",
    },
  },
  diabetes: {
    slug: "diabetes",
    headline: "Keep your blood glucose, HbA1c, medication and test results in one record.",
    campaignLine: "Good diabetes care involves more than checking blood sugar.",
    intro:
      "Diabetes affects the eyes, kidneys, nerves and heart over many years, so it needs steady attention. Tarragon keeps your glucose readings, HbA1c, medication and laboratory tests together, and a doctor reviews your results when they need a closer look.",
    included: [
      "Glucose and HbA1c tracking",
      "Medication reminders and support to take doses regularly",
      "Laboratory results followed up in the same record",
      "Prompts for the screening tests that detect complications early",
      "Doctor review when a trend needs attention",
    ],
    howItWorks: [
      {
        title: "Measure what matters",
        body: "Record your glucose readings, add each HbA1c result, and keep your medication on schedule.",
      },
      {
        title: "Stay on top of tests",
        body: "See which tests are due, and have each result followed up so none is overlooked.",
      },
      {
        title: "Get a doctor's review when needed",
        body: "Persistently high readings or missed follow-up prompt a doctor to review your record and contact you.",
      },
    ],
    metadata: {
      title: "Diabetes Monitoring",
      description:
        "Keep glucose readings, HbA1c, medication and laboratory results in one record, with doctor review when closer care is needed.",
    },
  },
  obesity: {
    slug: "obesity",
    headline: "Weight management with clinical support, not willpower alone.",
    campaignLine: "Excess weight is a health condition, and it responds to structured support.",
    intro:
      "A structured programme that combines weight tracking, a lifestyle plan, monitoring of related conditions and doctor review on one record. It is not a diet. It is built around your actual routine.",
    included: [
      "Weight and waist measurements on one record",
      "A personal plan for eating and physical activity",
      "Monitoring of related conditions, such as high blood pressure and raised blood sugar",
      "Regular check-ins and progress reviews",
      "Doctor review, with referral for closer care when it is needed",
    ],
    howItWorks: [
      {
        title: "Agree a plan",
        body: "Your care team reviews your history and helps you set goals you can realistically meet.",
      },
      {
        title: "Track progress with support",
        body: "Record your weight and daily habits, receive regular check-ins, and have related conditions monitored on the same record.",
      },
      {
        title: "Review and adjust",
        body: "Your progress is reviewed against clinical protocols, and closer care is arranged when it is needed.",
      },
    ],
    metadata: {
      title: "Weight Health",
      description:
        "Weight management with clinical support: tracking, a lifestyle plan, monitoring of related conditions, and doctor review.",
    },
  },
  parentcare: {
    slug: "parentcare",
    headline: "Follow your parent's health, even when you cannot be with them every day.",
    campaignLine: "Your parents cared for you. Help them stay well in return.",
    intro:
      "Your parent keeps their own free Tarragon account. If they name you as next of kin, you can follow their readings, appointments and results, and we contact you first if something urgent happens. You can pay for their health checks and their doctor's time in naira, from Lagos or from abroad. Laboratory tests are still paid directly to the laboratory when they attend.",
    included: [
      "Their own free account and their own health record, held in their name",
      "Vitals, medication, and preventive check tracking",
      "Next of kin access: you can see their care but not change it, and they can withdraw your access at any time",
      "We contact you first if something urgent happens",
      "Pay for their checks and their doctor's time in naira, from anywhere",
      "Doctor follow-up when readings or missed care need attention",
    ],
    howItWorks: [
      {
        title: "They create their own account",
        body: "Each person has one free account, and the record belongs to them. This lets a doctor treat them properly and keeps their consent meaningful.",
      },
      {
        title: "They name you as next of kin",
        body: "This is a single setting on their account. You can then follow their readings, appointments and results, and we know whom to call first.",
      },
      {
        title: "You can pay for their care, if you wish",
        body: "Buy a named health check or a doctor's time for their account whenever it suits you, in one payment or in instalments. It can be used only for their care and cannot be exchanged for cash. Laboratory tests are paid directly to the laboratory at its own price, so send them the cost of a test if you would like to help with that as well.",
      },
    ],
    metadata: {
      title: "Caring for a parent",
      description:
        "Follow a parent's care without taking it over: they keep their own account, you are named as next of kin, and you can pay for their checks from anywhere.",
    },
  },
  prevention: {
    slug: "prevention",
    headline: "Find health problems early, while they are easiest to treat.",
    campaignLine: "The best way to handle an emergency is to prevent it.",
    intro:
      "You do not need a diagnosis to use Tarragon. Prevention is one of our four priority programmes, designed for people who feel well and want to stay that way. It gives you a screening and vaccination calendar matched to your age, sex and medical history, a yearly Health Check, and clear explanations of your results. In most years the outcome is simple reassurance. If a check does find something, a doctor follows up within a day, or within 12 hours if the result is critical, which is often years earlier than the problem would otherwise have been found.",
    included: [
      "A personal screening calendar covering cancer, metabolic, infectious and reproductive health checks matched to you",
      "A vaccination schedule, booking, and doctor-verified certificates",
      "The Annual Health Check, up to a full Comprehensive Screen: we tell you which tests you need, you use any laboratory, and a doctor reads the results",
      "Health education matched to you, with short quizzes to check understanding",
      "Doctor follow-up within a day on any result that needs attention",
      "A direct path into chronic care monitoring if a condition is found, on the same record, with no need to start again",
    ],
    howItWorks: [
      {
        title: "See what is due",
        body: "Complete your health profile, which takes about two minutes, and Tarragon builds your personal calendar of the checks and vaccines you need, and when you need them.",
      },
      {
        title: "Complete the checks",
        body: "Take your screening requests to any laboratory near you, and keep every result in one record so that no report is lost.",
      },
      {
        title: "Act early if something is found",
        body: "Most results confirm that you are well. When one does not, your care team follows up straight away. Problems found early usually have more treatment options and cost less to manage.",
      },
    ],
    metadata: {
      title: "Preventive Health",
      description:
        "Preventive care for people who feel well: a personal screening and vaccination calendar, yearly health checks, and doctor follow-up when a result needs attention.",
    },
  },
  medication: {
    slug: "medication",
    headline: "Take your medication on time and never run out.",
    intro:
      "Medicines work only when they are taken as prescribed. Tarragon keeps your medication schedule in the same record as your readings and test results, sends reminders in the app and refill alerts before your supply ends, and has your care team follow up when doses are missed.",
    included: [
      "A medication schedule within your health record",
      "In-app reminders for each dose",
      "Refill alerts before your supply runs out",
      "Buy from any pharmacy you choose, and record the collection in seconds",
      "Doctor follow-up when doses are missed repeatedly",
    ],
    howItWorks: [
      {
        title: "Add your medication",
        body: "List what you take and when, during sign-up or whenever your prescription changes.",
      },
      {
        title: "Receive reminders and record each dose",
        body: "A reminder arrives at the right time. Recording the dose takes a few seconds and keeps your record accurate.",
      },
      {
        title: "Keep your supply uninterrupted",
        body: "Refill alerts arrive before you run out, and a doctor contacts you if doses are regularly missed.",
      },
    ],
    metadata: {
      title: "Medication Support",
      description:
        "Medication reminders, refill alerts and follow-up when doses are missed, all in the same record as the rest of your care.",
    },
  },
  labs: {
    slug: "labs",
    headline: "Know which tests are due, use any laboratory, and have every result followed up.",
    intro:
      "Laboratory tests are where care between visits most often lapses. Tarragon keeps a calendar of the tests you are due, gives you a written request you can take to any laboratory, and makes sure a doctor reviews every result. You pay the laboratory directly, and we take no commission.",
    included: [
      "A test calendar linked to your chronic care and screening record",
      "A written request you can take to any laboratory near you",
      "Results explained in plain language",
      "Immediate doctor alert for abnormal results",
      "Follow-up tracked until it is complete",
    ],
    howItWorks: [
      {
        title: "See what is due",
        body: "Your calendar reflects your conditions and screening schedule, so you do not have to guess what is overdue.",
      },
      {
        title: "Take the request to a laboratory",
        body: "Choose the laboratory that suits you, pay it directly, and upload the result. Every result then sits in one record instead of in scattered reports.",
      },
      {
        title: "Every result reviewed",
        body: "A doctor reviews every result. An abnormal finding prompts immediate follow-up, so no report goes unread.",
      },
    ],
    metadata: {
      title: "Lab Coordination",
      description:
        "Know which laboratory tests are due, take the request to any laboratory you choose, and receive doctor follow-up on every result.",
    },
  },
};

export function getProductPage(slug: string): ProductPageContent | undefined {
  const page = PRODUCT_PAGES[slug];
  if (!page) return undefined;
  // Inject the per-page canonical + OG/Twitter from the slug so every
  // programme page self-canonicalises (the slug matches its marketing route:
  // /hypertension …) and gets a real social share card, not the layout's bare
  // fallback (see pageMetadata's doc comment for why the fallback isn't enough).
  return {
    ...page,
    metadata: pageMetadata({
      title: page.metadata.title as string,
      description: page.metadata.description as string,
      path: `/${page.slug}`,
    }),
  };
}

export const PRICING_HREF = MARKETING_ROUTES.pricing;
