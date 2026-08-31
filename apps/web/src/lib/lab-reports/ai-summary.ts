/**
 * Patient-facing AI summary status, derived ONLY from the QC
 * 'outside_printed_range' flag (qc.ts) — the lab's own printed range vs. the
 * transcribed value, a fact about the document rather than a Tarragon
 * clinical judgement. Deliberately does not use reference-ranges.ts's
 * interpretReading/worstStatusOf: that module's own header says its
 * classification "must never drive... anything a patient sees or is told",
 * and is reserved for the escalation-bridge doctor-queue signal in
 * extraction-actions.ts.
 *
 * No row values or analyte names are ever derived here — only a status.
 *
 * Kept out of extraction-actions.ts deliberately: that file is "use server",
 * which requires every export to be an async Server Action — this is a pure,
 * synchronous function and belongs in a plain module.
 */
export function deriveAiSummaryStatus(
  rows: { status: string; flags: { key: string }[] }[],
): "ready" | "flagged" | "unavailable" {
  if (rows.length === 0) return "unavailable";
  const flagged = rows.some(
    (r) => r.status === "ready" && r.flags.some((f) => f.key === "outside_printed_range"),
  );
  return flagged ? "flagged" : "ready";
}
