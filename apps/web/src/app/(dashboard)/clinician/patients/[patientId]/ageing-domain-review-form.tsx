"use client";

import { useActionState } from "react";
import { reviewAgeingAssessmentDomain } from "./healthy-ageing-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function AgeingDomainReviewForm({ domainResultId }: { domainResultId: string }) {
  const [state, formAction, pending] = useActionState(reviewAgeingAssessmentDomain, undefined);

  return (
    <form action={formAction} className="mt-2 space-y-1.5">
      <input type="hidden" name="domain_result_id" value={domainResultId} />
      <Textarea name="notes" placeholder="Review note (optional)" maxLength={500} />
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs text-brand-green">Marked reviewed.</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Mark reviewed"}
      </Button>
    </form>
  );
}
