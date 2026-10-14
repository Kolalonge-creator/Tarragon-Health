import { mgDlToMmolL } from "@tarragon/shared";
import type { GlucoseContextCode, GlucoseSymptomCode, KetoneUrine } from "@tarragon/clinical";
import { gradeGlucoseOnDevice, type DeviceTriage } from "./triage-device";
import { classifyVitalOffline, type OfflineVitalFlag } from "./vitals";
import type { GlucoseUnit } from "./vitals-entry";

/**
 * The seam where on-device glucose triage attaches to the quick-log form (plan item R2, CMO Q6 to Q9). Same stance as the blood pressure
 * seam in bp-log.ts: run two checks side by side and show the stricter. They are the older single-reading check (classifyVitalOffline over the
 * synced thresholds, which is what the live server alerts also use) and the governed engine (`gradeGlucoseOnDevice`, the same pure rules
 * as the server, from @tarragon/clinical). While the glucose rule set is a draft (the CMO has not signed it) the engine can only ADD
 * guidance, never take away what the older check shows; a ticked Level 3 sign (confusion, seizure, unconscious, cannot swallow) always
 * shows the emergency guidance already bundled in the app (INV-06). No language model is ever consulted here (INV-01).
 */
export interface GlucoseEvalInput {
  value: number;
  unit: GlucoseUnit;
  context: GlucoseContextCode;
  ketoneBloodMmol?: number | null;
  ketoneUrine?: KetoneUrine | null;
  symptoms: readonly GlucoseSymptomCode[];
  subjectId: string;
}

export interface GlucoseOutcome {
  /** "emergency" takes over the screen with the emergency guidance; "urgent" is an inline banner; null is nothing to say. */
  severity: "emergency" | "urgent" | null;
  /** The older single-reading check's flag, with its English detail line. */
  legacy: OfflineVitalFlag | null;
  /** True when a Level 3 sign was ticked. */
  signFlag: boolean;
  /** The governed engine's answer, or null when it could not run. */
  device: DeviceTriage | null;
}

/** The signs that mean help from another person is needed whatever the glucose reads (ADA level 3). */
export const LEVEL_3_SIGNS: readonly GlucoseSymptomCode[] = ["confusion", "seizure", "unconscious", "cannot_swallow"];

export type GlucoseEvaluator = (input: GlucoseEvalInput) => Promise<GlucoseOutcome>;

export const evaluateGlucoseOnDevice: GlucoseEvaluator = async (input) => {
  const mmol = input.unit === "mg_dl" ? mgDlToMmolL(input.value) : input.value;
  const signFlag = input.symptoms.some((s) => LEVEL_3_SIGNS.includes(s));
  // A failure in either check must not hide the other, or the ticked signs, which need nothing from the network.
  const [legacy, device] = await Promise.all([
    classifyVitalOffline({ vital_type: "glucose", glucose_value: input.value, glucose_unit: input.unit, glucose_context: input.context }).catch(() => null),
    gradeGlucoseOnDevice({
      subjectId: input.subjectId,
      mmol,
      context: input.context,
      ketoneBloodMmol: input.ketoneBloodMmol ?? null,
      ketoneUrine: input.ketoneUrine ?? null,
      symptoms: input.symptoms,
    }).catch(() => null),
  ]);
  const severity: GlucoseOutcome["severity"] =
    signFlag || legacy?.severity === "emergency" || device?.severity === "emergency" ? "emergency" : (legacy?.severity ?? null);
  return { severity, legacy, signFlag, device };
};
