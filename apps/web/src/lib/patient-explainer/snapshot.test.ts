import { describe, expect, it } from "@jest/globals";
import { formatResultSnapshotForPrompt, type ResultSnapshot } from "./snapshot";

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

  it("renders details as extra lines for a medication snapshot", () => {
    const text = formatResultSnapshotForPrompt(
      snapshot({
        kind: "medication",
        subjectKey: "med-1",
        label: "Amlodipine",
        latest: { value: "5mg, once daily", unit: null, recordedAt: "2026-07-01T00:00:00.000Z" },
        details: { route: "oral", instructions: "Take in the morning with food" },
      })
    );
    expect(text).toContain("Route: oral");
    expect(text).toContain("Instructions: Take in the morning with food");
  });

  it("renders details as extra lines for a care-plan-item snapshot, and omits absent ones", () => {
    const text = formatResultSnapshotForPrompt(
      snapshot({
        kind: "care_plan_item",
        subjectKey: "plan-1",
        label: "Hypertension",
        latest: { value: "active", unit: null, recordedAt: "2026-07-01T00:00:00.000Z" },
        details: { target: "systolic: <130" },
      })
    );
    expect(text).toContain("Target: systolic: <130");
    expect(text).not.toContain("Notes:");
  });
});
