/**
 * S49a acceptance: "a recent meal repeats in one tap", plus favourites and the barcode door.
 * Run against the real server actions with a faked database client.
 */
import { FIXTURE_CATALOGUE } from "@/lib/nutrition/test-fixtures";

jest.mock("@/lib/lifestyle/weekly-plan-progress", () => ({ recordWeeklyPlanProgress: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/nutrition/food-catalogue-fetch", () => ({
  fetchFoodCatalogue: jest.fn(async () => (jest.requireActual("@/lib/nutrition/test-fixtures") as { FIXTURE_CATALOGUE: unknown[] }).FIXTURE_CATALOGUE),
}));
jest.mock("@/lib/ai-governance", () => ({ AI_SYSTEMS: { mealPhotoNutrition: { code: "AI-008" }, mealPlanGeneration: { code: "AI-011" } }, runGovernedAi: jest.fn() }));
jest.mock("@/lib/nutrition/meal-vision", () => ({ analyzeMealPhoto: jest.fn(), isMealVisionConfigured: () => false }));
jest.mock("@/lib/nutrition/meal-plan-generate", () => ({ generateMealPlan: jest.fn() }));

const inserted: { table: string; row: Record<string, unknown> }[] = [];
const updated: { table: string; row: Record<string, unknown> }[] = [];
const rpc = jest.fn();
let entryRow: Record<string, unknown> | null = null;
let favouriteRow: Record<string, unknown> | null = null;
let insertError: { code?: string; message: string } | null = null;

function table(name: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: name === "nutrition_log_entries" ? entryRow : name === "favourite_meals" ? favouriteRow : null, error: null });
  c.single = async () => ({ data: { organisation_id: "org-1" }, error: null });
  c.insert = (row: Record<string, unknown>) => {
    inserted.push({ table: name, row });
    const r: Record<string, unknown> = { error: insertError };
    const p = Promise.resolve({ error: insertError });
    return Object.assign(p, r, { select: () => ({ maybeSingle: async () => ({ data: insertError ? null : { id: "new-entry" }, error: insertError }) }) });
  };
  c.update = (row: Record<string, unknown>) => {
    updated.push({ table: name, row });
    const u: Record<string, unknown> = {};
    u.eq = () => u;
    u.then = (resolve: (v: unknown) => unknown) => resolve({ error: null });
    return u;
  };
  c.upsert = async () => ({ error: null });
  c.delete = () => ({ eq: () => ({ eq: async () => ({ error: null }) }) });
  return c;
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "patient-1" } } }) },
    from: (name: string) => table(name),
    rpc: (...args: unknown[]) => rpc(...args),
  })),
}));

import { repeatMealAction, logFavouriteAction, saveFavouriteAction, lookupBarcodeAction } from "./nutrition-actions";

beforeEach(() => {
  inserted.length = 0;
  updated.length = 0;
  rpc.mockReset();
  entryRow = null;
  favouriteRow = null;
  insertError = null;
});

describe("repeatMealAction: one tap", () => {
  it("logs the same meal again from a single call, with the numbers recomputed from the food table", async () => {
    entryRow = { meal_type: "lunch", description: "2 spoons of rice and beans", ai_estimate: null };
    const res = await repeatMealAction("11111111-1111-4111-8111-111111111111");
    expect(res).toEqual({ success: true });
    const rows = inserted.filter((i) => i.table === "nutrition_log_entries");
    expect(rows).toHaveLength(1);
    const row = rows[0]!.row;
    expect(row.meal_type).toBe("lunch");
    expect(row.description).toBe("2 spoons of rice and beans");
    expect(row.patient_id).toBe("patient-1");
    expect(row.organisation_id).toBe("org-1");
    expect(row.photo_path).toBeNull();
    expect((row.nutrition_analysis as { caloriesKcal: number }).caloriesKcal).toBeGreaterThan(0);
    expect(Array.isArray(row.parsed_items)).toBe(true);
  });

  it("repeats a photo-only meal's estimate, unconfirmed, without copying the photo", async () => {
    entryRow = { meal_type: "dinner", description: null, ai_estimate: { est_carbs_g: 50, est_calories: 600 } };
    const res = await repeatMealAction("11111111-1111-4111-8111-111111111111");
    expect(res).toEqual({ success: true });
    const row = inserted[0]!.row;
    expect(row.ai_estimate).toEqual({ est_carbs_g: 50, est_calories: 600 });
    expect(row.ai_status).toBe("estimated");
    expect(row.photo_path).toBeNull();
  });

  it("refuses a meal that is not the patient's own (the read returns nothing) and writes nothing", async () => {
    entryRow = null;
    const res = await repeatMealAction("11111111-1111-4111-8111-111111111111");
    expect(res).toEqual({ error: "That meal could not be found." });
    expect(inserted).toHaveLength(0);
  });

  it("refuses a meal with nothing to repeat", async () => {
    entryRow = { meal_type: "snack", description: "  ", ai_estimate: null };
    const res = await repeatMealAction("11111111-1111-4111-8111-111111111111");
    expect(res).toEqual({ error: "There is nothing in that meal to repeat." });
    expect(inserted).toHaveLength(0);
  });

  it("rejects a malformed id before touching the database", async () => {
    const res = await repeatMealAction("not-a-uuid");
    expect(res).toEqual({ error: "That meal could not be found." });
    expect(inserted).toHaveLength(0);
  });

  it("surfaces a database failure instead of reporting success", async () => {
    entryRow = { meal_type: "lunch", description: "rice", ai_estimate: null };
    insertError = { message: "permission denied" };
    const res = await repeatMealAction("11111111-1111-4111-8111-111111111111");
    expect(res).toEqual({ error: "permission denied" });
  });
});

describe("favourites", () => {
  it("logs a favourite in one call and bumps its use count", async () => {
    favouriteRow = { id: "f1", description: "a bowl of pap and 2 akara", meal_type: "breakfast", use_count: 2 };
    const res = await logFavouriteAction("22222222-2222-4222-8222-222222222222");
    expect(res).toEqual({ success: true });
    expect(inserted.filter((i) => i.table === "nutrition_log_entries")).toHaveLength(1);
    expect(inserted[0]!.row.meal_type).toBe("breakfast");
    expect(updated[0]).toMatchObject({ table: "favourite_meals", row: { use_count: 3 } });
  });

  it("a favourite with no meal type is logged by the Lagos clock, never left null", async () => {
    favouriteRow = { id: "f1", description: "rice", meal_type: null, use_count: 0 };
    await logFavouriteAction("22222222-2222-4222-8222-222222222222");
    expect(["breakfast", "lunch", "dinner", "snack"]).toContain(inserted[0]!.row.meal_type);
  });

  it("does not log a favourite that is not found", async () => {
    favouriteRow = null;
    expect(await logFavouriteAction("22222222-2222-4222-8222-222222222222")).toEqual({ error: "That favourite could not be found." });
    expect(inserted).toHaveLength(0);
  });

  it("saves a favourite from a logged meal, taking the words from the patient's own entry", async () => {
    entryRow = { meal_type: "breakfast", description: "pap and akara" };
    const fd = new FormData();
    fd.set("entry_id", "11111111-1111-4111-8111-111111111111");
    fd.set("name", "My usual breakfast");
    const res = await saveFavouriteAction(undefined, fd);
    expect(res).toEqual({ success: true });
    expect(inserted[0]).toMatchObject({ table: "favourite_meals", row: { name: "My usual breakfast", description: "pap and akara", meal_type: "breakfast", patient_id: "patient-1" } });
  });

  it("will not save a photo-only meal as a favourite", async () => {
    entryRow = { meal_type: "breakfast", description: null };
    const fd = new FormData();
    fd.set("entry_id", "11111111-1111-4111-8111-111111111111");
    fd.set("name", "x");
    expect(await saveFavouriteAction(undefined, fd)).toEqual({ error: "Only a meal you described in words can be saved as a favourite." });
    expect(inserted).toHaveLength(0);
  });

  it("reports a duplicate name in plain words", async () => {
    insertError = { code: "23505", message: "dup" };
    const fd = new FormData();
    fd.set("name", "Same");
    fd.set("description", "rice");
    expect(await saveFavouriteAction(undefined, fd)).toEqual({ error: "You already have a favourite with that name." });
  });

  it("requires a name", async () => {
    const fd = new FormData();
    fd.set("description", "rice");
    const res = await saveFavouriteAction(undefined, fd);
    expect(res?.error).toBeTruthy();
    expect(inserted).toHaveLength(0);
  });
});

describe("lookupBarcodeAction", () => {
  it("never calls the database for a code with a wrong check digit", async () => {
    const res = await lookupBarcodeAction("4006381333932");
    expect(res).toEqual({ ok: true, status: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("finds a curated product and returns its NAFDAC number", async () => {
    rpc.mockResolvedValue({ data: { status: "found", code: "4006381333931", product_name: "Test pack", nafdac_number: "A4-1234", food_code: "eba", food_name: "Eba" }, error: null });
    const res = await lookupBarcodeAction("4006 3813 33931");
    expect(rpc).toHaveBeenCalledWith("lookup_barcode", { p_code: "4006381333931" });
    expect(res).toMatchObject({ ok: true, status: "found", nafdacNumber: "A4-1234", foodCode: "eba" });
  });

  it("says not found rather than inventing a product", async () => {
    rpc.mockResolvedValue({ data: { status: "not_found" }, error: null });
    expect(await lookupBarcodeAction("036000291452")).toEqual({ ok: true, status: "not_found" });
  });

  it("a failed lookup is an error the patient can read, not a silent not-found", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    const res = await lookupBarcodeAction("036000291452");
    expect(res.ok).toBe(false);
  });
});

// keep the fixture import used so the mock above and this file agree on the catalogue
void FIXTURE_CATALOGUE;
