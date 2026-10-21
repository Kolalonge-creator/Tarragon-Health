import { describe, expect, it } from "@jest/globals";
import { summariseMeal } from "./meal-summary";
import { isValidGtin, normaliseBarcode, parseBarcodeLookup } from "./gtin";
import { compressFoodList, expandFoodList } from "./food-list";
import { portionUnitLabel, resolvePortionGrams } from "./catalogue";
import { parseFoodText } from "./parser";
import { analyseNutrition } from "./analysis";
import { FIXTURE_CATALOGUE } from "./test-fixtures";

const SUMMARY = { light_below_kcal: 400, heavy_above_kcal: 750, salty_above_sodium_mg: 800, sugary_above_sugar_g: 25 };

describe("summariseMeal", () => {
  it("answers in words", () => {
    expect(summariseMeal({ caloriesKcal: 300, sodiumMg: 100, reliable: true }, SUMMARY).word).toBe("light");
    expect(summariseMeal({ caloriesKcal: 400, sodiumMg: 100, reliable: true }, SUMMARY).word).toBe("balanced");
    expect(summariseMeal({ caloriesKcal: 750, sodiumMg: 100, reliable: true }, SUMMARY).word).toBe("balanced");
    expect(summariseMeal({ caloriesKcal: 751, sodiumMg: 100, reliable: true }, SUMMARY).word).toBe("heavy");
  });
  it("adds salty and sugary notes and a text a screen reader can read", () => {
    const s = summariseMeal({ caloriesKcal: 500, sodiumMg: 900, sugarG: 30, reliable: true }, SUMMARY);
    expect(s.notes).toEqual(["salty", "sugary"]);
    expect(s.text).toBe("A balanced meal, and a bit salty and sugary.");
  });
  it("says so when only part of the meal was counted", () => {
    const s = summariseMeal({ caloriesKcal: 500, sodiumMg: 100, reliable: false }, SUMMARY);
    expect(s.partial).toBe(true);
    expect(s.text).toContain("part of what you entered");
  });
  it("never uses numbers or colour names in the sentence", () => {
    const s = summariseMeal({ caloriesKcal: 900, sodiumMg: 900, sugarG: 40, reliable: true }, SUMMARY);
    expect(s.text).not.toMatch(/\d|red|green|amber|kcal/i);
  });
});

describe("gtin", () => {
  it("accepts real check digits (EAN-13, EAN-8, UPC-A)", () => {
    expect(isValidGtin("4006381333931")).toBe(true);
    expect(isValidGtin("96385074")).toBe(true);
    expect(isValidGtin("036000291452")).toBe(true);
  });
  it("refuses a wrong check digit, letters and odd lengths", () => {
    expect(isValidGtin("4006381333932")).toBe(false);
    expect(isValidGtin("ABC")).toBe(false);
    expect(isValidGtin("12345")).toBe(false);
    expect(isValidGtin("")).toBe(false);
  });
  it("removes spaces from a typed code", () => {
    expect(normaliseBarcode(" 4006 3813 33931 ")).toBe("4006381333931");
  });
  it("reads a lookup answer, and an unknown shape is not_found", () => {
    expect(parseBarcodeLookup({ status: "invalid" })).toEqual({ status: "invalid" });
    expect(parseBarcodeLookup({ status: "not_found" })).toEqual({ status: "not_found" });
    expect(parseBarcodeLookup(null)).toEqual({ status: "not_found" });
    expect(parseBarcodeLookup({ status: "found", code: "1", food_code: "eba", food_name: "Eba", product_name: "P", nafdac_number: "A4-1234" })).toMatchObject({
      status: "found",
      foodCode: "eba",
      nafdacNumber: "A4-1234",
    });
  });
});

describe("food list for the device", () => {
  it("round-trips the catalogue and the version changes only when the content does", () => {
    const list = compressFoodList(FIXTURE_CATALOGUE);
    const again = compressFoodList(FIXTURE_CATALOGUE);
    expect(list.version).toBe(again.version);
    const back = expandFoodList(list);
    expect(back.map((f) => f.code).sort()).toEqual(FIXTURE_CATALOGUE.map((f) => f.code).sort());
    const rice = back.find((f) => f.code === "white_rice");
    expect(rice?.portions.find((p) => p.isDefault)?.grams).toBe(200);
    const changed = compressFoodList(FIXTURE_CATALOGUE.map((f) => (f.code === "white_rice" ? { ...f, caloriesKcal100g: 131 } : f)));
    expect(changed.version).not.toBe(list.version);
  });
  it("recomputes the salt and sugar flags on the device", () => {
    const base = FIXTURE_CATALOGUE[0]!;
    const items = expandFoodList(
      compressFoodList([
        { ...base, code: "salty", sodiumMg100g: 1200, sugarG100g: 1 },
        { ...base, code: "sweet_drink", isDrink: true, sugarG100g: 12 },
        { ...base, code: "sweet_food", isDrink: false, sugarG100g: 12 },
      ]),
    );
    const by = (c: string) => items.find((i) => i.code === c)!;
    expect(by("salty").highSalt).toBe(true);
    expect(by("sweet_drink").highSugar).toBe(true);
    expect(by("sweet_food").highSugar).toBe(false);
  });
  it("is much smaller than the object form", () => {
    const compact = JSON.stringify(compressFoodList(FIXTURE_CATALOGUE)).length;
    const full = JSON.stringify(FIXTURE_CATALOGUE).length;
    expect(compact).toBeLessThan(full);
  });
});

describe("wrap and ladle units", () => {
  const withUnits = FIXTURE_CATALOGUE.map((f) => f);
  it("a wrap is a wrap, not a piece", () => {
    const [item] = parseFoodText("2 wraps of rice", withUnits);
    expect(item!.unit).toBe("wrap");
  });
  it("a ladle is a ladle, and a bowl is a bowl", () => {
    expect(parseFoodText("a ladle of rice", withUnits)[0]!.unit).toBe("ladle");
    expect(parseFoodText("a bowl of beans", withUnits)[0]!.unit).toBe("bowl");
  });
  it("falls back to a category default when a food has no row for the unit", () => {
    const rice = FIXTURE_CATALOGUE.find((f) => f.code === "white_rice")!;
    expect(resolvePortionGrams(rice, "ladle")).toBe(100);
    expect(resolvePortionGrams(rice, "wrap")).toBe(250);
  });
  it("labels", () => {
    expect(portionUnitLabel("wrap", 1)).toBe("wrap");
    expect(portionUnitLabel("ladle", 2)).toBe("ladles");
  });
});

describe("analysis carries sugar and salt", () => {
  it("sums known sugar and converts sodium to salt", () => {
    const rice = { ...FIXTURE_CATALOGUE.find((f) => f.code === "white_rice")!, sugarG100g: 0.5, sodiumMg100g: 400 };
    const items = parseFoodText("rice", [rice]);
    const a = analyseNutrition(items, [rice])!;
    expect(a.sugarG).toBe(1); // 200 g x 0.5 g
    expect(a.saltG).toBe(2); // 800 mg sodium x 2.5
  });
});
