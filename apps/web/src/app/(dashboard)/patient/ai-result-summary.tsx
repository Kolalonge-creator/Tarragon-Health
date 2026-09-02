"use client";

import { useActionState } from "react";
import {
  requestLabResultConsult,
  type RequestLabResultConsultState,
} from "./lab-result-consult-actions";
import type { Database } from "@tarragon/shared";

type AiSummaryStatus = Database["public"]["Enums"]["lab_result_ai_summary_status"];

/**
 * Deterministic, patient-visible summary derived from the extraction's QC
 * flags (extraction-actions.ts: deriveAiSummaryStatus). Deliberately styled
 * and worded to be unmistakably NOT the doctor-authored patientInterpretation
 * block above it — no green "reviewed" styling, an explicit "not a medical
 * opinion" label, and no analyte names or values, since none are ever stored
 * on ai_summary_status in the first place.
 *
 * "Discuss this" starts the same paid self-arranged consult flow every other
 * lab-result consult on this platform uses (requestLabResultConsult) — there
 * is no lab_order_id in scope for a document already sitting on the record,
 * so this books a "loose" credit rather than tying to a specific order, the
 * same fallback PatientResultUpload uses when its own labOrderId prop is
 * omitted.
 */
export function AiResultSummary({ status }: { status: AiSummaryStatus }) {
  const [state, formAction, pending] = useActionState<RequestLabResultConsultState, FormData>(
    requestLabResultConsult,
    undefined,
  );

  if (status === "pending") {
    return <p className="text-xs text-charcoal-ink/50">Preparing an automatic summary…</p>;
  }
  if (status === "unavailable") {
    return null;
  }

  const isFlagged = status === "flagged";

  return (
    <div
      className={`rounded-lg border p-3 ${
        isFlagged ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
        Automated summary — not a medical opinion
      </p>
      <p className="mt-1 text-sm text-charcoal-ink">
        {isFlagged
          ? "One or more values in this file fall outside the range printed on the report itself. This isn't a diagnosis — only a doctor reviewing the full picture can tell you what it means."
          : "The values in this file look consistent with the ranges printed on the report. A doctor hasn't reviewed this yet — you'll see their interpretation here once they have."}
      </p>
      <form action={formAction} className="mt-2">
        <button
          type="submit"
          disabled={pending}
          className={`text-sm font-medium hover:underline disabled:opacity-60 ${
            isFlagged ? "text-amber-700" : "text-charcoal-ink/70"
          }`}
        >
          {pending ? "Redirecting to payment…" : "Discuss this with a Tarragon doctor →"}
        </button>
      </form>
      {state?.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
