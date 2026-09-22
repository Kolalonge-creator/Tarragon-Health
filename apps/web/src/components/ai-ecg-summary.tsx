"use client";

import type { Database } from "@tarragon/shared";

type AiSummaryStatus = Database["public"]["Enums"]["lab_result_ai_summary_status"];

/**
 * Deterministic, patient-visible summary for an uploaded ECG, mirroring
 * AiResultSummary's role and discipline exactly (styling, "not a medical
 * opinion" labelling) — see lib/ecg-reports/ai-summary.ts for what it reads.
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
  flaggedStatement,
}: {
  status: AiSummaryStatus;
  /** The machine's own printed rhythm statement, verbatim — only meaningful
   * when status is 'flagged'. See EcgReportDocumentView.aiFlaggedStatement. */
  flaggedStatement?: string | null;
}) {
  if (status === "pending") {
    return (
      <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
        Preparing an automatic summary…
      </p>
    );
  }
  if (status === "unavailable") {
    return null;
  }

  const isFlagged = status === "flagged";

  return (
    <div
      className={`rounded-lg border p-3 ${
        isFlagged
          ? "border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15"
          : "border-slate-200 dark:border-night-ink/15 bg-slate-50 dark:bg-night-ink/10"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
        Automated summary. Not a medical opinion.
      </p>
      <p className="mt-1 text-sm text-charcoal-ink dark:text-night-ink">
        {isFlagged
          ? `The ECG machine's own printout reads: "${flaggedStatement ?? "not normal sinus rhythm"}". This isn't a diagnosis — you'll need to follow up with a doctor about it.`
          : "The ECG machine's own printout reads normal sinus rhythm. A doctor hasn't reviewed the full tracing yet — you'll see their interpretation here once they have."}
      </p>
      {isFlagged && (
        <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Message your care team in the app if you&apos;d like to talk this through sooner.
        </p>
      )}
    </div>
  );
}
