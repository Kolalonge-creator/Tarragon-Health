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
  it("includes the escalation reason and alert level when the alert has been escalated to a doctor", () => {
    const text = formatSnapshotForPrompt(snapshot());
    expect(text).toContain("BP reading flagged high");
    expect(text).toContain("urgent_escalation");
  });

  it("omits the escalation-reason line for a plain, not-yet-escalated clinician alert", () => {
    const text = formatSnapshotForPrompt(snapshot({ escalationReason: null }));
    expect(text).not.toContain("Escalated to a doctor because");
    expect(text).toContain("High BP");
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

  it("names the signed protocol, its version, targets and red flags when one is in force", () => {
    const text = formatSnapshotForPrompt(
      snapshot({
        signedProtocol: {
          condition: "hypertension",
          versionNumber: 3,
          title: "Hypertension escalation thresholds",
          targets: ["BP < 140/90 mmHg"],
          redFlags: ["BP >= 180/120 without symptoms"],
          cadence: "Every 3-6 months once controlled",
        },
      })
    );
    expect(text).toContain('"Hypertension escalation thresholds" v3');
    expect(text).toContain("BP < 140/90 mmHg");
    expect(text).toContain("BP >= 180/120 without symptoms");
    expect(text).toContain("Every 3-6 months once controlled");
  });

  it("tells the model explicitly when NO signed protocol exists, rather than staying silent", () => {
    // Silence is the dangerous case: a model given no protocol context will
    // happily supply plausible-sounding guidance of its own. Stating the
    // absence is what lets it say so instead.
    const text = formatSnapshotForPrompt(snapshot({ signedProtocol: null }));
    expect(text).toContain("Signed protocol in force: none");
    expect(text).toContain("Do not refer to protocol guidance");
  });

  it("treats an absent signedProtocol field the same as an explicit null", () => {
    expect(formatSnapshotForPrompt(snapshot())).toContain("Signed protocol in force: none");
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
});
