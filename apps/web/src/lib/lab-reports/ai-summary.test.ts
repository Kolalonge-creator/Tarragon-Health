import { deriveAiSummaryStatus, deriveAiFlaggedAnalytes } from "./ai-summary";

/**
 * deriveAiSummaryStatus is the entire decision surface for what a patient
 * sees on their own free upload before any doctor has reviewed it — it must
 * never derive from reference-ranges.ts's clinical classification (see the
 * function's own doc comment) and must never report "flagged" off a row the
 * extraction itself could not read.
 */
describe("deriveAiSummaryStatus", () => {
  it("is 'unavailable' when there are no rows at all", () => {
    expect(deriveAiSummaryStatus([])).toBe("unavailable");
  });

  it("is 'ready' when every readable row is within the lab's own printed range", () => {
    const rows = [
      { status: "ready", flags: [] },
      { status: "ready", flags: [{ key: "low_confidence" }] },
    ];
    expect(deriveAiSummaryStatus(rows)).toBe("ready");
  });

  it("is 'flagged' when a ready row carries the printed-range QC flag", () => {
    const rows = [
      { status: "ready", flags: [] },
      { status: "ready", flags: [{ key: "outside_printed_range" }] },
    ];
    expect(deriveAiSummaryStatus(rows)).toBe("flagged");
  });

  it("ignores the printed-range flag on a row the extraction never actually resolved", () => {
    // A row status other than 'ready' (unmapped/unreadable_value/implausible/
    // unknown_unit) means the value itself is unreliable — flagging the
    // PATIENT off a number the system does not trust would be worse than
    // saying nothing.
    const rows = [{ status: "unmapped", flags: [{ key: "outside_printed_range" }] }];
    expect(deriveAiSummaryStatus(rows)).toBe("ready");
  });
});

/**
 * deriveAiFlaggedAnalytes (2026-09-22) is the widened companion that names
 * the specific test(s) behind a 'flagged' status. It must read the SAME
 * 'outside_printed_range' flag as deriveAiSummaryStatus (the two can never
 * disagree about which rows are flagged) and must only ever surface fields
 * copied verbatim off the document — never a computed/converted value.
 */
describe("deriveAiFlaggedAnalytes", () => {
  it("returns [] when nothing is flagged", () => {
    const rows = [
      {
        status: "ready",
        label: "Fasting glucose",
        reportedLabel: "FASTING GLUCOSE",
        reportedRange: "3.9-5.5",
        flags: [],
      },
    ];
    expect(deriveAiFlaggedAnalytes(rows)).toEqual([]);
  });

  it("names the flagged row's label and the lab's own printed range, verbatim", () => {
    const rows = [
      {
        status: "ready",
        label: "Fasting glucose",
        reportedLabel: "FASTING GLUCOSE",
        reportedRange: "3.9-5.5",
        flags: [{ key: "outside_printed_range" }],
      },
    ];
    expect(deriveAiFlaggedAnalytes(rows)).toEqual([
      { label: "Fasting glucose", reportedRange: "3.9-5.5" },
    ]);
  });

  it("falls back to the verbatim reportedLabel when the row has no catalogue label", () => {
    // An unmapped-looking label should never happen alongside 'ready' status
    // in practice, but the fallback must still hold rather than showing
    // "null" to a patient.
    const rows = [
      {
        status: "ready",
        label: null,
        reportedLabel: "SOME UNRECOGNISED ROW",
        reportedRange: "10-20",
        flags: [{ key: "outside_printed_range" }],
      },
    ];
    expect(deriveAiFlaggedAnalytes(rows)).toEqual([
      { label: "SOME UNRECOGNISED ROW", reportedRange: "10-20" },
    ]);
  });

  it("never surfaces a row whose status is not 'ready', even if flagged", () => {
    const rows = [
      {
        status: "unmapped",
        label: null,
        reportedLabel: "UNRELIABLE ROW",
        reportedRange: "1-2",
        flags: [{ key: "outside_printed_range" }],
      },
    ];
    expect(deriveAiFlaggedAnalytes(rows)).toEqual([]);
  });

  it("can surface more than one flagged test at once", () => {
    const rows = [
      {
        status: "ready",
        label: "ALT (SGPT)",
        reportedLabel: "ALT",
        reportedRange: "7-56",
        flags: [{ key: "outside_printed_range" }],
      },
      {
        status: "ready",
        label: "Haemoglobin",
        reportedLabel: "HB",
        reportedRange: "12-16",
        flags: [{ key: "outside_printed_range" }],
      },
    ];
    expect(deriveAiFlaggedAnalytes(rows)).toEqual([
      { label: "ALT (SGPT)", reportedRange: "7-56" },
      { label: "Haemoglobin", reportedRange: "12-16" },
    ]);
  });
});
