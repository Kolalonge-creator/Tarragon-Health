import { normaliseIcd10 } from "./icd10";

describe("normaliseIcd10", () => {
  it("accepts a code with and without a decimal part", () => {
    expect(normaliseIcd10("B50.9")).toEqual({ ok: true, code: "B50.9" });
    expect(normaliseIcd10("I10")).toEqual({ ok: true, code: "I10" });
    expect(normaliseIcd10("O14.1")).toEqual({ ok: true, code: "O14.1" });
  });
  it("trims and upper-cases", () => {
    expect(normaliseIcd10("  e11.9 ")).toEqual({ ok: true, code: "E11.9" });
  });
  it("treats empty as no code", () => {
    expect(normaliseIcd10("")).toEqual({ ok: true, code: null });
    expect(normaliseIcd10("   ")).toEqual({ ok: true, code: null });
  });
  it("refuses free text and malformed codes, as the database does", () => {
    for (const bad of ["malaria", "50.9", "B5", "B50.", "B50.99999", "B50,9", "I 10"]) {
      expect(normaliseIcd10(bad)).toEqual({ ok: false });
    }
  });
  it("refuses a letter U first character (not a valid chapter start)", () => {
    expect(normaliseIcd10("U07.1")).toEqual({ ok: false });
  });
});
