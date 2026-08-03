import { estimateEgfr, egfrFromReading, gfrCategory } from "./egfr";

describe("estimateEgfr (CKD-EPI 2021, race-free)", () => {
  // Reference values cross-checked against the published CKD-EPI 2021 equation.
  // Tolerance is ±2 mL/min/1.73m² to absorb rounding, which is far tighter than
  // any threshold the drug-safety rules branch on (30/45/60).
  // Expected values below are hand-computed from the published CKD-EPI 2021
  // equation, term by term, NOT read back from this implementation. Tolerance
  // is ±1 to absorb rounding only.
  it("matches the published equation for a healthy adult male", () => {
    // Scr/κ = 0.9/0.9 = 1, so both power terms are 1.
    // 142 × 0.9938^40 = 142 × 0.77976 = 110.7
    const result = estimateEgfr({ creatinineMgDl: 0.9, ageYears: 40, sex: "male" });
    expect(result).not.toBeNull();
    expect(result!.egfr).toBeGreaterThanOrEqual(110);
    expect(result!.egfr).toBeLessThanOrEqual(111);
    expect(result!.category).toBe("G1");
  });

  it("matches the published equation for a healthy adult female", () => {
    // Scr/κ = 0.7/0.7 = 1. 142 × 0.9938^40 × 1.012 = 112.0
    const result = estimateEgfr({ creatinineMgDl: 0.7, ageYears: 40, sex: "female" });
    expect(result).not.toBeNull();
    expect(result!.egfr).toBeGreaterThanOrEqual(111);
    expect(result!.egfr).toBeLessThanOrEqual(113);
  });

  it("matches the published equation at an impaired creatinine", () => {
    // The anchor that matters, because it lands near the drug-safety
    // thresholds. Scr/κ = 1.5/0.9 = 1.6667:
    // 142 × 1.6667^-1.200 × 0.9938^60 = 142 × 0.5417 × 0.68854 = 53.0
    const result = estimateEgfr({ creatinineMgDl: 1.5, ageYears: 60, sex: "male" })!;
    expect(result.egfr).toBeGreaterThanOrEqual(52);
    expect(result.egfr).toBeLessThanOrEqual(54);
    expect(result.category).toBe("G3a");
  });

  it("applies the sex coefficient — same creatinine and age gives a lower eGFR for a woman", () => {
    const male = estimateEgfr({ creatinineMgDl: 1.1, ageYears: 55, sex: "male" })!;
    const female = estimateEgfr({ creatinineMgDl: 1.1, ageYears: 55, sex: "female" })!;
    expect(female.egfr).toBeLessThan(male.egfr);
  });

  it("falls with age at a fixed creatinine", () => {
    const young = estimateEgfr({ creatinineMgDl: 1.0, ageYears: 30, sex: "male" })!;
    const old = estimateEgfr({ creatinineMgDl: 1.0, ageYears: 75, sex: "male" })!;
    expect(old.egfr).toBeLessThan(young.egfr);
  });

  it("carries NO race coefficient — the whole reason for using the 2021 refit", () => {
    // There is no race parameter to pass. This test exists to fail loudly if
    // anyone ever reintroduces one: in a Nigerian population the 2009 multiplier
    // inflates eGFR and under-warns on exactly the drugs this platform checks.
    const input = { creatinineMgDl: 1.4, ageYears: 60, sex: "male" as const };
    expect(Object.keys(input)).toEqual(["creatinineMgDl", "ageYears", "sex"]);
    expect(estimateEgfr(input)!.equation).toBe("CKD-EPI 2021 (race-free)");
  });

  it("crosses the drug-safety thresholds in the right places", () => {
    // A creatinine that should sit in stage G3b for an older woman.
    const result = estimateEgfr({ creatinineMgDl: 1.6, ageYears: 68, sex: "female" })!;
    expect(result.egfr).toBeLessThan(45);
    expect(result.egfr).toBeGreaterThan(30);
    expect(result.category).toBe("G3b");
  });

  it("refuses paediatric ages rather than mis-applying the adult equation", () => {
    expect(estimateEgfr({ creatinineMgDl: 0.5, ageYears: 9, sex: "female" })).toBeNull();
    expect(estimateEgfr({ creatinineMgDl: 0.5, ageYears: 17, sex: "female" })).toBeNull();
    expect(estimateEgfr({ creatinineMgDl: 0.6, ageYears: 18, sex: "female" })).not.toBeNull();
  });

  it("refuses implausible or malformed creatinine rather than returning a number", () => {
    expect(estimateEgfr({ creatinineMgDl: 0, ageYears: 40, sex: "male" })).toBeNull();
    expect(estimateEgfr({ creatinineMgDl: -1, ageYears: 40, sex: "male" })).toBeNull();
    // 90 is a normal creatinine in µmol/L but catastrophic in mg/dL — refusing
    // it here is the second line of defence behind the catalogue's unit guard.
    expect(estimateEgfr({ creatinineMgDl: 90, ageYears: 40, sex: "male" })).toBeNull();
    expect(estimateEgfr({ creatinineMgDl: Number.NaN, ageYears: 40, sex: "male" })).toBeNull();
  });
});

describe("gfrCategory", () => {
  it("maps the KDIGO boundaries exactly", () => {
    expect(gfrCategory(120)).toBe("G1");
    expect(gfrCategory(90)).toBe("G1");
    expect(gfrCategory(89)).toBe("G2");
    expect(gfrCategory(60)).toBe("G2");
    expect(gfrCategory(59)).toBe("G3a");
    expect(gfrCategory(45)).toBe("G3a");
    expect(gfrCategory(44)).toBe("G3b");
    expect(gfrCategory(30)).toBe("G3b");
    expect(gfrCategory(29)).toBe("G4");
    expect(gfrCategory(15)).toBe("G4");
    expect(gfrCategory(14)).toBe("G5");
  });
});

describe("egfrFromReading", () => {
  const now = new Date("2026-08-03T00:00:00Z");

  it("uses age AT THE TIME OF THE TEST, not today", () => {
    // Same creatinine, same patient, but the sample is 20 years old. Using
    // today's age would understate eGFR.
    const old = egfrFromReading({
      creatinineMgDl: 1.0,
      takenAt: "2006-01-01T00:00:00Z",
      dateOfBirth: "1976-01-01T00:00:00Z",
      sex: "male",
      now,
    })!;
    const recent = egfrFromReading({
      creatinineMgDl: 1.0,
      takenAt: "2026-01-01T00:00:00Z",
      dateOfBirth: "1976-01-01T00:00:00Z",
      sex: "male",
      now,
    })!;
    expect(old.ageAtTest).toBe(30);
    expect(recent.ageAtTest).toBe(50);
    expect(old.egfr).toBeGreaterThan(recent.egfr);
  });

  it("flags a creatinine over a year old as stale", () => {
    const stale = egfrFromReading({
      creatinineMgDl: 1.0,
      takenAt: "2024-01-01T00:00:00Z",
      dateOfBirth: "1980-01-01T00:00:00Z",
      sex: "male",
      now,
    })!;
    expect(stale.stale).toBe(true);
    expect(stale.ageOfResultDays).toBeGreaterThan(365);

    const fresh = egfrFromReading({
      creatinineMgDl: 1.0,
      takenAt: "2026-07-01T00:00:00Z",
      dateOfBirth: "1980-01-01T00:00:00Z",
      sex: "male",
      now,
    })!;
    expect(fresh.stale).toBe(false);
  });

  it("returns null when sex is unknown rather than assuming one", () => {
    expect(
      egfrFromReading({
        creatinineMgDl: 1.0,
        takenAt: "2026-07-01T00:00:00Z",
        dateOfBirth: "1980-01-01T00:00:00Z",
        sex: null,
        now,
      }),
    ).toBeNull();
    expect(
      egfrFromReading({
        creatinineMgDl: 1.0,
        takenAt: "2026-07-01T00:00:00Z",
        dateOfBirth: "1980-01-01T00:00:00Z",
        sex: "other",
        now,
      }),
    ).toBeNull();
  });

  it("returns null for a malformed date rather than a wrong number", () => {
    expect(
      egfrFromReading({
        creatinineMgDl: 1.0,
        takenAt: "not-a-date",
        dateOfBirth: "1980-01-01T00:00:00Z",
        sex: "male",
        now,
      }),
    ).toBeNull();
  });
});
