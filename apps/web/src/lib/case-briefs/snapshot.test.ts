import { describe, expect, it } from "@jest/globals";
import { formatSnapshotForPrompt, type CaseSnapshot } from "./snapshot";

function snapshot(overrides: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    escalationReason: "BP reading flagged high",
    alert: { title: "High BP", effectiveLevel: "urgent_escalation", detail: null },
    activeCarePlans: [],
    latestRiskScores: [],
    recentVitals: [],
    recentEscalationHistory: [],
    ...overrides,
  };
}

describe("formatSnapshotForPrompt", () => {
  it("includes the escalation reason and alert level", () => {
    const text = formatSnapshotForPrompt(snapshot());
    expect(text).toContain("BP reading flagged high");
    expect(text).toContain("urgent_escalation");
  });

  it("uses the effective (override-aware) level already resolved into the snapshot, not a raw column", () => {
    const text = formatSnapshotForPrompt(
      snapshot({ alert: { title: "High BP", effectiveLevel: "routine", detail: "downgraded by clinician" } })
    );
    expect(text).toContain("routine");
    expect(text).toContain("downgraded by clinician");
  });

  it("says plainly when there's no active care plan, risk score, vitals, or history, rather than omitting the line", () => {
    const text = formatSnapshotForPrompt(snapshot());
    expect(text).toContain("Active care plans: none");
    expect(text).toContain("Recent risk scores: none on file");
    expect(text).toContain("Recent vitals: none on file");
    expect(text).toContain("Recent escalation history: none");
  });

  it("renders active care plans, risk scores, vitals, and history when present", () => {
    const text = formatSnapshotForPrompt(
      snapshot({
        activeCarePlans: [{ condition: "hypertension" }, { condition: "diabetes" }],
        latestRiskScores: [{ scoreType: "cvd_10yr", riskLevel: "high", score: 22.5 }],
        recentVitals: [
          { vitalType: "blood_pressure", takenAt: "2026-07-29T10:00:00.000Z", values: { systolic: 168, diastolic: 98 } },
        ],
        recentEscalationHistory: [{ level: "clinician_review", status: "resolved", createdAt: "2026-06-01T00:00:00.000Z" }],
      })
    );
    expect(text).toContain("hypertension, diabetes");
    expect(text).toContain("cvd_10yr=high (22.5)");
    expect(text).toContain("systolic=168");
    expect(text).toContain("clinician_review (resolved)");
  });

  it("omits null vital fields rather than printing them as null", () => {
    const text = formatSnapshotForPrompt(
      snapshot({
        recentVitals: [
          {
            vitalType: "blood_pressure",
            takenAt: "2026-07-29T10:00:00.000Z",
            values: { systolic: 168, diastolic: 98 },
          },
        ],
      })
    );
    expect(text).not.toContain("null");
  });

  it("handles a null alert (e.g. a manually-raised escalation with no linked clinician_alert)", () => {
    const text = formatSnapshotForPrompt(snapshot({ alert: null }));
    expect(text).not.toContain("Alert:");
    expect(text).toContain("BP reading flagged high");
  });
});
