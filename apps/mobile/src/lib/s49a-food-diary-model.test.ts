import { FOOD_PORTION_UNITS, type FoodCatalogueItem } from "@tarragon/shared";
import { appendPhrase, defaultUnit, foodPhrase, parseGuidance, searchFoods, NEVER_SHOW_BELOW_KCAL } from "./food-diary-model";

const EBA: FoodCatalogueItem = {
  id: "eba", code: "eba", name: "Eba", aliases: ["garri swallow"], category: "swallow", costTier: "budget",
  caloriesKcal100g: 150, carbsG100g: 36, proteinG100g: 0.7, fatG100g: 0.3, fibreG100g: 0.9, sodiumMg100g: 6,
  portions: [{ unit: "serving", grams: 200, isDefault: true }, { unit: "wrap", grams: 250, isDefault: false }],
};
const EGUSI: FoodCatalogueItem = { ...EBA, id: "egusi", code: "egusi_soup", name: "Egusi soup", aliases: [], category: "soup", portions: [{ unit: "ladle", grams: 100, isDefault: true }] };

const SUMMARY = { light_below_kcal: 400, heavy_above_kcal: 750, salty_above_sodium_mg: 800, sugary_above_sugar_g: 25 };
const TARGETS = { energyKcal: 1930, carbsG: 241, proteinG: 96, fatG: 64, fibreG: 27, sodiumMgMax: 2000, saltGMax: 5, sugarGMax: 48 };
const TOTALS = { caloriesKcal: 500, carbsG: 60, proteinG: 20, fatG: 10, fibreG: 5, sodiumMg: 400, sugarG: 6, uncountedMeals: 0 };

describe("pick from the list", () => {
  it("finds by name and by alias, and ignores a one-letter search", () => {
    expect(searchFoods([EBA, EGUSI], "eb").map((f) => f.code)).toEqual(["eba"]);
    expect(searchFoods([EBA, EGUSI], "garri").map((f) => f.code)).toEqual(["eba"]);
    expect(searchFoods([EBA, EGUSI], "e")).toEqual([]);
  });
  it("picks the default measure and writes a sentence the server can parse", () => {
    expect(defaultUnit(EBA)).toBe("serving");
    expect(foodPhrase(EBA, "wrap", 2)).toBe("2 wraps of eba");
    expect(foodPhrase(EGUSI, "ladle", 1)).toBe("1 ladle of egusi soup");
  });
  it("clamps the quantity", () => {
    expect(foodPhrase(EBA, "wrap", 0)).toBe("1 wrap of eba");
    expect(foodPhrase(EBA, "wrap", 99)).toBe("20 wraps of eba");
  });
  it("appends to what was already typed and respects the 500 limit", () => {
    expect(appendPhrase("", "1 wrap of eba")).toBe("1 wrap of eba");
    expect(appendPhrase("rice", "1 wrap of eba")).toBe("rice, 1 wrap of eba");
    expect(appendPhrase("x".repeat(600), "y").length).toBe(500);
  });
  it("the phone knows every unit the database can hold", () => {
    expect([...FOOD_PORTION_UNITS]).toEqual(expect.arrayContaining(["wrap", "ladle", "bowl"]));
  });
});

describe("parseGuidance: anything unexpected shows nothing", () => {
  it("hidden stays hidden", () => {
    expect(parseGuidance({ state: "hidden" })).toEqual({ state: "hidden" });
    expect(parseGuidance(null)).toEqual({ state: "hidden" });
    expect(parseGuidance("ok")).toEqual({ state: "hidden" });
    expect(parseGuidance({ state: "withheld" })).toEqual({ state: "hidden" });
  });
  it("reads a good answer", () => {
    const g = parseGuidance({ state: "ok", targets: TARGETS, totals: TOTALS, floorApplied: false, mode: "words", mealSummary: SUMMARY });
    expect(g.state).toBe("ok");
    if (g.state === "ok") expect(g.mode).toBe("words");
  });
  it("a missing or non-numeric number is hidden, not zero", () => {
    expect(parseGuidance({ state: "ok", targets: { ...TARGETS, fatG: "x" }, totals: TOTALS, mealSummary: SUMMARY, mode: "numbers" })).toEqual({ state: "hidden" });
    expect(parseGuidance({ state: "ok", targets: TARGETS, totals: TOTALS, mode: "numbers" })).toEqual({ state: "hidden" });
  });
  it("the phone refuses to show a calorie target under the safe minimum even if the server sent one", () => {
    expect(NEVER_SHOW_BELOW_KCAL).toBe(1000);
    expect(parseGuidance({ state: "ok", targets: { ...TARGETS, energyKcal: 900 }, totals: TOTALS, mealSummary: SUMMARY, mode: "numbers" })).toEqual({ state: "hidden" });
  });
  it("needs_profile carries the missing fields", () => {
    const g = parseGuidance({ state: "needs_profile", missing: ["weight"], mode: "numbers", mealSummary: SUMMARY });
    expect(g).toMatchObject({ state: "needs_profile", missing: ["weight"] });
  });
});
