"use client";

import { useState } from "react";
import {
  useOpenMedicationReconciliation,
  useConfirmMedicationList,
  useReconcileMedicationList,
} from "@/lib/queries/medication-reconciliations";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Medication safety pathway 64.3 — the clinician-facing half. Opening an
 * episode here snapshots the patient's active list server-side
 * (private.snapshot_medication_reconciliation_list). Reconciling is only
 * possible once the patient has confirmed, and only for a clinical-tier
 * caller — both enforced by private.stamp_medication_reconciliation_
 * transition, not just this UI, so the error message on a rejected attempt
 * comes straight from the database.
 */
export function MedicationReconciliationPanel({ patientId }: { patientId: string }) {
  const { data: open, isLoading } = useOpenMedicationReconciliation(patientId);
  const openEpisode = useConfirmMedicationList(patientId);
  const reconcile = useReconcileMedicationList(patientId);
  const [note, setNote] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Medication reconciliation</CardTitle>
        <CardDescription>
          Current list → patient confirms → clinician reconciles → record updated.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}

        {!isLoading && !open && (
          <>
            <p className="text-sm text-charcoal-ink/70">
              No reconciliation is in progress for this patient.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={openEpisode.isPending}
              onClick={() => openEpisode.mutate({ existingId: null, note: null })}
            >
              {openEpisode.isPending ? "Starting…" : "Start reconciliation"}
            </Button>
          </>
        )}

        {open && !open.patient_confirmed_at && (
          <>
            <Badge variant="amber">Awaiting patient confirmation</Badge>
            <p className="text-sm text-charcoal-ink/70">
              This patient hasn&apos;t yet confirmed their medication list is accurate. Ask them
              to confirm it (in the app) before reconciling.
            </p>
          </>
        )}

        {open && open.patient_confirmed_at && (
          <>
            <Badge variant="green">Patient confirmed</Badge>
            <p className="text-sm text-charcoal-ink/70">
              Confirmed {new Date(open.patient_confirmed_at).toLocaleDateString()}
              {open.patient_note ? ` (patient noted: "${open.patient_note}")` : ""}.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="reconciliation_note">
                What was reconciled? (duplicate found, dose corrected, nothing changed…)
              </Label>
              <Input
                id="reconciliation_note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
              />
            </div>
            {reconcile.isError && (
              <p className="text-sm text-red-600">
                {(reconcile.error as Error).message || "Could not reconcile this medication list."}
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={reconcile.isPending}
              onClick={() => reconcile.mutate({ id: open.id, note: note.trim() || null })}
            >
              {reconcile.isPending ? "Reconciling…" : "Mark reconciled"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
