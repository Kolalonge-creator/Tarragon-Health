import { normaliseIcd10, saveCodeIfChanged } from "./icd10";

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
  it("refuses a first letter U, as the database check does", () => {
    expect(normaliseIcd10("U07.1")).toEqual({ ok: false });
  });
});

describe("saveCodeIfChanged", () => {
  it("saves a changed code, normalised", async () => {
    const save = jest.fn(async () => {});
    expect(await saveCodeIfChanged(" e11.9", null, save)).toEqual({ ok: true, saved: true });
    expect(save).toHaveBeenCalledWith("E11.9");
  });
  it("clears the code when the box is emptied", async () => {
    const save = jest.fn(async () => {});
    expect(await saveCodeIfChanged("", "E11.9", save)).toEqual({ ok: true, saved: true });
    expect(save).toHaveBeenCalledWith(null);
  });
  it("does not call the database when nothing changed", async () => {
    const save = jest.fn(async () => {});
    expect(await saveCodeIfChanged("E11.9", "E11.9", save)).toEqual({ ok: true, saved: false });
    expect(await saveCodeIfChanged("", null, save)).toEqual({ ok: true, saved: false });
    expect(save).not.toHaveBeenCalled();
  });
  it("never sends a malformed code", async () => {
    const save = jest.fn(async () => {});
    expect(await saveCodeIfChanged("malaria", null, save)).toEqual({ ok: false, reason: "malformed" });
    expect(save).not.toHaveBeenCalled();
  });
  it("reports a refused save so the caller can stop before signing", async () => {
    const save = jest.fn(async () => { throw new Error("This encounter note is finalized and cannot be edited."); });
    expect(await saveCodeIfChanged("B50.9", null, save)).toEqual({
      ok: false,
      reason: "refused",
      message: "This encounter note is finalized and cannot be edited.",
    });
  });
});
