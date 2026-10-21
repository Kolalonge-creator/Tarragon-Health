import { describe, expect, it } from "@jest/globals";
import { loadDeviceLabBudgets, parseDeviceLabBudgets } from "./budgets";
import { assertConsistent, buildReport, measured, notMeasured, redactId, renderMarkdown, reportBaseName, slug, verdictFor, type DeviceInfo, type EvalContext } from "./report";
import { median, percentile, summarise } from "./stats";

const budgets = loadDeviceLabBudgets("2026-10-20");
const real: EvalContext = { realDevice: true, buildKind: "release", buildSensitive: true };
const device: DeviceInfo = { platform: "android", realDevice: true, id: "...ABCD", manufacturer: "TECNO", model: "TECNO KG5k", osVersion: "11", sdk: "30", ramMb: 1800 };
const app = { packageId: "com.tarragonhealth.app", versionName: "0.2.0", versionCode: 42, buildKind: "release" as const, buildLabel: null };

describe("stats", () => {
  it("median and nearest-rank p95", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5], 95)).toBe(5);
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
    expect(summarise([5, 1, 3])).toEqual({ n: 3, min: 1, median: 3, p95: 5, max: 5 });
  });
  it("throws on empty or non-finite input, never NaN", () => {
    expect(() => median([])).toThrow();
    expect(() => median([1, Number.NaN])).toThrow();
    expect(() => percentile([1], 0)).toThrow();
  });
});

describe("budgets come from versioned config", () => {
  it("loads, report only, memory has no budget", () => {
    expect(budgets.enforcement).toBe("report_only");
    expect(budgets.memoryMbMax).toBeNull();
    expect(budgets.configStatus).toBe("proposed");
    expect(budgets.coldStartMsMax).toBeGreaterThan(0);
  });
  it("rejects a config that turns on gating or has a bad number", () => {
    const good = {
      cold_start_ms_max: 1, cold_start_runs: 1, installed_size_mb_max: 1, memory_mb_max: null, log_store_write_ms_max: 1,
      log_visible_ms_max: 1, log_latency_runs: 1, reconnect_flush_seconds_max: 1, probe_requests_per_minute_max: 1, enforcement: "report_only",
    };
    const meta = { version: 1, status: "proposed" as const };
    expect(() => parseDeviceLabBudgets({ ...good, enforcement: "gated" }, meta)).toThrow(/report_only/);
    expect(() => parseDeviceLabBudgets({ ...good, cold_start_ms_max: -1 }, meta)).toThrow();
    expect(() => parseDeviceLabBudgets({ ...good, memory_mb_max: "big" }, meta)).toThrow();
    expect(() => parseDeviceLabBudgets(null, meta)).toThrow();
  });
});

describe("verdicts never claim what was not measured", () => {
  it("PASS and FAIL only on a real device with a release build", () => {
    expect(verdictFor(2000, 3000, real).verdict).toBe("PASS");
    expect(verdictFor(3000, 3000, real).verdict).toBe("PASS");
    expect(verdictFor(3001, 3000, real).verdict).toBe("FAIL");
  });
  it("a simulator is NOT EVALUATED even when the number is tiny", () => {
    expect(verdictFor(1, 3000, { ...real, realDevice: false }).verdict).toBe("NOT EVALUATED");
  });
  it("a debug build is NOT EVALUATED, an unknown build is INCONCLUSIVE", () => {
    expect(verdictFor(1, 3000, { ...real, buildKind: "debug" }).verdict).toBe("NOT EVALUATED");
    expect(verdictFor(1, 3000, { ...real, buildKind: "unknown" }).verdict).toBe("INCONCLUSIVE");
  });
  it("a network metric ignores build kind", () => {
    expect(verdictFor(10, 60, { ...real, buildKind: "debug", buildSensitive: false }).verdict).toBe("PASS");
  });
  it("no budget is NO BUDGET, not PASS", () => {
    expect(verdictFor(500, null, real).verdict).toBe("NO BUDGET");
  });
  it("a not-measured metric has no value and N/A, and needs a reason", () => {
    const m = notMeasured("x", "X", "ms", 10, "no phone");
    expect(m).toMatchObject({ status: "not measured", value: null, verdict: "N/A", samples: [] });
    expect(() => notMeasured("x", "X", "ms", 10, " ")).toThrow();
  });
  it("assertConsistent rejects a not-measured metric that carries a PASS (the fail-silent class)", () => {
    const bad = { ...notMeasured("x", "X", "ms", 10, "no phone"), verdict: "PASS" as const };
    expect(() => assertConsistent([bad])).toThrow(/not measured but carries/);
    const bad2 = { ...notMeasured("x", "X", "ms", 10, "no phone"), value: 5 };
    expect(() => assertConsistent([bad2])).toThrow();
  });
  it("a measured metric needs a finite value", () => {
    expect(() => measured({ id: "x", label: "X", unit: "ms", source: "adb", value: Number.NaN, budget: 1, context: real })).toThrow();
  });
  it("a verdict override cannot turn a simulator run into a PASS", () => {
    const m = measured({
      id: "r", label: "R", unit: "s", source: "maestro", value: 1, budget: 60, context: { ...real, realDevice: false },
      verdictOverride: { verdict: "PASS", reason: null },
    });
    expect(m.verdict).toBe("NOT EVALUATED");
  });
  it("buildReport refuses a simulator report that carries PASS or FAIL", () => {
    const sneaky = { ...measured({ id: "a", label: "A", unit: "ms", source: "adb", value: 1, budget: 2, context: real }) };
    expect(() => buildReport({ generatedAt: "t", gitSha: null, budgets, device: { ...device, realDevice: false }, app, metrics: [sneaky], notes: [] })).toThrow(/simulator/);
  });
});

describe("report rendering", () => {
  const m1 = measured({ id: "cold_start_ms", label: "Cold start", unit: "ms", source: "adb", value: 2400, samples: [2300, 2400, 2500, 2400, 2600], budget: 3000, context: real });
  const m2 = notMeasured("memory", "Memory", "MB", null, "flows were skipped");
  const report = buildReport({ generatedAt: "2026-10-20T10:00:00.000Z", gitSha: "abc1234", budgets, device, app, metrics: [m1, m2], notes: ["a note"] });
  const md = renderMarkdown(report);

  it("counts honestly and never states an overall pass", () => {
    expect(report.completeness).toBe("INCOMPLETE");
    expect(md).toContain("1 of 2 metrics measured (INCOMPLETE)");
    expect(md).toContain("REPORT ONLY");
    expect(md).not.toMatch(/overall pass:|all budgets met/i);
  });
  it("tags every metric measured or not measured, with a reason for the latter", () => {
    expect(md).toMatch(/\| Cold start \| measured \| 2400 ms \(adb\) \| 3000 ms max \| PASS \|/);
    expect(md).toMatch(/\| Memory \| not measured \| not measured \| none \| N\/A \|/);
    expect(md).toContain("Why not measured: flows were skipped");
  });
  it("shows runs summary", () => expect(md).toContain("median 2400 ms, p95 2600 ms"));
  it("is COMPLETE only when everything was measured", () => {
    expect(buildReport({ generatedAt: "t", gitSha: null, budgets, device, app, metrics: [m1], notes: [] }).completeness).toBe("COMPLETE");
  });
  it("file names carry date and device; ids are redacted", () => {
    expect(reportBaseName("2026-10-20", device)).toBe("2026-10-20-tecno-tecno-kg5k");
    expect(() => reportBaseName("20-10-2026", device)).toThrow();
    expect(slug("***")).toBe("unknown-device");
    expect(redactId("R58M12ABCDE")).toBe("...BCDE");
  });
});
