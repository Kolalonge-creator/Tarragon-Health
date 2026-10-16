import { recommendedScreenings, SCREENINGS } from "./screening-journey";

/**
 * Pins the sex/age filtering that decides what a visitor sees. Real
 * conversion surface (same discipline as plan-finder.test.ts): a sex-crossed
 * recommendation here would be a clinical accuracy bug, not just a UI bug.
 */
describe("recommendedScreenings", () => {
  it("never recommends cervical or breast screening to a male visitor", () => {
    for (const band of ["18-24", "25-39", "40-49", "50-plus"] as const) {
      const names = recommendedScreenings(band, "male").map((item) => item.name);
      expect(names).not.toContain("Cervical Screening");
      expect(names).not.toContain("Breast Screening");
    }
  });

  it("never recommends prostate screening to a female visitor", () => {
    for (const band of ["18-24", "25-39", "40-49", "50-plus"] as const) {
      const names = recommendedScreenings(band, "female").map((item) => item.name);
      expect(names).not.toContain("Prostate (PSA) Screening");
    }
  });

  it("always includes the cardiometabolic check and blood group & genotype at any age or sex", () => {
    for (const band of ["18-24", "25-39", "40-49", "50-plus"] as const) {
      for (const sex of ["male", "female"] as const) {
        const names = recommendedScreenings(band, sex).map((item) => item.name);
        expect(names).toContain("Cardiometabolic Health Check");
        expect(names).toContain("Blood Group & Genotype");
      }
    }
  });

  it("only recommends cancer screening age bands from 40 upward", () => {
    for (const band of ["18-24", "25-39"] as const) {
      const names = recommendedScreenings(band, "female").map((item) => item.name);
      expect(names).not.toContain("Breast Screening");
    }
    expect(recommendedScreenings("40-49", "female").map((i) => i.name)).toContain(
      "Breast Screening"
    );
    expect(recommendedScreenings("50-plus", "male").map((i) => i.name)).toContain(
      "Prostate (PSA) Screening"
    );
  });

  it("recommends cervical screening from 25 upward, not the 18-24 band", () => {
    expect(recommendedScreenings("18-24", "female").map((i) => i.name)).not.toContain(
      "Cervical Screening"
    );
    expect(recommendedScreenings("25-39", "female").map((i) => i.name)).toContain(
      "Cervical Screening"
    );
  });

  it("every screening has exactly four journey steps", () => {
    for (const item of SCREENINGS) {
      expect(item.steps).toHaveLength(4);
    }
  });

  it("never claims prostate or breast screening is booked as a bare stand-alone test", () => {
    const prostate = SCREENINGS.find((item) => item.id === "prostate")!;
    const breast = SCREENINGS.find((item) => item.id === "breast")!;
    expect(prostate.steps[1].body).toContain("not sold as a stand-alone test");
    expect(breast.steps[1].body).toContain("rather than sold as a stand-alone booking");
  });
});
