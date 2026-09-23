/**
 * Patient-facing AI summary status for an uploaded imaging/radiology report,
 * mirroring lib/lab-reports/ai-summary.ts and lib/ecg-reports/ai-summary.ts
 * in role and discipline. Reads ONLY what AI-016 (lib/imaging-reports/extract.ts)
 * transcribed: the radiologist's own Impression/Conclusion, verbatim, and
 * its own impressionIndicatesFinding flag — which is itself already biased
 * toward true (flagged) on ambiguity, applied inside extract.ts's own
 * mapping of the model's raw output. This module only turns that pair into
 * the three-value status every other document type on this platform uses.
 *
 * Kept out of extraction-actions.ts deliberately: that file is "use server",
 * which requires every export to be an async Server Action — this is a
 * pure, synchronous function and belongs in a plain module.
 */

export type AiImagingSummaryStatus = "ready" | "flagged" | "unavailable";

export function deriveImagingAiSummaryStatus(extraction: {
  impressionText: string | null;
  impressionIndicatesFinding: boolean | null;
}): AiImagingSummaryStatus {
  if (extraction.impressionText === null) return "unavailable";
  // impressionIndicatesFinding is only ever null when impressionText is
  // null too (see extract.ts) — this fallback is defensive, and biases
  // toward flagged for the same reason extract.ts does: never silently
  // treat an unclear read as "all clear".
  return extraction.impressionIndicatesFinding === false ? "ready" : "flagged";
}
