import { describe, expect, it } from "@jest/globals";
import { buildCaseloadReport, countBy, scoreLoad, type StaffLoadInput } from "./caseload";

function staff(overrides: Partial<StaffLoadInput> = {}): StaffLoadInput {
  return {
    profileId: "p1",
    fullName: "Test Clinician",
    doctorTier: "senior_medical_officer",
    panelSize: 0,
    activeEscalations: 0,
    activeOutreach: 0,
    ...overrides,
  };
}

describe("scoreLoad", () => {
  it("weights a claimed escalation heavier than a standing panel patient or an outreach task", () => {
    const panelOnly = scoreLoad({ panelSize: 1, activeEscalations: 0, activeOutreach: 0 });
    const oneEscalation = scoreLoad({ panelSize: 0, activeEscalations: 1, activeOutreach: 0 });
    const oneOutreach = scoreLoad({ panelSize: 0, activeEscalations: 0, activeOutreach: 1 });
    expect(oneEscalation).toBeGreaterThan(oneOutreach);
    expect(oneOutreach).toBeGreaterThan(panelOnly);
  });

  it("sums all three components", () => {
    expect(scoreLoad({ panelSize: 10, activeEscalations: 2, activeOutreach: 3 })).toBe(
      10 + 2 * 5 + 3 * 2
    );
  });
});

describe("buildCaseloadReport", () => {
  it("sorts by load score descending", () => {
    const report = buildCaseloadReport([
      staff({ profileId: "light", panelSize: 5 }),
      staff({ profileId: "heavy", panelSize: 5, activeEscalations: 4 }),
      staff({ profileId: "medium", panelSize: 20 }),
    ]);
    expect(report.rows.map((r) => r.profileId)).toEqual(["heavy", "medium", "light"]);
  });

  it("flags a doctor carrying more than 1.5x the team's own average load", () => {
    const report = buildCaseloadReport([
      staff({ profileId: "a", panelSize: 10 }),
      staff({ profileId: "b", panelSize: 10 }),
      staff({ profileId: "overloaded", panelSize: 10, activeEscalations: 10 }), // way above average
    ]);
    const overloaded = report.rows.find((r) => r.profileId === "overloaded")!;
    const a = report.rows.find((r) => r.profileId === "a")!;
    expect(overloaded.isHighLoad).toBe(true);
    expect(a.isHighLoad).toBe(false);
  });

  it("flags nobody when everyone carries the same load", () => {
    const report = buildCaseloadReport([
      staff({ profileId: "a", panelSize: 10 }),
      staff({ profileId: "b", panelSize: 10 }),
    ]);
    expect(report.rows.every((r) => !r.isHighLoad)).toBe(true);
  });

  it("handles an empty team without dividing by zero", () => {
    const report = buildCaseloadReport([]);
    expect(report.averageLoadScore).toBe(0);
    expect(report.rows).toEqual([]);
  });

  it("never flags anyone when the whole team's load is zero", () => {
    const report = buildCaseloadReport([staff({ profileId: "a" }), staff({ profileId: "b" })]);
    expect(report.rows.every((r) => !r.isHighLoad)).toBe(true);
  });
});

describe("countBy", () => {
  it("counts occurrences per non-null key", () => {
    const rows = [{ id: "x" }, { id: "x" }, { id: "y" }, { id: null }];
    const counts = countBy(rows, (r) => r.id);
    expect(counts.get("x")).toBe(2);
    expect(counts.get("y")).toBe(1);
    expect(counts.has("null")).toBe(false);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("returns an empty map for an empty list", () => {
    expect(countBy([], () => "anything").size).toBe(0);
  });
});
