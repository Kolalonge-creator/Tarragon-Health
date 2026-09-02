"use client";

import { useActionState, useState } from "react";
import { reportMedicationAccessBarrier } from "./actions";
import { MEDICATION_ACCESS_BARRIER_REASONS } from "@/lib/validation/medication-access-barriers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const REASON_LABEL: Record<(typeof MEDICATION_ACCESS_BARRIER_REASONS)[number], string> = {
  unavailable: "Not available at any pharmacy I tried",
  expensive: "I can't afford it",
  pharmacy_too_far: "The pharmacy is too far away",
  delivery_unavailable: "Delivery isn't available to me",
  forgot: "I forgot to collect/take it",
  side_effects: "I'm having side effects from it",
  didnt_understand_instructions: "I wasn't sure how to take it",
};

/**
 * Medication safety pathway 64.20/64.21 — "I cannot afford this medicine."
 * Submitting this never changes, stops, or substitutes the medication
 * itself; it only tells the care team so a person can work out a real
 * option (lower-cost alternative, a different pharmacy, an assistance
 * programme, an insurance question) with the patient.
 */
export function MedicationAccessBarrierForm({
  medicationId,
  drugName,
}: {
  medicationId: string;
  drugName: string;
}) {
  const [state, formAction, pending] = useActionState(reportMedicationAccessBarrier, undefined);
  const [reason, setReason] = useState<(typeof MEDICATION_ACCESS_BARRIER_REASONS)[number]>(
    "expensive"
  );

  return (
    <form action={formAction} className="space-y-3 rounded-md bg-charcoal-ink/5 p-3">
      <input type="hidden" name="medication_id" value={medicationId} />
      <p className="text-xs text-charcoal-ink/60">
        Tell us what&apos;s stopping you from taking {drugName}. Your care team will follow up —
        we never swap your medicine for a cheaper one on our own.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`barrier_reason_${medicationId}`} className="text-xs">
          What&apos;s the problem?
        </Label>
        <Select
          id={`barrier_reason_${medicationId}`}
          name="reason"
          value={reason}
          onChange={(event) =>
            setReason(event.target.value as (typeof MEDICATION_ACCESS_BARRIER_REASONS)[number])
          }
          className="h-9 text-sm"
        >
          {MEDICATION_ACCESS_BARRIER_REASONS.map((value) => (
            <option key={value} value={value}>
              {REASON_LABEL[value]}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`barrier_note_${medicationId}`} className="text-xs">
          Anything else? (optional)
        </Label>
        <Input id={`barrier_note_${medicationId}`} name="note" maxLength={500} className="h-9 text-sm" />
      </div>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && (
        <p className="text-xs text-brand-green">
          Thanks — your care team has been told and will follow up.
        </p>
      )}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Sending…" : "Send to my care team"}
      </Button>
    </form>
  );
}
