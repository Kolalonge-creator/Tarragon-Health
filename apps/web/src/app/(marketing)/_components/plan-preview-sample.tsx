"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

type AgeBand = "under25" | "25-39" | "40-59" | "60plus";
type Sex = "female" | "male";
type Situation = "healthy" | "family-history" | "existing-condition";

type SamplePlan =
  | { kind: "redirect"; message: string }
  | { kind: "example"; calendar: string[]; firstNinetyDays: string[] };

/**
 * A pure, client-side illustration of what a screening calendar could look
 * like — NOT the real recommendation engine (that lives in
 * lib/rules/care-programme-recommendations.ts and only ever runs against a
 * real signed-in health profile). Nothing here is saved, scored, or sent
 * anywhere; it exists purely so a visitor can see the shape of the real
 * feature before they sign up.
 */
export function buildSamplePlan(age: AgeBand, sex: Sex, situation: Situation): SamplePlan {
  if (situation === "existing-condition") {
    return {
      kind: "redirect",
      message:
        "It sounds like you may already be managing a diagnosed condition. Prevention's screening calendar is built for people without one yet; Tarragon's chronic care programme (hypertension, diabetes, weight, and more) is likely the better starting point, with regular doctor review built in.",
    };
  }

  const calendar = [
    "Blood pressure, weight, and BMI",
    "Fasting blood sugar and HbA1c (3-month sugar average)",
    "HIV and Hepatitis B screening",
  ];

  if (sex === "female") {
    if (age !== "under25") calendar.push("Cervical smear (recommended from age 25)");
    if (age === "40-59" || age === "60plus") calendar.push("Breast screening (recommended from age 40)");
  } else {
    if (age === "40-59" || age === "60plus") {
      calendar.push("PSA prostate screening (recommended from age 45)");
      calendar.push("Colorectal screening (recommended from age 45)");
    }
  }

  if (situation === "family-history") {
    calendar.push(
      "A closer-interval lipid panel and kidney function check, given your family history"
    );
  }

  calendar.push("A vaccination check (tetanus booster, Hepatitis B series, HPV if eligible)");
  if (age === "60plus") calendar.push("Shingles vaccine eligibility check (from age 50)");

  return {
    kind: "example",
    calendar,
    firstNinetyDays: [
      "A real two-minute health profile builds your real calendar; this example only used three quick picks.",
      "You book your first due check at a partner lab near you, and see the exact price before confirming.",
      "Most results just confirm you're on track. If one doesn't, a doctor follows up the same day, not next month.",
    ],
  };
}

const AGE_OPTIONS: { value: AgeBand; label: string }[] = [
  { value: "under25", label: "Under 25" },
  { value: "25-39", label: "25–39" },
  { value: "40-59", label: "40–59" },
  { value: "60plus", label: "60+" },
];

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];

const SITUATION_OPTIONS: { value: Situation; label: string }[] = [
  { value: "healthy", label: "Generally healthy" },
  { value: "family-history", label: "Family history of diabetes or high blood pressure" },
  { value: "existing-condition", label: "Already managing a diagnosed condition" },
];

function PillGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-charcoal-ink">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(opt.value)}
              className={cn(
                "rounded-full border px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
                selected
                  ? "border-brand-green bg-brand-green/10 font-medium text-deep-forest"
                  : "border-charcoal-ink/15 text-charcoal-ink/70 hover:border-charcoal-ink/30 hover:text-charcoal-ink"
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Three quick picks → an illustrative preview of the real screening-calendar feature. */
export function PlanPreviewSample() {
  const [age, setAge] = useState<AgeBand>();
  const [sex, setSex] = useState<Sex>();
  const [situation, setSituation] = useState<Situation>();

  const done = age && sex && situation;
  const plan = done ? buildSamplePlan(age, sex, situation) : null;

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-8">
      <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
        See what a plan could look like
      </h3>
      <p className="mt-1 text-sm text-charcoal-ink/60">
        Three quick picks, purely illustrative: nothing here is saved or scored.
      </p>
      <div className="mt-5 space-y-4">
        <PillGroup legend="Age range" options={AGE_OPTIONS} value={age} onChange={setAge} />
        <PillGroup legend="Sex" options={SEX_OPTIONS} value={sex} onChange={setSex} />
        <PillGroup
          legend="Which sounds like you?"
          options={SITUATION_OPTIONS}
          value={situation}
          onChange={setSituation}
        />
      </div>

      {plan ? (
        <div
          role="status"
          className="mt-6 space-y-4 rounded-xl border border-brand-green/25 bg-brand-green/[0.04] p-6"
        >
          {plan.kind === "redirect" ? (
            <>
              <p className="text-sm leading-relaxed text-charcoal-ink">{plan.message}</p>
              <Link
                href="/chronic-care"
                className="inline-block text-sm font-medium text-deep-forest hover:underline"
              >
                See how chronic care works →
              </Link>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-sm font-medium text-charcoal-ink">Example screening calendar:</p>
                <ul className="space-y-1">
                  {plan.calendar.map((item) => (
                    <li key={item} className="flex gap-2 text-sm text-charcoal-ink/80">
                      <span aria-hidden className="mt-0.5 shrink-0 text-brand-green">
                        ✓
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-charcoal-ink">Your example first 90 days:</p>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-charcoal-ink/80">
                  {plan.firstNinetyDays.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
              <Link
                href="/signup"
                className="inline-block text-sm font-medium text-deep-forest hover:underline"
              >
                Build my real calendar →
              </Link>
            </>
          )}
          <p className="text-xs text-charcoal-ink/50">
            This is an illustrative example, not a real health assessment. Your real calendar is
            built from your real answers, after you sign up.
          </p>
        </div>
      ) : (
        <p className="mt-6 text-sm text-charcoal-ink/60">
          Pick one answer for each question to see an example.
        </p>
      )}
    </div>
  );
}
