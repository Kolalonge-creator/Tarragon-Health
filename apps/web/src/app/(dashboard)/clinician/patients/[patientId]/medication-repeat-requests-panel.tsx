"use client";

import { useState } from "react";
import {
  usePendingMedicationRepeatRequests,
  useReviewMedicationRepeatRequest,
} from "@/lib/queries/medication-repeat-requests";
import { reviewMedicationRepeatRequestSchema } from "@/lib/validation/medications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Spec §62.12 repeat-request review — every request needs a clinician's
 * decision (20260829011000_medication_repeat_requests.sql has no
 * auto-approve path), so this is where that decision actually happens.
 * Scoped per-patient, same shape as MedicationSafetyPanel, rather than a
 * cross-patient work queue.
 */
export function MedicationRepeatRequestsPanel({
  patientId,
  canReview,
}: {
  patientId: string;
  /** private.can_confirm_medication_refill (any active clinical tier, never
   * a Care Coordinator) is the real gate — this only decides whether the
   * approve/deny controls render at all. */
  canReview: boolean;
}) {
  const { data, isLoading } = usePendingMedicationRepeatRequests(patientId);

  if (isLoading || !data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Repeat requests awaiting review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((request) => (
          <div
            key={request.id}
            className="space-y-2 rounded-md border border-charcoal-ink/10 p-3"
          >
            <div>
              <p className="text-sm font-medium text-charcoal-ink">
                {request.medication?.drug_name ?? "Medication"}
              </p>
              <p className="text-xs text-charcoal-ink/60">
                {[request.medication?.dose, request.medication?.frequency]
                  .filter(Boolean)
                  .join(", ")}
                {request.medication?.rx_number ? ` · ${request.medication.rx_number}` : ""}
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
                Any active clinical tier may review a repeat request; a Care Coordinator cannot.
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ReviewControls({ patientId, requestId }: { patientId: string; requestId: string }) {
  const review = useReviewMedicationRepeatRequest();
  const [denying, setDenying] = useState(false);
  const [denialReason, setDenialReason] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function submitReview(input: { status: "approved" | "denied"; denial_reason?: string }) {
    const parsed = reviewMedicationRepeatRequestSchema.safeParse(input);
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
          <Label htmlFor={`denial_reason_${requestId}`} className="text-xs">
            Reason (required)
          </Label>
          <Input
            id={`denial_reason_${requestId}`}
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
      {displayError && <p className="basis-full text-xs text-red-600">{displayError}</p>}
    </div>
  );
}
