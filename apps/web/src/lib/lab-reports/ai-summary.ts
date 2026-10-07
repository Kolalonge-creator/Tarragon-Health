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
 * No row values or analyte names are ever derived here — only a status. See
 * deriveAiFlaggedAnalytes below for the widened, 2026-09-22 companion that
 * DOES name the flagged test(s), deliberately kept as a separate function so
 * this one's contract (status only) stays exactly what its callers expect.
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

/** One test the QC 'outside_printed_range' flag caught — both fields copied
 * verbatim off the uploaded document, never a Tarragon-computed or
 * unit-converted value. See the 2026-09-22
 * lab_result_documents_ai_flagged_analytes migration for the full reasoning
 * on why this is safe to show a patient directly. */
export interface FlaggedAnalyte {
  /** The row's label as printed on the report (reportedLabel), or the
   * catalogue's display label when the row resolved to one — whichever a
   * patient will actually recognise against their own copy of the report. */
  label: string;
  /** The lab's own printed reference interval, verbatim. Null if the lab
   * printed no range at all for this row (should not happen for a row that
   * carries this flag, but never assumed). */
  reportedRange: string | null;
}

/**
 * Names the specific test(s) `deriveAiSummaryStatus` flagged — the widened,
 * 2026-09-22 companion to that function. Reads the SAME
 * 'outside_printed_range' flag, so the two can never disagree about WHICH
 * rows are flagged, only whether the caller wants the bare status or the
 * detail behind it. Always returns [] when the status would be 'ready' or
 * 'unavailable'.
 */
export function deriveAiFlaggedAnalytes(
  rows: {
    status: string;
    label: string | null;
    reportedLabel: string;
    reportedRange: string | null;
    flags: { key: string }[];
  }[],
): FlaggedAnalyte[] {
  return rows
    .filter(
      (r) => r.status === "ready" && r.flags.some((f) => f.key === "outside_printed_range"),
    )
    .map((r) => ({ label: r.label ?? r.reportedLabel, reportedRange: r.reportedRange }));
}
