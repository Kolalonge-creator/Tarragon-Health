"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { suggestPharmacyAction, type SuggestState } from "@/lib/pharmacy-suggestion/actions";

/**
 * One "Suggest this pharmacy" button. It records a suggestion for the patient to confirm; it sends nothing to the pharmacy.
 * The real action is passed straight to useActionState (wrapping a Server Action in a local try/catch would break progressive enhancement).
 */
export function SuggestPharmacyForm(props: { patientId: string; prescriptionId: string; partnerId: string; locationId: string; label: string }) {
  const [state, action, pending] = useActionState<SuggestState, FormData>(suggestPharmacyAction, undefined);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="patientId" value={props.patientId} />
      <input type="hidden" name="prescriptionId" value={props.prescriptionId} />
      <input type="hidden" name="partnerId" value={props.partnerId} />
      <input type="hidden" name="locationId" value={props.locationId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving" : props.label}
      </Button>
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-emerald-800" : "text-red-700"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
