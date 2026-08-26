"use client";

import Link from "next/link";
import { useLatestHealthScore, useHealthScoreHistory } from "@/lib/queries/health-score";
import { usePatientChronologicalAge } from "@/lib/queries/patient-demographics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import {
  getHealthScoreTips,
  getPriorityHealthScoreTip,
  computeHealthScoreTrend,
  type HealthScoreComponent,
  type HealthScoreRiskLevel,
} from "@/lib/rules/health-score";
import { computeBiologicalAge, describeBiologicalAgeTrend } from "@/lib/rules/biological-age";

/**
 * Signed-off v1 presentation of the existing Health Score as an age
 * estimate (lib/rules/biological-age.ts) — same data, same disclaimer,
 * reframed. Mirrors health-score-card.tsx's structure closely on purpose:
 * same query hooks, same component/tip helpers, same loading/empty/error
 * states — the only new things are the ring visual and the age framing.
 *
 * The ring recolors by risk level like any meter (dataviz: "the fill
 * carries severity, the unfilled track is a lighter step of the same
 * ramp"), while staying the separate clinical-status color system from
 * brand color per CLAUDE.md — the badge already draws from that system;
 * this just extends it to the ring/age-gap chip.
 */
const RISK_LEVEL_STYLE: Record<
  HealthScoreRiskLevel,
  { badgeVariant: "green" | "amber" | "red"; label: string; ringFill: string; ringTrack: string }
> = {
  low: { badgeVariant: "green", label: "On track", ringFill: "#0e7c52", ringTrack: "#e7eee7" },
  moderate: {
    badgeVariant: "amber",
    label: "Room to improve",
    ringFill: "#d97706",
    ringTrack: "#fef3c7",
  },
  high: {
    badgeVariant: "red",
    label: "Needs attention",
    ringFill: "#dc2626",
    ringTrack: "#fee2e2",
  },
  very_high: {
    badgeVariant: "red",
    label: "Needs urgent attention",
    ringFill: "#dc2626",
    ringTrack: "#fee2e2",
  },
};

const COMPONENT_LABEL: Record<HealthScoreComponent["key"], string> = {
  bp_control: "Blood pressure",
  hba1c: "HbA1c",
  screening_compliance: "Screening",
  vaccination: "Vaccinations",
  bmi: "Weight (BMI)",
  smoking: "Smoking",
};

const RING_RADIUS = 64;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function BiologicalAgeCard({ patientId }: { patientId: string }) {
  const { data: score, isLoading: isScoreLoading, isError } = useLatestHealthScore(patientId);
  const { data: history } = useHealthScoreHistory(patientId);
  const { data: chronologicalAge, isLoading: isAgeLoading } =
    usePatientChronologicalAge(patientId);

  const isLoading = isScoreLoading || isAgeLoading;

  // No date of birth on file yet: nothing honest to estimate from, so this
  // card self-hides rather than showing a broken state — the same
  // convention the dashboard already uses for its other conditional cards
  // (see the (sections)/page.tsx comment above BiomarkerCategoriesCard).
  if (!isLoading && chronologicalAge == null) return null;

  const components =
    (score?.inputs as { components?: HealthScoreComponent[] } | null)?.components ?? [];
  const priorityTip = getPriorityHealthScoreTip(components);
  const tips = getHealthScoreTips(components).filter((tip) => tip !== priorityTip?.tip);

  const scoredHistory = history?.filter(
    (h): h is { score: number; inputs: typeof h.inputs; computed_at: string } => h.score !== null,
  );
  const scoreTrend = scoredHistory ? computeHealthScoreTrend(scoredHistory) : null;
  const trendLine =
    scoreTrend && chronologicalAge != null
      ? describeBiologicalAgeTrend(scoreTrend, chronologicalAge)
      : null;

  const estimate =
    score?.score != null && chronologicalAge != null
      ? computeBiologicalAge(chronologicalAge, score.score)
      : null;
  const riskLevel = score?.risk_level as HealthScoreRiskLevel | null;
  const style = riskLevel ? RISK_LEVEL_STYLE[riskLevel] : null;

  const dashOffset =
    score?.score != null
      ? RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, score.score)) / 100)
      : RING_CIRCUMFERENCE;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your Biological Age
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load your Biological Age.</p>}
        {!isLoading && !isError && !score && (
          <p className="text-sm text-charcoal-ink/60">
            Log a reading or finish your risk assessment to see your first Biological Age
            estimate.
          </p>
        )}
        {!isLoading && !isError && score && estimate && style && (
          <>
            <div className="flex flex-col items-center gap-3.5">
              <div className="relative h-40 w-40">
                <svg width="160" height="160" viewBox="0 0 160 160">
                  <circle
                    cx="80"
                    cy="80"
                    r={RING_RADIUS}
                    fill="none"
                    stroke={style.ringTrack}
                    strokeWidth="12"
                  />
                  <circle
                    cx="80"
                    cy="80"
                    r={RING_RADIUS}
                    fill="none"
                    stroke={style.ringFill}
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={dashOffset}
                    transform="rotate(-90 80 80)"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-heading text-[42px] font-semibold leading-none tracking-tight text-charcoal-ink">
                    {estimate.estimatedAge}
                  </span>
                  <span className="mt-0.5 text-[13px] font-medium text-charcoal-ink/55">
                    yrs, estimated
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Badge variant={style.badgeVariant}>{style.label}</Badge>
                {estimate.yearsYoungerThanChronological !== 0 && (
                  <span
                    className={
                      estimate.yearsYoungerThanChronological > 0
                        ? "inline-flex items-center rounded-full border border-brand-green/30 px-2.5 py-0.5 text-xs font-medium text-brand-green"
                        : "inline-flex items-center rounded-full border border-charcoal-ink/15 px-2.5 py-0.5 text-xs font-medium text-charcoal-ink/60"
                    }
                  >
                    {Math.abs(estimate.yearsYoungerThanChronological)}{" "}
                    {Math.abs(estimate.yearsYoungerThanChronological) === 1 ? "yr" : "yrs"}{" "}
                    {estimate.yearsYoungerThanChronological > 0 ? "younger" : "older"} than birth
                    age ({chronologicalAge})
                  </span>
                )}
              </div>
            </div>

            <p className="text-center text-xs text-charcoal-ink/60">
              A non-diagnostic summary of a few everyday habits and numbers we already have on
              file — not a medical diagnosis. Updated{" "}
              {new Date(score.computed_at).toLocaleDateString()}.
            </p>

            {trendLine && (
              <p className="rounded-md bg-soft-sage px-3 py-2 text-sm text-deep-forest">
                {trendLine}
              </p>
            )}

            <Link
              href="/patient/biological-age"
              className="flex items-center justify-between text-sm font-medium text-brand-green hover:underline"
            >
              See your trend over time
              <NAV_ICON.chevronRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </Link>

            {components.length > 0 && (
              <div className="grid grid-cols-2 gap-2 pt-2">
                {components.map((component, index) => {
                  const isLastOdd =
                    components.length % 2 === 1 && index === components.length - 1;
                  return (
                    <div
                      key={component.key}
                      className={`flex flex-col gap-0.5 rounded-lg bg-warm-ivory px-3 py-2.5 ${
                        isLastOdd ? "col-span-2" : ""
                      }`}
                    >
                      <span className="text-[11px] text-charcoal-ink/55">
                        {COMPONENT_LABEL[component.key]}
                      </span>
                      <span className="text-[17px] font-semibold text-charcoal-ink">
                        {Math.round(component.value)}
                        <span className="text-[11px] font-medium text-charcoal-ink/40">/100</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {priorityTip && (
              <div className="space-y-1 border-t border-charcoal-ink/10 pt-3">
                <p className="text-xs font-medium text-charcoal-ink/70">
                  Start here for the biggest lift
                </p>
                <p className="rounded-md bg-soft-sage px-3 py-2 text-sm text-deep-forest">
                  {priorityTip.tip}
                </p>
              </div>
            )}
            {tips.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-xs font-medium text-charcoal-ink/70">
                  {priorityTip ? "Other things that could help" : "A few things that could help"}
                </p>
                <ul className="list-inside list-disc space-y-1 text-sm text-charcoal-ink/80">
                  {tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
