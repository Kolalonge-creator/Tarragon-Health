"use client";

import { useActionState } from "react";
import { resolveSafeguardingConcern } from "./safeguarding-actions";
import { Button } from "@/components/ui/button";

/**
 * `canReview` mirrors private.can_review_safeguarding_concern — it only
 * decides whether "Move to review" / "Close" are offered; the DB trigger
 * (enforce_safeguarding_concern_attribution) is the real enforcement
 * boundary and requires Tier 3+/Clinical Director for EVERY status
 * transition on this table, not just closing — so, unlike a typical
 * escalation worklist, staff below that tier can view and file a concern
 * but cannot move its status at all.
 */
export function ResolveSafeguardingConcernForm({
  concernId,
  canReview,
}: {
  concernId: string;
  canReview: boolean;
}) {
  const [state, formAction, pending] = useActionState(resolveSafeguardingConcern, undefined);

  if (!canReview) {
    return (
      <p className="text-xs text-charcoal-ink/60">
        Only a Tier 3+ clinician or the Clinical Director can move this concern into review or
        close it.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-md bg-cloud-mist/40 p-3">
      <input type="hidden" name="concernId" value={concernId} />
      <div className="flex-1 space-y-1">
        <label className="text-xs text-charcoal-ink/60" htmlFor={`outcome-${concernId}`}>
          Review outcome (required to close)
        </label>
        <textarea
          id={`outcome-${concernId}`}
          name="reviewOutcome"
          rows={1}
          maxLength={2000}
          className="w-full rounded-md border border-charcoal-ink/15 p-1.5 text-xs"
        />
      </div>
      <div className="flex-1 space-y-1">
        <label className="text-xs text-charcoal-ink/60" htmlFor={`action-${concernId}`}>
          Corrective action (optional)
        </label>
        <textarea
          id={`action-${concernId}`}
          name="correctiveAction"
          rows={1}
          maxLength={2000}
          className="w-full rounded-md border border-charcoal-ink/15 p-1.5 text-xs"
        />
      </div>
      <Button type="submit" name="status" value="under_review" variant="outline" size="sm" disabled={pending}>
        Move to review
      </Button>
      <Button type="submit" name="status" value="closed" size="sm" disabled={pending}>
        Close
      </Button>
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
