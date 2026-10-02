import { describe, expect, it, jest } from "@jest/globals";
import { buildCaseSnapshot, formatSnapshotForPrompt, type CaseSnapshot } from "./snapshot";

const mockVitals = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockMedications = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("@/lib/clinical/vitals-audited", () => ({
  readPatientVitalsAudited: (...args: unknown[]) => mockVitals(...args),
}));
jest.mock("@/lib/clinical/medications-audited", () => ({
  readPatientMedicationsAudited: (...args: unknown[]) => mockMedications(...args),
}));

function snapshot(overrides: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    escalationReason: "BP reading flagged high",
    alert: { title: "High BP", effectiveLevel: "urgent_escalation", detail: null },
    activeCarePlans: [],
    latestRiskScores: [],
    recentVitals: [],
    activeMedications: [],
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
    expect(text).toContain("Active medications: none on file");
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

describe("active medications in the brief", () => {
  it("lists the active medicines, so a brief cannot say there are none when there are some", () => {
    const text = formatSnapshotForPrompt(
      snapshot({
        escalationReason: "Medication: None on file",
        activeMedications: [
          { drugName: "Fake paracetamol", dose: "1g", frequency: "twice daily" },
          { drugName: "Fake vitamin C", dose: null, frequency: "once daily" },
        ],
      })
    );
    expect(text).toContain("Active medications: Fake paracetamol 1g twice daily; Fake vitamin C once daily");
    expect(text).not.toContain("Active medications: none on file");
  });

  it("states that the list could not be read, and does not say none, when the read failed", () => {
    const text = formatSnapshotForPrompt(snapshot({ activeMedications: null }));
    expect(text).toContain("Active medications: could not be read");
    expect(text).not.toContain("Active medications: none on file");
  });
});

describe("buildCaseSnapshot medications", () => {
  // A table-shaped stub: every query chain resolves to empty data except the alert lookup.
  function client() {
    const chain: Record<string, unknown> = {};
    const result = { data: [], error: null };
    for (const m of ["select", "eq", "neq", "order", "limit"]) chain[m] = () => chain;
    chain.maybeSingle = async () => ({
      data: { title: "High BP", detail: null, level: "urgent_escalation", override_level: null, patient_id: "patient-1" },
    });
    (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result);
    return { from: () => chain } as never;
  }
  const okVitals = { status: "ok", rows: [] };

  it("maps the audited active medicines into the snapshot", async () => {
    mockVitals.mockResolvedValue(okVitals);
    mockMedications.mockResolvedValue({
      status: "ok",
      rows: [{ drug_name: "Fake paracetamol", dose: "1g", frequency: "twice daily" }],
    });
    const snap = await buildCaseSnapshot(client(), "alert-1");
    expect(snap?.activeMedications).toEqual([{ drugName: "Fake paracetamol", dose: "1g", frequency: "twice daily" }]);
    expect(mockMedications).toHaveBeenCalledWith(expect.anything(), "patient-1", { active: true });
  });

  it("returns null (case not available) when the caller is refused the medications", async () => {
    mockVitals.mockResolvedValue(okVitals);
    mockMedications.mockResolvedValue({ status: "denied" });
    expect(await buildCaseSnapshot(client(), "alert-1")).toBeNull();
  });

  it("records the list as could-not-be-read, never as empty, when the medications read errors", async () => {
    mockVitals.mockResolvedValue(okVitals);
    mockMedications.mockResolvedValue({ status: "error", message: "boom" });
    const snap = await buildCaseSnapshot(client(), "alert-1");
    expect(snap).not.toBeNull();
    expect(snap?.activeMedications).toBeNull();
  });
});
