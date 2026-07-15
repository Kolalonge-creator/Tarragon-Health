"use client";

import { useState, type FormEvent } from "react";
import { useConfirmMedicationRefill, useMedications, type Medication } from "@/lib/queries/medications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEMANTIC_ICON } from "@/lib/icons";

export function MedicationsList({
  patientId,
  refillCoordinationEnabled,
  canConfirmRefill = false,
}: {
  patientId: string;
  /** 'medication_refills' feature — Free tier tracks medications but gets
   * no refill-date coordination (pricing.ts's Free-tier footnote). */
  refillCoordinationEnabled: boolean;
  /** Tier 1 doctors only (docs/Tarragon_Health_Master_Operating_Plan_v4.md
   * §4/§8) — confirms/continues an existing clinician-prescribed medication
   * without full prescribing authority. Never true for the patient's own
   * view or for Tier 2+/Director, who use AddMedicationForm's unrestricted
   * edit path instead. The DB (medications_update RLS +
   * enforce_medication_confirm_only trigger) is the real gate; this only
   * decides whether the control renders. */
  canConfirmRefill?: boolean;
}) {
  const { data, isLoading, isError } = useMedications(patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.medication className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Medications
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load medications.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No active medications.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((medication) => (
              <li key={medication.id} className="space-y-1 py-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-charcoal-ink">
                    {medication.drug_name}
                  </p>
                  <Badge variant={medication.source === "clinician" ? "blue" : "grey"}>
                    {medication.source === "clinician" ? "Prescribed" : "Self-added"}
                  </Badge>
                </div>
                <p className="text-xs text-charcoal-ink/60">
                  {[medication.dose, medication.frequency].filter(Boolean).join(" — ") ||
                    "No dose/frequency set"}
                </p>
                {medication.refill_date && refillCoordinationEnabled && (
                  <p className="text-xs text-charcoal-ink/60">
                    Refill by {new Date(medication.refill_date).toLocaleDateString()}
                  </p>
                )}
                {medication.refill_date && !refillCoordinationEnabled && (
                  <p className="text-xs text-charcoal-ink/60">
                    Refill coordination is part of a paid plan —{" "}
                    <a href="/patient/subscription" className="underline">
                      see plans
                    </a>
                    .
                  </p>
                )}
                {medication.last_confirmed_at && (
                  <p className="text-xs text-charcoal-ink/60">
                    Confirmed by your care team ·{" "}
                    {new Date(medication.last_confirmed_at).toLocaleDateString()}
                  </p>
                )}
                {canConfirmRefill && medication.source === "clinician" && (
                  <ConfirmRefillForm medication={medication} patientId={patientId} />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ConfirmRefillForm({
  medication,
  patientId,
}: {
  medication: Medication;
  patientId: string;
}) {
  const confirmRefill = useConfirmMedicationRefill();
  const [refillDate, setRefillDate] = useState(medication.refill_date ?? "");
  const [success, setSuccess] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(false);
    confirmRefill.mutate(
      { medicationId: medication.id, patientId, refillDate: refillDate || null },
      { onSuccess: () => setSuccess(true) }
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 pt-1">
      <div className="space-y-1">
        <Label htmlFor={`confirm_refill_date_${medication.id}`} className="text-xs">
          Refill date
        </Label>
        <Input
          id={`confirm_refill_date_${medication.id}`}
          type="date"
          value={refillDate}
          onChange={(event) => setRefillDate(event.target.value)}
          className="h-8 w-40 text-xs"
        />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={confirmRefill.isPending}>
        {confirmRefill.isPending ? "Confirming…" : "Confirm & continue"}
      </Button>
      {confirmRefill.isError && (
        <p className="text-xs text-red-600 basis-full">
          {(confirmRefill.error as Error).message || "Could not confirm this prescription."}
        </p>
      )}
      {success && !confirmRefill.isPending && (
        <p className="text-xs text-brand-green basis-full">Confirmed and continued.</p>
      )}
    </form>
  );
}
