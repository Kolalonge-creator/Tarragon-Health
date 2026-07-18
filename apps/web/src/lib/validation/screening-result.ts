import { z } from "zod";

/**
 * screen_types.code values (supabase/seed/seed.sql) that this form supports,
 * grouped by which /interpret/labs input shape they map to. Not every
 * catalogue code is covered here — 'blood_pressure' is handled by the
 * vitals-logging BP-control flow instead, and 'pcos_panel'/'antenatal_booking'
 * don't have an ML lab-interpretation shape yet.
 */
export const ANALYTE_SCREEN_TYPES = ["hba1c", "lipid_panel", "psa"] as const;
export const QUALITATIVE_SCREEN_TYPES = [
  "hiv",
  "hep_b",
  "hep_c",
  "tb_screen",
  "malaria_rdt",
] as const;
export const GENOTYPE_SCREEN_TYPES = ["sickle_cell_genotype"] as const;
export const PROCEDURAL_SCREEN_TYPES = [
  "mammography",
  "cervical_smear",
  "fit",
  "clinical_breast_exam",
  "bone_density",
  "colonoscopy",
  "vision_check",
] as const;

export const SCREENING_RESULT_SCREEN_TYPES = [
  ...ANALYTE_SCREEN_TYPES,
  ...QUALITATIVE_SCREEN_TYPES,
  ...GENOTYPE_SCREEN_TYPES,
  ...PROCEDURAL_SCREEN_TYPES,
] as const;

type AnalyteScreenType = (typeof ANALYTE_SCREEN_TYPES)[number];
type QualitativeScreenType = (typeof QUALITATIVE_SCREEN_TYPES)[number];
type GenotypeScreenType = (typeof GENOTYPE_SCREEN_TYPES)[number];
type ProceduralScreenType = (typeof PROCEDURAL_SCREEN_TYPES)[number];

function isAnalyteScreenType(code: string): code is AnalyteScreenType {
  return (ANALYTE_SCREEN_TYPES as readonly string[]).includes(code);
}
function isQualitativeScreenType(code: string): code is QualitativeScreenType {
  return (QUALITATIVE_SCREEN_TYPES as readonly string[]).includes(code);
}
function isGenotypeScreenType(code: string): code is GenotypeScreenType {
  return (GENOTYPE_SCREEN_TYPES as readonly string[]).includes(code);
}
function isProceduralScreenType(code: string): code is ProceduralScreenType {
  return (PROCEDURAL_SCREEN_TYPES as readonly string[]).includes(code);
}

/**
 * One flat schema rather than a discriminated union: the four groups above
 * share no common required fields, and `screen_type_code` alone (not a
 * single literal per branch) decides which optional fields matter — a
 * `superRefine` enforcing per-group requirements reads more directly than
 * a 16-branch literal union.
 */
export const screeningResultSchema = z
  .object({
    screen_type_code: z.enum(SCREENING_RESULT_SCREEN_TYPES),
    hba1c_value: z.coerce.number().gt(0).max(20).optional(),
    hba1c_unit: z.enum(["percent", "mmol_mol"]).default("percent"),
    psa_value: z.coerce.number().gt(0).max(2000).optional(),
    total_cholesterol_mg_dl: z.coerce.number().gt(0).max(500).optional(),
    hdl_cholesterol_mg_dl: z.coerce.number().gt(0).max(200).optional(),
    ldl_cholesterol_mg_dl: z.coerce.number().gt(0).max(500).optional(),
    triglycerides_mg_dl: z.coerce.number().gt(0).max(2000).optional(),
    qualitative_result: z.enum(["positive", "negative"]).optional(),
    genotype: z.string().trim().min(1).max(32).optional(),
    procedural_status: z.enum(["normal", "borderline", "abnormal", "critical"]).optional(),
  })
  .superRefine((data, ctx) => {
    const code = data.screen_type_code;
    if (isAnalyteScreenType(code)) {
      if (code === "hba1c" && data.hba1c_value === undefined) {
        ctx.addIssue({ code: "custom", path: ["hba1c_value"], message: "Enter an HbA1c value" });
      }
      if (code === "psa" && data.psa_value === undefined) {
        ctx.addIssue({ code: "custom", path: ["psa_value"], message: "Enter a PSA value" });
      }
      if (
        code === "lipid_panel" &&
        data.total_cholesterol_mg_dl === undefined &&
        data.hdl_cholesterol_mg_dl === undefined &&
        data.ldl_cholesterol_mg_dl === undefined &&
        data.triglycerides_mg_dl === undefined
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["total_cholesterol_mg_dl"],
          message: "Enter at least one lipid panel value",
        });
      }
    } else if (isQualitativeScreenType(code) && data.qualitative_result === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["qualitative_result"],
        message: "Select positive or negative",
      });
    } else if (isGenotypeScreenType(code) && !data.genotype) {
      ctx.addIssue({ code: "custom", path: ["genotype"], message: "Enter a genotype" });
    } else if (isProceduralScreenType(code) && data.procedural_status === undefined) {
      ctx.addIssue({ code: "custom", path: ["procedural_status"], message: "Select a result status" });
    }
  });

export type ScreeningResultInput = z.infer<typeof screeningResultSchema>;
