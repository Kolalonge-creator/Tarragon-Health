import { mgDlToMmolL } from "@tarragon/shared";
import { GLUCOSE_SIGN_SYMPTOM_TYPE, GLUCOSE_SYMPTOMS, TICKED_ON_GLUCOSE_FORM_NOTE, type GlucoseContextCode, type GlucoseSymptomCode, type KetoneUrine } from "@tarragon/clinical";
import { enqueueGroup, type EnqueueInput } from "./outbox";
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

/** One ticked sign as the server's symptom log stores it (see GLUCOSE_SIGN_SYMPTOM_TYPE for why each sign is the symptom it is). */
export interface PlannedGlucoseSign {
  sign: GlucoseSymptomCode;
  symptom_type: string;
  severity: number;
  description: string;
}

/**
 * The symptom rows for the signs ticked on one glucose log: each sign once, in the engine's own order, anything that is not one of the nine dropped.
 * `severity` is the configured value (glucose.symptom_checklist), which is below the older symptom trigger's paging line on purpose, so this stores the
 * sign for the governed engine to grade and cannot page through the older path on its own. Pure.
 */
export function planGlucoseSigns(signs: readonly GlucoseSymptomCode[], severity: number): PlannedGlucoseSign[] {
  return GLUCOSE_SYMPTOMS.filter((s) => signs.includes(s)).map((sign) => ({
    sign,
    symptom_type: GLUCOSE_SIGN_SYMPTOM_TYPE[sign],
    severity,
    description: TICKED_ON_GLUCOSE_FORM_NOTE,
  }));
}

export interface SaveSignsResult {
  /** Rows made durable on the phone (all or none). */
  saved: number;
  /** True when the signs could not be saved on the phone, so the caller can say so; the reading itself is saved on its own path. */
  failed: boolean;
}

/**
 * Makes the ticked signs durable on the phone as symptom rows in the one offline outbox, the same path blood pressure ticks take (idempotent by the
 * row's client id; held offline and sent oldest first). A Level 3 sign is a "danger" row, so if it has not reached the server within the hour the
 * patient gets the usual "not yet reached your care team" notice. Never throws: a failure must not stand between the patient and a saved reading,
 * and the caller is told, never left to assume.
 */
export async function saveGlucoseSigns(
  signs: readonly GlucoseSymptomCode[],
  severity: number,
  who: { subjectId: string; beneficiaryProfileId?: string },
): Promise<SaveSignsResult> {
  const plan = planGlucoseSigns(signs, severity);
  if (plan.length === 0) return { saved: 0, failed: false };
  const inputs: EnqueueInput[] = plan.map((p) => ({
    kind: "symptom",
    subjectId: who.subjectId,
    beneficiaryProfileId: who.beneficiaryProfileId,
    payload: { symptom_type: p.symptom_type, severity: p.severity, description: p.description },
    danger: LEVEL_3_SIGNS.includes(p.sign),
  }));
  try {
    await enqueueGroup(inputs);
  } catch {
    return { saved: 0, failed: true };
  }
  // Sending is the caller's business (the screen flushes after the reading is saved, without waiting): this only makes the rows durable.
  return { saved: plan.length, failed: false };
}
