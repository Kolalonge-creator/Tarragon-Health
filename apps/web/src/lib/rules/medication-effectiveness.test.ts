import { describe, expect, it } from "@jest/globals";
import {
  medicationEffectivenessVitalType,
  computeMedicationEffectiveness,
} from "./medication-effectiveness";

describe("medicationEffectivenessVitalType", () => {
  it("maps an antihypertensive to blood_pressure", () => {
    expect(medicationEffectivenessVitalType("Amlodipine 5mg")).toBe("blood_pressure");
    expect(medicationEffectivenessVitalType("Lisinopril 10mg")).toBe("blood_pressure");
  });

  it("maps a glucose-lowering drug to glucose", () => {
    expect(medicationEffectivenessVitalType("Metformin 500mg")).toBe("glucose");
    expect(medicationEffectivenessVitalType("Gliclazide 80mg")).toBe("glucose");
  });

  it("returns null for a drug outside this view's scope", () => {
    expect(medicationEffectivenessVitalType("Atorvastatin 20mg")).toBeNull();
    expect(medicationEffectivenessVitalType("Paracetamol 500mg")).toBeNull();
  });
});

describe("computeMedicationEffectiveness", () => {
  const startedAt = "2026-03-01T00:00:00Z";

  it("matches the spec's own worked example (BP 156/96 -> 138/84)", () => {
    const summary = computeMedicationEffectiveness("blood_pressure", startedAt, [
      { takenAt: "2026-02-01", systolic: 158, diastolic: 98 },
      { takenAt: "2026-02-15", systolic: 154, diastolic: 94 },
      { takenAt: "2026-04-01", systolic: 140, diastolic: 86 },
      { takenAt: "2026-04-15", systolic: 136, diastolic: 82 },
    ]);
    expect(summary).not.toBeNull();
    expect(summary!.beforeSystolic).toBe(156);
    expect(summary!.beforeDiastolic).toBe(96);
    expect(summary!.afterSystolic).toBe(138);
    expect(summary!.afterDiastolic).toBe(84);
  });

  it("returns null with fewer than 2 readings before the start date", () => {
    const summary = computeMedicationEffectiveness("blood_pressure", startedAt, [
      { takenAt: "2026-02-15", systolic: 154, diastolic: 94 },
      { takenAt: "2026-04-01", systolic: 140, diastolic: 86 },
      { takenAt: "2026-04-15", systolic: 136, diastolic: 82 },
    ]);
    expect(summary).toBeNull();
  });

  it("returns null with fewer than 2 readings after the start date", () => {
    const summary = computeMedicationEffectiveness("blood_pressure", startedAt, [
      { takenAt: "2026-02-01", systolic: 158, diastolic: 98 },
      { takenAt: "2026-02-15", systolic: 154, diastolic: 94 },
      { takenAt: "2026-04-01", systolic: 140, diastolic: 86 },
    ]);
    expect(summary).toBeNull();
  });

  it("treats a reading exactly on the start date as 'after'", () => {
    const summary = computeMedicationEffectiveness("blood_pressure", startedAt, [
      { takenAt: "2026-02-01", systolic: 158, diastolic: 98 },
      { takenAt: "2026-02-15", systolic: 154, diastolic: 94 },
      { takenAt: startedAt, systolic: 140, diastolic: 86 },
      { takenAt: "2026-04-15", systolic: 136, diastolic: 82 },
    ]);
    expect(summary!.afterCount).toBe(2);
    expect(summary!.beforeCount).toBe(2);
  });

  it("computes a glucose before/after average", () => {
    const summary = computeMedicationEffectiveness("glucose", startedAt, [
      { takenAt: "2026-02-01", glucoseMmolL: 9.5 },
      { takenAt: "2026-02-15", glucoseMmolL: 10.1 },
      { takenAt: "2026-04-01", glucoseMmolL: 7.2 },
      { takenAt: "2026-04-15", glucoseMmolL: 6.8 },
    ]);
    expect(summary).not.toBeNull();
    expect(summary!.beforeGlucoseMmolL).toBe(9.8);
    expect(summary!.afterGlucoseMmolL).toBe(7);
  });

  it("returns null when readings carry the wrong field for the vital type", () => {
    const summary = computeMedicationEffectiveness("glucose", startedAt, [
      { takenAt: "2026-02-01", systolic: 158, diastolic: 98 },
      { takenAt: "2026-02-15", systolic: 154, diastolic: 94 },
      { takenAt: "2026-04-01", systolic: 140, diastolic: 86 },
      { takenAt: "2026-04-15", systolic: 136, diastolic: 82 },
    ]);
    expect(summary).toBeNull();
  });
});
