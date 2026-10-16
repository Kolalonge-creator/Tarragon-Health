import { describe, expect, it, jest } from "@jest/globals";
import type { CvdOutcome } from "@tarragon/clinical";
import {
  assessCvdWho2019,
  buildCvdInputs,
  parseInstrumentConfig,
  type CvdDataSource,
  type CvdRawFacts,
  type InstrumentVersion,
} from "./who-2019";

const BANDS = [
  { code: "lt5", lowPct: 0, highPct: 5, tier: "low" },
  { code: "5to10", lowPct: 5, highPct: 10, tier: "low_moderate" },
  { code: "10to20", lowPct: 10, highPct: 20, tier: "moderate" },
  { code: "20to30", lowPct: 20, highPct: 30, tier: "high" },
  { code: "ge30", lowPct: 30, highPct: null, tier: "very_high" },
];
// SYNTHETIC mechanics-only model (risk = 1 - 0.95 ^ exp(0.05 * (age - 50))). Not the WHO model; never copy into a configuration.
const synthetic = { baselineSurvival: 0.95, terms: [{ coef: 0.05, factors: [{ var: "age", center: 50 }] }] };
const emptyConfig = {
  coefficientsVerified: false,
  ageRange: { min: 40, max: 74 },
  bands: BANDS,
  nonLabFurtherAssessmentAtOrAbovePct: 10,
  treatmentAlreadyIndicated: { systolicAtOrAbove: 160, diastolicAtOrAbove: 100, establishedCvd: true },
  models: { lab: { male: null, female: null }, non_lab: { male: null, female: null } },
};
const workingConfig = {
  ...emptyConfig,
  coefficientsVerified: true,
  models: { lab: { male: synthetic, female: synthetic }, non_lab: { male: synthetic, female: synthetic } },
};

const dob = (years: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
};
const facts = (over: Partial<CvdRawFacts> = {}): CvdRawFacts => ({
  dateOfBirth: dob(60), sex: "female", heightCm: 165, systolic: 128, diastolic: 80, weightKg: 70, totalCholesterolMgDl: 200,
  smokingResponse: "never", knownDiabetes: false, establishedCvd: false, ...over,
});

function source(over: { facts?: CvdRawFacts | null; version?: InstrumentVersion | null; reasons?: string[]; failScored?: boolean } = {}) {
  const calls: Array<{ outcome: CvdOutcome; versionId: string; trigger: string }> = [];
  const s: CvdDataSource = {
    facts: async () => (over.facts === undefined ? facts() : over.facts),
    instrument: async () => (over.version === undefined ? { id: "v1", signed: true, config: workingConfig } : over.version),
    reassessmentReasons: async () => over.reasons ?? [],
    record: jest.fn(async (a: Parameters<CvdDataSource["record"]>[0]) => {
      calls.push({ outcome: a.outcome, versionId: a.versionId, trigger: a.trigger });
      if (over.failScored && a.outcome.status === "scored") return { ok: false as const, code: "not_live" };
      return { ok: true as const, id: `row-${calls.length}` };
    }),
  };
  return { s, calls };
}

async function triggerFor(reasons: string[], explicit?: "initial") {
  const x = source({ reasons });
  await assessCvdWho2019(x.s, "p1", explicit ? { trigger: explicit } : {});
  return x.calls[0]?.trigger;
}

describe("buildCvdInputs", () => {
  it("converts cholesterol to mmol/L and computes BMI", () => {
    const i = buildCvdInputs(facts({ totalCholesterolMgDl: 193.35, weightKg: 70, heightCm: 170 }));
    expect(i.totalCholesterolMmol).toBeCloseTo(5, 2);
    expect(i.bmi).toBe(24.2);
  });
  it("treats an unanswered smoking question as unknown, never a non-smoker", () => {
    expect(buildCvdInputs(facts({ smokingResponse: null })).smoker).toBeNull();
    expect(buildCvdInputs(facts({ smokingResponse: "former" })).smoker).toBe(false);
    expect(buildCvdInputs(facts({ smokingResponse: "current" })).smoker).toBe(true);
  });
  it("leaves BMI and cholesterol empty when the data is missing", () => {
    const i = buildCvdInputs(facts({ heightCm: null, totalCholesterolMgDl: null }));
    expect(i.bmi).toBeNull();
    expect(i.totalCholesterolMmol).toBeNull();
  });
});

describe("parseInstrumentConfig", () => {
  it("parses a good config and rejects a malformed one", () => {
    expect(parseInstrumentConfig(emptyConfig)?.bands).toHaveLength(5);
    expect(parseInstrumentConfig({ bands: [] })).toBeNull();
    expect(parseInstrumentConfig(null)).toBeNull();
  });
});

describe("assessCvdWho2019", () => {
  it("records a scored band against the signed version", async () => {
    const { s, calls } = source();
    const r = await assessCvdWho2019(s, "p1");
    expect(r).toMatchObject({ ok: true, outcome: { status: "scored", bandCode: "5to10", model: "lab" } });
    expect(calls[0]?.versionId).toBe("v1");
  });
  it("records instrument_off against the version when it is unsigned, never a band", async () => {
    const { s, calls } = source({ version: { id: "v1", signed: false, config: emptyConfig } });
    const r = await assessCvdWho2019(s, "p1");
    expect(r).toMatchObject({ ok: true, outcome: { status: "not_scored_instrument_off" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.versionId).toBe("v1");
  });
  it("never scores an unsigned version even when it holds working coefficients", async () => {
    const { s } = source({ version: { id: "v2", signed: false, config: workingConfig } });
    expect(await assessCvdWho2019(s, "p1")).toMatchObject({ outcome: { status: "not_scored_instrument_off" } });
  });
  it("keeps the real clinical reason for a refusal even while the instrument is off", async () => {
    const a = source({ version: { id: "v1", signed: false, config: emptyConfig }, facts: facts({ knownDiabetes: true }) });
    expect(await assessCvdWho2019(a.s, "p1")).toMatchObject({ outcome: { status: "not_scored_known_diabetes" } });
    const b = source({ version: { id: "v1", signed: false, config: emptyConfig }, facts: facts({ systolic: 170 }) });
    expect(await assessCvdWho2019(b.s, "p1")).toMatchObject({ outcome: { status: "not_scored_treatment_indicated" } });
  });
  it("falls back to recording the refusal when the database says not live", async () => {
    const { s, calls } = source({ failScored: true });
    const r = await assessCvdWho2019(s, "p1");
    expect(r).toMatchObject({ ok: true, outcome: { status: "not_scored_instrument_off" } });
    expect(calls.map((c) => c.outcome.status)).toEqual(["scored", "not_scored_instrument_off"]);
  });
  it("names the trigger from the reassessment reasons", async () => {
    expect(await triggerFor(["yearly"])).toBe("yearly");
    expect(await triggerFor(["new_chronic_condition"])).toBe("major_change");
    expect(await triggerFor(["yearly"], "initial")).toBe("initial");
    expect(await triggerFor([])).toBe("manual");
  });
  it("reports a missing record or instrument instead of writing", async () => {
    const a = source({ facts: null });
    expect(await assessCvdWho2019(a.s, "p1")).toEqual({ ok: false, reason: "no_record" });
    const b = source({ version: null });
    expect(await assessCvdWho2019(b.s, "p1")).toEqual({ ok: false, reason: "no_instrument" });
    expect(a.calls).toHaveLength(0);
    expect(b.calls).toHaveLength(0);
  });
  it("reports a failed write", async () => {
    const s: CvdDataSource = { ...source().s, record: async () => ({ ok: false, code: "boom" }) };
    expect(await assessCvdWho2019(s, "p1")).toEqual({ ok: false, reason: "write_failed" });
  });
});
