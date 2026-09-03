"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { requestNutritionReferralAction } from "./nutrition-actions";
import { useNutritionEntries, useNutritionReferral } from "@/lib/queries/nutrition";
import { detectNutritionRisk, RISK_REASON_LABELS } from "@/lib/nutrition/referral-risk";
import type { NutritionAnalysisResult } from "@/lib/nutrition/nutrition-analysis";
import type { CarePlanCondition } from "@/lib/nutrition/condition-guidance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * The professional nutrition pathway (spec 19.11): nutrition risk -> a
 * dietitian referral request -> consultation -> personalised plan. This
 * component only ever surfaces the option and records the patient's own
 * request — it never creates or escalates a referral on its own (see
 * requestNutritionReferralAction).
 */

const STATUS_COPY: Record<string, string> = {
  requested: "You've asked for nutrition support. Your care team will follow up to arrange a consultation.",
  scheduled: "Your dietitian consultation is scheduled.",
  consultation_complete: "Your consultation is complete — a personalised plan is being prepared.",
  plan_issued: "Your personalised nutrition plan is ready. Ask your care team to walk you through it.",
  declined: "This request wasn't taken forward right now.",
  not_applicable: "Nutrition support wasn't needed for this request.",
};

const STATUS_BADGE: Record<string, "grey" | "blue" | "green" | "amber"> = {
  requested: "blue",
  scheduled: "blue",
  consultation_complete: "blue",
  plan_issued: "green",
  declined: "grey",
  not_applicable: "grey",
};

export function NutritionSupportCard({
  patientId,
  activeConditions,
}: {
  patientId: string;
  activeConditions: CarePlanCondition[];
}) {
  const queryClient = useQueryClient();
  const { data: entries } = useNutritionEntries(patientId);
  const { data: referral } = useNutritionReferral(patientId);
  const [state, formAction, isPending] = useActionState(requestNutritionReferralAction, undefined);

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["nutrition-referral", patientId] });
    }
  }, [state, queryClient, patientId]);

  const recentAnalyses = (entries ?? [])
    .map((e) => e.nutrition_analysis as unknown as NutritionAnalysisResult | null)
    .filter((a): a is NutritionAnalysisResult => a != null);
  const risk = detectNutritionRisk(activeConditions, recentAnalyses);

  // Nothing to anchor this card to yet — no chronic condition, no logged
  // meals, no existing request. Avoid showing an empty invitation to every
  // patient regardless of context.
  if (!referral && activeConditions.length === 0 && (entries?.length ?? 0) === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Nutrition support</CardTitle>
        {referral && (
          <Badge variant={STATUS_BADGE[referral.status] ?? "grey"}>
            {referral.status.replace(/_/g, " ")}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {referral ? (
          <p className="text-sm text-charcoal-ink/80">
            {STATUS_COPY[referral.status] ?? "Your care team is coordinating this."}
          </p>
        ) : (
          <>
            <p className="text-sm text-charcoal-ink/80">
              {risk.atRisk
                ? risk.reasons.map((r) => RISK_REASON_LABELS[r]).join(" ")
                : "Want extra support with your nutrition? Your care team can connect you with a dietitian for a plan built around you."}
            </p>
            <form action={formAction}>
              <Button type="submit" variant="outline" disabled={isPending}>
                {isPending ? "Requesting…" : "Request nutrition support"}
              </Button>
            </form>
            {state && "error" in state && state.error && (
              <p className="text-sm text-red-600">{state.error}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
