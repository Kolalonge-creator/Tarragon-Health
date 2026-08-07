/**
 * The canonical analyte catalogue — the single source of truth for every
 * numeric lab value this platform can store, its canonical unit, the units a
 * Nigerian lab report might print it in, and the many names those reports
 * actually use for it.
 *
 * WHY THIS EXISTS: Nigeria has no HL7/FHIR interchange between labs. Every
 * report is a differently-shaped PDF or a photo of a printout, and the same
 * analyte appears as "Creatinine", "Serum Creatinine", "CREAT", or "S. Creat"
 * depending on which lab printed it. Extraction (lib/lab-reports/extract.ts)
 * resolves whatever the report calls it back to ONE code, so every downstream
 * engine — eGFR, longitudinal trends, CV risk, the patient explainer — reads a
 * single vocabulary rather than free text.
 *
 * The existing analyte codes already in `lab_analyte_readings` (hba1c,
 * fasting_glucose, the five lipid codes from lib/lipids/analytes.ts, psa) are
 * carried here VERBATIM. This catalogue widens the vocabulary; it never renames
 * an existing code, because historical rows already carry those strings and a
 * rename would orphan every trend.
 *
 * Canonical units follow what `submitScreeningResult` already writes (mg/dL for
 * glucose and lipids, percent for HbA1c, ng/mL for PSA) so extracted values sit
 * in the same series as clinician-entered ones with no conversion at read time.
 *
 * NOT IN THIS FILE: clinical thresholds and targets. Those live in signed
 * config (`cv_risk_config`) or in the pure rules engines, deliberately, so a
 * clinical number can be reviewed and changed without touching this vocabulary.
 * The `refLow`/`refHigh` fields here are ORIENTATION ONLY — a rough adult
 * reference band used to render "outside the usual range" on an extraction
 * review screen. They are never used to classify a result, raise an alert, or
 * tell a patient anything.
 */

export type AnalyteGroup =
  | "renal"
  | "glycaemic"
  | "lipid"
  | "liver"
  | "haematology"
  | "electrolyte"
  | "thyroid"
  | "urinalysis"
  | "other";

export interface AnalyteDefinition {
  /** Stable code written to lab_analyte_readings.code. Never rename. */
  code: string;
  label: string;
  group: AnalyteGroup;
  /** The unit every stored row uses for this code. */
  canonicalUnit: string;
  /**
   * Other units a Nigerian report may print, with the factor to multiply by to
   * reach `canonicalUnit`. Keys are lower-cased and stripped of spaces/dots by
   * `normaliseUnit` before lookup.
   */
  unitConversions?: Record<string, number>;
  /**
   * Names, abbreviations, and misspellings seen on real report layouts. Matched
   * case-insensitively after punctuation stripping. Order does not matter;
   * `resolveAnalyteCode` prefers the longest match so "hdl cholesterol" never
   * loses to a bare "cholesterol".
   */
  aliases: string[];
  /**
   * Rough adult reference band, for review-screen orientation only.
   *
   * `refLow: 0` is the deliberate "no lower bound of interest" sentinel — a low
   * total cholesterol or a low ALT is not something this platform flags, so the
   * band is one-sided. It reads below the plausibility floor on purpose; a
   * value that low is rejected as a misread before it ever reaches the band.
   */
  refLow?: number;
  refHigh?: number;
  /**
   * Sex-specific reference band where the difference is large enough that a
   * single band would be misleading on the review screen (haemoglobin,
   * creatinine, haematocrit).
   */
  refBySex?: { male: [number, number]; female: [number, number] };
  /** A plausible-value guard. Anything outside this is rejected as a misread. */
  plausible: [number, number];
}

/**
 * mg/dL ⇄ µmol/L for creatinine: 1 mg/dL = 88.4 µmol/L. Nigerian labs print
 * both, and getting this backwards turns a normal creatinine into stage-5 CKD,
 * so it is named rather than inlined.
 */
const CREATININE_UMOL_TO_MG_DL = 1 / 88.4;
/** mmol/L → mg/dL for glucose. */
const GLUCOSE_MMOL_TO_MG_DL = 18.016;
/** mmol/L → mg/dL for cholesterol fractions. */
const CHOLESTEROL_MMOL_TO_MG_DL = 38.67;
/** mmol/L → mg/dL for triglycerides (different molecular weight to cholesterol). */
const TRIGLYCERIDE_MMOL_TO_MG_DL = 88.57;
/** mmol/L → mg/dL for urea. Note urea and BUN are NOT the same measurement. */
const UREA_MMOL_TO_MG_DL = 6.006;

export const ANALYTE_CATALOGUE: readonly AnalyteDefinition[] = [
  // ---------------------------------------------------------------- renal
  {
    code: "creatinine",
    label: "Creatinine",
    group: "renal",
    canonicalUnit: "mg/dL",
    unitConversions: { "umol/l": CREATININE_UMOL_TO_MG_DL, "µmol/l": CREATININE_UMOL_TO_MG_DL, "mmol/l": 1000 * CREATININE_UMOL_TO_MG_DL },
    aliases: ["creatinine", "serum creatinine", "s creatinine", "creat", "s creat", "plasma creatinine", "cr"],
    refBySex: { male: [0.7, 1.3], female: [0.6, 1.1] },
    plausible: [0.1, 25],
  },
  {
    code: "urea",
    label: "Urea",
    group: "renal",
    canonicalUnit: "mg/dL",
    unitConversions: { "mmol/l": UREA_MMOL_TO_MG_DL },
    aliases: ["urea", "serum urea", "s urea", "blood urea"],
    refLow: 15,
    refHigh: 45,
    plausible: [1, 400],
  },
  {
    code: "bun",
    label: "Blood urea nitrogen",
    group: "renal",
    canonicalUnit: "mg/dL",
    // BUN = urea / 2.14. Kept as its OWN code rather than converted into urea:
    // a report prints one or the other, and silently converting would invent a
    // measurement the lab never made.
    aliases: ["bun", "blood urea nitrogen", "urea nitrogen"],
    refLow: 7,
    refHigh: 20,
    plausible: [1, 200],
  },
  {
    code: "urine_acr",
    label: "Urine albumin-to-creatinine ratio",
    group: "renal",
    canonicalUnit: "mg/g",
    unitConversions: { "mg/mmol": 8.84 },
    aliases: ["urine acr", "acr", "albumin creatinine ratio", "albumin to creatinine ratio", "urine albumin creatinine ratio", "uacr", "microalbumin creatinine ratio"],
    refLow: 0,
    refHigh: 30,
    plausible: [0, 30000],
  },
  // ------------------------------------------------------------- glycaemic
  {
    code: "hba1c",
    label: "HbA1c",
    group: "glycaemic",
    canonicalUnit: "percent",
    // IFCC mmol/mol → DCCT %. Not a plain multiply: % = (mmol/mol / 10.929) + 2.15.
    // Handled by `convertToCanonical`'s special case, not a factor here.
    aliases: ["hba1c", "hb a1c", "haemoglobin a1c", "hemoglobin a1c", "glycated haemoglobin", "glycated hemoglobin", "glycosylated haemoglobin", "a1c"],
    refLow: 4,
    refHigh: 5.6,
    plausible: [3, 20],
  },
  {
    code: "fasting_glucose",
    label: "Fasting glucose",
    group: "glycaemic",
    canonicalUnit: "mg/dL",
    unitConversions: { "mmol/l": GLUCOSE_MMOL_TO_MG_DL },
    aliases: ["fasting glucose", "fasting blood glucose", "fasting blood sugar", "fbs", "fbg", "fpg", "fasting plasma glucose", "glucose fasting"],
    refLow: 70,
    refHigh: 99,
    plausible: [10, 1500],
  },
  {
    code: "random_glucose",
    label: "Random glucose",
    group: "glycaemic",
    canonicalUnit: "mg/dL",
    unitConversions: { "mmol/l": GLUCOSE_MMOL_TO_MG_DL },
    aliases: ["random glucose", "random blood sugar", "rbs", "rbg", "casual glucose", "random plasma glucose"],
    refLow: 70,
    refHigh: 139,
    plausible: [10, 1500],
  },
  {
    code: "ogtt_2h_glucose",
    label: "2-hour glucose (OGTT)",
    group: "glycaemic",
    canonicalUnit: "mg/dL",
    unitConversions: { "mmol/l": GLUCOSE_MMOL_TO_MG_DL },
    aliases: ["2 hour glucose", "2hr glucose", "ogtt 2 hour", "ogtt 2hr", "2 h post glucose", "post prandial glucose", "2 hour post prandial", "pp glucose", "ogtt"],
    refLow: 70,
    refHigh: 139,
    plausible: [10, 1500],
  },
  // ----------------------------------------------------------------- lipid
  {
    code: "total_cholesterol",
    label: "Total cholesterol",
    group: "lipid",
    canonicalUnit: "mg/dL",
    unitConversions: { "mmol/l": CHOLESTEROL_MMOL_TO_MG_DL },
    aliases: ["total cholesterol", "cholesterol total", "t chol", "tc", "cholesterol"],
    refLow: 0,
    refHigh: 200,
    plausible: [30, 800],
  },
  {
    code: "hdl_cholesterol",
    label: "HDL cholesterol",
    group: "lipid",
    canonicalUnit: "mg/dL",
    unitConversions: { "mmol/l": CHOLESTEROL_MMOL_TO_MG_DL },
    aliases: ["hdl cholesterol", "hdl", "hdl c", "high density lipoprotein", "hdl chol"],
    refLow: 40,
    refHigh: 100,
    plausible: [5, 200],
  },
  {
    code: "ldl_cholesterol",
    label: "LDL cholesterol",
    group: "lipid",
    canonicalUnit: "mg/dL",
    unitConversions: { "mmol/l": CHOLESTEROL_MMOL_TO_MG_DL },
    aliases: ["ldl cholesterol", "ldl", "ldl c", "low density lipoprotein", "ldl chol", "ldl calculated"],
    refLow: 0,
    refHigh: 100,
    plausible: [5, 600],
  },
  {
    code: "triglycerides",
    label: "Triglycerides",
    group: "lipid",
    canonicalUnit: "mg/dL",
    unitConversions: { "mmol/l": TRIGLYCERIDE_MMOL_TO_MG_DL },
    aliases: ["triglycerides", "triglyceride", "tg", "trig", "trigs"],
    refLow: 0,
    refHigh: 150,
    plausible: [10, 5000],
  },
  // ----------------------------------------------------------------- liver
  {
    code: "alt",
    label: "ALT (SGPT)",
    group: "liver",
    canonicalUnit: "U/L",
    aliases: ["alt", "sgpt", "alanine aminotransferase", "alanine transaminase", "alt sgpt", "sgpt alt"],
    refLow: 0,
    refHigh: 41,
    plausible: [1, 20000],
  },
  {
    code: "ast",
    label: "AST (SGOT)",
    group: "liver",
    canonicalUnit: "U/L",
    aliases: ["ast", "sgot", "aspartate aminotransferase", "aspartate transaminase", "ast sgot", "sgot ast"],
    refLow: 0,
    refHigh: 40,
    plausible: [1, 20000],
  },
  {
    code: "alp",
    label: "Alkaline phosphatase",
    group: "liver",
    canonicalUnit: "U/L",
    aliases: ["alp", "alkaline phosphatase", "alk phos", "alkaline phos"],
    refLow: 40,
    refHigh: 130,
    plausible: [5, 5000],
  },
  {
    code: "total_bilirubin",
    label: "Total bilirubin",
    group: "liver",
    canonicalUnit: "mg/dL",
    unitConversions: { "umol/l": 1 / 17.1, "µmol/l": 1 / 17.1 },
    aliases: ["total bilirubin", "bilirubin total", "t bilirubin", "t bil", "bilirubin"],
    refLow: 0.1,
    refHigh: 1.2,
    plausible: [0, 80],
  },
  {
    code: "albumin",
    label: "Albumin",
    group: "liver",
    canonicalUnit: "g/dL",
    unitConversions: { "g/l": 0.1 },
    aliases: ["albumin", "serum albumin", "s albumin", "alb"],
    refLow: 3.5,
    refHigh: 5.2,
    plausible: [0.5, 10],
  },
  // ----------------------------------------------------------- haematology
  {
    code: "haemoglobin",
    label: "Haemoglobin",
    group: "haematology",
    canonicalUnit: "g/dL",
    unitConversions: { "g/l": 0.1 },
    aliases: ["haemoglobin", "hemoglobin", "hb", "hgb", "haemoglobin concentration"],
    refBySex: { male: [13, 17], female: [12, 15] },
    plausible: [1, 25],
  },
  {
    code: "haematocrit",
    label: "Haematocrit (PCV)",
    group: "haematology",
    canonicalUnit: "percent",
    aliases: ["haematocrit", "hematocrit", "pcv", "hct", "packed cell volume"],
    refBySex: { male: [40, 52], female: [36, 46] },
    plausible: [5, 75],
  },
  {
    code: "wbc",
    label: "White cell count",
    group: "haematology",
    canonicalUnit: "10^9/L",
    // Nigerian reports print white cells either as 10^9/L (5.4) or as an
    // absolute count per microlitre (5400). Without these factors the second
    // form is refused as an unknown unit, which is most of the FBCs in the
    // country. 10^3/µL is numerically identical to 10^9/L.
    unitConversions: {
      "/ul": 0.001, "/µl": 0.001, "/mm3": 0.001, "/cumm": 0.001, "cells/ul": 0.001, "cells/µl": 0.001,
      "10^3/ul": 1, "10^3/µl": 1, "x10^3/ul": 1, "k/ul": 1, "10^9/l": 1, "x10^9/l": 1, "g/l": 1,
    },
    aliases: ["wbc", "white blood cell count", "white cell count", "total wbc", "leucocyte count", "leukocyte count", "twbc"],
    refLow: 4,
    refHigh: 11,
    plausible: [0.1, 500],
  },
  {
    code: "platelets",
    label: "Platelet count",
    group: "haematology",
    canonicalUnit: "10^9/L",
    // Same two printed forms as the white cell count: 250 x10^9/L or 250,000/µL.
    unitConversions: {
      "/ul": 0.001, "/µl": 0.001, "/mm3": 0.001, "/cumm": 0.001, "cells/ul": 0.001, "cells/µl": 0.001,
      "10^3/ul": 1, "10^3/µl": 1, "x10^3/ul": 1, "k/ul": 1, "10^9/l": 1, "x10^9/l": 1,
    },
    aliases: ["platelets", "platelet count", "plt", "thrombocyte count"],
    refLow: 150,
    refHigh: 400,
    plausible: [1, 3000],
  },
  // ----------------------------------------------------------- electrolyte
  {
    code: "sodium",
    label: "Sodium",
    group: "electrolyte",
    canonicalUnit: "mmol/L",
    aliases: ["sodium", "na", "na+", "serum sodium"],
    refLow: 135,
    refHigh: 145,
    plausible: [90, 200],
  },
  {
    code: "potassium",
    label: "Potassium",
    group: "electrolyte",
    canonicalUnit: "mmol/L",
    aliases: ["potassium", "k", "k+", "serum potassium"],
    refLow: 3.5,
    refHigh: 5.1,
    plausible: [1, 12],
  },
  {
    code: "chloride",
    label: "Chloride",
    group: "electrolyte",
    canonicalUnit: "mmol/L",
    aliases: ["chloride", "cl", "cl-", "serum chloride"],
    refLow: 98,
    refHigh: 107,
    plausible: [50, 180],
  },
  {
    code: "bicarbonate",
    label: "Bicarbonate",
    group: "electrolyte",
    canonicalUnit: "mmol/L",
    aliases: ["bicarbonate", "hco3", "hco3-", "co2", "total co2", "serum bicarbonate"],
    refLow: 22,
    refHigh: 29,
    plausible: [3, 60],
  },
  // --------------------------------------------------------------- thyroid
  {
    code: "tsh",
    label: "TSH",
    group: "thyroid",
    canonicalUnit: "mIU/L",
    aliases: ["tsh", "thyroid stimulating hormone", "thyrotropin"],
    refLow: 0.4,
    refHigh: 4.0,
    plausible: [0.001, 500],
  },
  {
    code: "free_t4",
    label: "Free T4",
    group: "thyroid",
    canonicalUnit: "ng/dL",
    unitConversions: { "pmol/l": 1 / 12.87 },
    aliases: ["free t4", "ft4", "free thyroxine", "t4 free"],
    refLow: 0.8,
    refHigh: 1.8,
    plausible: [0.01, 20],
  },
  // ----------------------------------------------------------------- other
  {
    code: "psa",
    label: "PSA",
    group: "other",
    canonicalUnit: "ng/mL",
    aliases: ["psa", "prostate specific antigen", "total psa", "prostatic specific antigen"],
    refLow: 0,
    refHigh: 4,
    plausible: [0, 5000],
  },
  {
    code: "uric_acid",
    label: "Uric acid",
    group: "other",
    canonicalUnit: "mg/dL",
    unitConversions: { "umol/l": 1 / 59.48, "µmol/l": 1 / 59.48 },
    aliases: ["uric acid", "urate", "serum uric acid"],
    refLow: 3.5,
    refHigh: 7.2,
    plausible: [0.1, 40],
  },

  // =========================================================================
  // Widened for the Nigerian panel set.
  //
  // The catalogue above reads a chronic-disease monitoring panel well. The
  // tests Nigerians actually walk out of a laboratory holding are FBC with a
  // differential, malaria, E/U/Cr, LFT, genotype and urinalysis. Everything
  // below closes that gap: the numeric half here, the non-numeric half in
  // QUALITATIVE_CATALOGUE.
  // =========================================================================

  // ------------------------------------------------- haematology (full FBC)
  {
    code: "rbc",
    label: "Red cell count",
    group: "haematology",
    canonicalUnit: "10^12/L",
    // Older analysers print an absolute count per microlitre.
    unitConversions: { "/ul": 1e-6, "/mm3": 1e-6, "/cumm": 1e-6, "10^6/ul": 1, "m/ul": 1 },
    aliases: ["rbc", "red blood cell count", "red cell count", "erythrocyte count", "rbc count"],
    refBySex: { male: [4.5, 5.9], female: [4.0, 5.2] },
    plausible: [0.5, 12],
  },
  {
    code: "mcv",
    label: "MCV",
    group: "haematology",
    canonicalUnit: "fL",
    aliases: ["mcv", "mean cell volume", "mean corpuscular volume"],
    refLow: 80,
    refHigh: 100,
    plausible: [30, 160],
  },
  {
    code: "mch",
    label: "MCH",
    group: "haematology",
    canonicalUnit: "pg",
    aliases: ["mch", "mean cell haemoglobin", "mean cell hemoglobin", "mean corpuscular haemoglobin", "mean corpuscular hemoglobin"],
    refLow: 27,
    refHigh: 33,
    plausible: [10, 60],
  },
  {
    code: "mchc",
    label: "MCHC",
    group: "haematology",
    canonicalUnit: "g/dL",
    unitConversions: { "g/l": 0.1 },
    aliases: ["mchc", "mean cell haemoglobin concentration", "mean corpuscular haemoglobin concentration", "mean corpuscular hemoglobin concentration"],
    refLow: 32,
    refHigh: 36,
    plausible: [15, 45],
  },
  {
    code: "neutrophils_pct",
    label: "Neutrophils",
    group: "haematology",
    canonicalUnit: "percent",
    aliases: ["neutrophils", "neutrophil", "neut", "polymorphs", "segmented neutrophils"],
    refLow: 40,
    refHigh: 75,
    plausible: [0, 100],
  },
  {
    code: "lymphocytes_pct",
    label: "Lymphocytes",
    group: "haematology",
    canonicalUnit: "percent",
    aliases: ["lymphocytes", "lymphocyte", "lymph", "lymphs"],
    refLow: 20,
    refHigh: 45,
    plausible: [0, 100],
  },
  {
    code: "eosinophils_pct",
    label: "Eosinophils",
    group: "haematology",
    canonicalUnit: "percent",
    aliases: ["eosinophils", "eosinophil", "eos"],
    refLow: 1,
    refHigh: 6,
    plausible: [0, 100],
  },
  {
    code: "monocytes_pct",
    label: "Monocytes",
    group: "haematology",
    canonicalUnit: "percent",
    aliases: ["monocytes", "monocyte", "mono", "monos"],
    refLow: 2,
    refHigh: 10,
    plausible: [0, 100],
  },
  {
    code: "esr",
    label: "ESR",
    group: "haematology",
    canonicalUnit: "mm/hr",
    aliases: ["esr", "erythrocyte sedimentation rate", "sed rate"],
    refLow: 0,
    refHigh: 20,
    plausible: [0, 200],
  },
  {
    code: "malaria_parasitaemia",
    label: "Malaria parasite density",
    group: "haematology",
    canonicalUnit: "/uL",
    aliases: ["parasite density", "parasitaemia", "parasitemia", "parasite count", "malaria parasite density"],
    // Deliberately no orientation band: "normal" here is the absence of the
    // result entirely, which a low/high pair cannot express. The clinical
    // reading (any parasite is abnormal; 100,000/uL is the WHO severe-malaria
    // threshold) lives in reference-ranges.ts.
    plausible: [0, 2000000],
  },

  // ------------------------------------------------------------ liver (LFT)
  {
    code: "ggt",
    label: "GGT",
    group: "liver",
    canonicalUnit: "U/L",
    aliases: ["ggt", "gamma gt", "gamma glutamyl transferase", "gamma glutamyl transpeptidase"],
    refLow: 0,
    refHigh: 55,
    plausible: [1, 5000],
  },
  {
    code: "direct_bilirubin",
    label: "Direct bilirubin",
    group: "liver",
    canonicalUnit: "mg/dL",
    unitConversions: { "umol/l": 1 / 17.1, "µmol/l": 1 / 17.1 },
    aliases: ["direct bilirubin", "conjugated bilirubin", "bilirubin direct", "d bilirubin"],
    refLow: 0,
    refHigh: 0.3,
    plausible: [0.01, 40],
  },
  {
    code: "total_protein",
    label: "Total protein",
    group: "liver",
    canonicalUnit: "g/dL",
    unitConversions: { "g/l": 0.1 },
    aliases: ["total protein", "protein total", "t protein", "serum total protein"],
    refLow: 6.4,
    refHigh: 8.3,
    plausible: [1, 15],
  },

  // ---------------------------------------------------------------- thyroid
  {
    code: "free_t3",
    label: "Free T3",
    group: "thyroid",
    canonicalUnit: "pg/mL",
    unitConversions: { "pmol/l": 1 / 1.536 },
    aliases: ["free t3", "ft3", "free triiodothyronine", "t3 free"],
    refLow: 2.3,
    refHigh: 4.2,
    plausible: [0.2, 40],
  },

  // ----------------------------------------------- haematinics / deficiency
  {
    code: "ferritin",
    label: "Ferritin",
    group: "other",
    canonicalUnit: "ng/mL",
    unitConversions: { "ug/l": 1, "µg/l": 1, "mcg/l": 1 },
    aliases: ["ferritin", "serum ferritin"],
    refLow: 15,
    refHigh: 300,
    plausible: [0.5, 40000],
  },
  {
    code: "vitamin_b12",
    label: "Vitamin B12",
    group: "other",
    canonicalUnit: "pg/mL",
    unitConversions: { "pmol/l": 1 / 0.738, "ng/l": 1 },
    aliases: ["vitamin b12", "b12", "cobalamin", "vit b12"],
    refLow: 200,
    refHigh: 900,
    plausible: [20, 20000],
  },
  {
    code: "folate",
    label: "Folate",
    group: "other",
    canonicalUnit: "ng/mL",
    unitConversions: { "nmol/l": 1 / 2.266, "ug/l": 1, "µg/l": 1 },
    aliases: ["folate", "folic acid", "serum folate", "red cell folate"],
    refLow: 4,
    refHigh: 20,
    plausible: [0.2, 100],
  },
  {
    code: "vitamin_d",
    label: "Vitamin D (25-OH)",
    group: "other",
    canonicalUnit: "ng/mL",
    unitConversions: { "nmol/l": 1 / 2.496 },
    aliases: ["vitamin d", "25 oh vitamin d", "25 hydroxy vitamin d", "vit d", "25 ohd", "vitamin d total"],
    refLow: 30,
    refHigh: 100,
    plausible: [1, 200],
  },
  {
    code: "crp",
    label: "CRP",
    group: "other",
    canonicalUnit: "mg/L",
    unitConversions: { "mg/dl": 10 },
    aliases: ["crp", "c reactive protein", "hs crp", "high sensitivity crp"],
    refLow: 0,
    refHigh: 5,
    plausible: [0.05, 1000],
  },
] as const;

/**
 * Non-HDL is derived, never extracted — a report does not print it, and
 * `computeNonHdl` already owns the derivation. Listed so trend/display code can
 * ask the catalogue about it without it ever becoming an extraction target.
 */
export const DERIVED_ANALYTE_CODES = ["non_hdl_cholesterol"] as const;

// ===========================================================================
// Non-numeric results
//
// A genotype is "AS". A malaria film is "positive". A urine dipstick is "2+".
// None of those are numbers, and every one of them is a result a Nigerian
// doctor acts on — genotype and malaria are among the highest-volume tests in
// the country. A catalogue that can only hold numbers cannot read the report
// in the patient's hand.
//
// These are kept in a SEPARATE list from ANALYTE_CATALOGUE rather than given a
// `kind` discriminator on the shared type, so that every existing consumer of
// AnalyteDefinition (convertToCanonical, orientationRange, the plausibility
// guard) keeps its current type and cannot be handed a row it has no unit or
// numeric band for.
// ===========================================================================

export interface QualitativeAnalyteDefinition {
  /** Stable code written to lab_analyte_readings.code. Never rename. */
  code: string;
  label: string;
  group: AnalyteGroup;
  /** The coded results this analyte may take, stored verbatim in value_text. */
  values: readonly string[];
  /** Row labels a report may print. Same matching rules as the numeric aliases. */
  aliases: readonly string[];
  /**
   * What a lab may print for the RESULT, folded to one of `values`. Keys are
   * normalised by `normaliseLabel` before lookup. Anything not listed resolves
   * to null and the row is surfaced as unreadable rather than guessed — the
   * same refusal-to-guess rule the numeric side applies to unknown units.
   */
  valueAliases: Readonly<Record<string, string>>;
}

/** Positive/negative wording shared by every serology and film result. */
const POSITIVE_NEGATIVE: Record<string, string> = {
  positive: "positive", "+ve": "positive", "+": "positive", reactive: "positive",
  detected: "positive", present: "positive", seen: "positive", pos: "positive",
  negative: "negative", "-ve": "negative", "-": "negative", "non reactive": "negative",
  nonreactive: "negative", "not detected": "negative", "not seen": "negative",
  absent: "negative", nil: "negative", neg: "negative", "no growth": "negative",
};

/** Dipstick grading, which reports print as words, plusses, or both. */
const DIPSTICK: Record<string, string> = {
  negative: "negative", nil: "negative", "-ve": "negative", "-": "negative",
  absent: "negative", none: "negative", neg: "negative",
  trace: "trace", tr: "trace",
  "1+": "1+", "+": "1+", "2+": "2+", "++": "2+",
  "3+": "3+", "+++": "3+", "4+": "4+", "++++": "4+",
};

const DIPSTICK_VALUES = ["negative", "trace", "1+", "2+", "3+", "4+"] as const;

export const QUALITATIVE_CATALOGUE: readonly QualitativeAnalyteDefinition[] = [
  {
    code: "genotype",
    label: "Haemoglobin genotype",
    group: "haematology",
    values: ["AA", "AS", "AC", "SS", "SC", "CC", "S-beta-thal"],
    aliases: ["genotype", "haemoglobin genotype", "hemoglobin genotype", "hb genotype", "haemoglobin electrophoresis", "hemoglobin electrophoresis", "hb electrophoresis"],
    valueAliases: {
      aa: "AA", "hb aa": "AA", as: "AS", "hb as": "AS", "a s": "AS",
      ac: "AC", "hb ac": "AC", ss: "SS", "hb ss": "SS", "s s": "SS",
      sc: "SC", "hb sc": "SC", cc: "CC", "hb cc": "CC",
      "s beta thal": "S-beta-thal", "s beta thalassaemia": "S-beta-thal",
      "s beta thalassemia": "S-beta-thal", sbthal: "S-beta-thal",
    },
  },
  {
    code: "blood_group",
    label: "Blood group",
    group: "haematology",
    values: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    aliases: ["blood group", "abo group", "blood grouping", "abo and rhesus", "group and rhesus", "abo rh"],
    valueAliases: {
      "a positive": "A+", "a pos": "A+", "a+": "A+", "a rh positive": "A+", "a rhesus positive": "A+",
      "a negative": "A-", "a neg": "A-", "a-": "A-", "a rh negative": "A-",
      "b positive": "B+", "b pos": "B+", "b+": "B+", "b rh positive": "B+",
      "b negative": "B-", "b neg": "B-", "b-": "B-", "b rh negative": "B-",
      "ab positive": "AB+", "ab pos": "AB+", "ab+": "AB+", "ab rh positive": "AB+",
      "ab negative": "AB-", "ab neg": "AB-", "ab-": "AB-", "ab rh negative": "AB-",
      "o positive": "O+", "o pos": "O+", "o+": "O+", "o rh positive": "O+",
      "o negative": "O-", "o neg": "O-", "o-": "O-", "o rh negative": "O-",
    },
  },
  {
    code: "malaria_parasite",
    label: "Malaria parasite",
    group: "haematology",
    values: ["positive", "negative"],
    aliases: ["malaria parasite", "malaria parasites", "mp", "mps", "blood film for mp", "bf for mp", "malaria", "malaria rdt", "thick film", "thick blood film"],
    valueAliases: {
      ...POSITIVE_NEGATIVE,
      "malaria parasite seen": "positive", "parasite seen": "positive",
      "no malaria parasite seen": "negative", "no parasite seen": "negative",
      "++": "positive", "+++": "positive",
    },
  },
  {
    code: "hepatitis_b_surface_antigen",
    label: "Hepatitis B surface antigen",
    group: "other",
    values: ["positive", "negative"],
    aliases: ["hbsag", "hbs ag", "hepatitis b surface antigen", "hepatitis b", "hep b"],
    valueAliases: POSITIVE_NEGATIVE,
  },
  {
    code: "hepatitis_c_antibody",
    label: "Hepatitis C antibody",
    group: "other",
    values: ["positive", "negative"],
    aliases: ["hcv", "anti hcv", "hcv ab", "hepatitis c antibody", "hepatitis c", "hep c"],
    valueAliases: POSITIVE_NEGATIVE,
  },
  {
    code: "urine_protein",
    label: "Urine protein",
    group: "urinalysis",
    values: DIPSTICK_VALUES,
    aliases: ["urine protein", "protein urine", "urinalysis protein", "urine albumin"],
    valueAliases: { ...DIPSTICK, "30 mg/dl": "1+", "100 mg/dl": "2+", "300 mg/dl": "3+" },
  },
  {
    code: "urine_glucose",
    label: "Urine glucose",
    group: "urinalysis",
    values: DIPSTICK_VALUES,
    aliases: ["urine glucose", "glucose urine", "urinalysis glucose", "urine sugar"],
    valueAliases: DIPSTICK,
  },
  {
    code: "urine_blood",
    label: "Urine blood",
    group: "urinalysis",
    values: DIPSTICK_VALUES,
    aliases: ["urine blood", "blood urine", "urinalysis blood", "haematuria", "hematuria", "occult blood"],
    valueAliases: DIPSTICK,
  },
  {
    code: "urine_leukocytes",
    label: "Urine leucocytes",
    group: "urinalysis",
    values: DIPSTICK_VALUES,
    aliases: ["urine leukocytes", "urine leucocytes", "leukocyte esterase", "urinalysis leukocytes", "pus cells"],
    valueAliases: DIPSTICK,
  },
  {
    code: "urine_nitrite",
    label: "Urine nitrite",
    group: "urinalysis",
    values: ["negative", "positive"],
    aliases: ["urine nitrite", "nitrite", "nitrites", "urinalysis nitrite"],
    valueAliases: POSITIVE_NEGATIVE,
  },
  {
    code: "urine_ketones",
    label: "Urine ketones",
    group: "urinalysis",
    values: DIPSTICK_VALUES,
    aliases: ["urine ketones", "ketones", "ketone bodies", "urinalysis ketones", "acetone"],
    valueAliases: DIPSTICK,
  },
] as const;

const BY_CODE = new Map(ANALYTE_CATALOGUE.map((a) => [a.code, a]));
const QUALITATIVE_BY_CODE = new Map(QUALITATIVE_CATALOGUE.map((a) => [a.code, a]));

export function getQualitativeAnalyte(code: string): QualitativeAnalyteDefinition | undefined {
  return QUALITATIVE_BY_CODE.get(code);
}

export function isQualitativeCode(code: string): boolean {
  return QUALITATIVE_BY_CODE.has(code);
}

export function getAnalyte(code: string): AnalyteDefinition | undefined {
  return BY_CODE.get(code);
}

export function isKnownAnalyteCode(code: string): boolean {
  return BY_CODE.has(code) || QUALITATIVE_BY_CODE.has(code);
}

/** Lower-case, strip punctuation, collapse whitespace. */
function normaliseLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[._():/\\,;*#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lower-case and strip spaces/dots so "µmol / L" and "umol/l" both match.
 *
 * "percent" folds to "%" because several analytes declare `canonicalUnit:
 * "percent"` (HbA1c, PCV, every differential) while every report on earth
 * prints the symbol. Without this fold the two never compared equal, no
 * conversion factor existed for "%", and every percentage on every report was
 * refused as an unknown unit — including HbA1c, silently, since this engine
 * shipped. Found by the corpus harness on its first real run.
 */
export function normaliseUnit(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/[\s.]+/g, "")
    .replace(/μ/g, "µ")
    .replace(/^percent$/, "%");
}

/**
 * Alias index, built longest-alias-first so a specific name always beats a
 * generic substring: "hdl cholesterol" must not resolve to `total_cholesterol`
 * via the bare "cholesterol" alias. That single ordering rule is the difference
 * between a correct lipid panel and a silently wrong one.
 */
const ALIAS_INDEX: { alias: string; code: string }[] = [
  ...ANALYTE_CATALOGUE.flatMap((a) =>
    a.aliases.map((alias) => ({ alias: normaliseLabel(alias), code: a.code })),
  ),
  // Qualitative rows resolve through the same index, so a report mixing an FBC
  // with a genotype and a urinalysis is read by one pass rather than two.
  ...QUALITATIVE_CATALOGUE.flatMap((a) =>
    a.aliases.map((alias) => ({ alias: normaliseLabel(alias), code: a.code })),
  ),
].sort((x, y) => y.alias.length - x.alias.length);

/**
 * Compact form — every non-alphanumeric removed, no space inserted. This is
 * what makes dotted abbreviations resolve: reports routinely print "A.L.P.",
 * "S.G.P.T." and "T. Bilirubin", which the spaced form turns into "a l p" and
 * matches nothing.
 */
function compactLabel(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const COMPACT_INDEX = new Map<string, string>();
for (const entry of ALIAS_INDEX) {
  const key = compactLabel(entry.alias);
  // Longest alias wins, matching ALIAS_INDEX's ordering, so a specific name
  // still beats a generic one after compaction.
  if (!COMPACT_INDEX.has(key)) COMPACT_INDEX.set(key, entry.code);
}

/**
 * Resolve whatever a report called a row back to a catalogue code.
 *
 * Exact alias match, then exact compact match (dotted abbreviations), then a
 * whole-word containment match so "Serum Creatinine (fasting)" still resolves.
 * Returns null when nothing matches — an unrecognised row is surfaced to the
 * reviewing clinician as unmapped, never guessed into the nearest code.
 */
export function resolveAnalyteCode(reportLabel: string): string | null {
  const label = normaliseLabel(reportLabel);
  if (!label) return null;

  for (const entry of ALIAS_INDEX) {
    if (entry.alias === label) return entry.code;
  }

  const compact = COMPACT_INDEX.get(compactLabel(reportLabel));
  if (compact) return compact;

  for (const entry of ALIAS_INDEX) {
    // Whole-word boundary check — prevents "k" (potassium) matching inside
    // "kidney", and "cr" matching inside "creatinine clearance".
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(entry.alias)}($|\\s)`);
    if (pattern.test(label)) return entry.code;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type UnitConversion =
  | { ok: true; value: number; converted: boolean }
  | { ok: false; reason: "unknown_unit" | "implausible" };

/**
 * Convert a reported value into the analyte's canonical unit.
 *
 * Deliberately strict: an unrecognised unit is refused rather than assumed to
 * be canonical. A creatinine of 90 is normal in µmol/L and end-stage renal
 * failure in mg/dL, so guessing here would be the single most dangerous thing
 * this file could do. An unrecognised unit surfaces to the reviewer instead.
 *
 * An empty/absent unit IS accepted as canonical — many Nigerian reports print
 * the unit once in a column header the extractor cannot attach per-row — but
 * the value must then still pass the plausibility band, which is what catches
 * a µmol/L creatinine that arrived with no unit at all.
 */
export function convertToCanonical(
  code: string,
  value: number,
  reportedUnit: string | null | undefined,
): UnitConversion {
  const analyte = getAnalyte(code);
  if (!analyte) return { ok: false, reason: "unknown_unit" };

  const unit = normaliseUnit(reportedUnit);
  const canonical = normaliseUnit(analyte.canonicalUnit);

  let converted = value;
  let didConvert = false;

  if (unit && unit !== canonical) {
    if (code === "hba1c" && (unit === "mmol/mol" || unit === "mmolmol")) {
      // IFCC → DCCT is affine, not a scale factor.
      converted = value / 10.929 + 2.15;
      didConvert = true;
    } else {
      const factorKey = Object.keys(analyte.unitConversions ?? {}).find(
        (k) => normaliseUnit(k) === unit,
      );
      if (factorKey === undefined) return { ok: false, reason: "unknown_unit" };
      converted = value * (analyte.unitConversions as Record<string, number>)[factorKey];
      didConvert = true;
    }
  }

  const rounded = Math.round(converted * 1000) / 1000;
  const [low, high] = analyte.plausible;
  if (rounded < low || rounded > high) return { ok: false, reason: "implausible" };

  return { ok: true, value: rounded, converted: didConvert };
}

/**
 * The rough adult reference band for review-screen orientation only, sex-aware
 * where the catalogue defines one. NEVER a clinical classification — nothing
 * downstream may branch on this to raise an alert or tell a patient anything.
 */
export function orientationRange(
  code: string,
  sex?: string | null,
): { low: number; high: number } | null {
  const analyte = getAnalyte(code);
  if (!analyte) return null;
  if (analyte.refBySex) {
    const key = sex === "male" || sex === "female" ? sex : null;
    if (!key) return null;
    const [low, high] = analyte.refBySex[key];
    return { low, high };
  }
  if (analyte.refLow === undefined || analyte.refHigh === undefined) return null;
  return { low: analyte.refLow, high: analyte.refHigh };
}

/** Every extractable code, for prompting the vision model with a closed vocabulary. */
export function extractableCodes(): string[] {
  return [
    ...ANALYTE_CATALOGUE.map((a) => a.code),
    ...QUALITATIVE_CATALOGUE.map((a) => a.code),
  ];
}

/**
 * Fold a printed qualitative result to one of the analyte's coded values.
 *
 * "Reactive", "+ve", "NO MALARIA PARASITE SEEN" and "Hb AS" all have to land on
 * a stable code, because a trend, a care plan and a genotype-driven alert all
 * compare strings. Returns null for wording the catalogue does not know, and
 * the row is surfaced to the reviewing clinician rather than guessed — the same
 * refusal that `convertToCanonical` applies to an unrecognised unit, and for
 * the same reason: a wrong genotype is worse than a missing one.
 */
export function resolveQualitativeValue(code: string, reported: string): string | null {
  const analyte = QUALITATIVE_BY_CODE.get(code);
  if (!analyte) return null;

  const raw = (reported ?? "").trim();
  if (!raw) return null;

  // An already-coded value passes through, case-insensitively.
  const exact = analyte.values.find((v) => v.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;

  const normalised = normaliseLabel(raw);
  if (analyte.valueAliases[normalised]) return analyte.valueAliases[normalised]!;

  // Plus-grades survive normaliseLabel intact, but a bare "+" or "++" arrives
  // with surrounding punctuation stripped, so try the raw form too.
  const compact = raw.toLowerCase().replace(/\s+/g, "");
  return analyte.valueAliases[compact] ?? null;
}
