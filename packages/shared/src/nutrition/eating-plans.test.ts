import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEatingGuidance, swapsForFood } from "./eating-plans";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(): { swaps: unknown[]; plans: Record<string, Record<string, unknown>> } {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s50a_eating_plans_swaps.sql"));
  if (!file) throw new Error("S50a migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /nutrition-guidance-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("seed not found");
  return JSON.parse(match[1]);
}

function answer(codes: string[]) {
  const s = seed();
  return { state: "ok", config_version: 1, swaps: s.swaps, plans: codes.map((c) => ({ code: c, ...s.plans[c] })) };
}

describe("the seeded guidance", () => {
  it("has the five plans and every plan asks the person to talk to the care team or a dietitian", () => {
    const s = seed();
    expect(Object.keys(s.plans).sort()).toEqual(["diabetes", "hypertension", "kidney", "pregnancy", "weight"]);
    for (const p of Object.values(s.plans)) expect(String(p.care_team_prompt).length).toBeGreaterThan(10);
  });

  it("gives kidney and pregnancy no numbers block and no nutrient or calorie digits in the words", () => {
    const s = seed();
    for (const code of ["kidney", "pregnancy"]) {
      expect(s.plans[code]).not.toHaveProperty("numbers");
      expect(JSON.stringify(s.plans[code])).not.toMatch(/[0-9]/);
      expect(JSON.stringify(s.plans[code]).toLowerCase()).not.toMatch(/potassium|phosph|protein|calorie|kcal/);
    }
  });

  it("gives the weight plan no calorie figure", () => {
    expect(JSON.stringify(seed().plans.weight)).not.toMatch(/[0-9]|kcal/i);
  });

  it("lists every number as a placeholder for the CMO", () => {
    const hyp = seed().plans.hypertension as { numbers: Record<string, number>; placeholders: string[] };
    expect(hyp.placeholders).toContain("numbers.salt_g_max");
    expect(Object.keys(hyp.numbers)).toEqual(["salt_g_max"]);
  });

  it("never moralises, shames or uses the banned words", () => {
    const text = JSON.stringify(seed()).toLowerCase();
    for (const bad of ["bad food", "good food", "junk", "cheat", "guilt", "cure", "fasting", "—", "doctor-led"]) expect(text).not.toContain(bad);
  });

  it("is read by the parser as a whole", () => {
    const parsed = parseEatingGuidance(answer(["hypertension", "weight"]));
    expect(parsed.state).toBe("ok");
    if (parsed.state === "ok") {
      expect(parsed.plans.map((p) => p.code)).toEqual(["hypertension", "weight"]);
      expect(parsed.swaps.length).toBeGreaterThan(10);
    }
  });
});

describe("parseEatingGuidance is cautious", () => {
  it("treats null, a failed call, an unknown state and unavailable the same", () => {
    for (const raw of [null, undefined, "x", {}, { state: "unavailable" }, { state: "withheld" }, { state: "ok" }]) {
      expect(parseEatingGuidance(raw)).toEqual({ state: "unavailable" });
    }
  });

  it("refuses the whole answer when one plan or swap is malformed", () => {
    const a = answer(["weight"]) as unknown as { plans: { tips: unknown[] }[]; swaps: unknown[] };
    a.plans[0]!.tips = [];
    expect(parseEatingGuidance(a)).toEqual({ state: "unavailable" });
    const b = answer(["weight"]) as unknown as { swaps: Record<string, unknown>[] };
    b.swaps[0]!.reason_kind = "bad_food";
    expect(parseEatingGuidance(b)).toEqual({ state: "unavailable" });
  });

  it("treats an empty ok answer as unavailable so no empty card is drawn", () => {
    expect(parseEatingGuidance({ state: "ok", config_version: 1, swaps: [], plans: [] })).toEqual({ state: "unavailable" });
  });
});

describe("swapsForFood", () => {
  const parsed = parseEatingGuidance(answer(["weight"]));
  const swaps = parsed.state === "ok" ? parsed.swaps : [];
  it("offers the salt swaps to a blood pressure concern and not the sugar ones", () => {
    const fish = swapsForFood(swaps, "fish_dried", ["hypertension"]);
    expect(fish.map((s) => s.toFoodCodes[0])).toEqual(["fish_grilled"]);
    expect(swapsForFood(swaps, "soft_drink", ["hypertension"])).toEqual([]);
  });
  it("offers the general swaps when there is no concern", () => {
    expect(swapsForFood(swaps, "soft_drink", []).length).toBe(1);
  });
});
