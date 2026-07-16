"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useOrgCareProgrammeRecommendations,
  orgCarePlanRecommendationsKey,
  type CarePlanRecommendationWithPatient,
} from "@/lib/queries/care-plan-recommendations";
import { acceptRecommendation, dismissRecommendation } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const CONDITION_LABEL: Record<string, string> = {
  hypertension: "Hypertension",
  diabetes: "Diabetes",
  cardiovascular: "Cardiovascular",
  obesity: "Obesity / metabolic",
  ckd: "Chronic kidney disease",
  other: "Other",
};

function RecommendationRow({ rec }: { rec: CarePlanRecommendationWithPatient }) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orgCarePlanRecommendationsKey });

  const accept = useMutation({
    mutationFn: async () => {
      const result = await acceptRecommendation(rec.id);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: invalidate,
  });
  const dismiss = useMutation({
    mutationFn: async () => {
      const result = await dismissRecommendation(rec.id);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: invalidate,
  });

  const pending = accept.isPending || dismiss.isPending;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {rec.patient?.full_name ?? "Patient"}
          {rec.patient?.patient_number ? ` · ${rec.patient.patient_number}` : ""}
        </p>
        <Badge variant={rec.tier === "high" || rec.tier === "very_high" ? "red" : "amber"}>
          {CONDITION_LABEL[rec.condition] ?? rec.condition}
        </Badge>
      </div>
      <p className="text-xs text-charcoal-ink/70">{rec.rationale}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => accept.mutate()}>
          {accept.isPending ? "Creating plan…" : "Accept → create care plan"}
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => dismiss.mutate()}>
          Dismiss
        </Button>
      </div>
      {(accept.error || dismiss.error) && (
        <p className="text-xs text-red-600">
          {(accept.error as Error)?.message ?? (dismiss.error as Error)?.message}
        </p>
      )}
    </li>
  );
}

export default function RecommendationsPage() {
  const { data: recommendations, isLoading } = useOrgCareProgrammeRecommendations();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Care programme recommendations
        </h1>
        <p className="mt-1 text-sm text-charcoal-ink/60">
          Suggestions generated from patients&apos; onboarding risk assessments. Accepting one
          creates a draft care plan for you to review; dismissing removes it.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Open recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {!isLoading && (!recommendations || recommendations.length === 0) && (
            <p className="text-sm text-charcoal-ink/60">Nothing waiting — you&apos;re all caught up.</p>
          )}
          {recommendations && recommendations.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {recommendations.map((rec) => (
                <RecommendationRow key={rec.id} rec={rec} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
