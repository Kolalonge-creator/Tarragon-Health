import { describe, expect, it } from "@jest/globals";
import { EMPTY_CONTEXT } from "@tarragon/symptom-triage-engine";
import { parseCheckContext } from "./context";

describe("parseCheckContext", () => {
  it("maps the database answer", () => {
    const c = parseCheckContext({ age_years: 30, sex: "female", pregnant: true, conditions: ["asthma"], medicines: [], readings: { spo2_pct: 91, systolic: "150", junk: 1 } });
    expect(c.ageYears).toBe(30);
    expect(c.pregnant).toBe(true);
    expect(c.readings).toEqual({ spo2_pct: 91, systolic: 150 });
  });
  it("anything malformed means nothing is known (fewer layers, never a lower result)", () => {
    expect(parseCheckContext(null)).toEqual(EMPTY_CONTEXT);
    expect(parseCheckContext({ age_years: "x" })).toEqual(EMPTY_CONTEXT);
  });
});
