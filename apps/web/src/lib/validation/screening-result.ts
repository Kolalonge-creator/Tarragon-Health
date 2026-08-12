import { z } from "zod";

/**
 * screen_types.code values (supabase/seed/seed.sql) that this form supports,
 * grouped by which /interpret/labs input shape they map to. Not every
 * catalogue code is covered here — 'blood_pressure' is handled by the
 * vitals-logging BP-control flow instead, and 'pcos_panel'/'antenatal_booking'
 * don't have an ML lab-interpretation shape yet.
 *
 * The Screen ladder's own annual/organ-baseline panel codes (added
 * 20260802010000) are folded into the two groups that need zero ML-service
 * schema change: 'ogtt_fpg' reuses the already-supported 'fasting_glucose'
 * analyte code (a fasting/OGTT glucose reading is that same measurement,
 * same canonical unit); 'fbc'/'lft'/'kft'/'tft'/'urinalysis'/'ecg_resting'/
 * 'urine_acr' are PROCEDURAL (status only, like mammography/FIT below) —
 * ML cannot derive a finding from a multi-value blood panel report any more
 * than it can from imaging, so a clinician records the panel's overall
 * status rather than every constituent value. 'syphilis' is QUALITATIVE
 * (VDRL/TPHA, positive/negative). 'blood_group' reuses the free-text
 * `genotype` field but is recorded server-side as `normal` verbatim (see
 * services/ml/app/scoring/screening_interpretation.py) — never run through
 * the sickle-cell-specific classifier `sickle_cell_genotype` uses.
 */
export const ANALYTE_SCREEN_TYPES = ["hba1c", "lipid_panel", "psa", "ogtt_fpg"] as const;
export const QUALITATIVE_SCREEN_TYPES = [
  "hiv",
  "hep_b",
  "hep_c",
  "tb_screen",
  "malaria_rdt",
  "syphilis",
] as const;
export const GENOTYPE_SCREEN_TYPES = ["sickle_cell_genotype", "blood_group"] as const;
export const PROCEDURAL_SCREEN_TYPES = [
  "mammography",
  "cervical_smear",
  "fit",
  "clinical_breast_exam",
  // Self-arranged like mammography/fit as of 20260811222950/20260811233511
  // — status-only, no ML lab-interpretation shape, same as every other
  // imaging/procedural code here. echo is deliberately excluded: it's
  // conditional on an ECG/BP/symptom finding, not a self-arranged calendar
  // screen, and isn't in any panel_bundle's test_codes.
  "breast_imaging",
  "abdominal_ultrasound",
  "prostate_ultrasound",
  "bone_density",
  "colonoscopy",
  "vision_check",
  "fbc",
  "lft",
  "kft",
  "tft",
  "urinalysis",
  "ecg_resting",
  "urine_acr",
  // hearing_check/dental_check added 2026-08-10 (screen_types migration
  // 20260810033458) — status-only like vision_check, no ML lab-interpretation
  // shape.
  "hearing_check",
  "dental_check",
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
    // Set only when this result is being recorded against a specific
    // Screen-tier (Core/Advanced/Comprehensive) order — the order-scoped
    // checklist passes it as a hidden field; the standalone clinician form
    // (record a result for this patient, no order context) omits it. Once
    // every applicable code for that order has a linked result, a DB
    // trigger auto-flips the order to 'resulted' (see
    // 20260802224400_screening_results_follow_up_action_and_auto_resulted).
    lab_order_id: z.string().uuid().optional(),
    hba1c_value: z.coerce.number().gt(0).max(20).optional(),
    hba1c_unit: z.enum(["percent", "mmol_mol"]).default("percent"),
    psa_value: z.coerce.number().gt(0).max(2000).optional(),
    total_cholesterol_mg_dl: z.coerce.number().gt(0).max(500).optional(),
    hdl_cholesterol_mg_dl: z.coerce.number().gt(0).max(200).optional(),
    ldl_cholesterol_mg_dl: z.coerce.number().gt(0).max(500).optional(),
    triglycerides_mg_dl: z.coerce.number().gt(0).max(2000).optional(),
    // OGTT/fasting plasma glucose — same canonical unit + ML AnalyteCode
    // ('fasting_glucose') as every other single-analyte field here.
    ogtt_fpg_value: z.coerce.number().gt(0).max(500).optional(),
    qualitative_result: z.enum(["positive", "negative"]).optional(),
    // Free-text carrier for both sickle_cell_genotype (classified AA/AS/SS)
    // and blood_group (recorded verbatim as normal — see screeningResultSchema's
    // GENOTYPE_SCREEN_TYPES comment and the ML-side branch this depends on).
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
      if (code === "ogtt_fpg" && data.ogtt_fpg_value === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["ogtt_fpg_value"],
          message: "Enter an OGTT/fasting glucose value",
        });
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
      ctx.addIssue({
        code: "custom",
        path: ["genotype"],
        message: code === "blood_group" ? "Enter a blood group" : "Enter a genotype",
      });
    } else if (isProceduralScreenType(code) && data.procedural_status === undefined) {
      ctx.addIssue({ code: "custom", path: ["procedural_status"], message: "Select a result status" });
    }
  });

export type ScreeningResultInput = z.infer<typeof screeningResultSchema>;
