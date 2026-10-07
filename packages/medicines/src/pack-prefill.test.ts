import { describe, expect, it } from "@jest/globals";
import { canSubmitAddForm, prefillFromPackReading, type PackReadingLike } from "./pack-prefill";

const reading = (over: Partial<PackReadingLike> = {}): PackReadingLike => ({
  drug_name: "Amlodipine", brand_name: null, strength: "5mg", form: "tablet", nafdac_number: "A4-1234",
  confidence: "high", unreadable_reason: null, ...over,
});

describe("prefillFromPackReading", () => {
  it("fills the form fields from a clear reading", () => {
    expect(prefillFromPackReading(reading())).toEqual({
      drugName: "Amlodipine", dose: "5mg", form: "tablet", brandName: "", nafdacNumber: "A4-1234", lowConfidence: false,
    });
  });
  it("falls back to the brand name and flags low confidence", () => {
    const p = prefillFromPackReading(reading({ drug_name: null, brand_name: " Norvasc ", strength: null, form: null, nafdac_number: null, confidence: "low" }));
    expect(p).toEqual({ drugName: "Norvasc", dose: "", form: "", brandName: "Norvasc", nafdacNumber: "", lowConfidence: true });
  });
  it("returns null for an unreadable photo or one with no name at all", () => {
    expect(prefillFromPackReading(reading({ unreadable_reason: "blurred" }))).toBeNull();
    expect(prefillFromPackReading(reading({ drug_name: null, brand_name: null }))).toBeNull();
  });
});

describe("canSubmitAddForm: nothing persists unconfirmed", () => {
  it("refuses an empty name", () => {
    expect(canSubmitAddForm({ hasName: false, prefilledFromPhoto: false, confirmedAgainstPack: false })).toBe(false);
  });
  it("refuses a photo prefill the patient has not confirmed", () => {
    expect(canSubmitAddForm({ hasName: true, prefilledFromPhoto: true, confirmedAgainstPack: false })).toBe(false);
  });
  it("allows a confirmed photo prefill and a hand-typed form", () => {
    expect(canSubmitAddForm({ hasName: true, prefilledFromPhoto: true, confirmedAgainstPack: true })).toBe(true);
    expect(canSubmitAddForm({ hasName: true, prefilledFromPhoto: false, confirmedAgainstPack: false })).toBe(true);
  });
});
