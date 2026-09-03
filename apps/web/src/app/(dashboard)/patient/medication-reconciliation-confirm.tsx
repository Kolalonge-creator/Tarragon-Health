"use client";

import { useState } from "react";
import {
  useOpenMedicationReconciliation,
  useConfirmMedicationList,
} from "@/lib/queries/medication-reconciliations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Medication safety pathway 64.3, step 1 of 2 — "Patient confirms". Shown
 * whether the episode was opened by a clinician (awaiting the patient) or
 * the patient opens it themselves; either way, confirming here is what lets
 * a clinician's later reconciliation happen at all (private.stamp_
 * medication_reconciliation_transition enforces that ordering server-side).
 */
export function MedicationReconciliationConfirm({ patientId }: { patientId: string }) {
  const { data: open } = useOpenMedicationReconciliation(patientId);
  const confirm = useConfirmMedicationList(patientId);
  const [note, setNote] = useState("");

  if (open?.patient_confirmed_at) {
    // Already confirmed, waiting on the clinician side — nothing more for
    // the patient to do here.
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirm your medication list</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Is the medication list above still accurate, nothing missing, nothing you&apos;ve
          stopped taking? Confirming lets your care team reconcile it at your next visit.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="reconciliation_note">Anything to flag? (optional)</Label>
          <Input
            id="reconciliation_note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="e.g. I stopped taking ibuprofen a month ago"
          />
        </div>
        {confirm.isError && (
          <p className="text-sm text-red-600 dark:text-red-300">
            {(confirm.error as Error).message || "Could not confirm your medication list."}
          </p>
        )}
        {confirm.isSuccess && (
          <p className="text-sm text-brand-green dark:text-brand-green-bright">Thanks. Your care team can now reconcile it.</p>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={confirm.isPending}
          onClick={() =>
            confirm.mutate({ existingId: open?.id ?? null, note: note.trim() || null })
          }
        >
          {confirm.isPending ? "Confirming…" : "Confirm this list is accurate"}
        </Button>
      </CardContent>
    </Card>
  );
}
