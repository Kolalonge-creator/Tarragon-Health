import { describe, expect, it } from "@jest/globals";
import {
  ANNUAL_DURATION_DAYS,
  ANNUAL_MONTHS,
  MAX_NOT_INCLUDED,
  monthlyEquivalentKobo,
  parseNotIncluded,
  parsePriceChangeNotices,
} from "../../../supabase/functions/_shared/commerce/price-transparency.ts";

describe("monthlyEquivalentKobo", () => {
  it("shows a yearly price as about a twelfth, in whole naira", () => {
    expect(monthlyEquivalentKobo(8_400_000, 365)).toBe(700_000); // 84,000 naira a year is about 7,000 a month
    expect(monthlyEquivalentKobo(12_900_000, 365)).toBe(1_075_000); // 129,000 / 12 = 10,750 exactly
    expect(monthlyEquivalentKobo(12_000_000, 365)).toBe(1_000_000);
  });

  it("rounds half up to the nearest whole naira, with integer arithmetic only", () => {
    // 1,000 naira / 12 = 83.33 -> 83
    expect(monthlyEquivalentKobo(100_000, 365)).toBe(8_300);
    // 1,050 naira / 12 = 87.5 exactly -> half rounds up to 88
    expect(monthlyEquivalentKobo(105_000, 365)).toBe(8_800);
    // one kobo under the half: 1,049.99 / 12 = 87.4991 -> 87
    expect(monthlyEquivalentKobo(104_999, 365)).toBe(8_700);
    for (const v of [100_000, 105_000, 104_999, 8_400_001]) expect(Number.isInteger(monthlyEquivalentKobo(v, 365))).toBe(true);
  });

  it("never shows a monthly line for Free, a covered price, a bad number or a rounded-to-zero figure", () => {
    expect(monthlyEquivalentKobo(0, 365)).toBeNull(); // Free, or a sponsor covers all of it
    expect(monthlyEquivalentKobo(-100, 365)).toBeNull();
    expect(monthlyEquivalentKobo(Number.NaN, 365)).toBeNull();
    expect(monthlyEquivalentKobo(1_000.5, 365)).toBeNull();
    expect(monthlyEquivalentKobo(500, 365)).toBeNull(); // 5 naira a year is under half a naira a month
  });

  it("applies only to a yearly item", () => {
    expect(monthlyEquivalentKobo(8_400_000, null)).toBeNull();
    expect(monthlyEquivalentKobo(8_400_000, 90)).toBeNull();
    expect(monthlyEquivalentKobo(8_400_000, 365.5)).toBeNull();
    expect(monthlyEquivalentKobo(8_400_000, ANNUAL_DURATION_DAYS.min - 1)).toBeNull();
    expect(monthlyEquivalentKobo(8_400_000, ANNUAL_DURATION_DAYS.min)).not.toBeNull();
    expect(monthlyEquivalentKobo(8_400_000, ANNUAL_DURATION_DAYS.max)).not.toBeNull();
    expect(monthlyEquivalentKobo(8_400_000, ANNUAL_DURATION_DAYS.max + 1)).toBeNull();
  });

  it("uses twelve months", () => {
    expect(ANNUAL_MONTHS).toBe(12);
  });
});

describe("parseNotIncluded", () => {
  const row = (items: unknown[]) => [{ code: "membership_annual", items }];

  it("reads words-only entries and priced extras, keeping the database's order", () => {
    const r = parseNotIncluded(row([
      { label_key: "catalog.notincl.medicines", extra_code: null, amount_kobo: null },
      { label_key: "catalog.consultation_single.name", extra_code: "consultation_single", amount_kobo: 1_500_000 },
    ]));
    expect(r["membership_annual"]).toEqual([
      { labelKey: "catalog.notincl.medicines", extraCode: null, amountKobo: null },
      { labelKey: "catalog.consultation_single.name", extraCode: "consultation_single", amountKobo: 1_500_000 },
    ]);
  });

  it("turns a missing, zero, negative, fractional or text price into Ask us (null), never a number", () => {
    const r = parseNotIncluded(row([
      { label_key: "catalog.a.name", extra_code: "a_item", amount_kobo: null },
      { label_key: "catalog.b.name", extra_code: "b_item", amount_kobo: 0 },
      { label_key: "catalog.c.name", extra_code: "c_item", amount_kobo: -5 },
      { label_key: "catalog.d.name", extra_code: "d_item", amount_kobo: 10.5 },
      { label_key: "catalog.e.name", extra_code: "e_item", amount_kobo: "1000" },
      { label_key: "catalog.f.name", extra_code: "f_item" },
    ]));
    expect((r["membership_annual"] ?? []).map((e) => e.amountKobo)).toEqual([null, null, null, null, null, null]);
  });

  it("drops a bad entry on its own and keeps the rest", () => {
    const r = parseNotIncluded(row([
      "nope", null, { label_key: 5 }, { label_key: "Has Spaces" }, { amount_kobo: 100 },
      { label_key: "catalog.ok.name", extra_code: 7, amount_kobo: 100 },
    ]));
    expect(r["membership_annual"]).toEqual([{ labelKey: "catalog.ok.name", extraCode: null, amountKobo: 100 }]);
  });

  it("caps the list and ignores rows that are not rows", () => {
    const many = Array.from({ length: MAX_NOT_INCLUDED + 5 }, (_, i) => ({ label_key: `catalog.x${i}.name`, extra_code: null, amount_kobo: null }));
    expect(parseNotIncluded(row(many))["membership_annual"]).toHaveLength(MAX_NOT_INCLUDED);
    expect(parseNotIncluded([null, 3, { code: 1, items: [] }, { code: "a_b_c" }, { code: "a_b_c", items: "x" }])).toEqual({});
  });

  it("returns nothing for anything that is not a list", () => {
    expect(parseNotIncluded(null)).toEqual({});
    expect(parseNotIncluded({})).toEqual({});
    expect(parseNotIncluded("x")).toEqual({});
  });
});

describe("parsePriceChangeNotices", () => {
  const good = {
    item_code: "membership_annual", name_key: "catalog.membership_annual.name", paid_list_kobo: 12_000_000, new_kobo: 12_900_000,
    new_from: "2026-12-01T00:00:00+00:00", ends_at: "2027-03-01T10:00:00+00:00",
  };

  it("reads a well-formed notice", () => {
    expect(parsePriceChangeNotices([good])).toEqual([{
      itemCode: "membership_annual", nameKey: "catalog.membership_annual.name", paidListKobo: 12_000_000, newKobo: 12_900_000,
      newFrom: "2026-12-01T00:00:00+00:00", endsAt: "2027-03-01T10:00:00+00:00",
    }]);
  });

  it("drops anything malformed, unchanged or not whole kobo, one row at a time", () => {
    const rows = [
      null, "x", { ...good, item_code: 1 }, { ...good, name_key: null }, { ...good, paid_list_kobo: 0 }, { ...good, new_kobo: 1.5 },
      { ...good, new_from: "not a date" }, { ...good, ends_at: 5 }, { ...good, ends_at: "never" }, { ...good, new_kobo: good.paid_list_kobo }, good,
    ];
    expect(parsePriceChangeNotices(rows)).toHaveLength(1);
  });

  it("returns nothing for a non-list", () => {
    expect(parsePriceChangeNotices(undefined)).toEqual([]);
    expect(parsePriceChangeNotices({})).toEqual([]);
  });
});
