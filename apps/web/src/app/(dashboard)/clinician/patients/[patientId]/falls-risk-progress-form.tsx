"use client";

import { useActionState, useState } from "react";
import { progressFallsRiskPathway } from "./healthy-ageing-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { FALLS_PATHWAY_STAGE_LABEL, type FallsRiskPathwayStage } from "@/lib/healthy-ageing/types";

const NEXT_STAGE: Partial<Record<FallsRiskPathwayStage, FallsRiskPathwayStage>> = {
  risk_identified: "clinical_assessment",
  clinical_assessment: "intervention",
  intervention: "follow_up",
  follow_up: "resolved",
};

export function FallsRiskProgressForm({
  fallsRiskId,
  currentStage,
}: {
  fallsRiskId: string;
  currentStage: FallsRiskPathwayStage;
}) {
  const [state, formAction, pending] = useActionState(progressFallsRiskPathway, undefined);
  const nextStage = NEXT_STAGE[currentStage];
  const [showFollowUpDate, setShowFollowUpDate] = useState(false);

  if (!nextStage) return null;

  return (
    <form action={formAction} className="mt-2 space-y-1.5">
      <input type="hidden" name="falls_risk_id" value={fallsRiskId} />
      <input type="hidden" name="pathway_stage" value={nextStage} />
      {nextStage === "intervention" && (
        <Textarea name="intervention_notes" placeholder="Intervention notes" maxLength={500} />
      )}
      {nextStage === "follow_up" && (
        <Input
          type="date"
          name="follow_up_due_at"
          onChange={() => setShowFollowUpDate(true)}
          aria-label="Follow-up due date"
        />
      )}
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs text-brand-green">Pathway updated.</p>}
      <Button type="submit" size="sm" disabled={pending || (nextStage === "follow_up" && !showFollowUpDate)}>
        {pending ? "Saving…" : `Move to ${FALLS_PATHWAY_STAGE_LABEL[nextStage]}`}
      </Button>
    </form>
  );
}
