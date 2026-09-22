"use client";

import { useActionState } from "react";
import {
  requestLabResultConsult,
  type RequestLabResultConsultState,
} from "./lab-result-consult-actions";
import { AiSummaryCard } from "@/components/ai-summary-card";
import type { Database } from "@tarragon/shared";

type AiSummaryStatus = Database["public"]["Enums"]["lab_result_ai_summary_status"];

/**
 * Deterministic, patient-visible summary derived from the extraction's QC
 * flags (extraction-actions.ts: deriveAiSummaryStatus). Deliberately styled
 * and worded to be unmistakably NOT the doctor-authored patientInterpretation
 * block above it (styling/labelling now shared via AiSummaryCard): no green
 * "reviewed" styling, an explicit "not a medical opinion" label.
 *
 * Widened 2026-09-22 to name the specific flagged test(s) (flaggedAnalytes)
 * — founder decision: a patient who already has the full document in hand
 * is not having a result "delivered" by being told which of its OWN rows sat
 * outside the range the lab itself printed. Both fields shown are copied
 * verbatim from the document (lib/lab-reports/ai-summary.ts), never a
 * Tarragon-computed value — see the ai_flagged_analytes migration for the
 * full reasoning. Still never a diagnosis, still always paired with the
 * "talk to a doctor" prompt below.
 *
 * "Discuss this" starts the same paid self-arranged consult flow every other
 * lab-result consult on this platform uses (requestLabResultConsult); there
 * is no lab_order_id in scope for a document already sitting on the record,
 * so this books a "loose" credit rather than tying to a specific order, the
 * same fallback PatientResultUpload uses when its own labOrderId prop is
 * omitted.
 */
export function AiResultSummary({
  status,
  flaggedAnalytes = [],
}: {
  status: AiSummaryStatus;
  /** Which test(s) triggered a 'flagged' status — ignored unless status is
   * 'flagged'. See ResultDocumentView.aiFlaggedAnalytes. */
  flaggedAnalytes?: { label: string; reportedRange: string | null }[];
}) {
  const [state, formAction, pending] = useActionState<RequestLabResultConsultState, FormData>(
    requestLabResultConsult,
    undefined,
  );

  return (
    <AiSummaryCard status={status} label="Automated summary. Not a medical opinion.">
      {(isFlagged) => (
        <>
          <p className="mt-1 text-sm text-charcoal-ink dark:text-night-ink">
            {isFlagged
              ? flaggedAnalytes.length > 0
                ? `${flaggedAnalytes.length === 1 ? "This test is" : "These tests are"} outside the range printed on the report itself: ${flaggedAnalytes
                    .map((a) => (a.reportedRange ? `${a.label} (report range: ${a.reportedRange})` : a.label))
                    .join(", ")}. This isn't a diagnosis — you'll need to follow up with a doctor about it.`
                : "One or more values in this file fall outside the range printed on the report itself. This isn't a diagnosis. Only a doctor reviewing the full picture can tell you what it means."
              : "The values in this file look consistent with the ranges printed on the report. A doctor hasn't reviewed this yet. You'll see their interpretation here once they have."}
          </p>
          <form action={formAction} className="mt-2">
            <button
              type="submit"
              disabled={pending}
              className={`text-sm font-medium hover:underline disabled:opacity-60 ${
                isFlagged
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-charcoal-ink/70 dark:text-night-ink/70"
              }`}
            >
              {pending ? "Redirecting to payment…" : "Discuss this with a Tarragon doctor →"}
            </button>
          </form>
          {state?.error && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-300">{state.error}</p>
          )}
        </>
      )}
    </AiSummaryCard>
  );
}
