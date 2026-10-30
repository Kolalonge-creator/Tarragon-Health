import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import {
  formatRange,
  mealsFromFoodLogs,
  pairMeals,
  parseGlucoseSeries,
  responseRows,
  summariseGlucoseResponse,
  type GlucosePoint,
  type GlucoseResponseConfig,
  type MealForPairing,
} from "./glucose-response";

const config = getProposedConfig("glucose_response.rules").value as unknown as GlucoseResponseConfig;
const NOW = "2026-10-20T20:00:00Z";
const at = (daysAgo: number, hh: number, mm = 0): string => {
  const d = new Date(Date.parse("2026-10-20T00:00:00Z") - daysAgo * 86_400_000);
  d.setUTCHours(hh, mm, 0, 0);
  return d.toISOString();
};
const pt = (iso: string, mmol: number, context: string | null = null, source = "fingerstick"): GlucosePoint => ({ at: iso, mmol, source, context });
const RICE = { code: "jollof_rice", name: "Jollof rice" };
const BEANS = { code: null, name: "Beans" };
const meal = (id: string, iso: string, foods = [RICE]): MealForPairing => ({ id, loggedAt: iso, foods });

/** One meal on day d at 12:00 with a before reading at 11:50 and an after reading at 14:00. */
function day(d: number, before: number, after: number, foods = [RICE]): { meal: MealForPairing; readings: GlucosePoint[] } {
  return { meal: meal(`m${d}`, at(d, 12), foods), readings: [pt(at(d, 11, 50), before, "pre_meal"), pt(at(d, 14, 0), after, "post_meal")] };
}

describe("pairMeals", () => {
  it("pairs a before reading and a reading about two hours after, and records the change", () => {
    const d = day(1, 5.4, 8.1);
    const pairs = pairMeals([d.meal], d.readings, config, NOW);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ beforeMmol: 5.4, afterMmol: 8.1, changeMmol: 2.7 });
  });

  it("takes the reading closest to the meal and closest to two hours", () => {
    const d = day(1, 5, 8);
    const extra = [pt(at(1, 11, 30), 4, "pre_meal"), pt(at(1, 13, 0), 9.9, "post_meal")];
    const pairs = pairMeals([d.meal], [...extra, ...d.readings], config, NOW);
    expect(pairs[0]).toMatchObject({ beforeMmol: 5, afterMmol: 8 });
  });

  it("breaks a tie between equally near readings in favour of the earlier one in the list", () => {
    const m = meal("t", at(1, 12));
    const pairs = pairMeals([m], [pt(at(1, 11, 45), 4.1, "pre_meal"), pt(at(1, 12, 15), 4.9, "pre_meal"), pt(at(1, 14), 7, "post_meal")], { ...config, before_grace_minutes: 20 }, NOW);
    expect(pairs[0]?.beforeMmol).toBe(4.1);
  });

  it("skips a meal with no before reading, or no reading near two hours after", () => {
    const d = day(1, 5, 8);
    expect(pairMeals([d.meal], [d.readings[1] as GlucosePoint], config, NOW)).toEqual([]);
    expect(pairMeals([d.meal], [d.readings[0] as GlucosePoint], config, NOW)).toEqual([]);
    expect(pairMeals([d.meal], [d.readings[0] as GlucosePoint, pt(at(1, 16, 0), 7, "post_meal")], config, NOW)).toEqual([]);
  });

  it("accepts a before reading up to the grace period after the meal was logged but not later", () => {
    const m = meal("g", at(1, 12));
    const after = pt(at(1, 14), 7, "post_meal");
    expect(pairMeals([m], [pt(at(1, 12, 5), 5, "pre_meal"), after], config, NOW)).toHaveLength(1);
    expect(pairMeals([m], [pt(at(1, 12, 20), 5, "pre_meal"), after], config, NOW)).toHaveLength(0);
  });

  it("ignores readings with a bedtime or night tag, an implausible value, a non-finite value, a bad time or a source that is not allowed", () => {
    const m = meal("x", at(1, 12));
    const goodAfter = pt(at(1, 14), 7, "post_meal");
    for (const bad of [pt(at(1, 11, 50), 5, "bedtime"), pt(at(1, 11, 50), 0.4), pt(at(1, 11, 50), 90), pt(at(1, 11, 50), Number.NaN), pt("nonsense", 5), pt(at(1, 11, 50), 5, "pre_meal", "cgm")]) {
      expect(pairMeals([m], [bad, goodAfter], config, NOW)).toEqual([]);
    }
  });

  it("uses a cgm series only when the config allows that source (dormant today)", () => {
    const m = meal("x", at(1, 12));
    const series = [pt(at(1, 11, 50), 5, null, "cgm"), pt(at(1, 14), 7, null, "cgm")];
    expect(pairMeals([m], series, config, NOW)).toEqual([]);
    expect(pairMeals([m], series, { ...config, allowed_sources: ["fingerstick", "cgm"] }, NOW)).toHaveLength(1);
  });

  it("treats an untagged reading as usable on both sides", () => {
    const m = meal("u", at(1, 12));
    expect(pairMeals([m], [pt(at(1, 11, 50), 5), pt(at(1, 14), 7)], config, NOW)).toHaveLength(1);
  });

  it("drops a meal older than the age limit, in the future, or with an unreadable time", () => {
    const old = day(100, 5, 8);
    const future = meal("f", "2026-10-21T12:00:00Z");
    expect(pairMeals([old.meal, future, meal("bad", "nonsense")], [...old.readings], config, NOW)).toEqual([]);
  });

  it("skips a meal when another meal was logged before its after reading, unless the config allows it", () => {
    const d = day(1, 5, 8);
    const snack = meal("s", at(1, 13, 0), []);
    expect(pairMeals([d.meal, snack], d.readings, config, NOW).map((p) => p.mealId)).toEqual([]);
    expect(pairMeals([d.meal, snack], d.readings, { ...config, skip_if_other_meal_between: false }, NOW).map((p) => p.mealId)).toEqual(["m1"]);
  });

  it("returns nothing for an unreadable clock", () => {
    const d = day(1, 5, 8);
    expect(pairMeals([d.meal], d.readings, config, "bad")).toEqual([]);
  });
});

describe("summariseGlucoseResponse", () => {
  const six = [1, 2, 3, 4, 5, 6].map((d, i) => day(d, 5 + i * 0.1, 7 + i * 0.5));
  const meals = six.map((d) => d.meal);
  const series = six.flatMap((d) => d.readings);

  it("shows ranges and the sample count once there are enough pairs, for all meals and for each food", () => {
    const s = summariseGlucoseResponse(meals, series, config, NOW);
    expect(s.enoughData).toBe(true);
    expect(s.pairedMeals).toBe(6);
    const rice = s.groups.find((g) => g.key === "jollof_rice");
    expect(rice).toMatchObject({ n: 6, label: "Jollof rice", afterMin: 7, afterMax: 9.5, beforeMin: 5, beforeMax: 5.5 });
    expect(s.groups[0]?.key).toBe("all");
  });

  it("shows nothing under the minimum number of pairs", () => {
    const s = summariseGlucoseResponse(meals.slice(0, 4), series, config, NOW);
    expect(s).toEqual({ mealsConsidered: 4, pairedMeals: 4, groups: [], enoughData: false });
  });

  it("shows a food only when that food alone has enough pairs", () => {
    const mixed = six.map((d, i) => ({ ...d, meal: { ...d.meal, foods: i < 5 ? [RICE] : [BEANS] } }));
    const s = summariseGlucoseResponse(mixed.map((d) => d.meal), series, config, NOW);
    expect(s.groups.map((g) => g.key)).toEqual(["all", "jollof_rice"]);
  });

  it("keys a food with no code by its lower-cased name, counts a food once per meal, ignores a blank name, and orders ties by label", () => {
    const foods = [BEANS, { code: null, name: "beans" }, { code: null, name: " " }];
    const m2 = six.map((d) => ({ ...d.meal, foods }));
    const s = summariseGlucoseResponse(m2, series, config, NOW);
    expect(s.groups.map((g) => [g.key, g.n])).toEqual([["all", 6], ["beans", 6]]);
    const tie = six.map((d) => ({ ...d.meal, foods: [RICE, BEANS] }));
    expect(summariseGlucoseResponse(tie, series, config, NOW).groups.map((g) => g.label)).toEqual(["all", "Beans", "Jollof rice"]);
    const tie2 = six.map((d) => ({ ...d.meal, foods: [RICE, BEANS, { code: "akara", name: "Akara" }] }));
    expect(summariseGlucoseResponse(tie2, series, config, NOW).groups.map((g) => g.label)).toEqual(["all", "Akara", "Beans", "Jollof rice"]);
  });

  it("orders groups with more pairs first", () => {
    const seven = [...six, day(7, 5, 8)];
    const m = seven.map((d, i) => ({ ...d.meal, foods: i < 6 ? [RICE] : [RICE] }));
    const mixed = m.map((x, i) => (i === 6 ? { ...x, foods: [BEANS] } : { ...x, foods: i % 2 ? [RICE, BEANS] : [RICE] }));
    const s = summariseGlucoseResponse(mixed, seven.flatMap((d) => d.readings), config, NOW);
    const ns = s.groups.slice(1).map((g) => g.n);
    expect([...ns].sort((a, b) => b - a)).toEqual(ns);
  });

  it("a meal with no matched food still counts toward the overall range", () => {
    const s = summariseGlucoseResponse(meals.map((m) => ({ ...m, foods: [] })), series, config, NOW);
    expect(s.groups.map((g) => g.key)).toEqual(["all"]);
  });
});

describe("parsing and formatting", () => {
  it("formats a range, and one number when both ends match", () => {
    expect(formatRange(5.04, 7.86)).toBe("5 to 7.9");
    expect(formatRange(6.01, 5.99)).toBe("6");
    expect(formatRange(5, 7, (n) => String(n * 18))).toBe("90 to 126");
  });

  it("responseRows gives ranges with the unit and nothing that ranks a food", () => {
    const six = [1, 2, 3, 4, 5, 6].map((d, i) => day(d, 5 + i * 0.1, 7 + i * 0.5));
    const s = summariseGlucoseResponse(six.map((d) => d.meal), six.flatMap((d) => d.readings), config, NOW);
    const rows = responseRows(s, (n) => String(Math.round(n * 10) / 10), "mmol/L");
    expect(rows[1]).toEqual({ key: "jollof_rice", label: "Jollof rice", n: 6, before: "5 to 5.5 mmol/L", after: "7 to 9.5 mmol/L", change: "2 to 4 mmol/L" });
    expect(Object.keys(rows[0] as object).sort()).toEqual(["after", "before", "change", "key", "label", "n"]);
    expect(responseRows({ mealsConsidered: 0, pairedMeals: 0, groups: [], enoughData: false }, String, "mmol/L")).toEqual([]);
  });

  it("parseGlucoseSeries reads good points and drops malformed ones", () => {
    const r = parseGlucoseSeries({ state: "ok", readings: [{ at: "2026-10-20T10:00:00Z", mmol: 6, source: "fingerstick", context: "fasting" }, { at: "x", mmol: "6", source: "fingerstick" }, null, { at: "2026-10-20T11:00:00Z", mmol: 7, source: "cgm", context: 3 }] });
    expect(r).toEqual({ state: "ok", points: [{ at: "2026-10-20T10:00:00Z", mmol: 6, source: "fingerstick", context: "fasting" }, { at: "2026-10-20T11:00:00Z", mmol: 7, source: "cgm", context: null }] });
  });

  it("parseGlucoseSeries answers unavailable for anything else", () => {
    for (const bad of [null, "x", { state: "unavailable" }, { state: "ok" }, { state: "ok", readings: "no" }]) expect(parseGlucoseSeries(bad)).toEqual({ state: "unavailable" });
  });

  it("mealsFromFoodLogs keeps matched, named items only", () => {
    const m = mealsFromFoodLogs([
      { id: "a", logged_at: "t", items: [{ matched: true, foodName: "Rice", foodCode: "rice" }, { matched: true, foodName: "Stew", foodCode: 4 }, { matched: false, foodName: "x" }, { matched: true, foodName: "" }, null, 3] },
      { id: "b", logged_at: "t2", items: "none" },
    ]);
    expect(m).toEqual([
      { id: "a", loggedAt: "t", foods: [{ code: "rice", name: "Rice" }, { code: null, name: "Stew" }] },
      { id: "b", loggedAt: "t2", foods: [] },
    ]);
  });
});
