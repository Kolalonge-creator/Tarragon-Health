"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { reviewPreventivePlan, type ReviewPreventivePlanState } from "./preventive-plan-actions";

export function PreventivePlanReviewForm({ patientId, baselineId }: { patientId: string; baselineId: string }) {
  const [state, action, pending] = useActionState<ReviewPreventivePlanState, FormData>(reviewPreventivePlan.bind(null, patientId), undefined);
  if (state?.success) return <p className="text-sm text-emerald-800 dark:text-emerald-300">Saved. The review task for this plan is closed.</p>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="baseline_id" value={baselineId} />
      <fieldset className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="decision" value="authorised" defaultChecked /> Authorise as it stands
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="decision" value="adjusted" /> I adjusted it
        </label>
      </fieldset>
      <Textarea name="note" rows={2} maxLength={1000} placeholder="What you changed and why (needed if you adjusted it). The patient sees this note." />
      {state?.error && <p className="text-xs text-red-600 dark:text-red-300">{state.error}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving" : "Record my decision"}
      </Button>
    </form>
  );
}
