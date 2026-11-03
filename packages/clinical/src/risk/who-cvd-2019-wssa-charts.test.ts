import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cvdRiskFraction,
  runCvdValidationVectors,
  scoreCvdWho2019,
  type CvdInputs,
  type CvdInstrumentConfig,
  type CvdTwoEndpointSexModel,
  type CvdValidationVector,
} from "./who-cvd-2019";

/**
 * The v3 configuration of who_cvd_2019_wssa (the committed migration, read here so the test runs against exactly what ships) must
 * reproduce the WHO 2019 Western sub-Saharan Africa charts as published (appendix 2 of Lancet Glob Health 2019;7:e1332-45). The fixture
 * holds every cell of the laboratory chart (p 5, with and without diabetes) and the non-laboratory chart (p 27), transcribed by script
 * from the PDF's text layer. Provenance: docs/clinical/who-cvd-2019-wssa-coefficients.md.
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS = join(here, "..", "..", "..", "..", "supabase", "migrations");

interface Cell {
  kind: "lab" | "non_lab";
  age: string;
  sbp: string;
  diabetes: 0 | 1;
  sex: "male" | "female";
  smoker: 0 | 1;
  col: number;
  value: number;
}
interface Fixture {
  source: string;
  cellPoints: { age: Record<string, number>; sbp: Record<string, number>; labColumns: number[]; nonLabColumns: number[] };
  cells: Cell[];
}

function loadV3(): CvdInstrumentConfig {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_who_cvd_2019_wssa_v3_verified_coefficients.sql"));
  if (!file) throw new Error("v3 migration not found");
  const match = /who-cvd-v3-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error("v3 config not found in the migration");
  return JSON.parse(match[1]) as CvdInstrumentConfig;
}
const fixture = JSON.parse(readFileSync(join(here, "fixtures", "who-cvd-2019-wssa-chart-cells.json"), "utf8")) as Fixture;
const v3 = loadV3();

function pointsFor(c: Cell) {
  const age = fixture.cellPoints.age[c.age];
  const sbp = fixture.cellPoints.sbp[c.sbp];
  const col = (c.kind === "lab" ? fixture.cellPoints.labColumns : fixture.cellPoints.nonLabColumns)[c.col];
  if (age === undefined || sbp === undefined || col === undefined) throw new Error(`bad cell ${JSON.stringify(c)}`);
  return { age, sbp, col };
}

describe("the v3 configuration", () => {
  it("is verified, region-checked for Nigeria, and carries the two-endpoint shape for every sex and model", () => {
    expect(v3.coefficientsVerified).toBe(true);
    expect((v3 as unknown as { regionCheckedForNigeria: boolean }).regionCheckedForNigeria).toBe(true);
    for (const kind of ["lab", "non_lab"] as const) {
      for (const sex of ["male", "female"] as const) {
        const m = v3.models[kind][sex] as CvdTwoEndpointSexModel | null;
        expect(m?.shape).toBe("two_endpoint_recalibrated");
        expect(m?.mi.terms.length).toBe(kind === "lab" ? 9 : 7);
        expect(m?.stroke.terms.length).toBe(kind === "lab" ? 9 : 7);
      }
    }
  });
  it("keeps the five WHO bands, ages 40 to 74 and the band actions of v2", () => {
    expect(v3.bands.map((b) => [b.lowPct, b.highPct])).toEqual([[0, 5], [5, 10], [10, 20], [20, 30], [30, null]]);
    expect(v3.ageRange).toEqual({ min: 40, max: 74 });
    expect((v3 as unknown as { bandActions: { appPrescribes: boolean } }).bandActions.appPrescribes).toBe(false);
  });
});

describe("the published Western sub-Saharan Africa charts", () => {
  it("has every cell of both charts", () => {
    expect(fixture.cells.filter((c) => c.kind === "lab")).toHaveLength(7 * 5 * 2 * 2 * 2 * 5);
    expect(fixture.cells.filter((c) => c.kind === "non_lab")).toHaveLength(7 * 5 * 2 * 2 * 5);
  });

  it("is reproduced exactly, cell for cell, by the v3 coefficients (2100 cells, rounded to the printed whole percent)", () => {
    const wrong: string[] = [];
    for (const c of fixture.cells) {
      const model = v3.models[c.kind][c.sex];
      if (!model) throw new Error("model missing");
      const p = pointsFor(c);
      const pct =
        cvdRiskFraction(model, {
          age: p.age,
          sbp: p.sbp,
          smoker: c.smoker,
          diabetes: c.diabetes,
          total_chol_mmol: c.kind === "lab" ? p.col : 0,
          bmi: c.kind === "non_lab" ? p.col : 0,
        }) * 100;
      if (Math.round(pct) !== c.value) wrong.push(`${c.kind} ${c.sex} ${c.age} ${c.sbp} smoker=${c.smoker} diabetes=${c.diabetes} col=${c.col}: chart ${c.value}, got ${pct.toFixed(2)}`);
    }
    expect(wrong).toEqual([]);
  });

  it("would catch a wrong recalibration slope (sabotage)", () => {
    const male = v3.models.lab.male as CvdTwoEndpointSexModel;
    const sabotaged: CvdInstrumentConfig = {
      ...v3,
      models: { ...v3.models, lab: { ...v3.models.lab, male: { ...male, mi: { ...male.mi, recalibration: { ...male.mi.recalibration, slope: male.mi.recalibration.slope * 1.2 } } } } },
    };
    let mismatches = 0;
    for (const c of fixture.cells.filter((x) => x.kind === "lab" && x.sex === "male")) {
      const p = pointsFor(c);
      const model = sabotaged.models.lab.male;
      if (!model) throw new Error("model missing");
      const pct = cvdRiskFraction(model, { age: p.age, sbp: p.sbp, smoker: c.smoker, diabetes: c.diabetes, total_chol_mmol: p.col, bmi: 0 }) * 100;
      if (Math.round(pct) !== c.value) mismatches += 1;
    }
    expect(mismatches).toBeGreaterThan(100);
  });

  it("would catch the recalibration applied to the wrong endpoint (sabotage: mi and stroke swapped)", () => {
    const female = v3.models.non_lab.female as CvdTwoEndpointSexModel;
    const swapped: CvdTwoEndpointSexModel = { ...female, mi: { ...female.mi, recalibration: female.stroke.recalibration }, stroke: { ...female.stroke, recalibration: female.mi.recalibration } };
    let mismatches = 0;
    for (const c of fixture.cells.filter((x) => x.kind === "non_lab" && x.sex === "female")) {
      const p = pointsFor(c);
      const pct = cvdRiskFraction(swapped, { age: p.age, sbp: p.sbp, smoker: c.smoker, diabetes: 0, total_chol_mmol: 0, bmi: p.col }) * 100;
      if (Math.round(pct) !== c.value) mismatches += 1;
    }
    expect(mismatches).toBeGreaterThan(20);
  });
});

/** Cells read directly off the printed charts, chosen well inside a band and inside the engine's scoring range (SBP below 160, no diabetes). */
const person = (over: Partial<CvdInputs>): CvdInputs => ({
  age: 60, sex: "male", systolic: 130, diastolic: 80, smoker: false, knownDiabetes: false, establishedCvd: false, totalCholesterolMmol: null, bmi: null, ...over,
});
const READ_OFF_THE_CHARTS: CvdValidationVector[] = [
  // laboratory chart p 5, men, non-smoker, 70-74, SBP 140-159, cholesterol 5 to 5.9: printed 18
  { name: "lab man 72.5y non-smoker SBP 150 TC 5.5 (chart 18%)", input: person({ age: 72.5, systolic: 150, totalCholesterolMmol: 5.5 }), expectedBandCode: "10to20" },
  // laboratory chart p 5, men, smoker, 55-59, SBP 120-139, cholesterol under 4: printed 7
  { name: "lab man 57.5y smoker SBP 130 TC 3.5 (chart 7%)", input: person({ age: 57.5, smoker: true, totalCholesterolMmol: 3.5 }), expectedBandCode: "5to10" },
  // laboratory chart p 5, women, smoker, 70-74, SBP 140-159, cholesterol 6 to 6.9: printed 21
  { name: "lab woman 72.5y smoker SBP 150 TC 6.5 (chart 21%)", input: person({ sex: "female", age: 72.5, smoker: true, systolic: 150, totalCholesterolMmol: 6.5 }), expectedBandCode: "20to30" },
  // laboratory chart p 5, women, non-smoker, 45-49, SBP 120-139, cholesterol 5 to 5.9: printed 2
  { name: "lab woman 47.5y non-smoker SBP 130 TC 5.5 (chart 2%)", input: person({ sex: "female", age: 47.5, totalCholesterolMmol: 5.5 }), expectedBandCode: "lt5" },
  // non-laboratory chart p 27, men, smoker, 65-69, SBP 140-159, BMI 35 and over: printed 22
  { name: "non-lab man 67.5y smoker SBP 150 BMI 37.5 (chart 22%)", input: person({ age: 67.5, smoker: true, systolic: 150, bmi: 37.5 }), expectedBandCode: "20to30" },
  // non-laboratory chart p 27, women, non-smoker, 60-64, SBP 120-139, BMI 25 to 29: printed 6
  { name: "non-lab woman 62.5y non-smoker SBP 130 BMI 27.5 (chart 6%)", input: person({ sex: "female", age: 62.5, bmi: 27.5 }), expectedBandCode: "5to10" },
];

describe("runCvdValidationVectors against the charts", () => {
  it("passes the hand-read vectors", () => {
    expect(READ_OFF_THE_CHARTS.length).toBeGreaterThanOrEqual(4);
    expect(runCvdValidationVectors(v3, READ_OFF_THE_CHARTS)).toEqual([]);
  });

  it("passes every scorable chart cell whose printed value sits at least 2 points inside its band", () => {
    const edges = [5, 10, 20, 30];
    const vectors: CvdValidationVector[] = fixture.cells
      .filter((c) => c.diabetes === 0 && !["160-179", ">=180"].includes(c.sbp) && edges.every((e) => Math.abs(c.value - e) >= 2))
      .map((c) => {
        const p = pointsFor(c);
        const band = v3.bands.find((b) => c.value >= b.lowPct && (b.highPct === null || c.value < b.highPct));
        if (!band) throw new Error("no band");
        return {
          name: `${c.kind} ${c.sex} ${c.age} ${c.sbp} smoker=${c.smoker} col=${c.col}`,
          input: person({ sex: c.sex, age: p.age, systolic: p.sbp, smoker: c.smoker === 1, totalCholesterolMmol: c.kind === "lab" ? p.col : null, bmi: c.kind === "non_lab" ? p.col : null }),
          expectedBandCode: band.code,
        };
      });
    expect(vectors.length).toBeGreaterThan(300);
    expect(runCvdValidationVectors(v3, vectors)).toEqual([]);
  });

  it("scores through the full engine with the lab model when cholesterol is known and the non-lab model otherwise", () => {
    expect(scoreCvdWho2019(person({ age: 72.5, systolic: 150, totalCholesterolMmol: 5.5 }), v3)).toEqual({ status: "scored", model: "lab", bandCode: "10to20", tier: "moderate", furtherAssessment: false });
    expect(scoreCvdWho2019(person({ age: 67.5, smoker: true, systolic: 150, bmi: 37.5 }), v3)).toEqual({ status: "scored", model: "non_lab", bandCode: "20to30", tier: "high", furtherAssessment: true });
  });
});
