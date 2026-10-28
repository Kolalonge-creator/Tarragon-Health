import { describe, expect, it } from "@jest/globals";
import { accuracySchema, overviewSchema, samplesByMonth, schedulerStatus } from "./model";

const sched = { armed: false, signed_version: null, waiting_for_signature_version: null, sample_rate: null, last_run: null };

describe("AI monitoring model", () => {
  it("says plainly that nothing is drawn until the CMO signs", () => {
    expect(schedulerStatus(sched).state).toBe("off");
    const w = schedulerStatus({ ...sched, waiting_for_signature_version: 1 });
    expect(w.state).toBe("waiting");
    expect(w.text).toMatch(/waiting for the Chief Medical Officer/);
    expect(schedulerStatus({ ...sched, armed: true, signed_version: "1" }).state).toBe("armed");
  });

  it("parses a good overview and refuses a malformed one", () => {
    const good = { scheduler: sched, samples: [{ month: "2026-09-01", rule: "risk_reported", drawn: 2, reviewed: 1 }], reported: [], reported_last_30_days: 0 };
    expect(overviewSchema.safeParse(good).success).toBe(true);
    expect(overviewSchema.safeParse({ ...good, scheduler: { ...sched, armed: "yes" } }).success).toBe(false);
    expect(overviewSchema.safeParse({ ...good, reported: [{ incident_id: "x" }] }).success).toBe(false);
  });

  it("groups samples by month with plain rule names and keeps unknown rules visible", () => {
    const g = samplesByMonth([
      { month: "2026-09-01", rule: "risk_emergency", drawn: 3, reviewed: 1 },
      { month: "2026-09-01", rule: "stratified", drawn: 5, reviewed: 5 },
      { month: "2026-08-01", rule: "mystery", drawn: 1, reviewed: 0 },
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]?.lines.map((l) => l.rule)).toEqual(["Touched an emergency or doctor-escalation grade", "Random share"]);
    expect(g[1]?.lines[0]?.rule).toBe("mystery");
  });

  it("parses the accuracy report including a withheld small group", () => {
    const base = { range: { from: "2026-07-01", to: "2026-09-30" }, capture_switched_on: false, what_this_is: "x" };
    expect(accuracySchema.safeParse({ ...base, coverage: { suppressed: true }, overall: { suppressed: true, minimum: 10 } }).success).toBe(true);
    expect(accuracySchema.safeParse({ ...base, coverage: { suppressed: false, reviewed_pct: 40, low_coverage: true }, overall: { suppressed: false, reviewed: 30, agree_pct: 90, should_have_been_higher_pct: 6.7, should_have_been_lower_pct: 3.3 } }).success).toBe(true);
    expect(accuracySchema.safeParse({ ...base, coverage: { suppressed: true }, overall: { agree_pct: 90 } }).success).toBe(false);
  });
});
