"use client";

import { useRiskScores } from "@/lib/queries/risk-assessment";
import { useLatestMentalHealthScreens } from "@/lib/queries/mental-health";
import { useCarePlans } from "@/lib/queries/care-plans";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

const RISK_BADGE: Record<string, BadgeProps["variant"]> = {
  low: "green",
  moderate: "amber",
  high: "red",
  very_high: "red",
};

const MENTAL_HEALTH_LABEL: Record<string, string> = {
  phq9: "PHQ-9 (depression)",
  gad7: "GAD-7 (anxiety)",
  auditc: "AUDIT-C (alcohol)",
};

/**
 * AI intake bridge: the risk assessment, PHQ-9/GAD-7/AUDIT-C intake
 * screens, and active care-plan conditions already exist and already feed
 * patient_risk_scores/care-plan recommendations — but none of it landed as
 * one structured summary a clinician sees before/during a visit. This
 * composes those existing signals into a single "pre-visit summary" at the
 * top of the patient detail page (linked from each Worklist alert row),
 * rather than a fifth place a Tier 1 clinician has to look. Read-only —
 * no new data, no new scoring, nothing clinical is decided here.
 */
export function PreVisitSummary({ patientId }: { patientId: string }) {
  const riskScores = useRiskScores(patientId);
  const mentalHealth = useLatestMentalHealthScreens(patientId);
  const carePlans = useCarePlans(patientId);

  const isLoading = riskScores.isLoading || mentalHealth.isLoading || carePlans.isLoading;
  const hasNothing =
    !isLoading &&
    (riskScores.data ?? []).length === 0 &&
    Object.keys(mentalHealth.data ?? {}).length === 0 &&
    (carePlans.data ?? []).length === 0;

  return (
    <Card className="border-brand-green/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.aiCoach className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Pre-visit summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {hasNothing && (
          <p className="text-sm text-charcoal-ink/60">
            No risk assessment, intake screen, or active care plan on file yet.
          </p>
        )}

        {(carePlans.data ?? []).length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Active care plans
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(carePlans.data ?? []).map((plan) => (
                <Badge key={plan.id} variant="grey">
                  {plan.condition}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {(riskScores.data ?? []).length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Prevention risk
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(riskScores.data ?? []).map((score) => (
                <Badge key={score.id} variant={RISK_BADGE[score.tier] ?? "grey"}>
                  {score.condition}: {score.tier.replace("_", " ")}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {Object.keys(mentalHealth.data ?? {}).length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Intake screens
            </p>
            <ul className="mt-1 space-y-1">
              {Object.entries(mentalHealth.data ?? {}).map(([instrument, screen]) => (
                <li key={instrument} className="flex items-center gap-2 text-xs">
                  <span className="text-charcoal-ink/70">
                    {MENTAL_HEALTH_LABEL[instrument] ?? instrument}:{" "}
                    {screen?.severity_band.replace(/_/g, " ")}
                  </span>
                  {screen?.crisis_flagged && <Badge variant="red">Crisis flag</Badge>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
