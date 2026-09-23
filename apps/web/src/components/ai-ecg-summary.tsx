"use client";

import { AiSummaryCard } from "@/components/ai-summary-card";
import type { Database } from "@tarragon/shared";

type AiSummaryStatus = Database["public"]["Enums"]["ai_document_summary_status"];

/**
 * Deterministic, patient-visible summary for an uploaded ECG, mirroring
 * AiResultSummary's role and discipline exactly (styling, "not a medical
 * opinion" labelling — both now shared via AiSummaryCard) — see
 * lib/ecg-reports/ai-summary.ts for what it reads.
 *
 * ALWAYS shows the machine's own printed rhythm statement verbatim, in both
 * the ready and flagged cases — never a hardcoded guess at what a "normal"
 * printout says. (Fixed 2026-09-22, /code-review high: this used to hardcode
 * "reads normal sinus rhythm" for every ready case, which was simply false
 * whenever a cart printed "Normal ECG"/"Normal 12-lead ECG" instead — a
 * direct violation of the feature's own verbatim-only discipline. See
 * lib/ecg-reports/ai-summary.ts's extractMachineRhythmStatement and the
 * ai_rhythm_statement column rename.)
 *
 * No paid "discuss this" booking action here, unlike AiResultSummary: this
 * platform has no ECG-specific consult-fee product (lab_result_consult_requests
 * is lab-specific by schema — see its own header). "Message your care team"
 * points at the free, already-built in-app care_messages channel instead of
 * inventing a new payment surface, per CLAUDE.md's standing guardrail against
 * building functional payment features without an explicit ask.
 */
export function AiEcgSummary({
  status,
  statement,
}: {
  status: AiSummaryStatus;
  /** The machine's own printed rhythm statement, verbatim — populated
   * whenever the extraction resolved one, regardless of status. See
   * EcgReportDocumentView.aiRhythmStatement. */
  statement?: string | null;
}) {
  // Should always be non-null when status is ready/flagged (both statuses
  // require a resolved statement — see deriveEcgAiSummaryStatus), but never
  // assumed: fall back to a generic phrase rather than showing "null".
  const printedText = statement ?? "no rhythm statement was printed";

  return (
    <AiSummaryCard status={status} label="Automated summary. Not a medical opinion.">
      {(isFlagged) => (
        <>
          <p className="mt-1 text-sm text-charcoal-ink dark:text-night-ink">
            {isFlagged
              ? `The ECG machine's own printout reads: "${printedText}". This isn't a diagnosis — you'll need to follow up with a doctor about it.`
              : `The ECG machine's own printout reads: "${printedText}". A doctor hasn't reviewed the full tracing yet — you'll see their interpretation here once they have.`}
          </p>
          {isFlagged && (
            <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Message your care team in the app if you&apos;d like to talk this through sooner.
            </p>
          )}
        </>
      )}
    </AiSummaryCard>
  );
}
