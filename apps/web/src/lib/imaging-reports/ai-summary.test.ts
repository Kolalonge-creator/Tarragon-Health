import { deriveImagingAiSummaryStatus } from "./ai-summary";

/**
 * deriveImagingAiSummaryStatus is the entire decision surface for what a
 * patient sees on their own imaging/radiology upload before any doctor has
 * reviewed it. It must be 'unavailable' whenever no impression was read at
 * all, and must default toward 'flagged' rather than 'ready' on anything
 * ambiguous — the same asymmetric-risk posture the AI-016 guardrail
 * (bias_toward_flagged_on_ambiguity) and extract.ts's own mapping apply.
 */
describe("deriveImagingAiSummaryStatus", () => {
  it("is 'unavailable' when no impression text was read at all", () => {
    expect(
      deriveImagingAiSummaryStatus({ impressionText: null, impressionIndicatesFinding: null }),
    ).toBe("unavailable");
  });

  it("is 'ready' when the impression clearly states no finding", () => {
    expect(
      deriveImagingAiSummaryStatus({
        impressionText: "IMPRESSION: No acute cardiopulmonary abnormality.",
        impressionIndicatesFinding: false,
      }),
    ).toBe("ready");
  });

  it("is 'flagged' when the impression clearly states a finding", () => {
    expect(
      deriveImagingAiSummaryStatus({
        impressionText: "CONCLUSION: Right lower lobe consolidation.",
        impressionIndicatesFinding: true,
      }),
    ).toBe("flagged");
  });

  it("defaults to 'flagged' rather than 'ready' when impressionIndicatesFinding is unexpectedly null but text exists", () => {
    // Should not happen in practice (extract.ts always resolves this to a
    // boolean whenever impressionText is non-null), but if it ever did, the
    // safe direction is flagged, never a silent 'ready'.
    expect(
      deriveImagingAiSummaryStatus({
        impressionText: "Some ambiguous wording.",
        impressionIndicatesFinding: null,
      }),
    ).toBe("flagged");
  });
});
