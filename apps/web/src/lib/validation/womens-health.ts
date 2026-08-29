import { z } from "zod";

/**
 * Zod schemas for the Women's Health platform (spec §44). Grouped in one
 * file, same as lib/validation/emergency.ts holding DANGER_SIGNS — these are
 * all part of one cohesive feature area with a handful of small forms each,
 * rather than one schema per file.
 */

// --- Menstrual cycle log (§44.3/44.4) ---------------------------------------

export const MENSTRUAL_SYMPTOMS = [
  "cramps",
  "bloating",
  "mood_changes",
  "headache",
  "fatigue",
  "nausea",
  "breast_tenderness",
  "other",
] as const;
export type MenstrualSymptom = (typeof MENSTRUAL_SYMPTOMS)[number];

export const MENSTRUAL_SYMPTOM_LABEL: Record<MenstrualSymptom, string> = {
  cramps: "Cramps",
  bloating: "Bloating",
  mood_changes: "Mood changes",
  headache: "Headache",
  fatigue: "Fatigue",
  nausea: "Nausea",
  breast_tenderness: "Breast tenderness",
  other: "Other",
};

export const FLOW_LEVELS = ["spotting", "light", "medium", "heavy"] as const;
export type FlowLevel = (typeof FLOW_LEVELS)[number];

export const menstrualCycleLogSchema = z.object({
  period_start_date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date"),
  period_end_date: z
    .string()
    .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "Enter a valid date")
    .optional(),
  flow_level: z.enum(FLOW_LEVELS).optional(),
  pain_level: z.coerce.number().int().min(0).max(10).optional(),
  symptoms: z.array(z.enum(MENSTRUAL_SYMPTOMS)).default([]),
  notes: z.string().max(1000).optional(),
});
export type MenstrualCycleLogInput = z.infer<typeof menstrualCycleLogSchema>;

// --- Pregnancy red-flag safety pathway (§44.8) ------------------------------

/**
 * Pregnancy-specific danger signs — a dedicated safety pathway alongside
 * (not replacing) the general DANGER_SIGNS checklist in validation/
 * emergency.ts. Reported signs raise an emergency_events row with source
 * 'pregnancy_symptom_checklist', which the existing handle_emergency_event
 * trigger routes through the same acknowledge-gated "go to the nearest
 * hospital now" guidance.
 */
export const PREGNANCY_DANGER_SIGNS = [
  "vaginal_bleeding",
  "severe_headache_with_vision_changes",
  "reduced_or_no_baby_movement",
  "severe_abdominal_pain",
  "fever_or_chills",
  "swelling_of_face_hands_with_headache",
  "waters_broken",
  "severe_vomiting",
] as const;
export type PregnancyDangerSign = (typeof PREGNANCY_DANGER_SIGNS)[number];

export const PREGNANCY_DANGER_SIGN_LABEL: Record<PregnancyDangerSign, string> = {
  vaginal_bleeding: "Vaginal bleeding",
  severe_headache_with_vision_changes: "Severe headache with blurred/flashing vision",
  reduced_or_no_baby_movement: "Reduced or no baby movement",
  severe_abdominal_pain: "Severe abdominal pain",
  fever_or_chills: "Fever or chills",
  swelling_of_face_hands_with_headache: "Sudden swelling of face/hands with headache",
  waters_broken: "Waters broken",
  severe_vomiting: "Severe, persistent vomiting",
};

export const pregnancyDangerReportSchema = z.object({
  signs: z.array(z.enum(PREGNANCY_DANGER_SIGNS)).min(1, "Select at least one sign"),
});
export type PregnancyDangerReportInput = z.infer<typeof pregnancyDangerReportSchema>;

export function pregnancyDangerSignsSummary(signs: PregnancyDangerSign[]): string {
  return `Pregnancy warning sign(s): ${signs.map((sign) => PREGNANCY_DANGER_SIGN_LABEL[sign]).join(", ")}`;
}

// --- Breast symptom report (§44.11) -----------------------------------------

export const BREAST_SYMPTOM_TYPES = [
  "lump",
  "pain",
  "nipple_discharge",
  "skin_change",
  "nipple_change",
  "swelling",
  "other",
] as const;
export type BreastSymptomType = (typeof BREAST_SYMPTOM_TYPES)[number];

export const BREAST_SYMPTOM_LABEL: Record<BreastSymptomType, string> = {
  lump: "A lump or thickening",
  pain: "Pain",
  nipple_discharge: "Nipple discharge",
  skin_change: "Skin change (dimpling, redness)",
  nipple_change: "Nipple change (inversion, shape)",
  swelling: "Swelling",
  other: "Other",
};

export const breastSymptomReportSchema = z.object({
  symptom_types: z.array(z.enum(BREAST_SYMPTOM_TYPES)).min(1, "Select at least one symptom"),
  laterality: z.enum(["left", "right", "both", "unsure"]).optional(),
  duration_note: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});
export type BreastSymptomReportInput = z.infer<typeof breastSymptomReportSchema>;

// --- Menopause symptom log (§44.12) -----------------------------------------

export const MENOPAUSE_SYMPTOM_TYPES = [
  "hot_flashes",
  "night_sweats",
  "sleep_disturbance",
  "mood_changes",
  "vaginal_dryness",
  "joint_aches",
  "brain_fog",
  "other",
] as const;
export type MenopauseSymptomType = (typeof MENOPAUSE_SYMPTOM_TYPES)[number];

export const MENOPAUSE_SYMPTOM_LABEL: Record<MenopauseSymptomType, string> = {
  hot_flashes: "Hot flashes",
  night_sweats: "Night sweats",
  sleep_disturbance: "Sleep disturbance",
  mood_changes: "Mood changes",
  vaginal_dryness: "Vaginal dryness",
  joint_aches: "Joint aches",
  brain_fog: "Brain fog / concentration",
  other: "Other",
};

export const menopauseSymptomLogSchema = z.object({
  symptom_types: z.array(z.enum(MENOPAUSE_SYMPTOM_TYPES)).default([]),
  severity: z.coerce.number().int().min(0).max(10).optional(),
  postmenopausal_bleeding: z.coerce.boolean().default(false),
  notes: z.string().max(1000).optional(),
});
export type MenopauseSymptomLogInput = z.infer<typeof menopauseSymptomLogSchema>;

// --- Fertility assessment request (§44.13) ----------------------------------

export const fertilityAssessmentRequestSchema = z.object({
  trying_duration_months: z.coerce.number().int().min(0).max(600).optional(),
  concern_notes: z.string().max(1000).optional(),
});
export type FertilityAssessmentRequestInput = z.infer<typeof fertilityAssessmentRequestSchema>;

// --- Postnatal (§44.9) -------------------------------------------------------

export const postnatalProfileSchema = z.object({
  delivery_date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date"),
  delivery_mode: z.enum(["vaginal", "assisted", "caesarean", "unknown"]).default("unknown"),
  complications: z.string().max(1000).optional(),
});
export type PostnatalProfileInput = z.infer<typeof postnatalProfileSchema>;

export const CHECKIN_WINDOWS = ["week_1", "week_6", "month_3", "month_6", "month_12", "other"] as const;
export type CheckinWindow = (typeof CHECKIN_WINDOWS)[number];

export const BREASTFEEDING_STATUSES = ["not_started", "exclusive", "mixed", "formula_only", "stopped"] as const;
export type BreastfeedingStatus = (typeof BREASTFEEDING_STATUSES)[number];

export const postnatalCheckinSchema = z.object({
  checkin_window: z.enum(CHECKIN_WINDOWS),
  breastfeeding_status: z.enum(BREASTFEEDING_STATUSES).optional(),
  maternal_recovery_notes: z.string().max(1000).optional(),
  contraception_discussed: z.coerce.boolean().default(false),
});
export type PostnatalCheckinInput = z.infer<typeof postnatalCheckinSchema>;
