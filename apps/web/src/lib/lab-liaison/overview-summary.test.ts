import { buildLiaisonSummary, readCount, type LiaisonSummaryInputs } from "./overview-summary";

const ok = (count: number) => ({ count, error: null });
const failed = { count: null, error: { message: "boom" } };

function inputs(overrides: Partial<LiaisonSummaryInputs> = {}): LiaisonSummaryInputs {
  return {
    patientCount: ok(40),
    uploadedToday: ok(3),
    uploadedThisWeek: ok(11),
    awaitingReview: ok(2),
    patientList: { error: null },
    recentFeed: { error: null },
    heldFailed: false,
    ...overrides,
  };
}

describe("readCount", () => {
  it("returns a real count, including a real zero", () => {
    expect(readCount(ok(7))).toBe(7);
    expect(readCount(ok(0))).toBe(0);
  });

  it("returns null when the query errored, even if a count came back with it", () => {
    expect(readCount({ count: 5, error: { message: "x" } })).toBeNull();
    expect(readCount(failed)).toBeNull();
  });

  it("returns null when no count was returned at all", () => {
    expect(readCount({ count: null, error: null })).toBeNull();
  });
});

describe("buildLiaisonSummary", () => {
  it("shows real figures when everything loaded", () => {
    const s = buildLiaisonSummary(inputs());
    expect(s.tiles.patients).toEqual({ value: "40" });
    expect(s.tiles.today).toEqual({ value: "3" });
    expect(s.tiles.thisWeek).toEqual({ value: "11" });
    expect(s.tiles.awaiting.tile).toEqual({ value: "2" });
    expect(s.tiles.awaiting.needsAttention).toBe(true);
    expect(s.tiles.awaiting.delta).toEqual({ text: "Across your organisation", direction: "down" });
    expect(s.anyCountFailed).toBe(false);
  });

  it("says all caught up only when the count loaded and is really zero", () => {
    const s = buildLiaisonSummary(inputs({ awaitingReview: ok(0) }));
    expect(s.tiles.awaiting.tile).toEqual({ value: "0" });
    expect(s.tiles.awaiting.needsAttention).toBe(false);
    expect(s.tiles.awaiting.delta).toEqual({ text: "All caught up", direction: "up" });
  });

  it("never says all caught up, and never shows 0, when the awaiting count failed", () => {
    const s = buildLiaisonSummary(inputs({ awaitingReview: failed }));
    expect(s.tiles.awaiting.tile).toEqual({ empty: { hint: "Could not be loaded" } });
    expect(s.tiles.awaiting.delta).toBeUndefined();
    expect(s.tiles.awaiting.needsAttention).toBe(false);
    expect(s.anyCountFailed).toBe(true);
  });

  it("marks only the tiles that failed", () => {
    const s = buildLiaisonSummary(inputs({ uploadedToday: failed }));
    expect(s.tiles.today.empty).toEqual({ hint: "Could not be loaded" });
    expect(s.tiles.patients).toEqual({ value: "40" });
    expect(s.tiles.thisWeek).toEqual({ value: "11" });
    expect(s.anyCountFailed).toBe(true);
  });

  it("formats large counts with the shared number formatter", () => {
    const s = buildLiaisonSummary(inputs({ patientCount: ok(12345) }));
    expect(s.tiles.patients).toEqual({ value: "12,345" });
  });

  it("flags a failed patient list, so the page does not say there are no patients", () => {
    const s = buildLiaisonSummary(inputs({ patientList: { error: { message: "x" } } }));
    expect(s.patientListFailed).toBe(true);
    expect(s.recentFeedFailed).toBe(false);
  });

  it("flags a failed recent feed and a failed held-uploads read independently", () => {
    const s = buildLiaisonSummary(
      inputs({ recentFeed: { error: { message: "x" } }, heldFailed: true })
    );
    expect(s.recentFeedFailed).toBe(true);
    expect(s.heldFailed).toBe(true);
    expect(s.patientListFailed).toBe(false);
  });
});
