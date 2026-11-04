import { describe, expect, it } from "@jest/globals";
import { testingDaysOffer } from "./testing-days-offer";

const rows = [
  { code: "plus", kind: "membership", name_key: "n.plus", amount_kobo: 150_000_00 },
  { code: "base", kind: "membership", name_key: "n.base", amount_kobo: 60_000_00 },
  { code: "base2", kind: "membership", name_key: "n.base2", amount_kobo: 50_000_00 },
  { code: "up", kind: "membership", name_key: "n.up", amount_kobo: 69_000_00 },
  { code: "pack", kind: "care_pack", name_key: "n.pack", amount_kobo: 5_000_00 },
];
const panel = (c: string) => (c === "plus" ? true : c === "base" ? false : null);
const upgrade = (c: string) => c === "up";

describe("testingDaysOffer", () => {
  it("lists only real Membership options, cheapest first, with the price in kobo, never the retired panel option or the upgrade", () => {
    const o = testingDaysOffer(rows, panel, upgrade);
    expect(o.options.map((x) => [x.code, x.amountKobo, x.panel])).toEqual([["base2", 5_000_000, false], ["base", 6_000_000, false]]);
    expect(o.showPanelTests).toBe(false);
  });
  it("T2-01: an option that includes the yearly blood panel (Membership Plus) is never offered, even if the catalogue returns it", () => {
    expect(testingDaysOffer([rows[0]!], panel, upgrade).options).toEqual([]);
    // sabotage: a panel predicate that says no lets the same row through, so the filter is what removes it
    expect(testingDaysOffer([rows[0]!], () => false, upgrade).options.map((x) => x.code)).toEqual(["plus"]);
  });
  it("gives nothing (never a guessed price) when the catalogue is closed, unreadable or has a bad amount", () => {
    expect(testingDaysOffer([], panel, upgrade).options).toEqual([]);
    expect(testingDaysOffer(null, panel, upgrade).options).toEqual([]);
    expect(testingDaysOffer([{ ...rows[1]!, amount_kobo: 0 }, { ...rows[1]!, amount_kobo: 1.5 }], panel, upgrade).options).toEqual([]);
  });
});
