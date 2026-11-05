"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import { completeReview, decideItem, startReview, type ReviewActionState } from "./actions";

export function StartReviewForm() {
  const [state, action, pending] = useActionState<ReviewActionState, FormData>(startReview, undefined);
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" disabled={pending}>{pending ? "Starting..." : "Start a review"}</Button>
      <FormError id="start-review-error" message={state?.error} />
      <FormSuccess message={state?.message} />
    </form>
  );
}

export function DecisionForm({ itemId, current }: { itemId: string; current: "keep" | "remove" | "change" | null }) {
  const [state, action, pending] = useActionState<ReviewActionState, FormData>(decideItem, undefined);
  const [decision, setDecision] = useState<"keep" | "remove" | "change">(current ?? "keep");
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="itemId" value={itemId} />
      <label className="sr-only" htmlFor={`d-${itemId}`}>Decision</label>
      <select
        id={`d-${itemId}`}
        name="decision"
        value={decision}
        onChange={(e) => setDecision(e.target.value === "remove" ? "remove" : e.target.value === "change" ? "change" : "keep")}
        className="min-h-11 rounded-md border px-3 py-2 text-sm"
      >
        <option value="keep">Keep as it is</option>
        <option value="change">Change role or tier</option>
        <option value="remove">Remove access</option>
      </select>
      {decision !== "keep" && (
        <>
          <label className="sr-only" htmlFor={`n-${itemId}`}>Why</label>
          <Input id={`n-${itemId}`} name="note" maxLength={500} placeholder="What should change and why" className="min-w-56" />
        </>
      )}
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
      <FormError id={`e-${itemId}`} message={state?.error} />
      <FormSuccess message={state?.message} />
    </form>
  );
}

export function CompleteReviewForm({ reviewId, undecided }: { reviewId: string; undecided: number }) {
  const [state, action, pending] = useActionState<ReviewActionState, FormData>(completeReview, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <Button type="submit" disabled={pending || undecided > 0}>
        {undecided > 0 ? `${undecided} ${undecided === 1 ? "account" : "accounts"} still to decide` : pending ? "Completing..." : "Complete the review"}
      </Button>
      <FormError id="complete-review-error" message={state?.error} />
      <FormSuccess message={state?.message} />
    </form>
  );
}
