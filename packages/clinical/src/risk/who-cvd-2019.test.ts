import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bandFor,
  cvdRiskFraction,
  runCvdValidationVectors,
  scoreCvdWho2019,
  type CvdInputs,
  type CvdInstrumentConfig,
  type CvdSexModel,
} from "./who-cvd-2019";

/**
 * SYNTHETIC coefficients, for exercising the mechanics ONLY. They are not the WHO model, they are not clinically meaningful, and they must
 * never be copied into a configuration. One term, so every expected value below can be worked by hand:
 * risk = 1 - 0.95 ^ exp(0.05 * (age - 50)).
 */
const SYNTHETIC: CvdSexModel = { baselineSurvival: 0.95, terms: [{ coef: 0.05, factors: [{ var: "age", center: 50 }] }] };

const BANDS = [
  { code: "lt5", lowPct: 0, highPct: 5, tier: "low" },
  { code: "5to10", lowPct: 5, highPct: 10, tier: "low_moderate" },
  { code: "10to20", lowPct: 10, highPct: 20, tier: "moderate" },
  { code: "20to30", lowPct: 20, highPct: 30, tier: "high" },
  { code: "ge30", lowPct: 30, highPct: null, tier: "very_high" },
];

function config(over: Partial<CvdInstrumentConfig> = {}): CvdInstrumentConfig {
  return {
    coefficientsVerified: true,
    ageRange: { min: 40, max: 74 },
    bands: BANDS,
    nonLabFurtherAssessmentAtOrAbovePct: 10,
    treatmentAlreadyIndicated: { systolicAtOrAbove: 160, diastolicAtOrAbove: 100, establishedCvd: true },
    models: { lab: { male: SYNTHETIC, female: SYNTHETIC }, non_lab: { male: SYNTHETIC, female: SYNTHETIC } },
    ...over,
  };
}

const person: CvdInputs = {
  age: 60, sex: "female", systolic: 130, diastolic: 80, smoker: false, knownDiabetes: false, establishedCvd: false,
  totalCholesterolMmol: 5.2, bmi: 27,
};

describe("the risk formula", () => {
  it("matches the hand-worked value", () => {
    const risk = cvdRiskFraction(SYNTHETIC, { age: 60, sbp: 0, smoker: 0, diabetes: 0, total_chol_mmol: 0, bmi: 0 });
    expect(risk).toBeCloseTo(1 - Math.pow(0.95, Math.exp(0.5)), 10);
    expect(risk * 100).toBeCloseTo(8.1, 1);
  });
  it("handles interaction terms (two factors)", () => {
    const m: CvdSexModel = { baselineSurvival: 0.9, terms: [{ coef: 0.1, factors: [{ var: "age", center: 50 }, { var: "smoker", center: 0 }] }] };
    const smoker = cvdRiskFraction(m, { age: 60, sbp: 0, smoker: 1, diabetes: 0, total_chol_mmol: 0, bmi: 0 });
    const non = cvdRiskFraction(m, { age: 60, sbp: 0, smoker: 0, diabetes: 0, total_chol_mmol: 0, bmi: 0 });
    expect(smoker).toBeGreaterThan(non);
    expect(non).toBeCloseTo(1 - 0.9, 10);
  });
});

describe("bands, not percentages", () => {
  it("places the boundaries in the upper band", () => {
    expect(bandFor(config(), 4.99)?.code).toBe("lt5");
    expect(bandFor(config(), 5)?.code).toBe("5to10");
    expect(bandFor(config(), 20)?.code).toBe("20to30");
    expect(bandFor(config(), 30)?.code).toBe("ge30");
    expect(bandFor(config(), 80)?.code).toBe("ge30");
  });
  it("never returns an exact percentage", () => {
    const out = scoreCvdWho2019(person, config());
    expect(out).toEqual({ status: "scored", model: "lab", bandCode: "5to10", tier: "low_moderate", furtherAssessment: false });
    expect(Object.keys(out)).not.toContain("risk");
  });
});

describe("model choice", () => {
  it("uses the lab model when cholesterol is on file and the non-lab model otherwise", () => {
    expect(scoreCvdWho2019(person, config())).toMatchObject({ model: "lab" });
    expect(scoreCvdWho2019({ ...person, totalCholesterolMmol: null }, config())).toMatchObject({ model: "non_lab" });
  });
  it("needs BMI for the non-lab model", () => {
    expect(scoreCvdWho2019({ ...person, totalCholesterolMmol: null, bmi: null }, config())).toEqual({ status: "not_scored_insufficient_data" });
  });
  it("flags further assessment for non-lab at 10 percent or above only", () => {
    expect(scoreCvdWho2019({ ...person, totalCholesterolMmol: null, age: 70 }, config())).toMatchObject({ bandCode: "10to20", furtherAssessment: true });
    expect(scoreCvdWho2019({ ...person, totalCholesterolMmol: null, age: 60 }, config())).toMatchObject({ furtherAssessment: false });
    expect(scoreCvdWho2019({ ...person, age: 70 }, config())).toMatchObject({ furtherAssessment: false });
  });
});

describe("refusals", () => {
  it("refuses outside ages 40 to 74", () => {
    expect(scoreCvdWho2019({ ...person, age: 39 }, config())).toEqual({ status: "not_scored_age_out_of_range" });
    expect(scoreCvdWho2019({ ...person, age: 75 }, config())).toEqual({ status: "not_scored_age_out_of_range" });
    expect(scoreCvdWho2019({ ...person, age: 40 }, config())).toMatchObject({ status: "scored" });
    expect(scoreCvdWho2019({ ...person, age: 74 }, config())).toMatchObject({ status: "scored" });
  });
  it("routes known diabetes to its own pathway", () => {
    expect(scoreCvdWho2019({ ...person, knownDiabetes: true }, config())).toEqual({ status: "not_scored_known_diabetes" });
  });
  it("does not score when treatment is already indicated", () => {
    expect(scoreCvdWho2019({ ...person, establishedCvd: true }, config())).toEqual({ status: "not_scored_treatment_indicated" });
    expect(scoreCvdWho2019({ ...person, systolic: 160 }, config())).toEqual({ status: "not_scored_treatment_indicated" });
    expect(scoreCvdWho2019({ ...person, diastolic: 100 }, config())).toEqual({ status: "not_scored_treatment_indicated" });
    expect(scoreCvdWho2019({ ...person, systolic: 159, diastolic: 99 }, config())).toMatchObject({ status: "scored" });
  });
  it("treatment-indicated wins over diabetes and age (the stronger instruction)", () => {
    expect(scoreCvdWho2019({ ...person, establishedCvd: true, knownDiabetes: true, age: 80 }, config())).toEqual({ status: "not_scored_treatment_indicated" });
  });
  it("refuses with missing data rather than guessing", () => {
    expect(scoreCvdWho2019({ ...person, age: null }, config())).toEqual({ status: "not_scored_insufficient_data" });
    expect(scoreCvdWho2019({ ...person, sex: null }, config())).toEqual({ status: "not_scored_insufficient_data" });
    expect(scoreCvdWho2019({ ...person, systolic: null }, config())).toEqual({ status: "not_scored_insufficient_data" });
    expect(scoreCvdWho2019({ ...person, smoker: null }, config())).toEqual({ status: "not_scored_insufficient_data" });
  });
  it("is off when coefficients are unverified or missing", () => {
    expect(scoreCvdWho2019(person, config({ coefficientsVerified: false }))).toEqual({ status: "not_scored_instrument_off" });
    expect(scoreCvdWho2019(person, config({ models: { lab: { male: null, female: null }, non_lab: { male: null, female: null } } }))).toEqual({ status: "not_scored_instrument_off" });
    expect(scoreCvdWho2019(person, config({ models: { lab: { male: SYNTHETIC, female: { baselineSurvival: 1.2, terms: SYNTHETIC.terms } }, non_lab: { male: null, female: null } } }))).toEqual({ status: "not_scored_instrument_off" });
  });
});

describe("validation harness", () => {
  const vectors = [
    { name: "age 45", input: { ...person, age: 45 }, expectedBandCode: "lt5" },
    { name: "age 60", input: { ...person, age: 60 }, expectedBandCode: "5to10" },
    { name: "age 70", input: { ...person, age: 70 }, expectedBandCode: "10to20" },
  ];
  it("reports nothing when the loaded coefficients reproduce every vector", () => {
    expect(runCvdValidationVectors(config(), vectors)).toEqual([]);
  });
  it("reports the vectors that do not match (sabotage: wrong baseline)", () => {
    const wrong = config({ models: { lab: { male: { ...SYNTHETIC, baselineSurvival: 0.7 }, female: { ...SYNTHETIC, baselineSurvival: 0.7 } }, non_lab: { male: null, female: null } } });
    expect(runCvdValidationVectors(wrong, vectors).length).toBeGreaterThan(0);
  });
});

describe("the committed seed", () => {
  const dir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");
  const file = readdirSync(dir).find((f) => f.endsWith("_s45_risk_screening_packages.sql"));
  const sql = file ? readFileSync(join(dir, file), "utf8") : "";
  const match = /who-cvd-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);

  it("is present, unverified and carries no coefficient for any model", () => {
    if (!match?.[1]) throw new Error("who_cvd seed not found");
    const cfg = JSON.parse(match[1]) as { coefficientsVerified: boolean; models: Record<string, Record<string, unknown>> };
    expect(cfg.coefficientsVerified).toBe(false);
    for (const kind of ["lab", "non_lab"]) for (const sex of ["male", "female"]) expect(cfg.models[kind]?.[sex]).toBeNull();
  });
  it("uses the five WHO 2019 bands", () => {
    if (!match?.[1]) throw new Error("who_cvd seed not found");
    const cfg = JSON.parse(match[1]) as { bands: Array<{ lowPct: number; highPct: number | null }> };
    expect(cfg.bands.map((b) => [b.lowPct, b.highPct])).toEqual([[0, 5], [5, 10], [10, 20], [20, 30], [30, null]]);
  });
});
