import { z } from "zod";

/**
 * Paediatric one-touch danger-symptom checklist (Child Health Platform §48.9:
 * "dedicated red-flag protocols" — must not simply reuse the adult
 * DANGER_SIGNS list in emergency.ts). Same fixed-list, no-free-text shape and
 * the same reasoning: a clinician-defined list a parent can tap in an instant,
 * so the trigger can never be gamed into under-reporting.
 *
 * Shown instead of (not alongside) DANGER_SIGNS when the acting-for subject
 * is a dependent under 5 — see shouldOfferPaediatricSymptomTypes in
 * pediatric-symptom-triage.ts for the same age gate used on the symptom-log
 * form. Reuses the identical emergency_events pathway (source:
 * "danger_symptom_checklist", same as the adult checklist) — this is a
 * different question set, not a different pipe.
 */
export const PAEDIATRIC_DANGER_SIGNS = [
  "wont_wake_or_very_hard_to_wake",
  "blue_lips_or_face",
  "severe_difficulty_breathing_or_grunting",
  "bulging_or_sunken_soft_spot",
  "seizure_lasting_over_5_minutes",
  "no_wet_nappy_in_8_hours",
  "not_feeding_at_all",
  "severe_allergic_reaction",
  "high_fever_under_3_months",
  "unresponsive_or_limp",
] as const;

export type PaediatricDangerSign = (typeof PAEDIATRIC_DANGER_SIGNS)[number];

export const PAEDIATRIC_DANGER_SIGN_LABEL: Record<PaediatricDangerSign, string> = {
  wont_wake_or_very_hard_to_wake: "Won't wake up, or is very hard to wake",
  blue_lips_or_face: "Blue or grey lips, tongue, or face",
  severe_difficulty_breathing_or_grunting: "Severe difficulty breathing, or grunting with each breath",
  bulging_or_sunken_soft_spot: "Bulging or sunken soft spot on the head (infant)",
  seizure_lasting_over_5_minutes: "A seizure lasting more than 5 minutes",
  no_wet_nappy_in_8_hours: "No wet nappy in 8 hours, dry mouth, or no tears when crying",
  not_feeding_at_all: "Refusing all feeds or unable to keep any fluids down",
  severe_allergic_reaction: "Severe allergic reaction (swelling, throat tightness)",
  high_fever_under_3_months: "Fever in a baby under 3 months old",
  unresponsive_or_limp: "Unresponsive, or unusually floppy",
};

export const paediatricDangerReportSchema = z.object({
  signs: z.array(z.enum(PAEDIATRIC_DANGER_SIGNS)).min(1, "Select at least one sign"),
});

export type PaediatricDangerReportInput = z.infer<typeof paediatricDangerReportSchema>;

export function paediatricDangerSignsSummary(signs: PaediatricDangerSign[]): string {
  return signs.map((sign) => PAEDIATRIC_DANGER_SIGN_LABEL[sign]).join(", ");
}
