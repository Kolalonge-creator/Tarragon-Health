import type { SymptomType } from "./symptoms";
import { validateBpEntry, validateOtherEntry, type BpEntryError, type OtherEntryError } from "./vitals-entry";

/**
 * Plans one blood pressure log with its optional pulse and symptom ticks (S07).
 * Pure: it validates the typed numbers, decides which rows are written, and
 * flags the red-flag ticks. It does not save, grade, or decide urgency.
 *
 * What gets written (the design note, section 2):
 * - the blood pressure reading, always;
 * - a companion pulse reading when a pulse was typed, so the existing pulse
 *   red-flag trigger judges it (the pulse is not hidden in a note);
 * - one symptoms row per ticked symptom, so the existing symptom red-flag
 *   trigger judges it. The form does not ask the patient to rate a tick, so the
 *   row carries the configured severity (bp.symptom_checklist) and a description
 *   saying it was ticked on this form, so a clinician can tell it was not a
 *   patient-rated severity.
 *
 * `redFlagTicked` lists the ticks that should bring up the emergency guidance
 * on the device straight away (the content already bundled in the app, INV-06).
 * Showing guidance is not grading: any tick of these symptoms shows it, with no
 * threshold, and S11/S12 own the actual triage rules (OQ-67).
 */
export type BpChecklistSymptom = Extract<
  SymptomType,
  "severe_headache" | "chest_pain" | "breathlessness" | "visual_disturbance" | "confusion" | "dizziness" | "palpitations"
>;

/** What the patient measured with (S12b). Optional; recorded on the reading so a trend from a wrist cuff is not read as an upper arm one. */
export type CuffType = "upper_arm" | "wrist" | "not_sure";
export const CUFF_TYPES: readonly CuffType[] = ["upper_arm", "wrist", "not_sure"];

export const BP_CHECKLIST_SYMPTOMS: readonly BpChecklistSymptom[] = [
  "severe_headache",
  "chest_pain",
  "breathlessness",
  "visual_disturbance",
  "confusion",
  "dizziness",
  "palpitations",
];

/** The ticks that bring up emergency guidance at once: the red-flag symptoms named for blood pressure in the spec (BP-R1). */
export const RED_FLAG_CHECKLIST_SYMPTOMS: readonly BpChecklistSymptom[] = [
  "severe_headache",
  "chest_pain",
  "breathlessness",
  "visual_disturbance",
  "confusion",
];

/**
 * The red-flag ticks among whatever was ticked. Used on its own when the numbers
 * are blank or invalid: guidance for a red-flag symptom must never depend on the
 * reading being valid, so the screen asks this before it asks for the numbers.
 */
export function redFlagsAmong(symptoms: readonly BpChecklistSymptom[]): BpChecklistSymptom[] {
  return RED_FLAG_CHECKLIST_SYMPTOMS.filter((s) => symptoms.includes(s));
}

/** Written on every ticked symptom so the severity is never mistaken for a patient rating. */
export const TICKED_ON_BP_FORM_NOTE = "Ticked on the blood pressure form (not rated by the patient).";

export interface BpLogInput {
  systolic: string;
  diastolic: string;
  /** Blank means no pulse was typed. */
  pulse: string;
  symptoms: readonly BpChecklistSymptom[];
  cuffType?: CuffType | null;
}

export type BpLogError = BpEntryError | Extract<OtherEntryError, "number" | "range_pulse">;

export interface PlannedSymptom {
  symptom_type: BpChecklistSymptom;
  severity: number;
  description: string;
}

export type BpLogPlan =
  | {
      ok: true;
      systolic: number;
      diastolic: number;
      pulse: number | null;
      symptoms: PlannedSymptom[];
      redFlagTicked: BpChecklistSymptom[];
      cuffType: CuffType | null;
    }
  | { ok: false; error: BpLogError; field: "bp" | "pulse" };

export function planBpLog(input: BpLogInput, tickedSeverity: number): BpLogPlan {
  const bp = validateBpEntry(input.systolic, input.diastolic);
  if (!bp.ok) return { ok: false, error: bp.error, field: "bp" };

  let pulse: number | null = null;
  if (input.pulse.trim() !== "") {
    const p = validateOtherEntry("pulse", input.pulse, "mmol_l");
    if (!p.ok) return { ok: false, error: p.error as BpLogError, field: "pulse" };
    pulse = p.value;
  }

  // Each symptom once, in checklist order, ignoring anything that is not on the list.
  const ticked = BP_CHECKLIST_SYMPTOMS.filter((s) => input.symptoms.includes(s));
  return {
    ok: true,
    systolic: bp.systolic,
    diastolic: bp.diastolic,
    pulse,
    symptoms: ticked.map((symptom_type) => ({ symptom_type, severity: tickedSeverity, description: TICKED_ON_BP_FORM_NOTE })),
    redFlagTicked: redFlagsAmong(ticked),
    // Anything not on the list is dropped, never stored.
    cuffType: CUFF_TYPES.find((c) => c === input.cuffType) ?? null,
  };
}
