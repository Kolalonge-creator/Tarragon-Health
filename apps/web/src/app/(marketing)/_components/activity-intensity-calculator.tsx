"use client";

import { useState } from "react";
import Link from "next/link";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

/**
 * Public, no-login physical-activity intensity + calorie-burn estimate.
 * MET values are the standard Compendium of Physical Activities figures
 * (the same reference class HealthHub-style tools use); calories burned =
 * MET x weight(kg) x hours. WHO's guideline of 150 weekly minutes of
 * moderate activity (or 75 vigorous, vigorous counting double) is the
 * progress bar's target — this tool never persists anything or tracks a
 * real week, it's a single-session estimate, consistent with the site's
 * app/web-is-the-transactional-layer rule (this is marketing, not the app).
 */

type Intensity = "light" | "moderate" | "vigorous";

type Activity = { key: string; label: string; met: number; intensity: Intensity };

const ACTIVITIES: Activity[] = [
  { key: "walking_slow", label: "Slow walking (strolling)", met: 2.8, intensity: "light" },
  { key: "stretching", label: "Stretching / yoga", met: 2.5, intensity: "light" },
  { key: "housework", label: "Housework (sweeping, mopping)", met: 3.3, intensity: "moderate" },
  { key: "walking_brisk", label: "Brisk walking", met: 3.8, intensity: "moderate" },
  { key: "cycling_leisure", label: "Cycling (leisurely)", met: 4.0, intensity: "moderate" },
  { key: "gardening", label: "Gardening / farm work", met: 4.3, intensity: "moderate" },
  { key: "dancing", label: "Dancing (social / Afrobeats)", met: 4.5, intensity: "moderate" },
  { key: "gym_weights", label: "Weight training", met: 5.0, intensity: "moderate" },
  { key: "jogging", label: "Jogging", met: 7.0, intensity: "vigorous" },
  { key: "football", label: "Football / soccer", met: 7.0, intensity: "vigorous" },
  { key: "swimming", label: "Swimming (laps)", met: 7.0, intensity: "vigorous" },
  { key: "climbing_stairs", label: "Climbing stairs", met: 8.0, intensity: "vigorous" },
  { key: "cycling_fast", label: "Cycling (fast / hilly)", met: 8.0, intensity: "vigorous" },
  { key: "running", label: "Running (fast)", met: 9.8, intensity: "vigorous" },
  { key: "skipping_rope", label: "Skipping rope", met: 10.0, intensity: "vigorous" },
];

const INTENSITY_COPY: Record<Intensity, { label: string; tone: string }> = {
  light: { label: "Light intensity", tone: "text-charcoal-ink/70" },
  moderate: { label: "Moderate intensity", tone: "text-deep-forest" },
  vigorous: { label: "Vigorous intensity", tone: "text-brand-green" },
};

const WEEKLY_TARGET_MINUTES = 150;

export function ActivityIntensityCalculator() {
  const [activityKey, setActivityKey] = useState(ACTIVITIES[3].key);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [weightKg, setWeightKg] = useState(70);

  const activity = ACTIVITIES.find((a) => a.key === activityKey) ?? ACTIVITIES[0];
  const caloriesBurned = Math.round(activity.met * weightKg * (durationMinutes / 60));
  const moderateEquivalentMinutes =
    activity.intensity === "vigorous" ? durationMinutes * 2 : activity.intensity === "moderate" ? durationMinutes : 0;
  const progressPct = Math.min(100, Math.round((moderateEquivalentMinutes / WEEKLY_TARGET_MINUTES) * 100));

  const inputClass =
    "mt-1 w-full rounded-xl border border-charcoal-ink/15 bg-white px-3 py-2 text-sm text-charcoal-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-charcoal-ink/10 bg-white p-8 shadow-sm">
      <h3 className="font-heading text-2xl font-semibold text-charcoal-ink">
        Estimate your activity intensity and calories burned
      </h3>
      <p className="mt-2 text-charcoal-ink/70">
        Free, no sign-up required. Pick an activity and how long you did it.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="activity-select" className="text-sm font-medium text-charcoal-ink">
            Activity
          </label>
          <select
            id="activity-select"
            value={activityKey}
            onChange={(e) => setActivityKey(e.target.value)}
            className={inputClass}
          >
            {ACTIVITIES.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="activity-duration" className="flex justify-between text-sm font-medium text-charcoal-ink">
            <span>Duration</span>
            <span>{durationMinutes} min</span>
          </label>
          <input
            id="activity-duration"
            type="range"
            min={5}
            max={180}
            step={5}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className="mt-3 w-full accent-[#0E7C52]"
          />
        </div>

        <div>
          <label htmlFor="activity-weight" className="text-sm font-medium text-charcoal-ink">
            Your weight (kg)
          </label>
          <input
            id="activity-weight"
            type="number"
            min={25}
            max={250}
            value={weightKg}
            onChange={(e) => setWeightKg(Math.max(0, Number(e.target.value) || 0))}
            className={inputClass}
          />
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-soft-sage p-5" role="status">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-heading text-3xl font-bold text-deep-forest">
            ~{caloriesBurned.toLocaleString()} <span className="text-base font-medium">kcal</span>
          </p>
          <p className={`text-sm font-semibold ${INTENSITY_COPY[activity.intensity].tone}`}>
            {INTENSITY_COPY[activity.intensity].label}
          </p>
        </div>
        <p className="mt-2 text-sm text-charcoal-ink/75">
          {durationMinutes} minutes of {activity.label.toLowerCase()} for someone weighing{" "}
          {weightKg}kg.
        </p>

        <div className="mt-4 border-t border-deep-forest/10 pt-4">
          <p className="text-xs font-medium text-charcoal-ink/70">
            Progress toward WHO&apos;s 150-minutes-a-week moderate-activity guideline
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-brand-green transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-charcoal-ink/60">
            {activity.intensity === "light"
              ? "Light activity is great for recovery and daily movement, but doesn't count toward this particular guideline."
              : `This session alone is about ${progressPct}% of the weekly target${activity.intensity === "vigorous" ? " (vigorous minutes count double)" : ""}.`}
          </p>
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-charcoal-ink/50">
        A general estimate from average energy-expenditure tables, not a personalised
        prescription. Actual calories burned vary with fitness level, terrain, and effort. If
        you&apos;re starting a new routine and live with a heart condition, high blood pressure, or
        another chronic condition, it&apos;s worth checking with your doctor first.
      </p>

      <div className="mt-5 flex flex-wrap gap-3 border-t border-charcoal-ink/10 pt-5">
        <Link
          href={MARKETING_ROUTES.obesity}
          className="inline-flex h-10 items-center justify-center rounded-full bg-brand-green px-5 text-sm font-medium text-white transition-colors hover:bg-brand-green/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
        >
          See lifestyle coaching support
        </Link>
        <Link
          href={MARKETING_ROUTES.bmiCalculator}
          className="inline-flex h-10 items-center justify-center rounded-full border border-charcoal-ink/15 px-5 text-sm font-medium text-charcoal-ink/80 transition-colors hover:border-charcoal-ink/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
        >
          Try the BMI calculator
        </Link>
      </div>
    </div>
  );
}
