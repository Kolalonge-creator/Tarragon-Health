import { describe, expect, it } from "@jest/globals";
import { resolveFacilityChoice } from "./facility-choice";

describe("resolveFacilityChoice (S64, 15.6)", () => {
  it("a directory entry wins and clears any typed text, so both are never sent", () => {
    expect(resolveFacilityChoice("fac-1", "Some clinic")).toEqual({ facilityId: "fac-1", freeText: null });
  });
  it("typed text is the fallback, trimmed and capped", () => {
    expect(resolveFacilityChoice("", "  Mercy Clinic  ")).toEqual({ facilityId: null, freeText: "Mercy Clinic" });
    expect(resolveFacilityChoice("", "x".repeat(300))?.freeText).toHaveLength(200);
  });
  it("nothing chosen clears the facility", () => {
    expect(resolveFacilityChoice("  ", "   ")).toEqual({ facilityId: null, freeText: null });
  });
});
