"use client";

import { useState, type FormEvent } from "react";
import {
  useSubmitMedicationAccessCheckin,
} from "@/lib/queries/medication-access";
import type { Medication } from "@/lib/queries/medications";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const BARRIER_OPTIONS: { value: string; label: string }[] = [
  { value: "too_expensive", label: "Too expensive" },
  { value: "pharmacy_unavailable", label: "Pharmacy unavailable" },
  { value: "out_of_stock", label: "Out of stock" },
  { value: "prescription_issue", label: "Prescription issue" },
  { value: "forgot", label: "I forgot" },
  { value: "other", label: "Other" },
];

/**
 * Module 21 §21.3 — "Were you able to obtain your medication?" A barrier
 * (other than "forgot") routes straight to the care team; access_status on
 * the medication itself is derived server-side, never set from here.
 */
export function MedicationAccessCheckinForm({
  medication,
  patientId,
}: {
  medication: Medication;
  patientId: string;
}) {
  const [open, setOpen] = useState(false);
  const [obtained, setObtained] = useState<"yes" | "partially" | "no" | "">("");
  const [barrier, setBarrier] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(false);
  const submit = useSubmitMedicationAccessCheckin();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!obtained) return;
    submit.mutate(
      {
        medication_id: medication.id,
        obtained,
        barrier: obtained === "yes" ? undefined : (barrier as MedicationAccessBarrier) || undefined,
        notes: notes.trim() || undefined,
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
        Thanks — noted. Your care team will follow up if you need help getting this.
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Were you able to get this?
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <p className="text-xs text-charcoal-ink/60">Were you able to obtain {medication.drug_name}?</p>
      <div className="flex flex-wrap gap-2">
        {(["yes", "partially", "no"] as const).map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={obtained === option ? "default" : "outline"}
            onClick={() => setObtained(option)}
          >
            {option === "yes" ? "Yes" : option === "partially" ? "Partially" : "No"}
          </Button>
        ))}
      </div>
      {(obtained === "no" || obtained === "partially") && (
        <div className="space-y-1">
          <Label className="text-xs">Why?</Label>
          <div className="flex flex-wrap gap-2">
            {BARRIER_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={barrier === option.value ? "default" : "outline"}
                onClick={() => setBarrier(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor={`access_notes_${medication.id}`} className="text-xs">
          Anything else? (optional)
        </Label>
        <Textarea
          id={`access_notes_${medication.id}`}
          className="text-xs"
          maxLength={1000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!obtained || (obtained !== "yes" && !barrier) || submit.isPending}
        >
          {submit.isPending ? "Saving…" : "Submit"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {submit.isError && (
          <p className="text-xs text-red-600">Could not save that. Please try again.</p>
        )}
      </div>
    </form>
  );
}

type MedicationAccessBarrier =
  | "too_expensive"
  | "pharmacy_unavailable"
  | "out_of_stock"
  | "prescription_issue"
  | "forgot"
  | "other";
