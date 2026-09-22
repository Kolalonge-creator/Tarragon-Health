"use client";

import { AiSummaryCard } from "@/components/ai-summary-card";
import type { Database } from "@tarragon/shared";

type AiSummaryStatus = Database["public"]["Enums"]["lab_result_ai_summary_status"];

/**
 * Deterministic, patient-visible summary for an uploaded imaging/radiology
 * report, mirroring AiResultSummary/AiEcgSummary's role and discipline
 * exactly (both now shared via AiSummaryCard). Reads AI-016's output
 * (lib/imaging-reports/extract.ts) — the radiologist's own
 * Impression/Conclusion, copied verbatim, never Tarragon's own reading of
 * the scan image.
 *
 * AI-016 ships registered but DISABLED (see the 2026-09-22 migration) — this
 * component already handles that correctly: 'unavailable' is exactly what
 * ai_summary_status reads while it's off, same as any other extraction
 * failure, so no separate "coming soon" state is needed here.
 *
 * No paid "discuss this" booking action, same reasoning as AiEcgSummary: no
 * imaging-specific consult-fee product exists on this platform.
 */
export function AiImagingSummary({
  status,
  impressionText,
}: {
  status: AiSummaryStatus;
  /** The radiologist's own Impression/Conclusion, verbatim — shown
   * regardless of flagged/ready, since "no acute abnormality" in the
   * radiologist's own words is itself the answer a patient uploaded to get. */
  impressionText?: string | null;
}) {
  return (
    <AiSummaryCard
      status={status}
      label="The radiologist's own report. Not a doctor's review of your case."
    >
      {(isFlagged) => (
        <>
          {impressionText && (
            <p className="mt-1 text-sm text-charcoal-ink dark:text-night-ink">{impressionText}</p>
          )}
          {isFlagged && (
            <p className="mt-2 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
              This isn&apos;t a diagnosis — you&apos;ll need to follow up with a doctor about it.
              Message your care team in the app if you&apos;d like to talk this through sooner.
            </p>
          )}
        </>
      )}
    </AiSummaryCard>
  );
}
