"use client";

import { useLatestHealthScore } from "@/lib/queries/health-score";
import type { HealthScoreRiskLevel } from "@/lib/rules/health-score";

// Spec §76.2 ("home screen") wants one prominent status word up top — "Your
// health: Stable" — distinct from HealthScoreCard's numeric score + small
// badge further down the page. Same underlying signal
// (patient_risk_scores.risk_level, computed by assessHealthScoreBestEffort),
// just promoted to its own line at the top of Overview rather than buried in
// a card. Never a second, disagreeing judgement of "how am I doing".
const STATUS_WORD: Record<HealthScoreRiskLevel, { word: string; dot: string }> = {
  low: { word: "Stable", dot: "bg-green-500" },
  moderate: { word: "Improving", dot: "bg-amber-500" },
  high: { word: "Needs attention", dot: "bg-red-500" },
  very_high: { word: "Needs urgent attention", dot: "bg-red-600" },
};

export function HealthStatusBanner({ patientId }: { patientId: string }) {
  const { data, isLoading } = useLatestHealthScore(patientId);

  // No score computed yet (e.g. a brand-new patient) — say nothing rather
  // than fabricate a status word with no data behind it.
  if (isLoading || !data) return null;

  const status = STATUS_WORD[data.risk_level as HealthScoreRiskLevel];
  if (!status) return null;

  return (
    <p className="flex items-center gap-2 text-sm font-medium text-charcoal-ink">
      <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} aria-hidden />
      Your health: {status.word}
    </p>
  );
}
