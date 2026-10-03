import { bandStatus, resolveTargetBand, splitAtGaps, trendDisplayMode } from "./bp-trend-rules";
import { lagosTimeToUtcMs } from "./lagos-date";
import { loadStartingSuggestionTarget, loadTrendDisplay } from "./s07-config";

const cfg = loadTrendDisplay();
const suggestion = loadStartingSuggestionTarget();
const at = (date: string) => lagosTimeToUtcMs(date, "08:00") as number;

describe("trendDisplayMode", () => {
  it("shows a list below the minimum and a chart at or above it", () => {
    expect(trendDisplayMode(0, cfg)).toBe("list");
    expect(trendDisplayMode(cfg.minReadingsForChart - 1, cfg)).toBe("list");
    expect(trendDisplayMode(cfg.minReadingsForChart, cfg)).toBe("chart");
  });
});

describe("splitAtGaps", () => {
  it("keeps readings within the gap limit on one line", () => {
    const pts = [{ atMs: at("2026-10-01") }, { atMs: at("2026-10-03") }]; // 2 days apart = allowed
    expect(splitAtGaps(pts, cfg)).toHaveLength(1);
  });

  it("breaks the line across a gap longer than the limit", () => {
    const pts = [{ atMs: at("2026-10-01") }, { atMs: at("2026-10-04") }]; // 3 days apart
    const segs = splitAtGaps(pts, cfg);
    expect(segs).toHaveLength(2);
    expect(segs.map((s) => s.length)).toEqual([1, 1]);
  });

  it("sorts unordered input and handles empty input", () => {
    const pts = [{ atMs: at("2026-10-03") }, { atMs: at("2026-10-01") }, { atMs: at("2026-10-02") }];
    const segs = splitAtGaps(pts, cfg);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.map((p) => p.atMs)).toEqual([at("2026-10-01"), at("2026-10-02"), at("2026-10-03")]);
    expect(splitAtGaps([], cfg)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const pts = [{ atMs: at("2026-10-03") }, { atMs: at("2026-10-01") }];
    splitAtGaps(pts, cfg);
    expect(pts[0]?.atMs).toBe(at("2026-10-03"));
  });
});

describe("resolveTargetBand", () => {
  it("uses the configured starting suggestion, unconfirmed, when there is no personal target", () => {
    const band = resolveTargetBand(null, suggestion);
    expect(band).toMatchObject({ confirmed: false, source: "starting_suggestion", setBy: null, setAt: null });
    expect(band.systolicBelow).toBe(suggestion.systolicBelow);
  });

  it("treats a personal target as confirmed only with a clinician and a date", () => {
    const band = resolveTargetBand(
      { systolicBelow: 130, diastolicBelow: 80, setBy: "Dr A", setAt: "2026-09-30" },
      suggestion,
    );
    expect(band).toMatchObject({ confirmed: true, source: "clinician", setBy: "Dr A", setAt: "2026-09-30", systolicBelow: 130 });
  });

  it("never labels a target as clinician-set when who or when is missing", () => {
    for (const partial of [
      { setBy: null, setAt: "2026-09-30" },
      { setBy: "Dr A", setAt: null },
      { setBy: "  ", setAt: "2026-09-30" },
    ]) {
      const band = resolveTargetBand({ systolicBelow: 130, diastolicBelow: 80, ...partial }, suggestion);
      expect(band.confirmed).toBe(false);
      expect(band.source).toBe("starting_suggestion");
      expect(band.setBy).toBeNull();
    }
  });

  it("falls back to the suggestion when the personal numbers are unusable", () => {
    const band = resolveTargetBand({ systolicBelow: 0, diastolicBelow: Number.NaN, setBy: "Dr A", setAt: "2026-09-30" }, suggestion);
    expect(band.systolicBelow).toBe(suggestion.systolicBelow);
    expect(band.confirmed).toBe(false);
  });
});

describe("bandStatus", () => {
  const band = resolveTargetBand({ systolicBelow: 130, diastolicBelow: 80, setBy: "Dr A", setAt: "2026-09-30" }, suggestion);

  it("is within when both numbers are under the limits", () => {
    expect(bandStatus(129, 79, band)).toBe("within");
  });

  it("is above when either number reaches its limit", () => {
    expect(bandStatus(130, 70, band)).toBe("above");
    expect(bandStatus(120, 80, band)).toBe("above");
  });
});
