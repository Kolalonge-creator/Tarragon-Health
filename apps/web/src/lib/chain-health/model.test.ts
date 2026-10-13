import { describe, expect, it } from "@jest/globals";
import { describeTiming, formatSeconds, groupParity, parseChainHealth, parityGroup, stageText } from "./model";

const timing = { n: 0, withheld: false };
const sample = {
  generated_at: "2026-10-13T20:00:00Z", status: "ok", reasons: [], thresholds: { minSample: 20 },
  canary: { last_result_at: null, last_passed: null, last_failed_stage: null, last_pass_at: null, minutes_since_last_result: null, runs_24h: 0, failures_24h: 0, recent: [] },
  bus: { subscribers: [], stuck: 0, dead: 0 },
  timings_7d: { reading_to_graded: timing, graded_to_task: timing, graded_to_page: timing, page_to_ack: timing },
  canary_timings_7d: { reading_to_graded: timing, graded_to_page: timing, page_to_ack: timing },
  parity_30d: [],
};

describe("parseChainHealth", () => {
  it("accepts the database shape", () => expect(parseChainHealth(sample)?.status).toBe("ok"));
  it("rejects a reply that does not match instead of half rendering it", () => {
    expect(parseChainHealth({ ...sample, status: "fine" })).toBeNull();
    expect(parseChainHealth(null)).toBeNull();
    expect(parseChainHealth({ ...sample, bus: undefined })).toBeNull();
  });
});

describe("formatting", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatSeconds(42)).toBe("42 seconds");
    expect(formatSeconds(185)).toBe("3 min 5 s");
    expect(formatSeconds(7500)).toBe("2 h 5 min");
  });
  it("never shows a typical time for a withheld sample", () => {
    expect(describeTiming({ n: 3, withheld: true })).toContain("too few");
    expect(describeTiming({ n: 0, withheld: false })).toBe("no events yet");
    expect(describeTiming({ n: 30, withheld: false, p50: 20, p95: 90 })).toContain("typical 20 seconds");
  });
  it("names stages in plain words and passes an unknown one through", () => {
    expect(stageText("graded")).toContain("grading");
    expect(stageText("brand_new")).toBe("brand_new");
    expect(stageText(null)).toBe("");
  });
});

describe("parity grouping", () => {
  it("separates agreement from the two concerns", () => {
    expect(parityGroup("red", "priority1")).toBe("both_urgent");
    expect(parityGroup("red", "emergency")).toBe("both_urgent");
    expect(parityGroup("red", "review")).toBe("engine_stricter");
    expect(parityGroup("red", "none")).toBe("engine_red_legacy_quiet");
    expect(parityGroup("amber", "priority1")).toBe("legacy_urgent_engine_not_red");
    expect(parityGroup("green", "emergency")).toBe("legacy_urgent_engine_not_red");
    expect(parityGroup("amber", "review")).toBe("neither_urgent");
    expect(parityGroup("green", "none")).toBe("neither_urgent");
  });
  it("sums rows and counts draft rule sets apart", () => {
    const g = groupParity([
      { engine_status: "approved", engine_grade: "red", legacy_class: "none", readings: 2 },
      { engine_status: "draft", engine_grade: "red", legacy_class: "none", readings: 1 },
      { engine_status: "approved", engine_grade: "green", legacy_class: "none", readings: 5 },
    ]);
    expect(g.find((x) => x.group === "engine_red_legacy_quiet")).toEqual({ group: "engine_red_legacy_quiet", readings: 3, draft: 1 });
    expect(g.find((x) => x.group === "neither_urgent")?.readings).toBe(5);
    expect(g).toHaveLength(5);
  });
});
