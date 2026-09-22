/**
 * Patient-facing AI summary status for an ECG upload, mirroring
 * lib/lab-reports/ai-summary.ts's role and discipline exactly, adapted to
 * what an ECG printout actually carries as its own verdict.
 *
 * An ECG cart prints no per-parameter reference range the way a lab report
 * does (lib/ecg-reports/qc.ts's own header explains this), so there is no
 * outside_printed_range-style numeric check available. What DOES exist, and
 * is exactly as strong a "the document's own verdict" signal: the machine's
 * own printed rhythm statement (extract.ts's machine_rhythm_statement row —
 * "Normal sinus rhythm", "Sinus tachycardia", "Possible left axis
 * deviation", etc — copied VERBATIM by the extraction, never Tarragon's own
 * reading of the tracing). This module classifies that verbatim text as
 * ready/flagged with a plain pattern match against known-normal phrasing —
 * still not a clinical judgement of our own, just recognising the machine's
 * OWN wording.
 *
 * Deliberately does NOT use any of the QC flags in qc.ts
 * (qt_shorter_than_qrs, qtc_bazett_mismatch, not_twelve_lead_suspected) as a
 * signal here — those say "we may have misread this", not "the document
 * says something is wrong", and conflating the two would tell a patient
 * their ECG looks abnormal when the real issue might only be a transcription
 * quirk.
 */

const NORMAL_RHYTHM_PATTERN =
  /^(normal sinus rhythm|normal ecg|normal electrocardiogram|normal 12[- ]lead ecg)\.?$/i;

export function deriveEcgAiSummaryStatus(
  parameters: { code: string | null; status: string; valueText: string | null }[],
): "ready" | "flagged" | "unavailable" {
  const statement = parameters.find(
    (p) => p.code === "machine_rhythm_statement" && p.status === "ready" && p.valueText,
  );
  if (!statement?.valueText) return "unavailable";
  return NORMAL_RHYTHM_PATTERN.test(statement.valueText.trim()) ? "ready" : "flagged";
}

/**
 * The machine's own printed rhythm statement, verbatim, when
 * deriveEcgAiSummaryStatus would return 'flagged' — null otherwise. Reads
 * the SAME row as that function so the two can never disagree about WHICH
 * statement is behind a 'flagged' status.
 */
export function deriveEcgFlaggedStatement(
  parameters: { code: string | null; status: string; valueText: string | null }[],
): string | null {
  const status = deriveEcgAiSummaryStatus(parameters);
  if (status !== "flagged") return null;
  const statement = parameters.find(
    (p) => p.code === "machine_rhythm_statement" && p.status === "ready" && p.valueText,
  );
  return statement?.valueText ?? null;
}
