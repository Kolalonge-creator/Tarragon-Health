"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { withdrawSuggestionAction, type SuggestState } from "@/lib/pharmacy-suggestion/actions";

/** Withdraws the clinician's own pending suggestion and says what happened, including a refusal. */
export function WithdrawPharmacySuggestionForm({ patientId, suggestionId }: { patientId: string; suggestionId: string }) {
  const [state, action, pending] = useActionState<SuggestState, FormData>(withdrawSuggestionAction, undefined);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="suggestionId" value={suggestionId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving" : "Withdraw suggestion"}
      </Button>
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-emerald-800" : "text-red-700"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
