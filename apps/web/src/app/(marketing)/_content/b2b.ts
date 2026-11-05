import type { Metadata } from "next";
import type { MarketingMediaSlot } from "./media";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

/** Caption under every made-up stat panel: the figures show the shape of a report, never a real client. */
export const EXAMPLE_DATA_NOTE = "Illustrative example, not real client data.";

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
  slug: "corporate";
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

// The HMO page was folded into /corporate#insurers on 2026-11-05 (W-05) and its
// content deleted with it: it typed a 24/12-hour follow-up promise that lives in
// the signed escalation_slas, and carried example member figures.
export const B2B_PAGES: Record<"corporate", B2bPageContent> = {
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
      "Screening completion reporting for HR",
      "Clinical follow-up on abnormal results, the same as for any Tarragon patient",
      "A doctor on the care team for staff who need closer care",
    ],
    exampleTitle: "What a workforce report looks like",
    exampleNote: EXAMPLE_DATA_NOTE,
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
        body: "Your HR and benefits team receives anonymous totals for the whole workforce and screening completion reporting. No individual health data is shared with them.",
      },
    ],
    ctaLabel: "Request an employer health plan",
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
        "Any programme reporting is agreed with you before the programme starts, and it is only ever counts for the group, never an individual's result or diagnosis",
        "This can work alongside a grant you already hold, a subcontracted programme or a direct partnership, whichever suits your funding",
      ],
      ctaLabel: "Discuss a funded programme",
      ctaRole: "ngo",
    },
  },
};
