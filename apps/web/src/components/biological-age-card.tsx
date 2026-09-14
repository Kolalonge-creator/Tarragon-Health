"use client";

import Link from "next/link";
import { useLatestHealthScore, useHealthScoreHistory } from "@/lib/queries/health-score";
import { usePatientChronologicalAge } from "@/lib/queries/patient-demographics";
import { useIsFeatureEnabled } from "@/lib/queries/feature-flags";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/ui/score-ring";
import { HealthScoreComponentGrid } from "@/components/health-score-component-grid";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import {
  getHealthScoreTips,
  getPriorityHealthScoreTip,
  computeHealthScoreTrend,
  type HealthScoreComponent,
  type HealthScoreRiskLevel,
} from "@/lib/rules/health-score";
import { computeBiologicalAge, describeBiologicalAgeTrend } from "@/lib/rules/biological-age";
import { RISK_LEVEL_RING } from "@/lib/rules/risk-level-style";

/**
 * A reframe of the existing Health Score (lib/rules/biological-age.ts) as an age
 * estimate. Mirrors health-score-card.tsx's structure closely on purpose: same query
 * hooks, same component/tip helpers, same loading/empty/error states — the new things
 * are the ring visual, the age framing, and this card's gate.
 *
 * Gated behind the `biological_age_card` feature flag (default `status = 'off'`,
 * migration 20260914180424) rather than shown unconditionally: presenting a derived
 * "age" is a stronger patient-facing clinical claim than the 0-100 score it reframes
 * (health-score.ts's own v1 scope note flags this), and as of this card's introduction
 * no real Clinical Director sign-off exists for it — only the code. That underlying
 * score now folds in real, clinician-reviewed lab-panel findings (heart/kidney/liver —
 * see health-score.ts's 2026-09-14 update), which makes the claim behind this card
 * stronger still, not weaker — more reason the gate stays on, not less. Do not remove
 * this gate or flip the flag's live-DB row to 'on'/'rollout' without that sign-off
 * actually happening first; see lib/rules/biological-age.ts's module doc for the full
 * history.
 *
 * Uses the shared ScoreRing component/RISK_LEVEL_RING tokens (also used by
 * health-score-card.tsx's own ring) so the two cards look like one visual system
 * rather than two independently-styled gauges.
 */
const RISK_LEVEL_STYLE: Record<
  HealthScoreRiskLevel,
  { badgeVariant: "green" | "amber" | "red"; label: string }
> = {
  low: { badgeVariant: "green", label: "On track" },
  moderate: { badgeVariant: "amber", label: "Room to improve" },
  high: { badgeVariant: "red", label: "Needs attention" },
  very_high: { badgeVariant: "red", label: "Needs urgent attention" },
};

export function BiologicalAgeCard({ patientId }: { patientId: string }) {
  const isEnabled = useIsFeatureEnabled("biological_age_card");
  const { data: score, isLoading: isScoreLoading, isError } = useLatestHealthScore(patientId);
  const { data: history } = useHealthScoreHistory(patientId);
  const { data: chronologicalAge, isLoading: isAgeLoading } =
    usePatientChronologicalAge(patientId);

  const isLoading = isScoreLoading || isAgeLoading;

  // Flag off, or no date of birth on file: nothing to show, and nothing honest to
  // estimate from either way — self-hides rather than a broken/placeholder state,
  // the same convention the dashboard uses for its other conditional cards.
  if (!isEnabled) return null;
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
  const badgeStyle = riskLevel ? RISK_LEVEL_STYLE[riskLevel] : null;
  const ringColorVar = riskLevel ? RISK_LEVEL_RING[riskLevel] : RISK_LEVEL_RING.low;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive
            className="h-5 w-5 text-deep-forest dark:text-brand-green-bright"
            strokeWidth={2}
          />
          Your Biological Age
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-300">
            Could not load your Biological Age.
          </p>
        )}
        {!isLoading && !isError && !score && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Log a reading or finish your risk assessment to see your first Biological Age
            estimate.
          </p>
        )}
        {!isLoading && !isError && score && estimate && badgeStyle && (
          <>
            <div className="flex flex-col items-center gap-3.5">
              <ScoreRing value={score.score ?? 0} colorVar={ringColorVar}>
                <span className="font-heading text-[42px] font-semibold leading-none tracking-tight text-charcoal-ink dark:text-night-ink">
                  {estimate.estimatedAge}
                </span>
                <span className="mt-0.5 text-[13px] font-medium text-charcoal-ink/55 dark:text-night-ink/55">
                  yrs, estimated
                </span>
              </ScoreRing>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Badge variant={badgeStyle.badgeVariant}>{badgeStyle.label}</Badge>
                {estimate.yearsYoungerThanChronological !== 0 && (
                  <span
                    className={
                      estimate.yearsYoungerThanChronological > 0
                        ? "inline-flex items-center rounded-full border border-brand-green/30 px-2.5 py-0.5 text-xs font-medium text-brand-green dark:border-brand-green-bright/30 dark:text-brand-green-bright"
                        : "inline-flex items-center rounded-full border border-charcoal-ink/15 px-2.5 py-0.5 text-xs font-medium text-charcoal-ink/60 dark:border-night-ink/20 dark:text-night-ink/60"
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

            <p className="text-center text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              An illustrative estimate built from the same Health Score shown elsewhere on your
              dashboard — including your care team&apos;s review of any lab results on file, when
              you have them. Not a dedicated biological-age panel or genetic test, and not a medical
              diagnosis. Updated {new Date(score.computed_at).toLocaleDateString()}.
            </p>

            {trendLine && (
              <p className="rounded-md bg-soft-sage dark:bg-brand-green/20 px-3 py-2 text-sm text-deep-forest dark:text-brand-green-bright">
                {trendLine}
              </p>
            )}

            <Link
              href="/patient/biological-age"
              className="flex items-center justify-between text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline"
            >
              See your trend over time
              <NAV_ICON.chevronRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </Link>

            <div className="pt-2">
              <HealthScoreComponentGrid components={components} />
            </div>

            {priorityTip && (
              <div className="space-y-1 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-3">
                <p className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
                  Start here for the biggest lift
                </p>
                <p className="rounded-md bg-soft-sage dark:bg-brand-green/20 px-3 py-2 text-sm text-deep-forest dark:text-brand-green-bright">
                  {priorityTip.tip}
                </p>
              </div>
            )}
            {tips.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
                  {priorityTip ? "Other things that could help" : "A few things that could help"}
                </p>
                <ul className="list-inside list-disc space-y-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
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
