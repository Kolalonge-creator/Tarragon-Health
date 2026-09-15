"use client";

import { useState } from "react";
import {
  usePendingMedicationChangeRequests,
  useReviewMedicationChangeRequest,
} from "@/lib/queries/medication-change-requests";
import { reviewMedicationChangeRequestSchema } from "@/lib/validation/medications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A patient's proposed medication change, awaiting review. Approving here
 * only records that a clinician has reviewed the request — it does NOT
 * change the prescription. The actual edit still goes through the existing
 * Amend control below in the Medications list, private.amend_medication
 * remaining the one true amendment mechanism. See
 * 20260907131424_medication_change_requests.sql.
 */
export function MedicationChangeRequestsPanel({
  patientId,
  canReview,
}: {
  patientId: string;
  /** private.has_prescribing_authority is the real gate — this only decides
   * whether the approve/deny controls render at all. */
  canReview: boolean;
}) {
  const { data, isLoading } = usePendingMedicationChangeRequests(patientId);

  if (isLoading || !data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Medication changes requested by the patient</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((request) => (
          <div key={request.id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
            <div>
              <p className="text-sm font-medium text-charcoal-ink">
                {request.medication?.drug_name ?? "Medication"}
              </p>
              <p className="text-xs text-charcoal-ink/60">
                Currently: {[request.medication?.dose, request.medication?.frequency].filter(Boolean).join(", ") || "—"}
                {request.medication?.rx_number ? ` · ${request.medication.rx_number}` : ""}
              </p>
              <p className="mt-1 text-sm text-charcoal-ink">
                <span className="font-medium">Wants:</span> {request.requested_change}
              </p>
              <p className="text-sm text-charcoal-ink/80">
                <span className="font-medium">Why:</span> {request.reason}
              </p>
              <p className="text-xs text-charcoal-ink/50">
                Requested {new Date(request.requested_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
            {canReview ? (
              <ReviewControls patientId={patientId} requestId={request.id} />
            ) : (
              <p className="text-xs text-charcoal-ink/50">
                Reviewing a medication change needs full prescribing authority — a Tier 1 doctor or
                Care Coordinator cannot.
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ReviewControls({ patientId, requestId }: { patientId: string; requestId: string }) {
  const review = useReviewMedicationChangeRequest();
  const [denying, setDenying] = useState(false);
  const [denialReason, setDenialReason] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function submitReview(input: { status: "approved" | "denied"; denial_reason?: string }) {
    const parsed = reviewMedicationChangeRequestSchema.safeParse(input);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    review.mutate({ requestId, patientId, input: parsed.data });
  }

  const displayError = validationError ?? ((review.error as Error | null)?.message || null);

  if (denying) {
    return (
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor={`change_denial_reason_${requestId}`} className="text-xs">
            Reason (required)
          </Label>
          <Input
            id={`change_denial_reason_${requestId}`}
            value={denialReason}
            onChange={(event) => setDenialReason(event.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={review.isPending || !denialReason.trim()}
          onClick={() => submitReview({ status: "denied", denial_reason: denialReason.trim() })}
        >
          {review.isPending ? "Denying…" : "Confirm deny"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDenying(false)}>
          Cancel
        </Button>
        {displayError && <p className="basis-full text-xs text-red-600">{displayError}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={review.isPending}
          onClick={() => submitReview({ status: "approved" })}
        >
          {review.isPending ? "Approving…" : "Approve"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setDenying(true)}>
          Deny
        </Button>
      </div>
      <p className="text-xs text-charcoal-ink/50">
        Approving only marks this as reviewed — use Amend on the medication below to make the
        actual change.
      </p>
      {displayError && <p className="text-xs text-red-600">{displayError}</p>}
    </div>
  );
}
