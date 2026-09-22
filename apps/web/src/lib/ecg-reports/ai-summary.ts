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

// Deliberately a WHOLE-STRING match (^...$), not a prefix/substring check: a
// cart that prints a compound statement like "Normal sinus rhythm with
// frequent PVCs" must NOT match here, since the trailing clause is a real
// abnormal finding a looser prefix match would silently swallow. The
// consequence, accepted on purpose, is that a genuinely normal printout with
// ANY extra trailing text (e.g. "Normal sinus rhythm. Rate 72bpm.") also
// falls through to 'flagged' rather than 'ready' -- over-flagging is the
// safe direction, matching this file's asymmetric-risk posture everywhere
// else. Calibrated against the phrasing extract.ts's own system prompt asks
// the model to use, not against real ECG cart output (no real hardware has
// exercised this path yet -- same caveat CLAUDE.md's BLE section carries for
// the clinical-device pairing path). Revisit the strictness once real
// printouts are available to calibrate against.
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
 * The machine's own printed rhythm statement, verbatim — ALWAYS returned
 * when the extraction resolved one, regardless of ready/flagged. Reads the
 * SAME row deriveEcgAiSummaryStatus does, so the two can never disagree
 * about which statement backs a given status.
 *
 * Deliberately not conditioned on status: a "ready" ECG did not necessarily
 * print exactly "Normal sinus rhythm" — this file's own NORMAL_RHYTHM_PATTERN
 * (above) also matches "Normal ECG", "Normal electrocardiogram" and "Normal
 * 12-lead ECG", none of which mention "sinus rhythm" at all.
 * Showing the patient the ACTUAL printed words in every case (not a
 * hardcoded "normal sinus rhythm" guess) is what the whole feature's
 * verbatim-only discipline requires — see extract.ts's own "copy it
 * VERBATIM... never your assessment" instruction.
 */
export function extractMachineRhythmStatement(
  parameters: { code: string | null; status: string; valueText: string | null }[],
): string | null {
  const statement = parameters.find(
    (p) => p.code === "machine_rhythm_statement" && p.status === "ready" && p.valueText,
  );
  return statement?.valueText ?? null;
}
