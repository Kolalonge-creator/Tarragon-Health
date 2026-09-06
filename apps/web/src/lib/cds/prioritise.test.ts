import {
  prioritiseCdsRecommendations,
  MAX_VISIBLE_RECOMMENDATIONS,
  type CdsDecisionRecord,
} from "./prioritise";
import type { CdsRecommendation, CdsPriority } from "./types";

const NOW = new Date("2026-08-29T10:00:00Z");

function rec(overrides: Partial<CdsRecommendation> & { key: string }): CdsRecommendation {
  return {
    fingerprint: "fp",
    category: "monitoring",
    priority: "medium",
    title: "Title",
    triggerText: "Trigger",
    sourceLabel: "Source",
    ...overrides,
  };
}

function decision(overrides: Partial<CdsDecisionRecord> & { recommendationKey: string }): CdsDecisionRecord {
  return {
    fingerprint: "fp",
    decision: "accepted",
    suppressUntil: null,
    decidedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("prioritiseCdsRecommendations — §38.12 a decision is respected until the facts change", () => {
  it("hides a recommendation the clinician already accepted, with the same fingerprint", () => {
    const recs = [rec({ key: "bp_uncontrolled" })];
    const decisions = [decision({ recommendationKey: "bp_uncontrolled", decision: "accepted" })];
    const result = prioritiseCdsRecommendations(recs, decisions, NOW);
    expect(result.visible).toEqual([]);
    expect(result.settled).toEqual(recs);
  });

  it("hides an overridden recommendation the same way as an accepted one", () => {
    const recs = [rec({ key: "k1" })];
    const decisions = [decision({ recommendationKey: "k1", decision: "overridden" })];
    const result = prioritiseCdsRecommendations(recs, decisions, NOW);
    expect(result.visible).toEqual([]);
  });

  it("resurfaces once the fingerprint changes, even with a settled decision on file (never a stale suppression)", () => {
    const recs = [rec({ key: "bp_uncontrolled", fingerprint: "150/95" })];
    const decisions = [decision({ recommendationKey: "bp_uncontrolled", fingerprint: "160/100", decision: "accepted" })];
    const result = prioritiseCdsRecommendations(recs, decisions, NOW);
    expect(result.visible).toEqual(recs);
    expect(result.settled).toEqual([]);
  });

  it("keeps a deferred recommendation hidden until suppress_until, then resurfaces it", () => {
    const recs = [rec({ key: "k1" })];
    const stillFuture = decision({
      recommendationKey: "k1",
      decision: "deferred",
      suppressUntil: "2026-09-05T00:00:00Z",
    });
    const alreadyPast = decision({
      recommendationKey: "k1",
      decision: "deferred",
      suppressUntil: "2026-08-01T00:00:00Z",
    });

    expect(prioritiseCdsRecommendations(recs, [stillFuture], NOW).visible).toEqual([]);
    expect(prioritiseCdsRecommendations(recs, [alreadyPast], NOW).visible).toEqual(recs);
  });

  it("uses only the LATEST decision per key when several exist", () => {
    const recs = [rec({ key: "k1" })];
    const decisions = [
      decision({ recommendationKey: "k1", decision: "deferred", suppressUntil: "2099-01-01T00:00:00Z", decidedAt: "2026-08-01T00:00:00Z" }),
      decision({ recommendationKey: "k1", decision: "accepted", decidedAt: "2026-08-20T00:00:00Z" }),
    ];
    // The later 'accepted' (no suppress window) should win over the earlier far-future deferral.
    const result = prioritiseCdsRecommendations(recs, decisions, NOW);
    expect(result.visible).toEqual([]);
    expect(result.settled).toEqual(recs);
  });

  it("has nothing to suppress a fresh recommendation with no decision history", () => {
    const recs = [rec({ key: "k1" })];
    const result = prioritiseCdsRecommendations(recs, [], NOW);
    expect(result.visible).toEqual(recs);
  });
});

describe("prioritiseCdsRecommendations — §38.11 alert-fatigue cap", () => {
  function manyRecs(n: number, priority: CdsPriority): CdsRecommendation[] {
    return Array.from({ length: n }, (_, i) => rec({ key: `k${priority}${i}`, priority }));
  }

  it("shows every item when under the cap", () => {
    const recs = manyRecs(3, "high");
    const result = prioritiseCdsRecommendations(recs, [], NOW);
    expect(result.visible).toHaveLength(3);
    expect(result.overflow).toHaveLength(0);
  });

  it("never exceeds MAX_VISIBLE_RECOMMENDATIONS, and accounts for every hidden item in overflow", () => {
    const recs = manyRecs(25, "low");
    const result = prioritiseCdsRecommendations(recs, [], NOW);
    expect(result.visible).toHaveLength(MAX_VISIBLE_RECOMMENDATIONS);
    expect(result.overflow).toHaveLength(25 - MAX_VISIBLE_RECOMMENDATIONS);
    expect(result.visible.length + result.overflow.length + result.settled.length).toBe(25);
  });

  it("always shows every high-priority item before any medium/low, even when that alone exceeds the cap", () => {
    const recs = [...manyRecs(MAX_VISIBLE_RECOMMENDATIONS + 2, "high"), ...manyRecs(3, "low")];
    const result = prioritiseCdsRecommendations(recs, [], NOW);
    expect(result.visible.every((r) => r.priority === "high")).toBe(true);
    expect(result.visible).toHaveLength(MAX_VISIBLE_RECOMMENDATIONS);
    // the 2 overflowed high-priority items plus all 3 low-priority items are accounted for, not dropped
    expect(result.overflow).toHaveLength(2 + 3);
  });

  it("settled items are removed before the cap is ever applied — a decided item never displaces an undecided one", () => {
    const recs = [rec({ key: "settled-one", priority: "high" }), ...manyRecs(MAX_VISIBLE_RECOMMENDATIONS, "high")];
    const decisions = [decision({ recommendationKey: "settled-one" })];
    const result = prioritiseCdsRecommendations(recs, decisions, NOW);
    expect(result.visible).toHaveLength(MAX_VISIBLE_RECOMMENDATIONS);
    expect(result.visible.some((r) => r.key === "settled-one")).toBe(false);
    expect(result.overflow).toHaveLength(0);
  });
});
