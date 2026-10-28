import { describe, expect, it } from "@jest/globals";
import { sponsorSplit } from "../../../supabase/functions/_shared/commerce/split.ts";

describe("sponsorSplit (A4)", () => {
  it("returns both parts for a part-covered order and keeps the name the database gave", () => {
    expect(sponsorSplit({ youKobo: 300_000, sponsorShareKobo: 200_000, sponsorName: "Acme" })).toEqual({ youKobo: 300_000, sponsorKobo: 200_000, sponsorName: "Acme" });
    expect(sponsorSplit({ youKobo: 300_000, sponsorShareKobo: 200_000, sponsorName: null })?.sponsorName).toBeNull();
  });
  it("is null when the person pays everything", () => {
    expect(sponsorSplit({ youKobo: 500_000, sponsorShareKobo: 0, sponsorName: "Acme" })).toBeNull();
  });
  it("is null when the sponsor pays everything (that case has its own wording)", () => {
    expect(sponsorSplit({ youKobo: 0, sponsorShareKobo: 500_000, sponsorName: "Acme" })).toBeNull();
  });
  it("is null for anything that is not integer kobo", () => {
    expect(sponsorSplit({ youKobo: 100.5, sponsorShareKobo: 200, sponsorName: null })).toBeNull();
    expect(sponsorSplit({ youKobo: 100, sponsorShareKobo: Number.NaN, sponsorName: null })).toBeNull();
  });
});
