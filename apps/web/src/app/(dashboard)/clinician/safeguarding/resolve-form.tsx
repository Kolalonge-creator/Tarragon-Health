"use client";

import { useActionState } from "react";
import { resolveSafeguardingConcern } from "./safeguarding-actions";
import { Button } from "@/components/ui/button";

/**
 * `canResolve` mirrors private.can_review_safeguarding_concern — it only
 * decides whether "Resolve" / "Close" are offered; enforce_safeguarding_
 * concern_resolution_tier is the real enforcement boundary. Everyone with
 * access to this worklist (any org clinical staff) can still move a concern
 * to "Under review" and add a note.
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
        <label className="text-xs text-charcoal-ink/60" htmlFor={`notes-${concernId}`}>
          Note
        </label>
        <textarea
          id={`notes-${concernId}`}
          name="resolutionNotes"
          rows={1}
          maxLength={2000}
          className="w-full rounded-md border border-charcoal-ink/15 p-1.5 text-xs"
        />
      </div>
      <Button type="submit" name="status" value="under_review" variant="outline" size="sm" disabled={pending}>
        Move to review
      </Button>
      {canResolve ? (
        <>
          <Button type="submit" name="status" value="resolved" size="sm" disabled={pending}>
            Resolve
          </Button>
          <Button type="submit" name="status" value="closed_no_action" variant="outline" size="sm" disabled={pending}>
            Close, no action
          </Button>
        </>
      ) : (
        <span className="text-xs text-charcoal-ink/60">Only a Tier 2+ clinician or the Clinical Director can resolve/close</span>
      )}
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
