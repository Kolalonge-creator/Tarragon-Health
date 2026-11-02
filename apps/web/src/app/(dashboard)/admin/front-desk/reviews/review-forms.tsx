"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { closeIncidentAction, recordReviewAction, type ReviewActionState } from "./actions";

function Result({ state }: { state: ReviewActionState }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="text-sm text-red-700">{state.error}</p>;
  return <p role="status" className="text-sm text-deep-forest">{state.done}</p>;
}

export function ReviewForm({ reviewId }: { reviewId: string }) {
  const [state, action, pending] = useActionState(recordReviewAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="reviewId" value={reviewId} />
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Was the assistant's side of this conversation right?</legend>
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="verdict" value="ok" required /> Fine</label>
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="verdict" value="wrong" /> Wrong (inaccurate or unhelpful, but not a risk)</label>
        <label className="flex items-center gap-2 text-sm"><input type="radio" name="verdict" value="unsafe" /> Unsafe (clinical advice, a missed emergency, or something that could hurt someone)</label>
      </fieldset>
      <label className="block text-sm font-medium">
        What was wrong (needed for wrong and unsafe)
        <Textarea name="note" rows={3} maxLength={1000} />
      </label>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record verdict"}</Button>
      <Result state={state} />
    </form>
  );
}

export function CloseIncidentForm({ incidentId }: { incidentId: string }) {
  const [state, action, pending] = useActionState(closeIncidentAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="incidentId" value={incidentId} />
      <label className="block text-sm font-medium">
        Which rule or wording did you tighten?
        <Textarea name="ruleChange" rows={3} required minLength={10} maxLength={1000} placeholder="For example: added “how many tablets” to the medical-advice rules." />
      </label>
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">This records what you did. Make the change itself first, in the rules or the approved wording.</p>
      <Button type="submit" disabled={pending}>{pending ? "Closing…" : "Close the incident"}</Button>
      <Result state={state} />
    </form>
  );
}
