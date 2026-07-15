import type { Metadata } from "next";
import type { MarketingMediaSlot } from "./media";

export type B2bStat = {
  label: string;
  value: string;
  pill?: { text: string; tone: "green" | "amber" | "red" };
};

export type B2bPageContent = {
  slug: "corporate" | "hmo";
  headline: string;
  campaignLine: string;
  intro: string;
  pullQuote?: string;
  hero: MarketingMediaSlot;
  included: string[];
  exampleTitle: string;
  exampleNote: string;
  exampleStats: B2bStat[];
  howItWorks: { title: string; body: string }[];
  ctaLabel: string;
  metadata: Metadata;
};

export const B2B_PAGES: Record<"corporate" | "hmo", B2bPageContent> = {
  corporate: {
    slug: "corporate",
    headline: "Help your workforce detect and manage chronic disease risk.",
    campaignLine: "Know your workforce health risks before they become costs.",
    intro:
      "Tarragon enrols your staff into clinician-led monitoring for hypertension, diabetes, and preventive screening, then turns what we find into a clear, anonymised risk picture your HR and benefits team can act on.",
    hero: { illustration: "connected-care", imageAlt: "Workforce health risk dashboard" },
    included: [
      "Staff enrolment and annual health checks",
      "Anonymised risk dashboard by cohort, not by individual",
      "Screening compliance reporting for HR",
      "Clinician-led follow-up on abnormal results, same as any Tarragon patient",
      "Doctor escalation for staff who need closer care",
    ],
    exampleTitle: "What a workforce report looks like",
    exampleNote: "Illustrative example, not real client data.",
    exampleStats: [
      { label: "Pre-diabetic (workforce)", value: "", pill: { text: "12%", tone: "amber" } },
      { label: "Uncontrolled BP", value: "", pill: { text: "8%", tone: "red" } },
      { label: "Cervical screening overdue", value: "60 employees" },
      { label: "Urgent follow-up needed", value: "25 employees" },
    ],
    howItWorks: [
      {
        title: "Enrol your staff",
        body: "We onboard your workforce with annual health checks and set up preventive screening and chronic disease monitoring where needed.",
      },
      {
        title: "Monitor, review, escalate",
        body: "The same clinician-led review and escalation pathway that runs for every Tarragon patient runs for your staff, individually, in confidence.",
      },
      {
        title: "See the cohort picture",
        body: "Your HR and benefits team gets an anonymised risk dashboard and screening compliance reporting, with no individual health data exposed.",
      },
    ],
    ctaLabel: "Request employer health plan",
    metadata: {
      title: "Corporate Health",
      description:
        "Corporate wellness plans that surface workforce chronic disease risk and close care gaps early: clinician-led, with anonymised reporting for HR.",
    },
  },
  hmo: {
    slug: "hmo",
    headline: "Monitor member risk, close care gaps, and generate outcome evidence.",
    campaignLine: "Close care gaps. Monitor risk. Prove outcomes.",
    pullQuote: "We don't just manage chronic disease. We catch it earlier, and we can prove it.",
    intro:
      "Tarragon gives your members the same clinician-led monitoring, reminders, and escalation as any Tarragon patient, and gives you population-level risk data, care-gap tracking, and outcome reporting built for renewal conversations.",
    hero: { illustration: "clinician-follow-up", imageAlt: "Population health monitoring for HMO members" },
    included: [
      "Population risk stratification, updated as members are monitored",
      "Care gap closure tracked to completion, not just flagged",
      "Immediate clinician follow-up on abnormal screening results",
      "Outcome reporting built for renewal and capitation conversations",
      "The same four-level clinical escalation pathway as every Tarragon patient",
    ],
    exampleTitle: "What member reporting looks like",
    exampleNote: "Illustrative example, not real client data.",
    exampleStats: [
      { label: "Members monitored", value: "4,820" },
      { label: "Care gaps closed (90d)", value: "", pill: { text: "+31%", tone: "green" } },
      { label: "Abnormal results caught early", value: "146" },
      { label: "Claims impact", value: "Reporting live" },
    ],
    howItWorks: [
      {
        title: "Onboard your members",
        body: "Members are monitored the same way any Tarragon patient is: vitals, medication, preventive screening, all on one record.",
      },
      {
        title: "Close gaps, catch risk early",
        body: "Care gaps are tracked to completion and abnormal results trigger immediate clinician follow-up, never left open.",
      },
      {
        title: "Report on outcomes",
        body: "Population risk and outcome data are packaged for your team: evidence you can bring to renewal, not just a claims log.",
      },
    ],
    ctaLabel: "Talk to Tarragon Health",
    metadata: {
      title: "HMO Support",
      description:
        "Monitor member risk, close care gaps, and generate outcome evidence: clinician-led chronic disease and preventive care for HMO members.",
    },
  },
};

export function getB2bPage(slug: string): B2bPageContent | undefined {
  return slug === "corporate" || slug === "hmo" ? B2B_PAGES[slug] : undefined;
}
