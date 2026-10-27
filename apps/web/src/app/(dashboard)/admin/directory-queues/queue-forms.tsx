"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { moderateRatingAction, recordCheckAction } from "./actions";

/** One pending rating. A held comment cannot be published whole, so that button is not offered for it; the database enforces the same. */
export function RatingModerationForm({ ratingId, held }: { ratingId: string; held: boolean }) {
  const [state, action, pending] = useActionState(moderateRatingAction, undefined);
  return (
    <form action={action} className="space-y-2 pt-2">
      <input type="hidden" name="rating" value={ratingId} />
      <label className="block text-xs text-charcoal-ink/70">
        Reason (needed to reject)
        <input name="reason" maxLength={500} className="mt-1 block w-full rounded border border-charcoal-ink/20 px-2 py-1 text-sm" />
      </label>
      <div className="flex flex-wrap gap-2">
        {held ? null : (
          <Button type="submit" name="decision" value="publish" size="sm" disabled={pending}>
            Publish
          </Button>
        )}
        <Button type="submit" name="decision" value="publish_without_comment" size="sm" variant="outline" disabled={pending}>
          Publish without the comment
        </Button>
        <Button type="submit" name="decision" value="reject" size="sm" variant="ghost" disabled={pending}>
          Reject
        </Button>
      </div>
      {state?.error ? <p role="alert" className="text-xs text-red-600">{state.error}</p> : null}
      {state?.done ? <p role="status" className="text-xs text-charcoal-ink/70">{state.done}</p> : null}
    </form>
  );
}

/** Record that a reported listing was checked. The note says how, so the next person can see what was actually confirmed. */
export function RecordCheckForm({ table, listing }: { table: "facilities" | "specialist_providers"; listing: string }) {
  const [state, action, pending] = useActionState(recordCheckAction, undefined);
  return (
    <form action={action} className="space-y-2 pt-2">
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="listing" value={listing} />
      <label className="block text-xs text-charcoal-ink/70">
        How did you check it?
        <input name="note" required minLength={3} maxLength={500} className="mt-1 block w-full rounded border border-charcoal-ink/20 px-2 py-1 text-sm" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="tier" value="phone_confirmed" size="sm" disabled={pending}>
          Confirmed by phone
        </Button>
        <Button type="submit" name="tier" value="licence_checked" size="sm" variant="outline" disabled={pending}>
          Licence checked
        </Button>
      </div>
      {state?.error ? <p role="alert" className="text-xs text-red-600">{state.error}</p> : null}
      {state?.done ? <p role="status" className="text-xs text-charcoal-ink/70">{state.done}</p> : null}
    </form>
  );
}
