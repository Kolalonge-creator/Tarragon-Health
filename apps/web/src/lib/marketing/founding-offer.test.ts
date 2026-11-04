import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { formatNaira } from "@tarragon/commerce";
import { loadFoundingOffer, parseFoundingOffer } from "./founding-offer";
import { foundingLadderPriceLabels } from "./membership";

const OPEN = { open: true, places_total: 100, places_left: 37, code: "FOUNDING10", percent: 10 };

describe("parseFoundingOffer", () => {
  it("reads an open offer", () => {
    expect(parseFoundingOffer(OPEN)).toEqual({ placesTotal: 100, placesLeft: 37, code: "FOUNDING10", percent: 10 });
  });

  it("gives null for a closed, full, malformed or over-sharing reply, so a page shows nothing rather than a wrong figure", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      { open: false },
      { open: false, places_total: 100, places_left: 0 },
      { ...OPEN, places_left: 0 },
      { ...OPEN, places_left: 101 },
      { ...OPEN, places_left: 1.5 },
      { ...OPEN, percent: 0 },
      { ...OPEN, percent: 101 },
      { ...OPEN, code: "lower10" },
      { ...OPEN, code: "" },
      { ...OPEN, note: "staff only" },
    ]) {
      expect(parseFoundingOffer(bad)).toBeNull();
    }
  });

  it("the loader gives null, never throws, when the database is not configured", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await expect(loadFoundingOffer()).resolves.toBeNull();
    if (url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  });
});

describe("foundingLadderPriceLabels", () => {
  it("takes the percent off the two config prices, rounding the discount down as the pricing engine does", () => {
    const l = getProposedConfig("commerce.membership_ladder").value as { evergreen_kobo: number; evergreen_plus_kobo: number };
    const off = (k: number, p: number) => k - Math.floor((k * p) / 100);
    expect(foundingLadderPriceLabels(10)).toEqual({ evergreen: "₦" + formatNaira(off(l.evergreen_kobo, 10)), evergreenPlus: "₦" + formatNaira(off(l.evergreen_plus_kobo, 10)) });
    // the founder's 2026-11-04 terms against today's config: 10% off 84,000 and 129,000
    expect(foundingLadderPriceLabels(10)).toEqual({ evergreen: "₦75,600", evergreenPlus: "₦116,100" });
  });
});
