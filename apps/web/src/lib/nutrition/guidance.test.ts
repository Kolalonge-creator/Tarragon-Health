import { lagosDayStart, loadNutritionGuidance } from "./guidance";

/**
 * The targets gate (S49a). The decision to show anything belongs to the database function my_nutrition_target_gate(); these tests prove the
 * app obeys it in every direction that matters: a withheld person triggers NO further reads and gets `hidden` (so nothing is rendered, not even
 * an empty card), an unsigned configuration is hidden, and a failed gate call is hidden and never shown as zeros.
 */

const CONFIG = {
  min_age_years: 18,
  energy: {
    activity_factors: { low: 1.2, light: 1.375, moderate: 1.55, high: 1.725 },
    default_activity: "light",
    floor_kcal: { female: 1200, male: 1500 },
    ceiling_kcal: 3500,
    round_to_kcal: 10,
  },
  macros_pct_of_energy: { carbs: 50, protein: 20, fat: 30 },
  salt_sugar_fibre: { sodium_mg_max: 2000, sugar_pct_of_energy_max: 10, fibre_g_per_1000_kcal: 14 },
  meal_summary: { light_below_kcal: 400, heavy_above_kcal: 750, salty_above_sodium_mg: 800, sugary_above_sugar_g: 25 },
};

interface Fake {
  from: jest.Mock;
  rpc: jest.Mock;
}

function fake(opts: {
  gate: { data: unknown; error: { message: string } | null };
  profile?: { date_of_birth: string | null; sex: "male" | "female" | null; height_cm: number | null } | null;
  weight?: number | null;
  mode?: "numbers" | "words" | null;
  entries?: { nutrition_analysis: unknown }[];
}): Fake {
  const result = (data: unknown) => ({ data, error: null });
  const chain = (data: unknown): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "is", "order", "limit", "gte"]) c[m] = () => c;
    c.maybeSingle = async () => result(data);
    c.then = (resolve: (v: unknown) => unknown) => resolve(result(data));
    return c;
  };
  const from = jest.fn((table: string) => {
    if (table === "profiles") return chain(opts.profile ?? null);
    if (table === "vitals_readings") return chain(opts.weight != null ? { weight_kg: opts.weight } : null);
    if (table === "nutrition_preferences") return chain(opts.mode ? { meal_summary_mode: opts.mode } : null);
    if (table === "nutrition_log_entries") return chain(opts.entries ?? []);
    throw new Error(`unexpected table ${table}`);
  });
  return { from, rpc: jest.fn(async () => opts.gate) };
}

const NOW = new Date("2026-10-20T10:00:00Z");
const ADULT = { date_of_birth: "1986-03-01", sex: "female" as const, height_cm: 165 };

describe("loadNutritionGuidance", () => {
  it("withheld: hidden, and nothing else is even read", async () => {
    const f = fake({ gate: { data: { state: "withheld" }, error: null }, profile: ADULT, weight: 70 });
    const g = await loadNutritionGuidance(f as never, "p1", NOW);
    expect(g).toEqual({ state: "hidden" });
    expect(f.from).not.toHaveBeenCalled();
  });

  it("not active (unsigned): hidden", async () => {
    const f = fake({ gate: { data: { state: "not_active" }, error: null }, profile: ADULT, weight: 70 });
    expect(await loadNutritionGuidance(f as never, "p1", NOW)).toEqual({ state: "hidden" });
    expect(f.from).not.toHaveBeenCalled();
  });

  it("a failed gate call is hidden, logged, never zeros", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fake({ gate: { data: null, error: { message: "boom" } }, profile: ADULT, weight: 70 });
    expect(await loadNutritionGuidance(f as never, "p1", NOW)).toEqual({ state: "hidden" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a gate answer that is not understood is hidden", async () => {
    const f = fake({ gate: { data: { state: "ok", config: { energy: {} } }, error: null }, profile: ADULT, weight: 70 });
    expect(await loadNutritionGuidance(f as never, "p1", NOW)).toEqual({ state: "hidden" });
  });

  it("ok: computes targets from the signed config and sums today's meals", async () => {
    const f = fake({
      gate: { data: { state: "ok", config_version: 4, config: CONFIG }, error: null },
      profile: ADULT,
      weight: 70,
      mode: "words",
      entries: [{ nutrition_analysis: { caloriesKcal: 500, sodiumMg: 300, sugarG: 4 } }, { nutrition_analysis: null }],
    });
    const g = await loadNutritionGuidance(f as never, "p1", NOW);
    expect(g.state).toBe("ok");
    if (g.state !== "ok") return;
    expect(g.configVersion).toBe(4);
    expect(g.targets.energyKcal).toBeGreaterThanOrEqual(1200);
    expect(g.mode).toBe("words");
    expect(g.totals.caloriesKcal).toBe(500);
    expect(g.totals.uncountedMeals).toBe(1);
  });

  it("asks for the missing profile fields instead of guessing, and still carries the summary lines", async () => {
    const f = fake({
      gate: { data: { state: "ok", config_version: 1, config: CONFIG }, error: null },
      profile: { date_of_birth: null, sex: null, height_cm: null },
      weight: null,
    });
    const g = await loadNutritionGuidance(f as never, "p1", NOW);
    expect(g.state).toBe("needs_profile");
    if (g.state === "needs_profile") {
      expect(g.missing).toEqual(["age", "sex", "weight", "height"]);
      expect(g.mealSummary.light_below_kcal).toBe(400);
    }
  });

  it("a profile under 18 is hidden even if the gate (wrongly) said ok", async () => {
    const f = fake({
      gate: { data: { state: "ok", config_version: 1, config: CONFIG }, error: null },
      profile: { date_of_birth: "2012-01-01", sex: "male", height_cm: 150 },
      weight: 40,
    });
    expect(await loadNutritionGuidance(f as never, "p1", NOW)).toEqual({ state: "hidden" });
  });

  it("an unreadable profile or day is hidden, not zeros", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fake({ gate: { data: { state: "ok", config_version: 1, config: CONFIG }, error: null }, profile: ADULT, weight: 70 });
    f.from.mockImplementation((table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "is", "order", "limit", "gte"]) c[m] = () => c;
      c.maybeSingle = async () => ({ data: null, error: table === "profiles" ? { message: "denied" } : null });
      c.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
      return c;
    });
    expect(await loadNutritionGuidance(f as never, "p1", NOW)).toEqual({ state: "hidden" });
    spy.mockRestore();
  });
});

describe("lagosDayStart", () => {
  it("is midnight Lagos (23:00 UTC the day before)", () => {
    expect(lagosDayStart(new Date("2026-10-20T10:00:00Z"))).toBe("2026-10-19T23:00:00.000Z");
  });
  it("rolls to the next Lagos day at 23:00 UTC", () => {
    expect(lagosDayStart(new Date("2026-10-20T23:30:00Z"))).toBe("2026-10-20T23:00:00.000Z");
  });
});
