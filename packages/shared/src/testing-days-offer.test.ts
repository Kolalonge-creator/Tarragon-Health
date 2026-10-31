import { describe, expect, it } from "@jest/globals";
import { testingDaysOffer } from "./testing-days-offer";

const rows = [
  { code: "plus", kind: "membership", name_key: "n.plus", amount_kobo: 129_000_00 },
  { code: "base", kind: "membership", name_key: "n.base", amount_kobo: 60_000_00 },
  { code: "up", kind: "membership", name_key: "n.up", amount_kobo: 69_000_00 },
  { code: "pack", kind: "care_pack", name_key: "n.pack", amount_kobo: 5_000_00 },
];
const panel = (c: string) => (c === "plus" ? true : c === "base" ? false : null);
const upgrade = (c: string) => c === "up";

describe("testingDaysOffer", () => {
  it("lists only real Membership options, cheapest first, with the price in kobo", () => {
    const o = testingDaysOffer(rows, panel, upgrade);
    expect(o.options.map((x) => [x.code, x.amountKobo, x.panel])).toEqual([["base", 6_000_000, false], ["plus", 12_900_000, true]]);
    expect(o.showPanelTests).toBe(true);
  });
  it("shows no panel tests when no option includes the panel", () => {
    expect(testingDaysOffer([rows[1]], panel, upgrade).showPanelTests).toBe(false);
  });
  it("gives nothing (never a guessed price) when the catalogue is closed, unreadable or has a bad amount", () => {
    expect(testingDaysOffer([], panel, upgrade).options).toEqual([]);
    expect(testingDaysOffer(null, panel, upgrade).options).toEqual([]);
    expect(testingDaysOffer([{ ...rows[0], amount_kobo: 0 }, { ...rows[0], amount_kobo: 1.5 }], panel, upgrade).options).toEqual([]);
  });
});
