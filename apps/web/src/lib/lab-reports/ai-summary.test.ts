import { deriveAiSummaryStatus } from "./ai-summary";

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
