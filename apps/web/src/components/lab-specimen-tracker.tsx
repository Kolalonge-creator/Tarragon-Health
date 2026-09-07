"use client";

import { usePatientLabSpecimens } from "@/lib/queries/lab-specimens";
import { LAB_SPECIMEN_STATUS_LABEL, LAB_SPECIMEN_REJECTION_REASON_LABEL } from "@/lib/queries/lab-specimens";
import { Badge } from "@/components/ui/badge";

/**
 * §56.9 sample tracking, patient-facing: the specimen(s) for one partner-
 * billed order, oldest first. A rejection (§56.10) shows as two rows — the
 * rejected one and its recollection replacement — rather than one row
 * silently changing meaning, so the patient sees what actually happened
 * rather than a single status flipping back to "waiting".
 *
 * Renders nothing for a self-arranged order (no specimen row exists —
 * Tarragon never takes custody of that sample) or while there is genuinely
 * nothing to show yet.
 */
export function LabSpecimenTracker({ labOrderId }: { labOrderId: string }) {
  const { data: specimens, isLoading } = usePatientLabSpecimens(labOrderId);

  if (isLoading || !specimens || specimens.length === 0) return null;

  return (
    <div className="space-y-1.5 rounded-md bg-soft-sage/60 p-2.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
        Sample status
      </p>
      {specimens.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
          <div>
            <span className="font-medium text-charcoal-ink">{s.specimen_number}</span>{" "}
            <span className="text-charcoal-ink/60">
              {s.status === "rejected" && s.rejection_reason
                ? LAB_SPECIMEN_REJECTION_REASON_LABEL[s.rejection_reason]
                : LAB_SPECIMEN_STATUS_LABEL[s.status]}
            </span>
          </div>
          <Badge variant={s.status === "rejected" ? "amber" : s.status === "completed" ? "green" : "blue"}>
            {s.status === "rejected" ? "Redraw needed" : LAB_SPECIMEN_STATUS_LABEL[s.status]}
          </Badge>
        </div>
      ))}
    </div>
  );
}
