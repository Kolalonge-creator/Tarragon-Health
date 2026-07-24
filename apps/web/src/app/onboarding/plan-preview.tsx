"use client";

import { useRiskScores } from "@/lib/queries/risk-assessment";
import { useCareProgrammeRecommendations } from "@/lib/queries/care-plan-recommendations";

const RISK_LABEL: Record<string, { label: string; tone: string }> = {
  low: { label: "Low", tone: "text-brand-green" },
  moderate: { label: "Moderate", tone: "text-amber-600" },
  high: { label: "High", tone: "text-red-600" },
  very_high: { label: "Very high", tone: "text-red-700" },
};

const RISK_ORDER = ["low", "moderate", "high", "very_high"];

const CONDITION_LABEL: Record<string, string> = {
  hypertension: "Hypertension programme",
  diabetes: "Diabetes programme",
  obesity: "Obesity programme",
  cardiovascular: "Cardiovascular prevention programme",
  ckd: "Kidney health programme",
  asthma: "Asthma programme",
  copd: "COPD programme",
  heart_failure: "Heart failure programme",
  other: "Chronic care programme",
};

/**
 * The honest plan-preview moment at the end of onboarding intake — Noom's
 * projection screen without the dark patterns: no invented numbers, no fake
 * countdown, no weight-by-November promise. It synthesises only what the
 * intake actually produced (real prevention_risk_scores + real
 * care_plan_recommendations rows, both patient-visible under RLS) and frames
 * programme suggestions as pending care-team review — never as a doctor's
 * signed plan.
 */
export function PlanPreview({ patientId }: { patientId: string }) {
  const { data: scores } = useRiskScores(patientId);
  const { data: recommendations } = useCareProgrammeRecommendations(patientId);

  const hasScores = (scores ?? []).length > 0;
  const hasRecs = (recommendations ?? []).length > 0;
  if (!hasScores && !hasRecs) return null;

  const topRisk = (scores ?? []).reduce<string | null>((acc, s) => {
    if (!s.tier) return acc;
    if (!acc) return s.tier;
    return RISK_ORDER.indexOf(s.tier) > RISK_ORDER.indexOf(acc) ? s.tier : acc;
  }, null);
  const risk = topRisk ? RISK_LABEL[topRisk] : null;

  return (
    <div className="space-y-4 rounded-xl border border-brand-green/25 bg-brand-green/[0.04] p-6">
      <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
        What your answers tell us
      </h2>
      {risk && (
        <p className="text-sm text-charcoal-ink">
          Based on what you shared, your overall health risk today looks{" "}
          <span className={`font-semibold ${risk.tone}`}>{risk.label.toLowerCase()}</span>.
          This is a starting picture, not a diagnosis — real readings will sharpen it.
        </p>
      )}
      {hasRecs && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-charcoal-ink">Suggested for you:</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
            {(recommendations ?? []).map((rec) => (
              <li key={rec.id}>
                {CONDITION_LABEL[rec.condition] ?? "Care programme"}
                <span className="text-charcoal-ink/50"> — pending your care team&apos;s review</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-charcoal-ink">Your first 90 days:</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-charcoal-ink/80">
          <li>Log readings regularly — your baseline builds in the first two weeks.</li>
          <li>
            Your care team reviews your profile{hasRecs ? " and the suggestions above" : ""} and
            sets up your plan.
          </li>
          <li>Screenings and check-ins land on your calendar — we remind you, you tap to book.</li>
        </ol>
      </div>
      <p className="text-xs text-charcoal-ink/50">
        Everything here stays visible on your dashboard — nothing is locked behind this
        screen.
      </p>
    </div>
  );
}
