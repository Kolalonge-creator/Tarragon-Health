/**
 * WHO 2019 cardiovascular risk charts engine (S45, function 3.2). Pure code, no network, no database, no model call (INV-01).
 *
 * The instrument is Western sub-Saharan Africa, a laboratory model (total cholesterol) and a non-laboratory model (BMI), shown as BANDS.
 * THIS FILE HOLDS NO COEFFICIENTS. They come in through `CvdInstrumentConfig`, loaded from the signed `risk_instrument_versions` row, because
 * a coefficient typed from memory is a clinical error waiting to happen. With no verified coefficients the engine refuses with
 * `not_scored_instrument_off` and never invents a number.
 *
 * The model shape is the one the paper uses: risk = 1 - S0 ^ exp(LP), where LP is a sum of coefficient times product of
 * (variable - centre) terms (the interaction terms with age are just terms with two factors).
 */
export type CvdSex = "male" | "female";
export type CvdVariable = "age" | "sbp" | "smoker" | "diabetes" | "total_chol_mmol" | "bmi";
export type CvdModelKind = "lab" | "non_lab";

export interface CvdTerm {
  readonly coef: number;
  readonly factors: ReadonlyArray<{ readonly var: CvdVariable; readonly center: number }>;
}
export interface CvdSexModel {
  readonly baselineSurvival: number;
  readonly terms: readonly CvdTerm[];
}
export interface CvdBand {
  readonly code: string;
  readonly lowPct: number;
  readonly highPct: number | null;
  readonly tier: string;
}
export interface CvdInstrumentConfig {
  readonly coefficientsVerified: boolean;
  readonly ageRange: { readonly min: number; readonly max: number };
  readonly bands: readonly CvdBand[];
  readonly nonLabFurtherAssessmentAtOrAbovePct: number;
  readonly treatmentAlreadyIndicated: { readonly systolicAtOrAbove: number; readonly diastolicAtOrAbove: number; readonly establishedCvd: boolean };
  readonly models: Readonly<Record<CvdModelKind, Readonly<Record<CvdSex, CvdSexModel | null>>>>;
}

export interface CvdInputs {
  readonly age: number | null;
  readonly sex: CvdSex | null;
  readonly systolic: number | null;
  readonly diastolic: number | null;
  readonly smoker: boolean | null;
  readonly knownDiabetes: boolean;
  readonly establishedCvd: boolean;
  readonly totalCholesterolMmol: number | null;
  readonly bmi: number | null;
}

export type CvdNotScoredStatus =
  | "not_scored_instrument_off"
  | "not_scored_age_out_of_range"
  | "not_scored_known_diabetes"
  | "not_scored_treatment_indicated"
  | "not_scored_insufficient_data";

export type CvdOutcome =
  | { readonly status: "scored"; readonly model: CvdModelKind; readonly bandCode: string; readonly tier: string; readonly furtherAssessment: boolean }
  | { readonly status: CvdNotScoredStatus };

/** Raw 10-year risk as a fraction. Exported for the validation harness only; callers show bands, never this number. */
export function cvdRiskFraction(model: CvdSexModel, values: Readonly<Record<CvdVariable, number>>): number {
  let lp = 0;
  for (const term of model.terms) {
    let product = term.coef;
    for (const f of term.factors) product *= values[f.var] - f.center;
    lp += product;
  }
  return 1 - Math.pow(model.baselineSurvival, Math.exp(lp));
}

export function bandFor(config: CvdInstrumentConfig, riskPct: number): CvdBand | null {
  for (const b of config.bands) {
    if (riskPct >= b.lowPct && (b.highPct === null || riskPct < b.highPct)) return b;
  }
  return null;
}

function modelIsUsable(m: CvdSexModel | null): m is CvdSexModel {
  return m !== null && Number.isFinite(m.baselineSurvival) && m.baselineSurvival > 0 && m.baselineSurvival < 1 && m.terms.length > 0;
}

export function scoreCvdWho2019(input: CvdInputs, config: CvdInstrumentConfig): CvdOutcome {
  const t = config.treatmentAlreadyIndicated;
  // Treatment already indicated: the chart is not used (established disease, very high BP).
  if ((t.establishedCvd && input.establishedCvd) ||
      (input.systolic !== null && input.systolic >= t.systolicAtOrAbove) ||
      (input.diastolic !== null && input.diastolic >= t.diastolicAtOrAbove)) {
    return { status: "not_scored_treatment_indicated" };
  }
  // Known diabetes goes down its own pathway, not through the chart.
  if (input.knownDiabetes) return { status: "not_scored_known_diabetes" };
  if (input.age === null) return { status: "not_scored_insufficient_data" };
  if (input.age < config.ageRange.min || input.age > config.ageRange.max) return { status: "not_scored_age_out_of_range" };
  if (input.sex === null || input.systolic === null || input.smoker === null) return { status: "not_scored_insufficient_data" };

  const kind: CvdModelKind = input.totalCholesterolMmol !== null ? "lab" : "non_lab";
  if (kind === "non_lab" && input.bmi === null) return { status: "not_scored_insufficient_data" };
  const model = config.models[kind][input.sex];
  if (!config.coefficientsVerified || !modelIsUsable(model)) return { status: "not_scored_instrument_off" };

  const values: Record<CvdVariable, number> = {
    age: input.age,
    sbp: input.systolic,
    smoker: input.smoker ? 1 : 0,
    diabetes: 0,
    total_chol_mmol: input.totalCholesterolMmol ?? 0,
    bmi: input.bmi ?? 0,
  };
  const riskPct = cvdRiskFraction(model, values) * 100;
  if (!Number.isFinite(riskPct)) return { status: "not_scored_instrument_off" };
  const band = bandFor(config, riskPct);
  if (!band) return { status: "not_scored_instrument_off" };
  return {
    status: "scored",
    model: kind,
    bandCode: band.code,
    tier: band.tier,
    furtherAssessment: kind === "non_lab" && band.lowPct >= config.nonLabFurtherAssessmentAtOrAbovePct,
  };
}

export interface CvdValidationVector {
  readonly name: string;
  readonly input: CvdInputs;
  readonly expectedBandCode: string;
}

/**
 * The validation harness. When real coefficients arrive, run them against vectors taken from the paper's published charts BEFORE the CMO is asked
 * to sign. Returns the vectors the engine got wrong; an empty list means the loaded coefficients reproduce every vector.
 */
export function runCvdValidationVectors(config: CvdInstrumentConfig, vectors: readonly CvdValidationVector[]): string[] {
  const bad: string[] = [];
  for (const v of vectors) {
    const out = scoreCvdWho2019(v.input, config);
    const got = out.status === "scored" ? out.bandCode : out.status;
    if (got !== v.expectedBandCode) bad.push(`${v.name}: expected ${v.expectedBandCode}, got ${got}`);
  }
  return bad;
}
