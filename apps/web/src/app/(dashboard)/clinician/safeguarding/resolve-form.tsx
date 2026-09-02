"use client";

import { useActionState } from "react";
import { resolveSafeguardingConcern } from "./safeguarding-actions";
import { Button } from "@/components/ui/button";

/**
 * `canResolve` mirrors private.can_review_safeguarding_concern (Tier 3+ or
 * the Clinical Director) — it decides whether "Move to review" / "Close"
 * are offered at all, since the DB trigger requires that authority for ANY
 * status transition on the shared safeguarding_concerns table, not only
 * closing. enforce_safeguarding_concern_attribution is the real enforcement
 * boundary. Everyone with access to this worklist (any org clinical staff)
 * can still add a review-outcome/corrective-action note without changing
 * status.
 */
export function ResolveSafeguardingConcernForm({
  concernId,
  canResolve,
}: {
  concernId: string;
  canResolve: boolean;
}) {
  const [state, formAction, pending] = useActionState(resolveSafeguardingConcern, undefined);

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
      <Button type="submit" formNoValidate name="status" value="" variant="ghost" size="sm" disabled={pending}>
        Save note
      </Button>
      {canResolve ? (
        <>
          <Button type="submit" name="status" value="under_review" variant="outline" size="sm" disabled={pending}>
            Move to review
          </Button>
          <Button type="submit" name="status" value="closed" size="sm" disabled={pending}>
            Close
          </Button>
        </>
      ) : (
        <span className="text-xs text-charcoal-ink/60">
          Only a Tier 3+ clinician or the Clinical Director can move this into review or close it
        </span>
      )}
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
