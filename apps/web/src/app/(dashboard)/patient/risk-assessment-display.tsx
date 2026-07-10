"use client";

import { useRiskScores } from "@/lib/queries/risk-assessment";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PreventionCondition, RiskTier } from "@/lib/rules/risk-scoring";
import { SEMANTIC_ICON } from "@/lib/icons";

const CONDITION_LABELS: Record<PreventionCondition, string> = {
  hypertension: "Hypertension",
  diabetes: "Diabetes",
  cvd: "Heart disease",
  breast_ca: "Breast cancer",
  cervical_ca: "Cervical cancer",
  colorectal_ca: "Colorectal cancer",
  prostate_ca: "Prostate cancer",
  other: "Other",
};

// Clinical-dashboard status colors (green/amber/red) — a separate system
// from brand color, per CLAUDE.md.
const TIER_BADGE: Record<RiskTier, "green" | "amber" | "red"> = {
  low: "green",
  moderate: "amber",
  high: "red",
};

function humanizeFactor(factor: string) {
  return factor.split("_").join(" ");
}

export function RiskAssessmentDisplay({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useRiskScores(patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your risk tiers
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load your risk assessment.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            Fill in the assessment above to see your personal risk tiers — a starting
            point for your care, not a diagnosis.
          </p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((score) => {
              const snapshot = (score.inputs_snapshot ?? {}) as Record<string, unknown>;
              const factors = Array.isArray(snapshot.factors) ? (snapshot.factors as string[]) : [];
              const forcedBy = typeof snapshot.forced_by === "string" ? snapshot.forced_by : null;

              return (
                <li key={score.id} className="space-y-1 py-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">
                      {CONDITION_LABELS[score.condition]}
                    </p>
                    <Badge variant={TIER_BADGE[score.tier as RiskTier]}>
                      {score.tier.charAt(0).toUpperCase() + score.tier.slice(1)}
                    </Badge>
                  </div>
                  {forcedBy === "existing_diagnosis" ? (
                    <p className="text-xs text-charcoal-ink/60">
                      Based on a diagnosis you already told us about.
                    </p>
                  ) : factors.length > 0 ? (
                    <p className="text-xs text-charcoal-ink/60">
                      Because: {factors.map(humanizeFactor).join(", ")}.
                    </p>
                  ) : (
                    <p className="text-xs text-charcoal-ink/60">
                      No major risk factors noted right now.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
