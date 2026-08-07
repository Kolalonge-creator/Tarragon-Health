/**
 * Clinical classification for extracted lab values.
 *
 * WHY THIS IS SEPARATE FROM THE CATALOGUE
 * analyte-catalogue.ts is deliberate about its `refLow`/`refHigh` being
 * ORIENTATION ONLY — "never used to classify a result, raise an alert, or tell
 * a patient anything". That stance is kept exactly as written; nothing in this
 * file reads those fields. This module is a separate, explicit clinical layer
 * with its own sourced thresholds, and it exists for one narrowly-scoped
 * purpose: deciding whether an unconfirmed machine reading looks critical
 * enough to move the review alert that ALREADY EXISTS further up a doctor's
 * queue, and to colour the review screen while they look at it.
 *
 * WHAT IT MUST NEVER DRIVE, and does not:
 *   * a screening_results row or an abnormal flag — that stays a clinical act
 *     performed by a doctor through the screening-result form;
 *   * anything a patient sees or is told;
 *   * a value written to the record. Classification never changes a number.
 *
 * So the worst this can do when it is wrong is put a normal result in front of
 * a doctor two hours sooner than it deserved. That asymmetry is the whole
 * reason it is allowed to exist at all, and it is why the thresholds below are
 * the "call someone today" kind, not the "slightly out of range" kind.
 *
 * SOURCES
 *   ADA. Standards of Care in Diabetes 2024. Diabetes Care 2024;47(S1):S20-S42.
 *   NCEP ATP III. JAMA 2001;285(19):2486-2497.
 *   WHO. Haemoglobin concentrations for the diagnosis of anaemia, 2011.
 *   WHO. Guidelines for the treatment of malaria, 3rd ed., 2015.
 *   Inker LA et al. NEJM 2021;385:1737-1749 (CKD-EPI 2021, race-free).
 *   KDIGO 2024 CKD Guideline. Kidney Int 2024;105(4S):S117-S314.
 *   Adult chemistry and haematology intervals otherwise follow Tietz Textbook
 *   of Clinical Chemistry, 6th ed., which Nigerian laboratory handbooks cite.
 *
 * ON "NIGERIAN" RANGES
 * For metabolic analytes there is no separate Nigerian threshold to use:
 * Nigeria's FMoH NCD guidance adopts the WHO/ADA and NCEP cut-offs directly.
 * Where local epidemiology genuinely changes how a number should be READ —
 * anaemia against a malaria-endemic background, eosinophilia against endemic
 * helminths, haematuria against urinary schistosomiasis — that is attached as
 * a note for the reviewing doctor rather than by quietly moving a threshold.
 * Moving a threshold hides a judgement; a note surfaces it to the person
 * making one.
 */

export type AnalyteStatus = "normal" | "borderline" | "abnormal" | "critical";

export const STATUS_SEVERITY: Record<AnalyteStatus, number> = {
  normal: 0,
  borderline: 1,
  abnormal: 2,
  critical: 3,
};

export interface PatientContext {
  sex: "male" | "female" | null;
  ageYears: number | null;
}

export interface Interpretation {
  status: AnalyteStatus;
  direction: "low" | "high" | null;
  /** Local-epidemiology or interpretation caveat, for the reviewing doctor. */
  note?: string;
}

/**
 * A normal band and the bands either side of it.
 *
 * `low`/`high` bound normal inclusively. Beyond `borderlineLow`/
 * `borderlineHigh` in the outward direction is abnormal; between the normal
 * edge and the borderline edge is borderline. Beyond `criticalLow`/
 * `criticalHigh` is critical. Null means unbounded on that side — HDL has no
 * upper limit worth flagging, ESR no meaningful lower one.
 */
interface Band {
  low: number | null;
  high: number | null;
  borderlineLow?: number | null;
  borderlineHigh?: number | null;
  criticalLow?: number | null;
  criticalHigh?: number | null;
  note?: string;
}

const female = (ctx: PatientContext) => ctx.sex === "female";

/** Keyed by analyte-catalogue.ts codes. */
const BANDS: Record<string, (ctx: PatientContext) => Band> = {
  // -- Glycaemic ------------------------------------------------------------
  hba1c: () => ({ low: null, high: 5.6, borderlineHigh: 6.4 }),
  fasting_glucose: () => ({
    low: 70, high: 99, borderlineHigh: 125, criticalLow: 54, criticalHigh: 400,
  }),
  random_glucose: () => ({
    low: 70, high: 139, borderlineHigh: 199, criticalLow: 54, criticalHigh: 400,
  }),
  ogtt_2h_glucose: () => ({
    low: 70, high: 139, borderlineHigh: 199, criticalLow: 54, criticalHigh: 400,
  }),

  // -- Lipids (NCEP ATP III) ------------------------------------------------
  total_cholesterol: () => ({ low: null, high: 199, borderlineHigh: 239 }),
  ldl_cholesterol: () => ({ low: null, high: 129, borderlineHigh: 159 }),
  hdl_cholesterol: (ctx) => ({ low: female(ctx) ? 50 : 40, high: null }),
  triglycerides: () => ({
    low: null, high: 149, borderlineHigh: 199,
    criticalHigh: 500, // pancreatitis risk
  }),

  // -- Haematology ----------------------------------------------------------
  haemoglobin: (ctx) => ({
    low: female(ctx) ? 12 : 13,
    high: female(ctx) ? 16 : 17,
    borderlineLow: female(ctx) ? 11 : 12,
    criticalLow: 7, // transfusion is usually considered at or below this
    note: "In a malaria-endemic population a mildly low haemoglobin is common and is read alongside the malaria result and the red-cell indices, not on its own. The pregnancy threshold (11.0 g/dL) is lower than the one used here.",
  }),
  haematocrit: (ctx) => ({
    low: female(ctx) ? 36 : 40,
    high: female(ctx) ? 46 : 52,
    borderlineLow: female(ctx) ? 33 : 36,
    criticalLow: 21,
  }),
  wbc: () => ({ low: 4, high: 11, criticalLow: 1, criticalHigh: 30 }),
  platelets: () => ({
    low: 150, high: 400, borderlineLow: 100, criticalLow: 50, criticalHigh: 1000,
  }),
  rbc: (ctx) => ({ low: female(ctx) ? 4.0 : 4.5, high: female(ctx) ? 5.2 : 5.9 }),
  neutrophils_pct: () => ({ low: 40, high: 75 }),
  lymphocytes_pct: () => ({ low: 20, high: 45 }),
  monocytes_pct: () => ({ low: 2, high: 10 }),
  eosinophils_pct: () => ({
    low: 1, high: 6, borderlineHigh: 10,
    note: "A raised eosinophil count is common in Nigeria and often reflects intestinal helminths rather than allergy or a haematological cause.",
  }),
  mcv: () => ({ low: 80, high: 100 }),
  mch: () => ({ low: 27, high: 33 }),
  mchc: () => ({ low: 32, high: 36 }),
  esr: (ctx) => ({
    low: null, high: female(ctx) ? 20 : 15, borderlineHigh: female(ctx) ? 40 : 30,
    note: "ESR is non-specific and rises with anaemia, pregnancy and any infection. It is read in context, never alone.",
  }),
  malaria_parasitaemia: () => ({
    low: null, high: 0, borderlineHigh: 0,
    criticalHigh: 100000, // WHO hyperparasitaemia threshold for severe malaria
    note: "At or above 100,000 parasites per microlitre this meets the WHO hyperparasitaemia threshold for severe malaria.",
  }),

  // -- Renal ----------------------------------------------------------------
  creatinine: (ctx) => ({
    low: female(ctx) ? 0.6 : 0.7,
    high: female(ctx) ? 1.1 : 1.3,
    borderlineHigh: female(ctx) ? 1.4 : 1.6,
    criticalHigh: 4,
    note: "Kidney function is judged on the estimated GFR rather than the creatinine alone. A creatinine inside the range can still sit with a reduced eGFR in an older or smaller patient.",
  }),
  urea: () => ({ low: 15, high: 45, borderlineHigh: 60, criticalHigh: 150 }),
  bun: () => ({ low: 7, high: 20, borderlineHigh: 28, criticalHigh: 70 }),
  urine_acr: () => ({ low: null, high: 30, borderlineHigh: 300 }),
  uric_acid: (ctx) => ({
    low: female(ctx) ? 2.4 : 3.4,
    high: female(ctx) ? 6.0 : 7.0,
    borderlineHigh: female(ctx) ? 7.5 : 8.5,
  }),

  // -- Electrolytes ---------------------------------------------------------
  sodium: () => ({
    low: 135, high: 145, borderlineLow: 130, borderlineHigh: 150,
    criticalLow: 120, criticalHigh: 160,
  }),
  potassium: () => ({
    low: 3.5, high: 5.1, borderlineLow: 3.0, borderlineHigh: 5.5,
    criticalLow: 2.5,
    criticalHigh: 6.5, // arrhythmia risk: a same-day call
  }),
  chloride: () => ({ low: 98, high: 107 }),
  bicarbonate: () => ({ low: 22, high: 29, criticalLow: 10 }),

  // -- Liver ----------------------------------------------------------------
  alt: (ctx) => ({
    low: null, high: female(ctx) ? 33 : 41, borderlineHigh: female(ctx) ? 66 : 82,
    criticalHigh: 400, // ~10x upper limit: acute hepatocellular injury
  }),
  ast: (ctx) => ({
    low: null, high: female(ctx) ? 32 : 40, borderlineHigh: female(ctx) ? 64 : 80,
    criticalHigh: 400,
  }),
  alp: () => ({ low: 40, high: 130, borderlineHigh: 200 }),
  ggt: (ctx) => ({
    low: null, high: female(ctx) ? 38 : 55, borderlineHigh: female(ctx) ? 76 : 110,
  }),
  total_bilirubin: () => ({ low: null, high: 1.2, borderlineHigh: 2.0, criticalHigh: 15 }),
  direct_bilirubin: () => ({ low: null, high: 0.3, borderlineHigh: 0.6 }),
  albumin: () => ({ low: 3.5, high: 5.2, borderlineLow: 3.0, criticalLow: 2.0 }),
  total_protein: () => ({ low: 6.4, high: 8.3 }),

  // -- Thyroid --------------------------------------------------------------
  tsh: () => ({
    low: 0.4, high: 4.0, borderlineLow: 0.1, borderlineHigh: 10,
    criticalLow: 0.01, criticalHigh: 100,
  }),
  free_t4: () => ({ low: 0.8, high: 1.8 }),
  free_t3: () => ({ low: 2.3, high: 4.2 }),

  // -- Other ----------------------------------------------------------------
  ferritin: (ctx) => ({
    low: female(ctx) ? 15 : 30,
    high: female(ctx) ? 150 : 400,
    note: "Ferritin is an acute-phase reactant: it can read normal or high in genuine iron deficiency when there is concurrent infection or inflammation, which is common alongside malaria.",
  }),
  vitamin_b12: () => ({ low: 200, high: 900, borderlineLow: 300 }),
  folate: () => ({ low: 4, high: null, borderlineLow: 3 }),
  vitamin_d: () => ({ low: 30, high: 100, borderlineLow: 20 }),
  crp: () => ({ low: null, high: 5, borderlineHigh: 10 }),
  psa: (ctx) => {
    // Age-banded upper limits (Oesterling 1993), falling back to the widely
    // used 4.0 ng/mL cut-off when the age is unknown.
    const age = ctx.ageYears;
    const high = age === null ? 4.0 : age < 50 ? 2.5 : age < 60 ? 3.5 : age < 70 ? 4.5 : 6.5;
    return {
      low: null,
      high,
      borderlineHigh: high * 2.5,
      note: "PSA is a shared-decision test. A raised value has many benign causes and is interpreted with examination and, where appropriate, repeat testing.",
    };
  },
};

/** Qualitative results, keyed by code then by coded value. */
const QUALITATIVE: Record<
  string,
  { status: Record<string, AnalyteStatus>; fallback: AnalyteStatus; note?: string }
> = {
  malaria_parasite: {
    status: { negative: "normal", positive: "abnormal" },
    fallback: "normal",
    note: "A negative film does not exclude malaria in a symptomatic patient; a repeat film or a rapid diagnostic test may still be indicated.",
  },
  genotype: {
    status: { AA: "normal", AS: "borderline", AC: "borderline", SS: "abnormal", SC: "abnormal", CC: "abnormal", "S-beta-thal": "abnormal" },
    fallback: "borderline",
    note: "Genotype is a lifelong result. AS and AC are carrier states that matter for family planning rather than for the patient's own health. A newly reported SS, SC or S-beta-thalassaemia is a sickling disorder and warrants review even when the patient feels well.",
  },
  // A blood group is an identity fact, never normal or abnormal.
  blood_group: { status: {}, fallback: "normal" },
  hepatitis_b_surface_antigen: {
    status: { negative: "normal", positive: "abnormal" },
    fallback: "normal",
    note: "A positive surface antigen needs confirmation and staging before anything is said to the patient about chronic infection.",
  },
  hepatitis_c_antibody: {
    status: { negative: "normal", positive: "abnormal" },
    fallback: "normal",
    note: "An antibody test shows exposure, not active infection. Confirmation is by HCV RNA.",
  },
  urine_protein: {
    status: { negative: "normal", trace: "borderline", "1+": "borderline", "2+": "abnormal", "3+": "abnormal", "4+": "abnormal" },
    fallback: "borderline",
    note: "Persistent proteinuria is an early sign of kidney damage, particularly alongside diabetes or hypertension.",
  },
  urine_glucose: {
    status: { negative: "normal", trace: "borderline", "1+": "abnormal", "2+": "abnormal", "3+": "abnormal", "4+": "abnormal" },
    fallback: "borderline",
    note: "Glucose in the urine usually means the blood glucose has passed the renal threshold, and should prompt a blood glucose test.",
  },
  urine_blood: {
    status: { negative: "normal", trace: "borderline", "1+": "abnormal", "2+": "abnormal", "3+": "abnormal", "4+": "abnormal" },
    fallback: "borderline",
    note: "In Nigeria, blood in the urine may reflect urinary schistosomiasis as well as the usual renal and urological causes.",
  },
  urine_leukocytes: {
    status: { negative: "normal", trace: "borderline", "1+": "abnormal", "2+": "abnormal", "3+": "abnormal", "4+": "abnormal" },
    fallback: "borderline",
  },
  urine_nitrite: { status: { negative: "normal", positive: "abnormal" }, fallback: "normal" },
  urine_ketones: {
    status: { negative: "normal", trace: "borderline", "1+": "abnormal", "2+": "abnormal", "3+": "abnormal", "4+": "abnormal" },
    fallback: "borderline",
    note: "Ketones alongside a high blood glucose can indicate diabetic ketoacidosis, which is a same-day concern.",
  },
};

function classify(band: Band, value: number): Interpretation {
  if (band.criticalLow != null && value <= band.criticalLow) {
    return { status: "critical", direction: "low", note: band.note };
  }
  if (band.criticalHigh != null && value >= band.criticalHigh) {
    return { status: "critical", direction: "high", note: band.note };
  }

  const belowNormal = band.low != null && value < band.low;
  const aboveNormal = band.high != null && value > band.high;
  if (!belowNormal && !aboveNormal) {
    return { status: "normal", direction: null, note: band.note };
  }

  if (belowNormal) {
    const borderline = band.borderlineLow != null && value >= band.borderlineLow;
    return { status: borderline ? "borderline" : "abnormal", direction: "low", note: band.note };
  }
  const borderline = band.borderlineHigh != null && value <= band.borderlineHigh;
  return { status: borderline ? "borderline" : "abnormal", direction: "high", note: band.note };
}

/**
 * Interpret one reading. `value` is the canonical-unit number for a
 * quantitative analyte, or the coded string for a qualitative one.
 *
 * Returns null when this module has no threshold for the code — which renders
 * as "no reference range" on screen rather than silently as "normal". A
 * catalogue code with no band here is a gap, and the test suite fails on it.
 */
export function interpretReading(
  code: string,
  value: number | string,
  ctx: PatientContext = { sex: null, ageYears: null },
): Interpretation | null {
  if (typeof value === "string") {
    const rule = QUALITATIVE[code];
    if (!rule) return null;
    const status = rule.status[value] ?? rule.fallback;
    return { status, direction: status === "normal" ? null : "high", note: rule.note };
  }

  const bandFn = BANDS[code];
  if (!bandFn || !Number.isFinite(value)) return null;
  return classify(bandFn(ctx), value);
}

/** Codes from the given list that this module cannot interpret. Asserted in tests. */
export function codesWithoutInterpretation(codes: readonly string[]): string[] {
  return codes.filter((code) => !BANDS[code] && !QUALITATIVE[code]);
}

/**
 * Estimated GFR from creatinine, CKD-EPI 2021 (race-free).
 *
 * DERIVED, never extracted — exactly like non-HDL cholesterol. A laboratory
 * printing its own eGFR may have used the 2009 equation with the Black race
 * coefficient, which is retired and, applied to a Nigerian population,
 * systematically overestimates kidney function. Recomputing it from the
 * creatinine we transcribed means the number came from one known equation.
 *
 * Returns null without an age and sex: an eGFR cannot be estimated without
 * them, and guessing either is worse than showing nothing.
 */
export function estimateGfr(
  creatinineMgDl: number,
  ctx: PatientContext,
): { value: number; stage: string; status: AnalyteStatus } | null {
  const { sex, ageYears } = ctx;
  if (sex === null || ageYears === null) return null;
  if (!Number.isFinite(creatinineMgDl) || creatinineMgDl <= 0) return null;
  if (ageYears < 18) return null; // CKD-EPI is not validated in children

  const isFemale = sex === "female";
  const kappa = isFemale ? 0.7 : 0.9;
  const alpha = isFemale ? -0.241 : -0.302;
  const ratio = creatinineMgDl / kappa;
  const egfr =
    142 *
    Math.min(ratio, 1) ** alpha *
    Math.max(ratio, 1) ** -1.2 *
    0.9938 ** ageYears *
    (isFemale ? 1.012 : 1);

  const value = Math.round(egfr);
  const { stage, status }: { stage: string; status: AnalyteStatus } =
    value >= 90
      ? { stage: "G1 (normal)", status: "normal" }
      : value >= 60
        ? { stage: "G2 (mildly reduced)", status: "borderline" }
        : value >= 45
          ? { stage: "G3a (mild to moderate)", status: "abnormal" }
          : value >= 30
            ? { stage: "G3b (moderate to severe)", status: "abnormal" }
            : value >= 15
              ? { stage: "G4 (severely reduced)", status: "critical" }
              : { stage: "G5 (kidney failure)", status: "critical" };

  return { value, stage, status };
}

/**
 * The worst status across a set of readings, and a plain sentence naming what
 * drove it — the input to the escalation bridge.
 *
 * Only rows that converted cleanly take part. An implausible or unmapped row
 * has no trustworthy number, and escalating on one would mean raising a
 * doctor's queue on the strength of a reading we have already rejected.
 */
export function worstStatusOf(
  rows: readonly { code: string | null; value: number | null; valueText: string | null; status: string }[],
  ctx: PatientContext,
): { status: AnalyteStatus | null; reason: string | null; criticalCodes: string[] } {
  let worst: AnalyteStatus | null = null;
  const criticalCodes: string[] = [];

  for (const row of rows) {
    if (!row.code || row.status !== "ready") continue;
    const input = row.value ?? row.valueText;
    if (input === null) continue;

    const interpretation = interpretReading(row.code, input, ctx);
    if (!interpretation) continue;

    if (worst === null || STATUS_SEVERITY[interpretation.status] > STATUS_SEVERITY[worst]) {
      worst = interpretation.status;
    }
    if (interpretation.status === "critical") criticalCodes.push(row.code);
  }

  const reason =
    criticalCodes.length > 0
      ? `the uploaded report appears to contain a critical ${criticalCodes.join(" and ")} value.`
      : null;

  return { status: worst, reason, criticalCodes };
}
