import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { formatNaira } from "@tarragon/commerce";
import { loadFoundingOffer, parseFoundingOffer } from "./founding-offer";
import { foundingPriceLabel } from "./membership";

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

describe("foundingPriceLabel", () => {
  it("takes the percent off the one Membership price in config, rounding the discount down as the pricing engine does", () => {
    const k = (getProposedConfig("commerce.membership_prices").value as { individual_kobo: number }).individual_kobo;
    expect(foundingPriceLabel(10)).toBe(formatNaira(k - Math.floor((k * 10) / 100)));
    // the founder's 2026-11-04 terms against today's config: 10% off 100,000
    expect(foundingPriceLabel(10)).toBe("90,000");
  });
});
