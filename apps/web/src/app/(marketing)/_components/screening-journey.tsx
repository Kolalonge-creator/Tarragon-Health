"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export type Sex = "female" | "male";
export type AgeBand = "18-24" | "25-39" | "40-49" | "50-plus";

export interface ScreeningStep {
  title: string;
  body: string;
}

export interface ScreeningItem {
  id: string;
  name: string;
  forSex: "all" | Sex;
  ageBands: AgeBand[];
  category: string;
  summary: string;
  price: string;
  steps: [ScreeningStep, ScreeningStep, ScreeningStep, ScreeningStep];
}

const ALL_BANDS: AgeBand[] = ["18-24", "25-39", "40-49", "50-plus"];

/**
 * Every entry maps to something actually bookable on the platform today
 * (see /annual-health-check and /prevention, which describe these same
 * mechanisms) — nothing here is invented. No entry quotes a price:
 * Tarragon has no contracted lab, so it doesn't know or set what any
 * laboratory charges for a test — see SELF-ARRANGED FULFILMENT in
 * pricing.ts. Standalone self-booking is only offered for the
 * WHO-priority confidential screens, blood group & genotype, and the
 * Annual Health Check ladder itself; prostate and colorectal screening
 * are part of Advanced Screen, breast imaging is part of Comprehensive
 * Screen, or otherwise ordered by a doctor — never a bare self-service
 * SKU, so their "book it" step says that plainly rather than overclaiming.
 */
export const SCREENINGS: ScreeningItem[] = [
  {
    id: "cardiometabolic",
    name: "Cardiometabolic Health Check",
    forSex: "all",
    ageBands: ALL_BANDS,
    category: "Heart & metabolic",
    summary: "Blood sugar (HbA1c), cholesterol, blood pressure and body mass index (BMI). These measurements show your risk of diabetes and heart disease years before symptoms appear.",
    price: "Paid to the laboratory, not to Tarragon",
    steps: [
      {
        title: "Is this for you?",
        body: "Yes, at any age. These checks measure the main risks behind most preventable illness in Nigeria, and they become more useful once you have several years of results to compare.",
      },
      {
        title: "Book it",
        body: "Request the Annual Health Check in the app, then take the request to any laboratory you choose. You pay the laboratory directly at its own price, and Tarragon takes no fee from that payment.",
      },
      {
        title: "Test day",
        body: "One visit: a blood sample, plus your blood pressure, weight and height. Fasting is not required for every version, and the app tells you how to prepare beforehand.",
      },
      {
        title: "Results & what is next",
        body: "A doctor reviews every result against your history, usually within about two weeks, and adds it to your Health Passport. Most checks come back clear, and a clear result is still valuable because it gives you a baseline. If something needs attention, a doctor follows up within a day, and within 12 hours if the result is critical.",
      },
    ],
  },
  {
    id: "cervical",
    name: "Cervical Screening",
    forSex: "female",
    ageBands: ["25-39", "40-49", "50-plus"],
    category: "Cancer screening",
    summary: "A quick, confidential test that detects changes years before they could become cervical cancer.",
    price: "Paid to the laboratory, not to Tarragon",
    steps: [
      {
        title: "Is this for you?",
        body: "Recommended for women from age 25, repeated on a schedule a doctor sets based on your results and history.",
      },
      {
        title: "Book it",
        body: "Request it directly and confidentially in the app, on its own with no bundle required, then take it to any laboratory or clinic you choose.",
      },
      {
        title: "Test day",
        body: "A clinician collects a sample in a few minutes. It may be uncomfortable for some people but is not usually painful.",
      },
      {
        title: "Results & what is next",
        body: "Results go only to you and the reviewing doctor. A normal result means you are on track for your next scheduled screening. If a result is abnormal, a doctor follows up immediately to explain what happens next.",
      },
    ],
  },
  {
    id: "breast",
    name: "Breast Screening",
    forSex: "female",
    ageBands: ["40-49", "50-plus"],
    category: "Cancer screening",
    summary: "Screening matched to your age, because breast cancer found early is much easier to treat.",
    price: "Included in Comprehensive Screen",
    steps: [
      {
        title: "Is this for you?",
        body: "Formal screening is recommended from age 40. Before that, it matters more to know what is normal for your breasts and to tell a doctor about any change than to have a scheduled test.",
      },
      {
        title: "Book it",
        body: "It is included in Comprehensive Screen, or arranged directly by a doctor if your history calls for it sooner, rather than sold as a stand-alone booking.",
      },
      {
        title: "Test day",
        body: "You receive an imaging request (ultrasound if you are under 40, mammography from 40), which you take to any imaging facility near you. You pay the facility directly at its own price and upload the result yourself, as with the rest of Comprehensive Screen.",
      },
      {
        title: "Results & what is next",
        body: "A doctor explains the result to you directly. Most results are clear. If not, you move straight into follow-up on the same record, without starting again.",
      },
    ],
  },
  {
    id: "prostate",
    name: "Prostate (PSA) Screening",
    forSex: "male",
    ageBands: ["40-49", "50-plus"],
    category: "Cancer screening",
    summary: "A blood test that helps a doctor assess prostate health, and that is discussed with you before it is ordered.",
    price: "Included in Advanced Screen",
    steps: [
      {
        title: "Is this for you?",
        body: "Generally considered from age 45, or from age 40 with a family history. Speak to a doctor first, because PSA testing has both benefits and drawbacks.",
      },
      {
        title: "Book it",
        body: "Ordered by a doctor as part of Advanced Screen, not sold as a stand-alone test. PSA is not offered as a self-service booking because it needs that conversation first.",
      },
      {
        title: "Test day",
        body: "A simple blood sample, taken with your other Advanced Screen samples during the same visit.",
      },
      {
        title: "Results & what is next",
        body: "A doctor explains the result in context, including your age, your family history and how the figure is changing over time, rather than as a simple pass or fail.",
      },
    ],
  },
  {
    id: "colorectal",
    name: "Colorectal Screening",
    forSex: "all",
    ageBands: ["40-49", "50-plus"],
    category: "Cancer screening",
    summary: "Finding changes in the colon early, when treatment is simplest.",
    price: "Ordered by a doctor",
    steps: [
      {
        title: "Is this for you?",
        body: "Recommended from age 45 for most people, or sooner with a family history or symptoms worth checking.",
      },
      {
        title: "Book it",
        body: "A doctor orders the right first step for you as part of your Advanced Screen or a care-plan review, then coordinates the referral if further investigation is needed.",
      },
      {
        title: "Test day",
        body: "This depends on what a doctor orders. Your care team explains what to expect and how to prepare before anything is booked.",
      },
      {
        title: "Results & what is next",
        body: "Reviewed by a doctor, with a clear explanation either way, and coordinated follow-up on the same record if anything needs a closer look.",
      },
    ],
  },
  {
    id: "confidential",
    name: "Confidential Infection Screening",
    forSex: "all",
    ageBands: ALL_BANDS,
    category: "Infectious disease",
    summary: "HIV, hepatitis B and hepatitis C: the infection checks that WHO prioritises for Nigeria, booked confidentially and on your own terms.",
    price: "Paid to the laboratory, not to Tarragon",
    steps: [
      {
        title: "Is this for you?",
        body: "Yes, at any adult age, whether or not you think you are at risk. These infections can cause serious harm when nobody is testing for them.",
      },
      {
        title: "Book it",
        body: "Book each test on its own, directly and confidentially in the app. No referral is needed and you do not have to explain your reasons to anyone.",
      },
      {
        title: "Test day",
        body: "A simple blood sample at the laboratory of your choice, usually taken within minutes.",
      },
      {
        title: "Results & what is next",
        body: "Results go only to you and the reviewing doctor, and are shared elsewhere on the platform only with your consent. Support and next steps are arranged privately if a result needs it.",
      },
    ],
  },
  {
    id: "blood-basics",
    name: "Blood Group & Genotype",
    forSex: "all",
    ageBands: ALL_BANDS,
    category: "Know your basics",
    summary: "Blood group and sickle cell genotype (AA, AS or SS). Useful for marriage counselling, pregnancy planning and emergencies, and information that few people in Nigeria are ever told clearly.",
    price: "Paid to the laboratory, not to Tarragon",
    steps: [
      {
        title: "Is this for you?",
        body: "Worth knowing at any age, and especially before marriage or when planning a pregnancy, because two partners who both have the AS genotype risk having a child with sickle cell disease.",
      },
      {
        title: "Book it",
        body: "Request it directly in the app, on its own, then take it to any laboratory you choose.",
      },
      {
        title: "Test day",
        body: "One blood sample is taken. No preparation is needed.",
      },
      {
        title: "Results & what is next",
        body: "Saved permanently to your Health Passport, so you and any partner planning a family with you can always confirm your genotype.",
      },
    ],
  },
];

const AGE_BAND_LABELS: Record<AgeBand, string> = {
  "18-24": "18–24",
  "25-39": "25–39",
  "40-49": "40–49",
  "50-plus": "50+",
};

export function recommendedScreenings(ageBand: AgeBand, sex: Sex): ScreeningItem[] {
  return SCREENINGS.filter(
    (item) => (item.forSex === "all" || item.forSex === sex) && item.ageBands.includes(ageBand)
  );
}

export function ScreeningJourney() {
  const [ageBand, setAgeBand] = useState<AgeBand>("25-39");
  const [sex, setSex] = useState<Sex>("female");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const results = recommendedScreenings(ageBand, sex);
  const selected = results.find((item) => item.id === selectedId) ?? results[0] ?? null;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
        <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
          Choose your age group and sex to see your recommended screening
        </h3>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-charcoal-ink">Your age group</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {ALL_BANDS.map((band) => (
              <button
                key={band}
                type="button"
                aria-pressed={ageBand === band}
                onClick={() => {
                  setAgeBand(band);
                  setSelectedId(null);
                }}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
                  ageBand === band
                    ? "border-brand-green bg-brand-green/10 font-medium text-deep-forest"
                    : "border-charcoal-ink/15 text-charcoal-ink/70 hover:border-charcoal-ink/30 hover:text-charcoal-ink"
                )}
              >
                {AGE_BAND_LABELS[band]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-charcoal-ink">Sex</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["female", "male"] as Sex[]).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={sex === option}
                onClick={() => {
                  setSex(option);
                  setSelectedId(null);
                }}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
                  sex === option
                    ? "border-brand-green bg-brand-green/10 font-medium text-deep-forest"
                    : "border-charcoal-ink/15 text-charcoal-ink/70 hover:border-charcoal-ink/30 hover:text-charcoal-ink"
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-8">
        <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
          Recommended for you
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {results.map((item) => {
            const isSelected = selected?.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                aria-pressed={isSelected}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
                  isSelected
                    ? "border-brand-green bg-brand-green/5"
                    : "border-charcoal-ink/10 bg-white hover:border-charcoal-ink/25"
                )}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/65">
                  {item.category}
                </p>
                <h4 className="mt-1 font-heading text-base font-semibold text-charcoal-ink">
                  {item.name}
                </h4>
                <p className="mt-1 text-sm leading-relaxed text-charcoal-ink/65">{item.summary}</p>
                <p className="mt-2 text-sm font-medium text-brand-green">{item.price}</p>
              </button>
            );
          })}
        </div>
      </div>

      {selected ? (
        <div className="mt-8 rounded-2xl border border-charcoal-ink/10 bg-soft-sage p-6 sm:p-8">
          <h3 className="font-heading text-xl font-semibold text-charcoal-ink">
            Your journey: {selected.name}
          </h3>
          <ol className="mt-6 grid gap-6 sm:grid-cols-2">
            {selected.steps.map((step, index) => (
              <li key={step.title} className="rounded-xl border border-charcoal-ink/10 bg-white p-5">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-clinical-navy font-heading text-sm font-semibold text-white"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <h4 className="mt-3 font-heading text-base font-semibold text-charcoal-ink">
                  {step.title}
                </h4>
                <p className="mt-1.5 text-sm leading-relaxed text-charcoal-ink/70">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-full bg-brand-green px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-deep-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
            >
              Book this on Tarragon
            </Link>
            <Link
              href={MARKETING_ROUTES.annualHealthCheck}
              className="inline-flex items-center justify-center rounded-full border border-charcoal-ink/15 px-5 py-2.5 text-sm font-medium text-charcoal-ink transition-colors hover:border-charcoal-ink/30"
            >
              See Annual Health Check pricing
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
