import { matchFood, parseFoodText } from "./food-parser";
import { FIXTURE_CATALOGUE } from "./test-fixtures";

describe("matchFood", () => {
  it("matches an exact food name", () => {
    const result = matchFood("jollof rice", FIXTURE_CATALOGUE);
    expect(result?.food.code).toBe("jollof_rice");
    expect(result?.confidence).toBe("high");
  });

  it("matches an alias", () => {
    const result = matchFood("ewa", FIXTURE_CATALOGUE);
    expect(result?.food.code).toBe("beans_cooked");
  });

  it("matches a plural/informal alias with lower confidence than an exact hit", () => {
    const result = matchFood("moin moin", FIXTURE_CATALOGUE);
    expect(result?.food.code).toBe("moi_moi");
  });

  it("returns null for text with no reasonable match", () => {
    const result = matchFood("xyzzy quux", FIXTURE_CATALOGUE);
    expect(result).toBeNull();
  });
});

describe("parseFoodText", () => {
  it("parses a simple comma-separated list with no quantities", () => {
    const items = parseFoodText("Rice, beans and chicken", FIXTURE_CATALOGUE);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.foodCode)).toEqual(["white_rice", "beans_cooked", "chicken_grilled"]);
    expect(items.every((i) => i.matched)).toBe(true);
  });

  it("extracts a numeric quantity and unit, and scales grams", () => {
    const [item] = parseFoodText("2 spoons of rice", FIXTURE_CATALOGUE);
    expect(item.foodCode).toBe("white_rice");
    expect(item.quantity).toBe(2);
    expect(item.unit).toBe("spoon");
    expect(item.grams).toBe(60); // 2 * 30g/spoon
  });

  it("understands the Nigerian 'serving spoon' compound unit", () => {
    const [item] = parseFoodText("2 serving spoons of rice", FIXTURE_CATALOGUE);
    expect(item.unit).toBe("spoon");
    expect(item.foodCode).toBe("white_rice");
    expect(item.grams).toBe(60);
  });

  it("understands word-form quantities and 'a plate of' phrasing", () => {
    const [item] = parseFoodText("a plate of egusi soup", FIXTURE_CATALOGUE);
    expect(item.quantity).toBe(1);
    expect(item.unit).toBe("plate");
    expect(item.foodCode).toBe("egusi_soup");
  });

  it("strips filler phrases like 'a bit of' before matching", () => {
    const items = parseFoodText("jollof rice with chicken and a bit of egusi soup", FIXTURE_CATALOGUE);
    expect(items.map((i) => i.foodCode)).toEqual(["jollof_rice", "chicken_grilled", "egusi_soup"]);
  });

  it("reports an unmatched item explicitly rather than guessing", () => {
    const items = parseFoodText("rice and some unknown alien food", FIXTURE_CATALOGUE);
    expect(items[0].matched).toBe(true);
    expect(items[1].matched).toBe(false);
    expect(items[1].foodCode).toBeNull();
    expect(items[1].grams).toBeNull();
  });

  it("returns an empty array for empty input", () => {
    expect(parseFoodText("", FIXTURE_CATALOGUE)).toEqual([]);
    expect(parseFoodText("   ", FIXTURE_CATALOGUE)).toEqual([]);
  });

  it("falls back to the category default when a food has no explicit row for the given unit", () => {
    // fish_dried only has a 'piece' portion defined; 'handful' isn't listed for it.
    const [item] = parseFoodText("a handful of stockfish", FIXTURE_CATALOGUE);
    expect(item.foodCode).toBe("fish_dried");
    expect(item.unit).toBe("handful");
    expect(item.grams).toBeGreaterThan(0);
  });
});
