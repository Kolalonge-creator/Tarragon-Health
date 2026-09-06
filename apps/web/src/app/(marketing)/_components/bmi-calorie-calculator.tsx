"use client";

import { useState } from "react";
import Link from "next/link";
import { computeBmi, bmiCategory, type BmiCategory, type Sex } from "@/lib/obesity/classify";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

/**
 * Public, no-login BMI + daily calorie estimate. Reuses the same computeBmi/
 * bmiCategory the doctor-facing obesity pathway uses (apps/web/src/lib/obesity/
 * classify.ts) so the number a visitor sees here matches what the platform
 * would compute later — but the category labels/copy here are the warm,
 * non-clinical public-facing versions, never the doctor-facing "obesity_class_i"
 * language or a diagnosis. Calorie need is Mifflin-St Jeor, the standard
 * general-population estimate (not the ML SCORE2 pathway, which is patient-data-only).
 */

type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string }[] = [
  { value: "sedentary", label: "Sedentary (little to no exercise, desk job)" },
  { value: "light", label: "Lightly active (light exercise 1-3 days/week)" },
  { value: "moderate", label: "Moderately active (moderate exercise 3-5 days/week)" },
  { value: "active", label: "Active (hard exercise 6-7 days/week)" },
  { value: "very_active", label: "Very active (physical job or twice-daily training)" },
];

const CATEGORY_COPY: Record<
  BmiCategory,
  { label: string; tone: string; body: string }
> = {
  underweight: {
    label: "Underweight range",
    tone: "text-clinical-navy",
    body: "Your BMI is below the typical range. This can be completely normal for some body types, but it's worth a conversation with a doctor, especially if it's a recent change.",
  },
  healthy: {
    label: "Healthy weight range",
    tone: "text-deep-forest",
    body: "Your BMI sits in the range associated with lower health risk. Keeping an eye on it over time matters more than any single reading.",
  },
  overweight: {
    label: "Overweight range",
    tone: "text-charcoal-ink",
    body: "Your BMI is above the typical range. Small, steady changes (not crash diets) are what tend to work, and it's a good time to check in with a doctor before anything becomes harder to manage.",
  },
  obesity_class_i: {
    label: "Higher weight range",
    tone: "text-charcoal-ink",
    body: "Your BMI is in a range where a plan reviewed by a doctor tends to help more than going it alone: real support, not judgment.",
  },
  obesity_class_ii: {
    label: "Higher weight range",
    tone: "text-charcoal-ink",
    body: "Your BMI is in a range where a plan reviewed by a doctor tends to help more than going it alone: real support, not judgment.",
  },
  obesity_class_iii: {
    label: "Higher weight range",
    tone: "text-charcoal-ink",
    body: "Your BMI is in a range where a plan reviewed by a doctor tends to help more than going it alone: real support, not judgment.",
  },
};

function bmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

export function BmiCalorieCalculator() {
  const [sex, setSex] = useState<Sex>("female");
  const [age, setAge] = useState(30);
  const [heightCm, setHeightCm] = useState(165);
  const [weightKg, setWeightKg] = useState(70);
  const [activity, setActivity] = useState<ActivityLevel>("light");

  const bmi = computeBmi(weightKg, heightCm);
  const category = bmi ? bmiCategory(bmi) : null;
  const maintenanceCalories = bmi
    ? Math.round((bmr(sex, weightKg, heightCm, age) * ACTIVITY_MULTIPLIERS[activity]) / 10) * 10
    : null;

  const wantsLoss = category && category !== "underweight" && category !== "healthy";
  const wantsGain = category === "underweight";
  const targetCalories = maintenanceCalories
    ? wantsLoss
      ? Math.max(1200, maintenanceCalories - 500)
      : wantsGain
        ? maintenanceCalories + 300
        : null
    : null;

  const inputClass =
    "mt-1 w-full rounded-xl border border-charcoal-ink/15 bg-white px-3 py-2 text-sm text-charcoal-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-charcoal-ink/10 bg-white p-8 shadow-sm">
      <h3 className="font-heading text-2xl font-semibold text-charcoal-ink">
        Check your BMI and daily calorie estimate
      </h3>
      <p className="mt-2 text-charcoal-ink/70">
        Free, no sign-up required. Adjust anything below.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="text-sm font-medium text-charcoal-ink">Sex</legend>
          <div className="mt-1 flex gap-2">
            {(["female", "male"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={sex === value}
                onClick={() => setSex(value)}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green ${
                  sex === value
                    ? "border-brand-green bg-brand-green/10 font-medium text-deep-forest"
                    : "border-charcoal-ink/15 text-charcoal-ink/70 hover:border-charcoal-ink/30"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="bmi-age" className="text-sm font-medium text-charcoal-ink">
            Age
          </label>
          <input
            id="bmi-age"
            type="number"
            min={15}
            max={100}
            value={age}
            onChange={(e) => setAge(Math.max(15, Math.min(100, Number(e.target.value) || 0)))}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="bmi-height" className="text-sm font-medium text-charcoal-ink">
            Height (cm)
          </label>
          <input
            id="bmi-height"
            type="number"
            min={100}
            max={230}
            value={heightCm}
            onChange={(e) => setHeightCm(Math.max(0, Number(e.target.value) || 0))}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="bmi-weight" className="text-sm font-medium text-charcoal-ink">
            Weight (kg)
          </label>
          <input
            id="bmi-weight"
            type="number"
            min={25}
            max={250}
            value={weightKg}
            onChange={(e) => setWeightKg(Math.max(0, Number(e.target.value) || 0))}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="bmi-activity" className="text-sm font-medium text-charcoal-ink">
            Activity level
          </label>
          <select
            id="bmi-activity"
            value={activity}
            onChange={(e) => setActivity(e.target.value as ActivityLevel)}
            className={inputClass}
          >
            {ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {bmi && category ? (
        <div className="mt-6 rounded-xl bg-soft-sage p-5" role="status">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-heading text-3xl font-bold text-deep-forest">{bmi.toFixed(1)}</p>
            <p className={`text-sm font-semibold ${CATEGORY_COPY[category].tone}`}>
              {CATEGORY_COPY[category].label}
            </p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">
            {CATEGORY_COPY[category].body}
          </p>
          {maintenanceCalories ? (
            <div className="mt-4 border-t border-deep-forest/10 pt-4">
              <p className="text-sm text-charcoal-ink/75">
                Estimated calories to maintain your current weight:{" "}
                <span className="font-semibold text-charcoal-ink">
                  ~{maintenanceCalories.toLocaleString()} kcal/day
                </span>
              </p>
              {targetCalories ? (
                <p className="mt-1 text-sm text-charcoal-ink/75">
                  {wantsLoss
                    ? "For gradual weight loss (about 0.5kg/week), a common target is"
                    : "For gradual, healthy weight gain, a common target is"}{" "}
                  <span className="font-semibold text-charcoal-ink">
                    ~{targetCalories.toLocaleString()} kcal/day
                  </span>
                  .
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="mt-4 text-xs leading-relaxed text-charcoal-ink/65">
        A general estimate, not a diagnosis or personalised medical advice. BMI doesn&apos;t
        account for muscle mass, pregnancy, or every body type, and calorie needs vary by
        individual. For a plan built around your real health picture, a doctor on Tarragon can
        help.
      </p>

      <div className="mt-5 flex flex-wrap gap-3 border-t border-charcoal-ink/10 pt-5">
        <Link
          href={wantsLoss ? MARKETING_ROUTES.obesity : MARKETING_ROUTES.prevention}
          className="inline-flex h-10 items-center justify-center rounded-full bg-brand-green px-5 text-sm font-medium text-white transition-colors hover:bg-brand-green/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
        >
          {wantsLoss ? "See our Weight Health programme" : "See our Prevention programme"}
        </Link>
        <Link
          href={MARKETING_ROUTES.activityCalculator}
          className="inline-flex h-10 items-center justify-center rounded-full border border-charcoal-ink/15 px-5 text-sm font-medium text-charcoal-ink/80 transition-colors hover:border-charcoal-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
        >
          Try the activity calculator
        </Link>
      </div>
    </div>
  );
}
