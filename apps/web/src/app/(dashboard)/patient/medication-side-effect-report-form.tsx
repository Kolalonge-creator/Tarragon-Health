"use client";

import { useState, type FormEvent } from "react";
import { useSubmitMedicationSideEffectReport } from "@/lib/queries/medication-access";
import type { Medication } from "@/lib/queries/medications";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SEVERITY_OPTIONS: { value: "mild" | "moderate" | "severe"; label: string }[] = [
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
];

/**
 * Module 21 §21.11 side-effect pathway entry point. Severity decides how
 * urgently the care team is notified server-side — this form only collects
 * what the patient noticed, it never classifies "how serious."
 */
export function MedicationSideEffectReportForm({
  medication,
  patientId,
}: {
  medication: Medication;
  patientId: string;
}) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"mild" | "moderate" | "severe" | "">("");
  const [done, setDone] = useState(false);
  const submit = useSubmitMedicationSideEffectReport();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim() || !severity) return;
    submit.mutate(
      {
        medication_id: medication.id,
        description: description.trim(),
        severity,
        patientId,
        organisationId: medication.organisation_id,
      },
      {
        onSuccess: () => {
          setDone(true);
          setOpen(false);
        },
      }
    );
  }

  if (done) {
    return (
      <p className="text-xs font-medium text-brand-green">
        Thanks for letting us know — your care team has been notified.
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Report a side effect
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <div className="space-y-1">
        <Label htmlFor={`side_effect_desc_${medication.id}`} className="text-xs">
          What did you notice with {medication.drug_name}?
        </Label>
        <Textarea
          id={`side_effect_desc_${medication.id}`}
          className="text-xs"
          maxLength={1000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">How severe does it feel?</Label>
        <div className="flex flex-wrap gap-2">
          {SEVERITY_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={severity === option.value ? "default" : "outline"}
              onClick={() => setSeverity(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!description.trim() || !severity || submit.isPending}>
          {submit.isPending ? "Sending…" : "Send to my care team"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {submit.isError && (
          <p className="text-xs text-red-600">Could not send that. Please try again.</p>
        )}
      </div>
    </form>
  );
}
