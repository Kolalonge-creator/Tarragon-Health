/**
 * Shared wrapper for the "never throws, but doesn't enforce it" best-effort
 * post-insert helpers (assessBpControlBestEffort, assessHeartRateBestEffort,
 * assessGlucoseBestEffort, assessHealthScoreBestEffort) — extracted after the
 * same try/catch + Sentry.captureException + failure-flag shape was hand-
 * duplicated across apps/web/src/lib/wearables/ingest.ts and three API
 * routes. This is the one place that shape is tested directly; the call
 * sites' own tests cover the integration (see
 * ingest-safety-assessment-failure.test.ts and the route-safety-assessment-
 * failure.test.ts files).
 */

const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

import { runBestEffort } from "./run-best-effort";

describe("runBestEffort", () => {
  beforeEach(() => {
    captureException.mockReset();
  });

  it("returns false and reports nothing when the work succeeds", async () => {
    const failed = await runBestEffort(async () => undefined, { stage: "safety_assessment" });

    expect(failed).toBe(false);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns true and reports to Sentry when the work throws — sabotage: a caller not checking this return value would silently treat a failed assessment as a success", async () => {
    const error = new TypeError("fetch failed");

    const failed = await runBestEffort(async () => {
      throw error;
    }, { stage: "safety_assessment", assessor: "bp_control" });

    expect(failed).toBe(true);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ extra: { stage: "safety_assessment", assessor: "bp_control" } })
    );
  });

  it("never lets the underlying rejection escape as an uncaught exception", async () => {
    // The entire reason this helper exists: assess*BestEffort's "never
    // throws" doc comment isn't literally enforced internally, so every
    // caller needs this guarantee instead.
    await expect(
      runBestEffort(async () => {
        throw new Error("boom");
      }, {})
    ).resolves.toBe(true);
  });
});
