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
 * mechanisms) — nothing here is invented. Corrected 2026-08-25: Synlab
 * Nigeria is now a real, signed, nationwide lab partner (see the
 * "Corrected 2026-08-25" note in pricing.ts), so a lab-fulfilled entry's
 * "book it" step says Tarragon books it with Synlab and bills the patient
 * directly, not "paid to the lab, not to us." Standalone self-booking is
 * only offered for the WHO-priority confidential screens, blood group &
 * genotype, and the Annual Health Check ladder itself; prostate and
 * colorectal screening are part of Advanced Screen, breast imaging is part
 * of Comprehensive Screen, or otherwise ordered by a doctor — never a bare
 * self-service SKU, so their "book it" step says that plainly rather than
 * overclaiming.
 */
export const SCREENINGS: ScreeningItem[] = [
  {
    id: "cardiometabolic",
    name: "Cardiometabolic Health Check",
    forSex: "all",
    ageBands: ALL_BANDS,
    category: "Heart & metabolic",
    summary: "Blood sugar (HbA1c), cholesterol, blood pressure, and BMI: the numbers behind diabetes and heart disease, years before symptoms show.",
    price: "Booked with our partner lab",
    steps: [
      {
        title: "Is this for you?",
        body: "Yes, at any age. These are the checks that quietly explain most preventable illness in Nigeria, and they only get more useful once you have a few years of readings to compare against.",
      },
      {
        title: "Book it",
        body: "Request the Annual Health Check in the app, and we book it directly with Synlab Nigeria, our nationwide partner lab. You see the exact price and confirm before anything is charged.",
      },
      {
        title: "Test day",
        body: "One visit: a blood draw plus blood pressure, weight, and height measured properly. Fasting isn't required for every version, and the app tells you exactly what to do beforehand.",
      },
      {
        title: "Results & what's next",
        body: "A doctor reads every result against your history, usually within about two weeks, and adds it to your Health Passport. Most checks come back clear; that's the point, and it's worth paying for. If something needs attention, your doctor follows up the same day.",
      },
    ],
  },
  {
    id: "cervical",
    name: "Cervical Screening",
    forSex: "female",
    ageBands: ["25-39", "40-49", "50-plus"],
    category: "Cancer screening",
    summary: "A quick, confidential test that catches changes years before they could become cervical cancer.",
    price: "Booked with our partner lab",
    steps: [
      {
        title: "Is this for you?",
        body: "Recommended for women from age 25, repeated on a schedule your doctor sets based on your results and history.",
      },
      {
        title: "Book it",
        body: "Request it directly and confidentially in the app, on its own, no bundle required, and we book it with Synlab Nigeria, at their price, shown before you confirm.",
      },
      {
        title: "Test day",
        body: "A short, routine sample collection, done by a clinician in a few minutes. Uncomfortable for some, but not usually painful.",
      },
      {
        title: "Results & what's next",
        body: "Results go only to you and the reviewing doctor. A normal result means you're on track for your next scheduled screening; an abnormal one gets an immediate doctor follow-up to explain, calmly, what happens next.",
      },
    ],
  },
  {
    id: "breast",
    name: "Breast Screening",
    forSex: "female",
    ageBands: ["40-49", "50-plus"],
    category: "Cancer screening",
    summary: "Screening matched to your age, because catching breast cancer early changes almost everything about how treatable it is.",
    price: "Included in Comprehensive Screen",
    steps: [
      {
        title: "Is this for you?",
        body: "Formal screening is recommended from age 40. Before that, knowing what's normal for you and mentioning changes to your doctor matters more than a scheduled test.",
      },
      {
        title: "Book it",
        body: "Included as part of Comprehensive Screen or arranged directly by your doctor if your history calls for it sooner, rather than sold as a stand-alone booking.",
      },
      {
        title: "Test day",
        body: "An imaging order (ultrasound if you're under 40, mammography from 40), which you take to any imaging facility near you. You pay them directly, at their price, and upload the result yourself, just like the rest of Comprehensive Screen.",
      },
      {
        title: "Results & what's next",
        body: "Your doctor talks you through the result directly. Most are clear. If not, you move straight into follow-up on the same record, with no starting over.",
      },
    ],
  },
  {
    id: "prostate",
    name: "Prostate (PSA) Screening",
    forSex: "male",
    ageBands: ["40-49", "50-plus"],
    category: "Cancer screening",
    summary: "A blood test that helps your doctor judge prostate health, discussed with you rather than ordered blindly.",
    price: "Included in Advanced Screen",
    steps: [
      {
        title: "Is this for you?",
        body: "Generally considered from age 45, or age 40 with a family history. This is one worth a short conversation with a doctor first, since PSA testing has real trade-offs.",
      },
      {
        title: "Book it",
        body: "Ordered by your doctor as part of Advanced Screen, not sold as a stand-alone test; PSA isn't offered as a bare self-service booking because it genuinely needs that conversation first.",
      },
      {
        title: "Test day",
        body: "A simple blood draw alongside your other Advanced Screen samples, same visit, no extra trip.",
      },
      {
        title: "Results & what's next",
        body: "Your doctor explains the number in context, your age, family history, and how it's trending, not as a bare pass/fail.",
      },
    ],
  },
  {
    id: "colorectal",
    name: "Colorectal Screening",
    forSex: "all",
    ageBands: ["40-49", "50-plus"],
    category: "Cancer screening",
    summary: "Catching changes in the colon early, when treatment is simplest.",
    price: "Ordered by your doctor",
    steps: [
      {
        title: "Is this for you?",
        body: "Recommended from age 45 for most people, or sooner with a family history or symptoms worth checking.",
      },
      {
        title: "Book it",
        body: "Your doctor orders the right first step for you as part of your Advanced Screen or a care-plan review, then coordinates the referral if further investigation is needed.",
      },
      {
        title: "Test day",
        body: "Depends on what your doctor orders; they'll walk you through exactly what to expect and how to prepare before anything is booked.",
      },
      {
        title: "Results & what's next",
        body: "Reviewed by your doctor, with a clear explanation either way, and coordinated follow-up on the same record if anything needs a closer look.",
      },
    ],
  },
  {
    id: "confidential",
    name: "Confidential Infection Screening",
    forSex: "all",
    ageBands: ALL_BANDS,
    category: "Infectious disease",
    summary: "HIV, Hepatitis B, and Hepatitis C: the WHO-priority checks for Nigeria, booked quietly, on your own terms.",
    price: "Booked with our partner lab",
    steps: [
      {
        title: "Is this for you?",
        body: "Yes, at any adult age, whether or not you think you're at risk. These are the checks that do the most damage when nobody is looking for them.",
      },
      {
        title: "Book it",
        body: "Book each test on its own, directly and confidentially in the app; we book it with Synlab Nigeria and bill you, no referral or explanation needed to anyone.",
      },
      {
        title: "Test day",
        body: "A simple blood sample at whichever lab you choose, usually done in minutes.",
      },
      {
        title: "Results & what's next",
        body: "Results go only to you and the reviewing doctor, never shared elsewhere on the platform without your consent. Support and next steps are arranged privately if a result needs it.",
      },
    ],
  },
  {
    id: "blood-basics",
    name: "Blood Group & Genotype",
    forSex: "all",
    ageBands: ALL_BANDS,
    category: "Know your basics",
    summary: "Blood group and sickle cell genotype (AA/AS/SS): useful for marriage counselling, pregnancy planning, and emergencies, and something most Nigerians never get told plainly.",
    price: "₦37,000, booked with our partner lab",
    steps: [
      {
        title: "Is this for you?",
        body: "Worth knowing at any age, and especially before marriage or planning a pregnancy, since two AS/AS partners carry a real risk worth understanding beforehand.",
      },
      {
        title: "Book it",
        body: "Request it directly in the app, on its own, and we book it with Synlab Nigeria for ₦37,000, billed once you confirm.",
      },
      {
        title: "Test day",
        body: "One quick blood sample; no preparation needed.",
      },
      {
        title: "Results & what's next",
        body: "Saved to your Health Passport for good, so you (or a partner planning a family with you) never have to ask 'do you know your genotype?' and get a shrug.",
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
          Tell us two things, see your screening journey
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
                <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
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
