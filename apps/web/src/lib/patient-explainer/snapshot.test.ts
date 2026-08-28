import { describe, expect, it } from "@jest/globals";
import {
  formatMedicationSnapshotForPrompt,
  formatResultSnapshotForPrompt,
  type MedicationSnapshot,
  type ResultSnapshot,
} from "./snapshot";

function snapshot(overrides: Partial<ResultSnapshot> = {}): ResultSnapshot {
  return {
    kind: "risk_score",
    subjectKey: "cvd_10yr",
    label: "Heart & circulation risk",
    latest: { value: "moderate", unit: null, recordedAt: "2026-07-29T00:00:00.000Z" },
    previous: null,
    ...overrides,
  };
}

describe("formatResultSnapshotForPrompt", () => {
  it("includes the label and latest value", () => {
    const text = formatResultSnapshotForPrompt(snapshot());
    expect(text).toContain("Heart & circulation risk");
    expect(text).toContain("moderate");
    expect(text).toContain("2026-07-29");
  });

  it("says plainly when there's no previous value, rather than inventing a trend", () => {
    const text = formatResultSnapshotForPrompt(snapshot());
    expect(text).toContain("none on file yet");
    expect(text).not.toContain("Previous value: null");
  });

  it("includes the previous value and date when one exists", () => {
    const text = formatResultSnapshotForPrompt(
      snapshot({ previous: { value: "high", unit: null, recordedAt: "2026-06-01T00:00:00.000Z" } })
    );
    expect(text).toContain("Previous value: high");
    expect(text).toContain("2026-06-01");
  });

  it("appends the unit when one is present", () => {
    const text = formatResultSnapshotForPrompt(
      snapshot({
        kind: "lab_analyte",
        subjectKey: "ldl_cholesterol",
        label: "LDL cholesterol",
        latest: { value: "140", unit: "mg/dL", recordedAt: "2026-07-29T00:00:00.000Z" },
      })
    );
    expect(text).toContain("140 mg/dL");
  });

  it("omits the unit suffix when none is present, leaving no double-space artifact", () => {
    const text = formatResultSnapshotForPrompt(snapshot());
    expect(text).toContain("Latest value: moderate on 2026-07-29");
    expect(text).not.toContain("  ");
  });
});

function medicationSnapshot(overrides: Partial<MedicationSnapshot> = {}): MedicationSnapshot {
  return {
    kind: "medication",
    subjectKey: "med-1",
    label: "Lisinopril",
    drugName: "Lisinopril",
    dose: "10mg",
    frequency: "Once daily",
    route: null,
    indication: null,
    instructions: null,
    source: "clinician",
    startedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatMedicationSnapshotForPrompt", () => {
  it("includes the drug name, dose and frequency", () => {
    const text = formatMedicationSnapshotForPrompt(medicationSnapshot());
    expect(text).toContain("Lisinopril");
    expect(text).toContain("10mg");
    expect(text).toContain("Once daily");
  });

  it("attributes a clinician-sourced medication to the Tarragon care team", () => {
    const text = formatMedicationSnapshotForPrompt(medicationSnapshot({ source: "clinician" }));
    expect(text).toContain("the Tarragon care team");
  });

  it("attributes a patient-sourced medication as self-reported, not prescribed here", () => {
    const text = formatMedicationSnapshotForPrompt(medicationSnapshot({ source: "patient" }));
    expect(text).toContain("self-reported by the patient");
  });

  it("includes the recorded indication and instructions when present", () => {
    const text = formatMedicationSnapshotForPrompt(
      medicationSnapshot({ indication: "Blood pressure", instructions: "Take with food" })
    );
    expect(text).toContain("Recorded reason for taking it: Blood pressure");
    expect(text).toContain("Recorded instructions: Take with food");
  });

  it("omits indication/instructions lines when not recorded", () => {
    const text = formatMedicationSnapshotForPrompt(medicationSnapshot());
    expect(text).not.toContain("Recorded reason");
    expect(text).not.toContain("Recorded instructions");
  });
});
