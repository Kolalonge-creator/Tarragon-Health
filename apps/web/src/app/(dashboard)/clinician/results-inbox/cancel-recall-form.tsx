"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelResultRecallAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Inline cancel control for one "Result recalls due" row — collapsed to a
 * single button until clicked, since a reason is required (result_recalls
 * has no direct client write path; cancel_result_recall enforces this). */
export function CancelRecallForm({ recallId }: { recallId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    cancelResultRecallAction.bind(null, recallId),
    undefined
  );
  const router = useRouter();

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  if (state?.success) {
    return <span className="text-xs text-charcoal-ink/50">Cancelled</span>;
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Cancel recall
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Input name="reason" placeholder="Why is this no longer needed?" className="h-8 w-48 text-xs" required />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Confirm"}
      </Button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
