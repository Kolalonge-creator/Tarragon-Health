"use client";

import { useState, type FormEvent } from "react";
import { useAmendMedication } from "@/lib/queries/medications";
import { amendMedicationSchema } from "@/lib/validation/medications";
import type { MedicationWithCarePlan } from "@/lib/queries/medications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Spec §62.14 amendment — "a changed prescription should create a new
 * version." Pre-filled with the current version's values; only what's
 * actually edited needs to change (public.amend_medication() falls back to
 * the current value for anything left as-is). The reason field is required
 * — it's this form's equivalent of AddMedicationForm's sign-off checkbox,
 * proving a clinician deliberately chose to version the prescription rather
 * than just editing it in place.
 */
export function AmendMedicationForm({
  medication,
  patientId,
  onDone,
}: {
  medication: MedicationWithCarePlan;
  patientId: string;
  onDone: () => void;
}) {
  const amendMedication = useAmendMedication();
  const [drugName, setDrugName] = useState(medication.drug_name);
  const [dose, setDose] = useState(medication.dose ?? "");
  const [frequency, setFrequency] = useState(medication.frequency ?? "");
  const [route, setRoute] = useState(medication.route ?? "");
  const [durationDays, setDurationDays] = useState(
    medication.duration_days != null ? String(medication.duration_days) : ""
  );
  const [quantity, setQuantity] = useState(medication.quantity ?? "");
  const [repeatsAllowed, setRepeatsAllowed] = useState(String(medication.repeats_allowed));
  const [indication, setIndication] = useState(medication.indication ?? "");
  const [instructions, setInstructions] = useState(medication.instructions ?? "");
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = amendMedicationSchema.safeParse({
      amendment_reason: reason,
      drug_name: drugName || undefined,
      dose: dose || undefined,
      frequency: frequency || undefined,
      route: route || undefined,
      duration_days: durationDays || undefined,
      quantity: quantity || undefined,
      repeats_allowed: repeatsAllowed || undefined,
      indication: indication || undefined,
      instructions: instructions || undefined,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    amendMedication.mutate(
      { medicationId: medication.id, patientId, input: parsed.data },
      { onSuccess: onDone }
    );
  }

  const mutationError = (amendMedication.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 space-y-3 rounded-md border border-charcoal-ink/10 bg-charcoal-ink/5 p-3"
    >
      <p className="text-xs font-medium text-charcoal-ink/70">
        Amend this prescription: creates {medication.rx_number ? "a new Rx number as " : ""}v
        {medication.version + 1}; this version is kept, not deleted.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={`amend_drug_${medication.id}`} className="text-xs">
            Drug name
          </Label>
          <Input
            id={`amend_drug_${medication.id}`}
            value={drugName}
            onChange={(event) => setDrugName(event.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`amend_dose_${medication.id}`} className="text-xs">
            Dose
          </Label>
          <Input
            id={`amend_dose_${medication.id}`}
            value={dose}
            onChange={(event) => setDose(event.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`amend_frequency_${medication.id}`} className="text-xs">
            Frequency
          </Label>
          <Input
            id={`amend_frequency_${medication.id}`}
            value={frequency}
            onChange={(event) => setFrequency(event.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`amend_route_${medication.id}`} className="text-xs">
            Route
          </Label>
          <Input
            id={`amend_route_${medication.id}`}
            value={route}
            onChange={(event) => setRoute(event.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`amend_duration_${medication.id}`} className="text-xs">
            Duration (days)
          </Label>
          <Input
            id={`amend_duration_${medication.id}`}
            type="number"
            min={1}
            value={durationDays}
            onChange={(event) => setDurationDays(event.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`amend_quantity_${medication.id}`} className="text-xs">
            Quantity
          </Label>
          <Input
            id={`amend_quantity_${medication.id}`}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`amend_repeats_${medication.id}`} className="text-xs">
            Repeats allowed
          </Label>
          <Input
            id={`amend_repeats_${medication.id}`}
            type="number"
            min={0}
            max={99}
            value={repeatsAllowed}
            onChange={(event) => setRepeatsAllowed(event.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`amend_indication_${medication.id}`} className="text-xs">
            Indication
          </Label>
          <Input
            id={`amend_indication_${medication.id}`}
            value={indication}
            onChange={(event) => setIndication(event.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`amend_instructions_${medication.id}`} className="text-xs">
          Patient instructions
        </Label>
        <Input
          id={`amend_instructions_${medication.id}`}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          className="h-8 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`amend_reason_${medication.id}`} className="text-xs">
          Reason for this amendment (required)
        </Label>
        <Input
          id={`amend_reason_${medication.id}`}
          placeholder="e.g. Dose increased after review"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="h-8 text-xs"
        />
      </div>
      {displayError && <p className="text-xs text-red-600">{displayError}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={amendMedication.isPending}>
          {amendMedication.isPending ? "Saving…" : "Sign amended version"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
