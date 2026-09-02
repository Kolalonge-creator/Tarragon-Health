import { describe, expect, it } from "@jest/globals";
import {
  buildCaseloadReport,
  buildUtilisationReport,
  countBy,
  scoreLoad,
  type StaffLoadInput,
  type UtilisationInput,
} from "./caseload";

function staff(overrides: Partial<StaffLoadInput> = {}): StaffLoadInput {
  return {
    profileId: "p1",
    fullName: "Test Clinician",
    doctorTier: "tier_2",
    isClinicalDirector: false,
    panelSize: 0,
    activeEscalations: 0,
    activeOutreach: 0,
    ...overrides,
  };
}

function clinician(overrides: Partial<UtilisationInput> = {}): UtilisationInput {
  return {
    clinicianId: "p1",
    fullName: "Test Clinician",
    availabilityWindows: [],
    leaveWindows: [],
    completedConsultations: 0,
    cancelledConsultations: 0,
    noShowConsultations: 0,
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

describe("buildUtilisationReport", () => {
  it("sums available hours across multiple active availability rules", () => {
    const [row] = buildUtilisationReport([
      clinician({
        availabilityWindows: [
          { startTime: "09:00:00", endTime: "13:00:00" }, // 4h
          { startTime: "14:00:00", endTime: "16:30:00" }, // 2.5h
        ],
      }),
    ]);
    expect(row.availableHoursPerWeek).toBe(6.5);
  });

  it("reports zero available hours for a clinician with no active rules", () => {
    const [row] = buildUtilisationReport([clinician()]);
    expect(row.availableHoursPerWeek).toBe(0);
  });

  it("flags onLeave true and surfaces the return date for a leave window in progress", () => {
    const now = Date.now();
    const startsAt = new Date(now - 3600_000).toISOString(); // started an hour ago
    const endsAt = new Date(now + 3600_000 * 24).toISOString(); // returns tomorrow
    const [row] = buildUtilisationReport([clinician({ leaveWindows: [{ startsAt, endsAt }] })]);
    expect(row.onLeave).toBe(true);
    expect(row.currentOrNextLeave).toEqual({ startsAt, endsAt });
  });

  it("does not flag onLeave for a leave window that hasn't started yet, but still surfaces it", () => {
    const now = Date.now();
    const startsAt = new Date(now + 3600_000 * 24).toISOString(); // starts tomorrow
    const endsAt = new Date(now + 3600_000 * 48).toISOString();
    const [row] = buildUtilisationReport([clinician({ leaveWindows: [{ startsAt, endsAt }] })]);
    expect(row.onLeave).toBe(false);
    expect(row.currentOrNextLeave).toEqual({ startsAt, endsAt });
  });

  it("picks the soonest of several leave windows", () => {
    const now = Date.now();
    const later = {
      startsAt: new Date(now + 3600_000 * 72).toISOString(),
      endsAt: new Date(now + 3600_000 * 96).toISOString(),
    };
    const sooner = {
      startsAt: new Date(now + 3600_000 * 24).toISOString(),
      endsAt: new Date(now + 3600_000 * 48).toISOString(),
    };
    const [row] = buildUtilisationReport([clinician({ leaveWindows: [later, sooner] })]);
    expect(row.currentOrNextLeave).toEqual(sooner);
  });

  it("has no current/next leave and is not on leave when there are no leave windows", () => {
    const [row] = buildUtilisationReport([clinician()]);
    expect(row.onLeave).toBe(false);
    expect(row.currentOrNextLeave).toBeNull();
  });

  it("computes utilisation as completed share of attempted consultations", () => {
    const [row] = buildUtilisationReport([
      clinician({ completedConsultations: 6, cancelledConsultations: 3, noShowConsultations: 1 }),
    ]);
    expect(row.utilisationPct).toBe(0.6);
  });

  it("does not divide by zero when there are no consultations at all", () => {
    const [row] = buildUtilisationReport([clinician()]);
    expect(row.utilisationPct).toBe(0);
  });

  it("passes the raw counts through unchanged alongside the computed fields", () => {
    const [row] = buildUtilisationReport([
      clinician({ clinicianId: "c2", fullName: "Dr. Ada", completedConsultations: 4 }),
    ]);
    expect(row.clinicianId).toBe("c2");
    expect(row.fullName).toBe("Dr. Ada");
    expect(row.completedConsultations).toBe(4);
  });
});
