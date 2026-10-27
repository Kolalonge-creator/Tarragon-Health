import { describe, expect, it } from "@jest/globals";
import { FAMILY_RELATIONSHIPS, validateFamilyHistory, validateProcedure } from "./health-history";

const NOW = new Date("2026-10-20T10:00:00Z");

describe("validateProcedure", () => {
  it("accepts a name alone and trims it", () => {
    expect(validateProcedure({ name: "  Appendectomy " }, NOW)).toEqual({ ok: true, value: { name: "Appendectomy", year: null, facility: null } });
  });
  it("keeps a rough year and a facility", () => {
    expect(validateProcedure({ name: "Caesarean", year: "2019", facility: " LUTH " }, NOW)).toEqual({ ok: true, value: { name: "Caesarean", year: 2019, facility: "LUTH" } });
  });
  it("refuses an empty name, a future year, a non-numeric year and a year before 1900", () => {
    expect(validateProcedure({ name: " " }, NOW)).toEqual({ ok: false, error: "name_required" });
    expect(validateProcedure({ name: "x", year: "2027" }, NOW)).toEqual({ ok: false, error: "year_future" });
    expect(validateProcedure({ name: "x", year: "20a9" }, NOW)).toEqual({ ok: false, error: "year_invalid" });
    expect(validateProcedure({ name: "x", year: "1899" }, NOW)).toEqual({ ok: false, error: "year_invalid" });
  });
  it("refuses over-long text", () => {
    expect(validateProcedure({ name: "x".repeat(201) }, NOW)).toEqual({ ok: false, error: "name_too_long" });
    expect(validateProcedure({ name: "x", facility: "y".repeat(201) }, NOW)).toEqual({ ok: false, error: "facility_too_long" });
  });
});

describe("validateFamilyHistory", () => {
  it("accepts every listed relative", () => {
    for (const r of FAMILY_RELATIONSHIPS) expect(validateFamilyHistory({ condition: "Diabetes", relationship: r }).ok).toBe(true);
  });
  it("refuses an unknown relative, an empty condition and an impossible age", () => {
    expect(validateFamilyHistory({ condition: "Diabetes", relationship: "cousin" })).toEqual({ ok: false, error: "relationship_invalid" });
    expect(validateFamilyHistory({ condition: "", relationship: "mother" })).toEqual({ ok: false, error: "condition_required" });
    expect(validateFamilyHistory({ condition: "x", relationship: "mother", onsetAge: "121" })).toEqual({ ok: false, error: "onset_invalid" });
    expect(validateFamilyHistory({ condition: "x", relationship: "mother", onsetAge: "4.5" })).toEqual({ ok: false, error: "onset_invalid" });
  });
  it("reads an age of onset", () => {
    expect(validateFamilyHistory({ condition: "Stroke", relationship: "father", onsetAge: "58" })).toEqual({ ok: true, value: { condition: "Stroke", relationship: "father", onsetAge: 58 } });
  });
});
