"use client";

import { useState } from "react";
import { useRaiseMedicationSafetyAlert } from "@/lib/queries/medication-safety-alerts";
import { Button } from "@/components/ui/button";

/**
 * 13.9's "clinician-raised only" mechanism (see
 * 20260828021620_medication_safety_manual_alert_rpc.sql): turns a computed
 * drug-safety finding into a real, trackable clinician_alerts row. Never
 * blocks or changes the prescription — this is the deliberate, decision-
 * support half of "support clinician decision-making, not blindly block
 * every prescription".
 */
export function FlagSafetyFindingButton({
  patientId,
  medicationId,
  typeCode,
  severity,
  message,
}: {
  patientId: string;
  medicationId: string;
  typeCode: "medication_safety" | "potential_interaction";
  severity: "contraindicated" | "caution";
  message: string;
}) {
  const raiseAlert = useRaiseMedicationSafetyAlert();
  const [flagged, setFlagged] = useState(false);

  if (flagged || raiseAlert.isSuccess) {
    return <p className="text-xs text-brand-green">Flagged to care team</p>;
  }

  return (
    <div className="mt-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs text-charcoal-ink/60"
        disabled={raiseAlert.isPending}
        onClick={() =>
          raiseAlert.mutate(
            { patientId, medicationId, typeCode, severity, message },
            { onSuccess: () => setFlagged(true) }
          )
        }
      >
        {raiseAlert.isPending ? "Flagging…" : "Flag to care team"}
      </Button>
      {raiseAlert.isError && (
        <p className="text-xs text-red-600">
          {(raiseAlert.error as Error).message || "Could not flag this finding."}
        </p>
      )}
    </div>
  );
}
