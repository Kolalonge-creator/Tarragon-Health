import { describe, expect, it } from "@jest/globals";
import {
  isFailedAnalyticsQuery,
  pageReportsItsOwnFailures,
  worstAnalyticsLoadState,
  type QueryLike,
} from "./load-failures";

function query(
  over: Partial<{ key: unknown[]; status: string; data: unknown; observers: number }> = {}
): QueryLike {
  return {
    queryKey: over.key ?? ["analytics", "business-summary"],
    state: { status: over.status ?? "success", data: over.data },
    getObserversCount: () => over.observers ?? 1,
  };
}

describe("worstAnalyticsLoadState", () => {
  it("is none when nothing has failed", () => {
    expect(worstAnalyticsLoadState([])).toBe("none");
    expect(worstAnalyticsLoadState([query({ data: { a: 1 } }), query({ status: "pending" })])).toBe("none");
  });

  it("is failed when a figure has nothing to show", () => {
    expect(worstAnalyticsLoadState([query({ status: "error" })])).toBe("failed");
  });

  it("is stale, not failed, when the last good figures are still on screen", () => {
    expect(worstAnalyticsLoadState([query({ status: "error", data: { total: 9 } })])).toBe("stale");
  });

  it("counts a genuine empty answer as data, so it is stale rather than failed", () => {
    // `[]` and `0` are real answers from a successful read; only undefined is "nothing".
    expect(worstAnalyticsLoadState([query({ status: "error", data: [] })])).toBe("stale");
    expect(worstAnalyticsLoadState([query({ status: "error", data: 0 })])).toBe("stale");
  });

  it("lets failed outrank stale however they are ordered", () => {
    const stale = query({ status: "error", data: { a: 1 } });
    const failed = query({ status: "error" });
    expect(worstAnalyticsLoadState([stale, failed])).toBe("failed");
    expect(worstAnalyticsLoadState([failed, stale])).toBe("failed");
  });

  it("ignores queries that are not analytics queries", () => {
    expect(worstAnalyticsLoadState([query({ key: ["patients", "list"], status: "error" })])).toBe("none");
  });

  it("ignores a failure nothing on this page is waiting on", () => {
    // Failed on another page and merely still in the cache: no observer.
    expect(worstAnalyticsLoadState([query({ status: "error", observers: 0 })])).toBe("none");
  });
});

describe("isFailedAnalyticsQuery", () => {
  it("is the same test the retry button uses to pick what to refetch", () => {
    expect(isFailedAnalyticsQuery(query({ status: "error" }))).toBe(true);
    expect(isFailedAnalyticsQuery(query({ status: "success" }))).toBe(false);
    expect(isFailedAnalyticsQuery(query({ key: ["x"], status: "error" }))).toBe(false);
  });
});

describe("pageReportsItsOwnFailures", () => {
  it("is true for the two pages that already say so themselves", () => {
    expect(pageReportsItsOwnFailures("/analytics")).toBe(true);
    expect(pageReportsItsOwnFailures("/analytics/")).toBe(true);
    expect(pageReportsItsOwnFailures("/analytics/investor")).toBe(true);
  });

  it("is false for every other analytics page, and for an unknown path", () => {
    expect(pageReportsItsOwnFailures("/analytics/business")).toBe(false);
    expect(pageReportsItsOwnFailures("/analytics/investor/extra")).toBe(false);
    expect(pageReportsItsOwnFailures(null)).toBe(false);
    expect(pageReportsItsOwnFailures(undefined)).toBe(false);
  });
});
