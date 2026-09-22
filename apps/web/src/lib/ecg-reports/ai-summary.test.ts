import { deriveEcgAiSummaryStatus, deriveEcgFlaggedStatement } from "./ai-summary";

/**
 * deriveEcgAiSummaryStatus is the entire decision surface for what a
 * patient sees on their own ECG upload before any doctor has reviewed it. It
 * must read ONLY the machine's own printed rhythm statement — never a QC
 * flag (which says "we may have misread this", not "the document says
 * something is wrong") — and must never report a status off a statement
 * the extraction itself did not resolve.
 */
describe("deriveEcgAiSummaryStatus", () => {
  it("is 'unavailable' when no machine rhythm statement was printed/read", () => {
    const parameters = [{ code: "heart_rate", status: "ready", valueText: null }];
    expect(deriveEcgAiSummaryStatus(parameters)).toBe("unavailable");
  });

  it("is 'unavailable' when the rhythm-statement row exists but isn't ready", () => {
    const parameters = [
      { code: "machine_rhythm_statement", status: "unmapped", valueText: "Normal sinus rhythm" },
    ];
    expect(deriveEcgAiSummaryStatus(parameters)).toBe("unavailable");
  });

  it.each([
    "Normal sinus rhythm",
    "normal sinus rhythm.",
    "NORMAL ECG",
    "Normal 12-lead ECG",
  ])("is 'ready' for a known-normal machine statement: %s", (statement) => {
    const parameters = [
      { code: "machine_rhythm_statement", status: "ready", valueText: statement },
    ];
    expect(deriveEcgAiSummaryStatus(parameters)).toBe("ready");
  });

  it.each([
    "Sinus tachycardia",
    "Possible left axis deviation",
    "Atrial fibrillation",
    "Sinus rhythm with premature ventricular contractions",
  ])("is 'flagged' for anything other than a clearly normal statement: %s", (statement) => {
    const parameters = [
      { code: "machine_rhythm_statement", status: "ready", valueText: statement },
    ];
    expect(deriveEcgAiSummaryStatus(parameters)).toBe("flagged");
  });

  it("never derives a status from QC flags — only the printed statement matters", () => {
    // A QC flag (qtc_bazett_mismatch etc.) means the EXTRACTION may be
    // wrong, not that the tracing itself is abnormal — it must never leak
    // into this patient-facing status on its own.
    const parameters = [
      { code: "machine_rhythm_statement", status: "ready", valueText: "Normal sinus rhythm" },
      { code: "qt_interval", status: "implausible", valueText: null },
    ];
    expect(deriveEcgAiSummaryStatus(parameters)).toBe("ready");
  });
});

describe("deriveEcgFlaggedStatement", () => {
  it("is null when the status is 'ready'", () => {
    const parameters = [
      { code: "machine_rhythm_statement", status: "ready", valueText: "Normal sinus rhythm" },
    ];
    expect(deriveEcgFlaggedStatement(parameters)).toBeNull();
  });

  it("is null when the status is 'unavailable'", () => {
    expect(deriveEcgFlaggedStatement([])).toBeNull();
  });

  it("returns the machine's statement verbatim when flagged", () => {
    const parameters = [
      { code: "machine_rhythm_statement", status: "ready", valueText: "Sinus tachycardia" },
    ];
    expect(deriveEcgFlaggedStatement(parameters)).toBe("Sinus tachycardia");
  });
});
