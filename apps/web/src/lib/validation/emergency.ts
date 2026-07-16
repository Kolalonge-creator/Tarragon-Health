import { z } from "zod";

/**
 * Danger / emergency signs a patient can tap in the one-touch emergency check.
 * These are unambiguous red flags — reporting ANY of them raises an
 * emergency_events row (which triages to the care team and shows the patient
 * the "go to the nearest hospital now" advice). Deliberately a fixed,
 * clinician-defined list, not free text, so the trigger can never be gamed
 * into under-reporting.
 */
export const DANGER_SIGNS = [
  "chest_pain",
  "trouble_breathing",
  "face_arm_weakness_or_slurred_speech",
  "severe_bleeding",
  "fainting_or_unresponsive",
  "seizure",
  "severe_allergic_reaction",
  "thoughts_of_self_harm",
  "sudden_severe_headache",
  "severe_abdominal_pain",
] as const;

export type DangerSign = (typeof DANGER_SIGNS)[number];

export const DANGER_SIGN_LABEL: Record<DangerSign, string> = {
  chest_pain: "Chest pain or pressure",
  trouble_breathing: "Trouble breathing",
  face_arm_weakness_or_slurred_speech: "Face/arm weakness or slurred speech",
  severe_bleeding: "Severe bleeding that won't stop",
  fainting_or_unresponsive: "Fainting or unresponsive",
  seizure: "Seizure or convulsions",
  severe_allergic_reaction: "Severe allergic reaction (swelling, throat tightness)",
  thoughts_of_self_harm: "Thoughts of harming myself",
  sudden_severe_headache: "Sudden, severe headache",
  severe_abdominal_pain: "Severe stomach pain",
};

export const dangerReportSchema = z.object({
  // At least one sign must be selected.
  signs: z.array(z.enum(DANGER_SIGNS)).min(1, "Select at least one sign"),
});

export type DangerReportInput = z.infer<typeof dangerReportSchema>;

/** Human-readable summary stored on emergency_events.trigger_detail. */
export function dangerSignsSummary(signs: DangerSign[]): string {
  return signs.map((sign) => DANGER_SIGN_LABEL[sign]).join(", ");
}
