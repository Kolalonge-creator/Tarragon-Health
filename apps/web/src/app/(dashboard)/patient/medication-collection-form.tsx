"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { todayIsoDate, useConfirmPrescriptionCollected, type Medication } from "@/lib/queries/medications";
import { CONFIRM_OUTCOME_MESSAGE, type ConfirmOutcome } from "@/lib/prescriptions/patient-supply";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

/**
 * "I picked this up" — the medication half of self-arranged fulfilment.
 *
 * Tarragon routes nothing to a pharmacy, so the patient buys wherever suits
 * them and records it here. That record is what keeps the refill clock and the
 * adherence picture honest; without it, dropping pharmacy routing would have
 * quietly cost the care team all sight of whether medicine was actually being
 * collected.
 *
 * Writes straight through the patient's own session:
 * pharmacy_order_dispenses_insert already admits patient_id = auth.uid(), so no
 * server action or elevated client is needed. pharmacy_order_id stays null,
 * which is exactly what the 20260803132008 migration made possible.
 *
 * T2-11c (2026-11-05): for a signed prescription the same button records a PATIENT-REPORTED SUPPLY through
 * public.confirm_prescription_collected instead. It counts against the prescription, so the QR check shows it used and a second pharmacy
 * cannot fill it, and it is labelled as reported by the patient everywhere. The patient can undo it for 24 hours (prescription-download).
 */
export function isSignedPrescription(medication: Pick<Medication, "source" | "rx_number" | "superseded_at" | "is_active">): boolean {
  return medication.source === "clinician" && !!medication.rx_number && !medication.superseded_at && medication.is_active;
}
export function MedicationCollectionForm({
  medication,
  patientId,
}: {
  medication: Medication;
  patientId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [collectedOn, setCollectedOn] = useState(todayIsoDate());
  const [pharmacyName, setPharmacyName] = useState("");
  const [pharmacyTown, setPharmacyTown] = useState("");
  const [done, setDone] = useState(false);
  const [outcome, setOutcome] = useState<ConfirmOutcome | null>(null);
  const signed = isSignedPrescription(medication);
  const confirm = useConfirmPrescriptionCollected(patientId);
  const errorId = fieldErrorId(`medication-collection-${medication.id}`);

  const logCollection = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error } = await supabase.from("pharmacy_order_dispenses").insert({
        organisation_id: medication.organisation_id,
        patient_id: patientId,
        medication_id: medication.id,
        drug_name: medication.drug_name,
        dispensed_on: collectedOn,
        pharmacy_name: pharmacyName.trim() || null,
        source: "patient",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDone(true);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["medication-collections", patientId] });
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (signed) {
      confirm.mutate(
        { medicationId: medication.id, collectedOn, pharmacyName, pharmacyTown },
        {
          onSuccess: (result) => {
            setOutcome(result);
            if (CONFIRM_OUTCOME_MESSAGE[result].ok) setOpen(false);
          },
        }
      );
      return;
    }
    logCollection.mutate();
  }

  const pending = signed ? confirm.isPending : logCollection.isPending;
  const failed = signed ? confirm.isError : logCollection.isError;
  const outcomeMessage = outcome ? CONFIRM_OUTCOME_MESSAGE[outcome] : null;

  if (signed && outcomeMessage?.ok && !open) {
    return (
      <p role="status" className="text-xs font-medium text-brand-green dark:text-brand-green-bright">
        {outcomeMessage.text}
      </p>
    );
  }

  if (done) {
    return (
      <p className="text-xs font-medium text-brand-green dark:text-brand-green-bright">
        Noted, thank you. Your care team can see you have this one.
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {signed ? "I've got this medicine" : "I picked this up"}
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        {signed
          ? "If the pharmacy did not record this supply, tell us here. It will be marked on your prescription as collected, as reported by you, so it cannot be filled again elsewhere."
          : "You may buy this medicine wherever is convenient for you. Telling us when you collected it keeps your refill reminders accurate."}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`collected_on_${medication.id}`} className="text-xs">
            When
          </Label>
          <Input
            id={`collected_on_${medication.id}`}
            type="date"
            className="w-40"
            max={todayIsoDate()}
            value={collectedOn}
            onChange={(event) => setCollectedOn(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`pharmacy_name_${medication.id}`} className="text-xs">
            Pharmacy (optional)
          </Label>
          <Input
            id={`pharmacy_name_${medication.id}`}
            className="w-52"
            placeholder="Where you bought it"
            maxLength={120}
            value={pharmacyName}
            onChange={(event) => setPharmacyName(event.target.value)}
            {...fieldErrorProps(errorId, failed)}
          />
        </div>
        {signed && (
          <div className="space-y-1">
            <Label htmlFor={`pharmacy_town_${medication.id}`} className="text-xs">
              Town (optional)
            </Label>
            <Input
              id={`pharmacy_town_${medication.id}`}
              className="w-40"
              placeholder="For example, Ikeja"
              maxLength={80}
              value={pharmacyTown}
              onChange={(event) => setPharmacyTown(event.target.value)}
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!collectedOn || pending}>
          {pending ? "Saving…" : signed ? "Confirm I have it" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <FormError
          id={errorId}
          message={
            (failed && "Could not save that. Please try again.") ||
            (outcomeMessage && !outcomeMessage.ok && outcomeMessage.text)
          }
          className="text-xs"
        />
      </div>
    </form>
  );
}
