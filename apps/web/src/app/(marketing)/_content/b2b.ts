import type { Metadata } from "next";
import type { MarketingMediaSlot } from "./media";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export type B2bStat = {
  label: string;
  value: string;
  pill?: { text: string; tone: "green" | "amber" | "red" };
};

export type B2bPartnerOffer = {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  ctaLabel: string;
  /** Appended to the contact link, e.g. "ngo" to pre-select that role. */
  ctaRole: string;
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
  /**
   * A second, distinct offer on the same page for a different kind of
   * counterparty — currently used on the Corporate page for NGOs, PHC
   * programmes, and government partners, who aren't "employers" but land on
   * the same page (see docs/FUNDING_STRATEGY.md: NGOs are a customer /
   * subcontracting / implementation-partner channel, not a grant source).
   */
  partnerOffer?: B2bPartnerOffer;
};

export const B2B_PAGES: Record<"corporate" | "hmo", B2bPageContent> = {
  corporate: {
    slug: "corporate",
    headline: "Help your workforce detect and manage chronic disease risk.",
    campaignLine: "Know your workforce health risks before they become costs.",
    intro:
      "Tarragon enrols your staff in clinical monitoring for hypertension, diabetes, and preventive screening, then turns what we find into an anonymised risk picture your HR and benefits team can act on.",
    hero: {
      imageSrc: "/marketing/photos/hero/corporate.jpg",
      imageAlt: "Colleagues talking together during a break at work",
      imageFocus: "center 38%",
    },
    included: [
      "Staff enrolment and annual health checks",
      "Anonymised risk dashboard by cohort, not by individual",
      "Screening compliance reporting for HR",
      "Clinical follow-up on abnormal results, the same as for any Tarragon patient",
      "Referral to a doctor for staff who need closer care",
    ],
    exampleTitle: "What a workforce report looks like",
    exampleNote: "Illustrative example, not real client data.",
    exampleStats: [
      { label: "Pre-diabetic (workforce)", value: "", pill: { text: "12%", tone: "amber" } },
      { label: "Uncontrolled blood pressure", value: "", pill: { text: "8%", tone: "red" } },
      { label: "Cervical screening overdue", value: "60 employees" },
      { label: "Urgent follow-up needed", value: "25 employees" },
    ],
    howItWorks: [
      {
        title: "Enrol your staff",
        body: "We onboard your workforce with annual health checks, then set up screening and chronic disease monitoring where needed.",
      },
      {
        title: "Monitor, review and refer",
        body: "Your staff follow the same clinical review and doctor referral pathway as every Tarragon patient, individually and in confidence.",
      },
      {
        title: "See the cohort picture",
        body: "Your HR and benefits team receives an anonymised risk dashboard and screening compliance reporting. No individual health data is shared with them.",
      },
    ],
    ctaLabel: "Request employer health plan",
    metadata: pageMetadata({
      title: "Corporate Health",
      description:
        "Corporate wellness plans that identify chronic disease risk in your workforce early, with anonymised reporting for HR.",
      path: MARKETING_ROUTES.corporate,
    }),
    partnerOffer: {
      eyebrow: "NGOs, PHC & government programmes",
      title: "Fund care for a group that you already serve.",
      body: "If you run a hypertension or diabetes programme, a screening drive or a primary-care outreach effort, Tarragon can provide the digital layer that keeps care continuous: enrolment, care-team workflows, remote monitoring, follow-up on medicine adherence and anonymised outcome reporting, for a defined group over a defined term.",
      points: [
        "Your organisation funds a fixed, agreed number of people, and each person's own care stays private and confidential",
        "Tarragon provides the clinical review, referral to a doctor and follow-up, using the same pathway as for any Tarragon patient",
        "You receive aggregate programme reporting only (activations, completed follow-up and outcome measures), and never an individual's result or diagnosis",
        "This can work alongside a grant you already hold, a subcontracted programme or a direct partnership, whichever suits your funding",
      ],
      ctaLabel: "Discuss a funded programme",
      ctaRole: "ngo",
    },
  },
  hmo: {
    slug: "hmo",
    headline: "Monitor member risk, follow up on missed care, and generate outcome evidence.",
    campaignLine: "Follow up on missed care, monitor risk and show the outcomes.",
    pullQuote: "We do not only manage chronic disease. We detect it earlier, and we can show the evidence.",
    intro:
      "Members receive the same clinical monitoring, reminders and doctor referral as any Tarragon patient. You receive population-level risk data, tracking of missed care and outcome reporting designed for renewal discussions.",
    hero: {
      imageSrc: "/marketing/photos/hero/hmo.jpg",
      imageAlt: "Two business partners shaking hands in an office lobby",
      imageFocus: "center 24%",
    },
    included: [
      "Population risk stratification, updated as members are monitored",
      "Missed care followed up until it is completed, not only flagged",
      "Immediate doctor follow-up on abnormal screening results",
      "Outcome reporting designed for renewal discussions",
      "The same four-level clinical referral pathway as every Tarragon patient",
    ],
    exampleTitle: "What member reporting looks like",
    exampleNote: "Illustrative example, not real client data.",
    exampleStats: [
      { label: "Members monitored", value: "4,820" },
      { label: "Missed care completed (90 days)", value: "", pill: { text: "+31%", tone: "green" } },
      { label: "Abnormal results caught early", value: "146" },
      { label: "Claims impact", value: "Included in your report" },
    ],
    howItWorks: [
      {
        title: "Onboard your members",
        body: "Members are monitored in the same way as any Tarragon patient: vital signs, medication and preventive screening, all on one record.",
      },
      {
        title: "Follow up and detect risk early",
        body: "Missed care is followed up until it is completed, and abnormal results prompt immediate doctor follow-up rather than being left open.",
      },
      {
        title: "Report on outcomes",
        body: "Population risk and outcome data are prepared for your team as evidence you can bring to renewal discussions, not only a claims log.",
      },
    ],
    ctaLabel: "Talk to Tarragon Health",
    metadata: pageMetadata({
      title: "HMO Support",
      description:
        "Monitor member risk, follow up on missed care and generate outcome evidence: chronic disease and preventive care for HMO members.",
      path: MARKETING_ROUTES.hmo,
    }),
  },
};

export function getB2bPage(slug: string): B2bPageContent | undefined {
  return slug === "corporate" || slug === "hmo" ? B2B_PAGES[slug] : undefined;
}
