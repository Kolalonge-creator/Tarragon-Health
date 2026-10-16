import { describe, expect, it } from "@jest/globals";
import { composeHealthReport, shareableView } from "./compose";
import type { HealthReportConfig, HealthReportFacts } from "./types";

const CONFIG: HealthReportConfig = {
  maxPriorities: 3,
  minBpReadings: 12,
  minBpDays: 3,
  bpTarget: { systolicBelow: 140, diastolicBelow: 90 },
  bpTargetHigherRisk: { systolicBelow: 130, diastolicBelow: 80 },
  bpHighNormalBand: { systolicFrom: 130, systolicBelow: 140, diastolicFrom: 80, diastolicBelow: 90 },
  changeTolerancePct: 3,
  recheckWeeks: 4,
  priorityWindows: { bp: "within 4 weeks", lab: "within 4 weeks", screening: "within 3 months", risk: "within 4 weeks" },
  trendMinPoints: 2,
  trendYears: 3,
  statementKey: "report.statement.not_rule_out",
  statementApprovedByCmo: false,
  shareExcludedSections: ["screening_reproductive", "risk", "questionnaires"],
};

const EMPTY: HealthReportFacts = {
  year: 2026,
  bp: { count: 0, days: 0, firstAt: null, lastAt: null, avgSystolic: null, avgDiastolic: null },
  bpPrior: null,
  bpCareTeamTarget: null,
  weight: null,
  devices: { manual: 0, device: 0, wearable: 0 },
  labs: [],
  trends: [],
  screening: { done: [], due: [] },
  risk: { state: "not_assessed" },
  questionnaires: [],
};

const TODAY = new Date("2026-12-01T00:00:00Z");
const lab = (code: string, value: number, refLow: number | null, refHigh: number | null, flag: string | null = "normal", prev?: number) => ({
  code,
  unit: "mg/dL",
  readingsThisYear: 1,
  latest: { at: "2026-06-01T00:00:00Z", value, refLow, refHigh, flag, unit: "mg/dL" },
  previous: prev === undefined ? null : { at: "2025-06-01T00:00:00Z", value: prev, refLow, refHigh, flag: null, unit: "mg/dL" },
});

describe("honesty rules", () => {
  it("never says on target without data: an empty year has no on_target item and says not measured", () => {
    const r = composeHealthReport(EMPTY, CONFIG, TODAY);
    expect(r.items.filter((i) => i.state === "on_target")).toHaveLength(0);
    expect(r.items[0]).toMatchObject({ id: "bp", state: "not_measured", reason: "no_readings", value: null });
    expect(r.summary.key).toBe("report.summary.nothing_measured");
  });

  it("blood pressure below the minimum reading count says too few readings and neither passes nor fails", () => {
    const r = composeHealthReport({ ...EMPTY, bp: { count: 2, days: 2, firstAt: "a", lastAt: "b", avgSystolic: 118, avgDiastolic: 76 } }, CONFIG, TODAY);
    const bp = r.items.find((i) => i.id === "bp")!;
    expect(bp.state).toBe("not_measured");
    expect(bp.tooFewReadings).toBe(true);
    expect(bp.readingCount).toBe(2);
    expect(bp.value).toBeNull();
  });

  it("minimum readings rule: 11 readings are too few, 12 are enough (control), on the same days", () => {
    const at = (count: number) => composeHealthReport({ ...EMPTY, bp: { count, days: 5, firstAt: "a", lastAt: "b", avgSystolic: 118, avgDiastolic: 76 } }, CONFIG, TODAY).items.find((i) => i.id === "bp")!;
    expect(at(11)).toMatchObject({ state: "not_measured", tooFewReadings: true, minReadings: 12 });
    expect(at(12)).toMatchObject({ state: "on_target", tooFewReadings: false, readingCount: 12, readingDays: 5 });
  });

  it("minimum days rule: 30 readings squeezed into 2 days are too few, the same 30 over 3 days are enough (control)", () => {
    const on = (days: number) => composeHealthReport({ ...EMPTY, bp: { count: 30, days, firstAt: "a", lastAt: "b", avgSystolic: 118, avgDiastolic: 76 } }, CONFIG, TODAY).items.find((i) => i.id === "bp")!;
    expect(on(2)).toMatchObject({ state: "not_measured", tooFewReadings: true, minDays: 3, readingDays: 2 });
    expect(on(3)).toMatchObject({ state: "on_target", readingDays: 3 });
  });

  it("always carries the count and the days it rests on, so the report can say 'based on N readings over D days'", () => {
    const bp = composeHealthReport({ ...EMPTY, bp: { count: 14, days: 6, firstAt: "a", lastAt: "b", avgSystolic: 150, avgDiastolic: 96 } }, CONFIG, TODAY).items.find((i) => i.id === "bp")!;
    expect(bp).toMatchObject({ readingCount: 14, readingDays: 6 });
    expect(composeHealthReport(EMPTY, CONFIG, TODAY).minBpDays).toBe(3);
  });

  it("blood pressure with enough readings shows the count and date range and is on target inside the window", () => {
    const r = composeHealthReport({ ...EMPTY, bp: { count: 12, days: 6, firstAt: "2026-01-02", lastAt: "2026-11-20", avgSystolic: 122, avgDiastolic: 78 } }, CONFIG, TODAY);
    const bp = r.items.find((i) => i.id === "bp")!;
    expect(bp).toMatchObject({ state: "on_target", readingCount: 12, dateFrom: "2026-01-02", dateTo: "2026-11-20", borderline: false });
  });

  it("a care-team blood pressure target overrides the settings default", () => {
    const facts = { ...EMPTY, bp: { count: 14, days: 6, firstAt: "a", lastAt: "b", avgSystolic: 128, avgDiastolic: 78 }, bpCareTeamTarget: { systolicBelow: 120, diastolicBelow: 80, setBy: "care_team" } };
    const bp = composeHealthReport(facts, CONFIG, TODAY).items.find((i) => i.id === "bp")!;
    expect(bp.state).toBe("needs_attention");
    expect(bp.target?.source).toBe("care_team");
  });

  const bpFacts = (sys: number, dia: number, higher?: Partial<NonNullable<HealthReportFacts["bpHigherRisk"]>>): HealthReportFacts => ({
    ...EMPTY,
    bp: { count: 14, days: 6, firstAt: "a", lastAt: "b", avgSystolic: sys, avgDiastolic: dia },
    ...(higher ? { bpHigherRisk: { diabetes: false, ckd: false, cvd: false, elevatedRisk: false, ...higher } } : {}),
  });
  const bpOf = (f: HealthReportFacts) => composeHealthReport(f, CONFIG, TODAY).items.find((i) => i.id === "bp")!;

  it("comorbidity-aware target: 134/84 is on target by default but needs attention (borderline, high-normal) with diabetes, CKD, known CVD or a high risk band", () => {
    expect(bpOf(bpFacts(134, 84, {}))).toMatchObject({ state: "on_target", borderline: false, target: { high: 140, high2: 90, source: "report_settings" } });
    for (const flag of ["diabetes", "ckd", "cvd", "elevatedRisk"] as const) {
      expect(bpOf(bpFacts(134, 84, { [flag]: true }))).toMatchObject({ state: "needs_attention", borderline: true, recheckWeeks: 4, target: { high: 130, high2: 80, source: "higher_risk" } });
    }
  });

  it("a care-plan target overrides the comorbidity target in both directions", () => {
    const looser = { ...bpFacts(134, 84, { diabetes: true }), bpCareTeamTarget: { systolicBelow: 140, diastolicBelow: 90, setBy: "care_team" } };
    expect(bpOf(looser)).toMatchObject({ state: "on_target", target: { high: 140, source: "care_team" } });
    const stricter = { ...bpFacts(125, 78, {}), bpCareTeamTarget: { systolicBelow: 120, diastolicBelow: 75, setBy: "care_team" } };
    expect(bpOf(stricter)).toMatchObject({ state: "needs_attention", target: { high: 120, source: "care_team" } });
  });

  it("without a higher-risk target in the settings the default applies even when the facts say higher risk (no invented number)", () => {
    const noHr = { ...CONFIG, bpTargetHigherRisk: undefined };
    const item = composeHealthReport(bpFacts(134, 84, { diabetes: true }), noHr, TODAY).items.find((i) => i.id === "bp")!;
    expect(item).toMatchObject({ state: "on_target", target: { high: 140 } });
  });

  it("borderline is the high-normal band only: no margin exists, so 142/88 against 140/90 is needs attention, not borderline", () => {
    expect(bpOf(bpFacts(142, 88, {}))).toMatchObject({ state: "needs_attention", borderline: false });
    expect(bpOf(bpFacts(141, 85, {}))).toMatchObject({ state: "needs_attention", borderline: false });
    // 139/89 with the stricter target sits in the band and is borderline; 140/90 is out of the band and is not
    expect(bpOf(bpFacts(139, 89, { cvd: true }))).toMatchObject({ state: "needs_attention", borderline: true });
    expect(bpOf(bpFacts(140, 90, { cvd: true }))).toMatchObject({ state: "needs_attention", borderline: false });
    expect(composeHealthReport(bpFacts(134, 84, { cvd: true }), CONFIG, TODAY).priorities[0].action).toBe("report.priority.bp_borderline.action");
  });

  it("the settings no longer have a margin field and the composer ignores one if an old row carries it", () => {
    expect(Object.keys(CONFIG)).not.toContain("bpBorderlineMarginMmHg");
    expect(Object.keys(CONFIG)).not.toContain("labBorderlineMarginPct");
    const old = { ...CONFIG, bpBorderlineMarginMmHg: 50, labBorderlineMarginPct: 50 } as unknown as HealthReportConfig;
    expect(composeHealthReport(bpFacts(142, 88, {}), old, TODAY).items.find((i) => i.id === "bp")!.borderline).toBe(false);
  });

  it("a lab value is flagged only outside the lab's own range: a value 1 percent over is needs attention with no borderline, one inside is on target", () => {
    const r = composeHealthReport({ ...EMPTY, labs: [lab("ldl", 131, null, 130), lab("alt", 56, 7, 56)] }, CONFIG, TODAY);
    expect(r.items.find((i) => i.id === "lab:ldl")).toMatchObject({ state: "needs_attention", borderline: false, recheckWeeks: null });
    expect(r.items.find((i) => i.id === "lab:alt")).toMatchObject({ state: "on_target" });
    expect(r.priorities.map((p) => p.action)).not.toContain("report.priority.lab_borderline.action");
  });

  it("a lab value inside the lab's own range is on target; outside is needs attention; no range is no_target", () => {
    const r = composeHealthReport({ ...EMPTY, labs: [lab("ldl", 100, null, 130), lab("alt", 200, 7, 56, "high"), lab("ferritin", 40, null, null, null)] }, CONFIG, TODAY);
    expect(r.items.find((i) => i.id === "lab:ldl")!.state).toBe("on_target");
    expect(r.items.find((i) => i.id === "lab:alt")!.state).toBe("needs_attention");
    expect(r.items.find((i) => i.id === "lab:ferritin")!.state).toBe("no_target");
  });

  it("a value inside the range but flagged abnormal by the lab is not called on target", () => {
    const r = composeHealthReport({ ...EMPTY, labs: [lab("alt", 50, 7, 56, "high")] }, CONFIG, TODAY);
    expect(r.items.find((i) => i.id === "lab:alt")!.state).toBe("needs_attention");
  });

  it("caps priorities at three and moves the rest to also worth knowing, whatever the setting says", () => {
    const labs = ["a", "b", "c", "d", "e"].map((c, i) => lab(c, 300 + i * 10, 7, 56, "high"));
    const r = composeHealthReport({ ...EMPTY, labs }, { ...CONFIG, maxPriorities: 10 }, TODAY);
    expect(r.priorities).toHaveLength(3);
    expect(r.alsoWorthKnowing.length).toBeGreaterThanOrEqual(2);
    for (const p of r.priorities) expect(p).toEqual(expect.objectContaining({ action: expect.any(String), why: expect.any(String), whoHelps: expect.any(String), when: expect.any(String) }));
  });

  it("compares to the patient's own previous year, never converts units, and says no comparison when units differ", () => {
    const improved = composeHealthReport({ ...EMPTY, labs: [lab("alt", 60, 7, 56, "high", 90)] }, CONFIG, TODAY).items.find((i) => i.id === "lab:alt")!;
    expect(improved.change).toBe("improved");
    expect(improved.previousValue).toBe(90);
    const mixed = { ...lab("alt", 60, 7, 56, "high", 90), previous: { at: "2025-01-01", value: 5, refLow: 0.1, refHigh: 1, flag: null, unit: "umol/L" } };
    expect(composeHealthReport({ ...EMPTY, labs: [mixed] }, CONFIG, TODAY).items.find((i) => i.id === "lab:alt")!.change).toBe("no_comparison");
  });

  it("an overdue screening is not checked, and a priority; the report never claims a result for it", () => {
    const facts = { ...EMPTY, screening: { done: [], due: [{ code: "fit", dueOn: "2026-03-01", status: "overdue", reproductive: false }] } };
    const r = composeHealthReport(facts, CONFIG, TODAY);
    expect(r.items.find((i) => i.id === "screening:fit")).toMatchObject({ state: "not_checked", value: null });
    expect(r.priorities.map((p) => p.id)).toContain("screening:fit");
  });

  it("the risk band is used only when the facts carry one; otherwise it stays not assessed and creates no priority", () => {
    const none = composeHealthReport(EMPTY, CONFIG, TODAY);
    expect(none.risk).toEqual({ state: "not_assessed" });
    expect(none.priorities.find((p) => p.category === "risk")).toBeUndefined();
    const high = composeHealthReport({ ...EMPTY, risk: { state: "assessed", bandCode: "20to30", tier: "high", lowPct: 20, highPct: 30, model: "lab", assessedAt: "2026-05-01", basedOn: {} } }, CONFIG, TODAY);
    expect(high.priorities.find((p) => p.category === "risk")).toBeDefined();
  });

  it("carries the fixed statement key and does not claim CMO approval it has not got", () => {
    const r = composeHealthReport(EMPTY, CONFIG, TODAY);
    expect(r.statementKey).toBe("report.statement.not_rule_out");
    expect(r.statementApprovedByCmo).toBe(false);
  });

  it("the composed output never contains optimal, biological age, healthspan, percentile or a sensitive result word", () => {
    const labs = [lab("ldl", 100, null, 130), lab("alt", 200, 7, 56, "high")];
    const text = JSON.stringify(composeHealthReport({ ...EMPTY, labs, bp: { count: 14, days: 6, firstAt: "a", lastAt: "b", avgSystolic: 150, avgDiastolic: 95 } }, CONFIG, TODAY)).toLowerCase();
    expect(text).not.toMatch(/optimal|biological|healthspan|percentile|hiv|hbsag|hepatitis|hcv/);
  });
});

describe("trends and sharing", () => {
  const points = (n: number) => Array.from({ length: n }, (_, i) => ({ at: `202${4 + i}-01-01`, value: 100 + i, unit: "mg/dL", refLow: null, refHigh: 130 }));
  it("keeps a trend only when it has the minimum number of points", () => {
    const r = composeHealthReport({ ...EMPTY, trends: [{ code: "ldl", unitMixed: false, points: points(1) }, { code: "alt", unitMixed: false, points: points(3) }] }, CONFIG, TODAY);
    expect(r.trends.map((t) => t.code)).toEqual(["alt"]);
  });

  it("a shared copy drops reproductive screening, the risk band and questionnaires by default, and keeps them when the patient includes them", () => {
    const facts: HealthReportFacts = {
      ...EMPTY,
      screening: {
        done: [{ code: "cervical_smear", on: "2026-02-01", reproductive: true }, { code: "fit", on: "2026-03-01", reproductive: false }],
        due: [{ code: "mammography", dueOn: "2026-01-01", status: "overdue", reproductive: true }],
      },
      risk: { state: "assessed", bandCode: "10to20", tier: "moderate", lowPct: 10, highPct: 20, model: "lab", assessedAt: "2026-05-01", basedOn: {} },
      questionnaires: [{ type: "lifestyle", level: "medium", at: "2026-04-01" }],
    };
    const full = composeHealthReport(facts, CONFIG, TODAY);
    const shared = shareableView(full, CONFIG);
    expect(shared.screening.done.map((d) => d.code)).toEqual(["fit"]);
    expect(shared.screening.due).toHaveLength(0);
    expect(shared.risk).toEqual({ state: "not_assessed" });
    expect(shared.questionnaires).toHaveLength(0);
    expect(shared.items.find((i) => i.id === "screening:mammography")).toBeUndefined();
    expect(shared.priorities.find((p) => p.id === "screening:mammography")).toBeUndefined();
    const withAll = shareableView(full, CONFIG, ["risk", "questionnaires", "screening_reproductive"]);
    expect(withAll.screening.done).toHaveLength(2);
    expect(withAll.risk.state).toBe("assessed");
  });
});
