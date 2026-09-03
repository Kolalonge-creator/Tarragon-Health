"use client";

import { useActionState } from "react";
import { updateSocialDeterminantFollowUp } from "./healthy-ageing-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function SocialDeterminantFollowUpForm({ screeningId }: { screeningId: string }) {
  const [state, formAction, pending] = useActionState(updateSocialDeterminantFollowUp, undefined);

  return (
    <form action={formAction} className="mt-2 space-y-1.5">
      <input type="hidden" name="screening_id" value={screeningId} />
      <Textarea name="coordinator_notes" placeholder="Notes on the follow-up (optional)" maxLength={500} />
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs text-brand-green">Updated.</p>}
      <div className="flex gap-2">
        <Button type="submit" name="follow_up_status" value="contacted" size="sm" variant="outline" disabled={pending}>
          Mark contacted
        </Button>
        <Button type="submit" name="follow_up_status" value="resolved" size="sm" disabled={pending}>
          Mark resolved
        </Button>
      </div>
    </form>
  );
}
