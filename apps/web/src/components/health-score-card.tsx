"use client";

import { useLatestHealthScore } from "@/lib/queries/health-score";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { HealthScoreComponent, HealthScoreRiskLevel } from "@/lib/rules/health-score";

// Clinical-dashboard status colors (green/amber/red) — a separate system
// from brand color, per CLAUDE.md. Matches risk-assessment-display.tsx's
// low/moderate/high convention, extended with very_high.
const RISK_LEVEL_BADGE: Record<HealthScoreRiskLevel, { variant: "green" | "amber" | "red"; label: string }> = {
  low: { variant: "green", label: "On track" },
  moderate: { variant: "amber", label: "Room to improve" },
  high: { variant: "red", label: "Needs attention" },
  very_high: { variant: "red", label: "Needs urgent attention" },
};

const COMPONENT_LABEL: Record<HealthScoreComponent["key"], string> = {
  bp_control: "Blood pressure control",
  hba1c: "HbA1c",
  screening_compliance: "Screening compliance",
  bmi: "Weight (BMI)",
  smoking: "Smoking",
};

export function HealthScoreCard({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useLatestHealthScore(patientId);
  const components = (data?.inputs as { components?: HealthScoreComponent[] } | null)?.components ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your Health Score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load your Health Score.</p>}
        {!isLoading && !isError && !data && (
          <p className="text-sm text-charcoal-ink/60">
            Log a reading or finish your risk assessment to get your first Health Score.
          </p>
        )}
        {data && (
          <>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-semibold text-charcoal-ink">{data.score}</span>
              <span className="text-sm text-charcoal-ink/60">/ 100</span>
              {data.risk_level && (
                <Badge variant={RISK_LEVEL_BADGE[data.risk_level as HealthScoreRiskLevel].variant}>
                  {RISK_LEVEL_BADGE[data.risk_level as HealthScoreRiskLevel].label}
                </Badge>
              )}
            </div>
            <p className="text-xs text-charcoal-ink/60">
              A non-diagnostic summary of a few everyday habits and numbers we already have on
              file — not a medical diagnosis. Updated {new Date(data.computed_at).toLocaleDateString()}.
            </p>
            {components.length > 0 && (
              <ul className="space-y-1 pt-2 text-sm text-charcoal-ink">
                {components.map((component) => (
                  <li key={component.key} className="flex items-center justify-between">
                    <span>{COMPONENT_LABEL[component.key]}</span>
                    <span className="text-charcoal-ink/60">{Math.round(component.value)}/100</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
