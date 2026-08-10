import { z } from "zod";

/**
 * Which diabetes a patient has. Matters clinically: the metformin-first
 * ladder assumes type 2, "never stop insulin" is unconditional in type 1,
 * and the type-1 suspicion heuristic (glucose-red-flags.ts::suspectsType1)
 * should stand down once a clinician has actually confirmed the type.
 */
export const DIABETES_TYPES = ["type_1", "type_2", "gestational", "other"] as const;

export const DIABETES_TYPE_LABEL: Record<(typeof DIABETES_TYPES)[number], string> = {
  type_1: "Type 1",
  type_2: "Type 2",
  gestational: "Gestational (diagnosed during pregnancy)",
  other: "Another / unclear type",
};

export const patientReportedDiabetesTypeSchema = z.object({
  diabetes_type: z.enum(DIABETES_TYPES),
});

export const confirmDiabetesTypeSchema = z.object({
  patient_id: z.string().uuid(),
  diabetes_type: z.enum(DIABETES_TYPES),
});
