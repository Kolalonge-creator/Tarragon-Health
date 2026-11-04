import { arrangeItems, EVERGREEN_CODE, EVERGREEN_PLUS_CODE, isTier, ladderActive, monthlyFramingKobo, panelIncluded, UPGRADE_CODE } from "../../../supabase/functions/_shared/commerce/tiers.ts";

interface CatalogueItem { code: string; amount_kobo: number }
const item = (code: string, amount: number): CatalogueItem => ({ code, amount_kobo: amount });
// Membership Plus and the upgrade are retired (T2-01, T2-09, 2026-11-04) and inactive in the catalogue; their fixtures stay only to prove the
// screen copes with a catalogue that still returns them. The Membership price is the live one, from the versioned config.
const PLUS = item(EVERGREEN_PLUS_CODE, 12_000_000);
const EG = item(EVERGREEN_CODE, 10_000_000);
const UP = item(UPGRADE_CODE, 4_500_000);
const FREE = { tier: null, isMember: false, inGrace: false, forSomeoneElse: false } as const;

describe("one Membership (T2-01, T2-09): the catalogue the database now serves holds only the Membership", () => {
  it("a Free person sees exactly one card, the Membership, and no upgrade", () => {
    const a = arrangeItems([EG], FREE);
    expect(ladderActive([EG])).toBe(true);
    expect(a.tierCards.map((i) => i.code)).toEqual([EVERGREEN_CODE]);
    expect(a.upgrade).toBeNull();
  });

  it("a Membership member and a Plus member still in their year have nothing to buy and are never offered an upgrade", () => {
    for (const tier of ["evergreen", "plus"] as const) {
      const a = arrangeItems([EG], { tier, isMember: true, inGrace: false, forSomeoneElse: false });
      expect(a.tierCards).toEqual([]);
      expect(a.upgrade).toBeNull();
    }
  });

  it("a Plus member in the grace after their year renews into the Membership only, and a gift is the Membership", () => {
    expect(arrangeItems([EG], { tier: "plus", isMember: true, inGrace: true, forSomeoneElse: false }).tierCards.map((i) => i.code)).toEqual([EVERGREEN_CODE]);
    expect(arrangeItems([EG], { tier: "plus", isMember: true, inGrace: false, forSomeoneElse: true }).tierCards.map((i) => i.code)).toEqual([EVERGREEN_CODE]);
  });

  it("the Membership card never carries the yearly blood panel", () => {
    expect(panelIncluded(EVERGREEN_CODE)).toBe(false);
  });
});

describe("the Membership ladder on the Membership screen", () => {
  it("before the ladder is on, the screen is the single-Membership screen and the upgrade never shows", () => {
    const a = arrangeItems([PLUS, UP], FREE);
    expect(ladderActive([PLUS, UP])).toBe(false);
    expect(a.tierCards).toEqual([]);
    expect(a.upgrade).toBeNull();
    expect(a.others.map((i) => i.code)).toEqual([EVERGREEN_PLUS_CODE]);
  });

  it("a Free person sees the two tier cards, Membership first, and no upgrade", () => {
    const a = arrangeItems([PLUS, UP, EG], FREE);
    expect(a.tierCards.map((i) => i.code)).toEqual([EVERGREEN_CODE, EVERGREEN_PLUS_CODE]);
    expect(a.upgrade).toBeNull();
  });

  it("an Membership member sees the upgrade only: no second Membership to buy", () => {
    const a = arrangeItems([PLUS, UP, EG], { tier: "evergreen", isMember: true, inGrace: false, forSomeoneElse: false });
    expect(a.tierCards).toEqual([]);
    expect(a.upgrade?.code).toBe(UPGRADE_CODE);
  });

  it("an Membership Plus member sees neither a purchase nor an upgrade", () => {
    const a = arrangeItems([PLUS, UP, EG], { tier: "plus", isMember: true, inGrace: false, forSomeoneElse: false });
    expect(a.tierCards).toEqual([]);
    expect(a.upgrade).toBeNull();
  });

  it("in the grace after the year ends the person can renew either tier and is not offered an upgrade", () => {
    const a = arrangeItems([PLUS, UP, EG], { tier: "evergreen", isMember: true, inGrace: true, forSomeoneElse: false });
    expect(a.tierCards.map((i) => i.code)).toEqual([EVERGREEN_CODE, EVERGREEN_PLUS_CODE]);
    expect(a.upgrade).toBeNull();
  });

  it("paying for someone else offers the two tiers and never the upgrade", () => {
    const a = arrangeItems([PLUS, UP, EG], { tier: "evergreen", isMember: true, inGrace: false, forSomeoneElse: true });
    expect(a.tierCards.map((i) => i.code)).toEqual([EVERGREEN_CODE, EVERGREEN_PLUS_CODE]);
    expect(a.upgrade).toBeNull();
  });

  it("isTier accepts exactly the two stored tiers", () => {
    expect(isTier("evergreen")).toBe(true);
    expect(isTier("plus")).toBe(true);
    expect(isTier("gold")).toBe(false);
    expect(isTier(null)).toBe(false);
    expect(isTier(undefined)).toBe(false);
  });

  it("an Evergreen member sees no upgrade when the catalogue does not carry it", () => {
    const a = arrangeItems([PLUS, EG], { tier: "evergreen", isMember: true, inGrace: false, forSomeoneElse: false });
    expect(a.upgrade).toBeNull();
    expect(a.tierCards).toEqual([]);
  });

  it("the annual blood panel is stated per card: no for Membership, yes for Membership Plus, nothing for other items", () => {
    expect(panelIncluded(EVERGREEN_CODE)).toBe(false);
    expect(panelIncluded(EVERGREEN_PLUS_CODE)).toBe(true);
    expect(panelIncluded(UPGRADE_CODE)).toBeNull();
    expect(panelIncluded("anything_else")).toBeNull();
  });

  it("the monthly framing is a rounded whole-naira figure in integer kobo, framing only", () => {
    expect(monthlyFramingKobo(10_000_000)).toBe(833_300);
    expect(monthlyFramingKobo(9_000_000)).toBe(750_000);
    expect(Number.isInteger(monthlyFramingKobo(10_000_000))).toBe(true);
  });
});
