"use client";

import { useCareProgrammeRecommendations } from "@/lib/queries/care-plan-recommendations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CONDITION_LABEL: Record<string, string> = {
  hypertension: "Blood pressure care",
  diabetes: "Diabetes care",
  cardiovascular: "Heart health care",
  obesity: "Weight & metabolic care",
  ckd: "Kidney care",
  other: "Care programme",
};

/**
 * Patient-facing "recommended for you" card. Deliberately framed as a
 * suggestion pending the care team's review — it must never claim a doctor
 * has reviewed it (docs/CLINICAL_TRUST_MODEL_SPEC.md). Null-gated: renders
 * nothing when there are no open recommendations.
 */
export function CareProgrammeRecommendations({ patientId }: { patientId: string }) {
  const { data: recommendations } = useCareProgrammeRecommendations(patientId);

  if (!recommendations || recommendations.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recommended for you</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/60">
          Based on your answers, these programmes may help. Your care team will review and
          confirm what&apos;s right for you.
        </p>
        <ul className="space-y-2">
          {recommendations.map((rec) => (
            <li
              key={rec.id}
              className="rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-charcoal-ink">
                  {CONDITION_LABEL[rec.condition] ?? rec.condition}
                </span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Pending review
                </span>
              </div>
              <p className="mt-1 text-sm text-charcoal-ink/70">{rec.rationale}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
