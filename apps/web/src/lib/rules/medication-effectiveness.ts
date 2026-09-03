/**
 * Medication safety pathway 64.11 — "medication started -> monitoring ->
 * outcome -> clinician review", the spec's own worked example ("BP before
 * treatment 156/96, after treatment 138/84"). PURE and unit-testable, same
 * discipline as every other engine in this directory.
 *
 * Scoped deliberately to the platform's two core-wedge conditions
 * (hypertension, diabetes — CLAUDE.md's "Chronic Disease Management (core
 * wedge)") rather than every drug class: those are the two where a single
 * routinely-logged vital (blood pressure, glucose) is both the right
 * effectiveness measure and something patients already log often enough for
 * a before/after comparison to mean anything. A statin's effectiveness
 * measure is a lipid panel drawn maybe once or twice a year — comparing two
 * such sparse values invites over-reading noise as a trend, so that's left
 * for a lab-panel-specific view rather than forced into this shape.
 *
 * Reuses classifyDrug (drug-safety.ts) rather than a second drug taxonomy —
 * one classifier, one source of truth for what a drug name "is".
 */

import { classifyDrug, type TherapeuticClass } from "./drug-safety";

export type EffectivenessVitalType = "blood_pressure" | "glucose";

const BP_CLASSES: TherapeuticClass[] = [
  "ace_inhibitor",
  "arb",
  "beta_blocker",
  "ccb_dihydropyridine",
  "ccb_non_dihydropyridine",
  "thiazide_diuretic",
  "loop_diuretic",
];

const GLUCOSE_CLASSES: TherapeuticClass[] = ["metformin", "sulfonylurea", "sglt2", "dpp4", "insulin"];

/** Which vital this drug's effectiveness is judged against, or null if it's outside this view's scope. */
export function medicationEffectivenessVitalType(drugName: string): EffectivenessVitalType | null {
  const classes = classifyDrug(drugName);
  if (classes.some((c) => BP_CLASSES.includes(c))) return "blood_pressure";
  if (classes.some((c) => GLUCOSE_CLASSES.includes(c))) return "glucose";
  return null;
}

export interface VitalReadingForEffectiveness {
  takenAt: string;
  systolic?: number | null;
  diastolic?: number | null;
  glucoseMmolL?: number | null;
}

export interface MedicationEffectivenessSummary {
  vitalType: EffectivenessVitalType;
  beforeCount: number;
  afterCount: number;
  beforeSystolic?: number;
  beforeDiastolic?: number;
  afterSystolic?: number;
  afterDiastolic?: number;
  beforeGlucoseMmolL?: number;
  afterGlucoseMmolL?: number;
}

/**
 * A reading below this count on either side of the medication's start date
 * is too little to average meaningfully — a single reading either way could
 * be an outlier, and this is explicitly a "does this look like it's
 * working" nudge for a clinician, not a statistical claim.
 */
const MIN_READINGS_PER_WINDOW = 2;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function average(values: number[]): number {
  return round1(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * Splits readings of the right vital type into before/after the
 * medication's start date and averages each side. Returns null whenever
 * there isn't enough on either side to say anything (see
 * MIN_READINGS_PER_WINDOW) — never a partial, misleadingly confident summary.
 */
export function computeMedicationEffectiveness(
  vitalType: EffectivenessVitalType,
  startedAt: string,
  readings: VitalReadingForEffectiveness[]
): MedicationEffectivenessSummary | null {
  const startTime = new Date(startedAt).getTime();
  const before = readings.filter((r) => new Date(r.takenAt).getTime() < startTime);
  const after = readings.filter((r) => new Date(r.takenAt).getTime() >= startTime);

  if (before.length < MIN_READINGS_PER_WINDOW || after.length < MIN_READINGS_PER_WINDOW) {
    return null;
  }

  if (vitalType === "blood_pressure") {
    const beforeSys = before.map((r) => r.systolic).filter((v): v is number => v != null);
    const beforeDia = before.map((r) => r.diastolic).filter((v): v is number => v != null);
    const afterSys = after.map((r) => r.systolic).filter((v): v is number => v != null);
    const afterDia = after.map((r) => r.diastolic).filter((v): v is number => v != null);
    if (
      beforeSys.length < MIN_READINGS_PER_WINDOW ||
      beforeDia.length < MIN_READINGS_PER_WINDOW ||
      afterSys.length < MIN_READINGS_PER_WINDOW ||
      afterDia.length < MIN_READINGS_PER_WINDOW
    ) {
      return null;
    }
    return {
      vitalType,
      beforeCount: before.length,
      afterCount: after.length,
      beforeSystolic: average(beforeSys),
      beforeDiastolic: average(beforeDia),
      afterSystolic: average(afterSys),
      afterDiastolic: average(afterDia),
    };
  }

  const beforeGlucose = before.map((r) => r.glucoseMmolL).filter((v): v is number => v != null);
  const afterGlucose = after.map((r) => r.glucoseMmolL).filter((v): v is number => v != null);
  if (beforeGlucose.length < MIN_READINGS_PER_WINDOW || afterGlucose.length < MIN_READINGS_PER_WINDOW) {
    return null;
  }
  return {
    vitalType,
    beforeCount: before.length,
    afterCount: after.length,
    beforeGlucoseMmolL: average(beforeGlucose),
    afterGlucoseMmolL: average(afterGlucose),
  };
}

/** The honest caveat this view must always carry alongside a summary — see the file header. */
export const MEDICATION_EFFECTIVENESS_DISCLAIMER =
  "A simple before/after average, not a clinical judgement — other changes (diet, other medications, measurement conditions) can also move these numbers.";
