/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): logMealAction refuses a photo path the server has not cleared (one that skipped the
 * browser's check, or was refused), before anything is saved or sent to the photo reader.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const download = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "o1" } }) }) }) }),
    storage: { from: () => ({ download }) },
  }),
}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
const insertMeal = jest.fn();
jest.mock("@/lib/nutrition/meal-log", () => ({ insertMeal: (...a: unknown[]) => insertMeal(...a), analyseDescriptionWith: jest.fn() }));
jest.mock("@/lib/ai-governance", () => ({ AI_SYSTEMS: {}, runGovernedAi: jest.fn() }));
const cleared = jest.fn<(...a: unknown[]) => Promise<boolean>>();
jest.mock("@/lib/uploads/cleared-for-reading", () => ({ isClearedForReading: (...a: unknown[]) => cleared(...a) }));

import { logMealAction } from "./nutrition-actions";

beforeEach(() => {
  download.mockReset();
  insertMeal.mockReset();
  cleared.mockReset();
});

describe("logMealAction upload check", () => {
  it("refuses an uncleared photo before saving or reading anything", async () => {
    cleared.mockResolvedValue(false);
    const fd = new FormData();
    fd.set("meal_type", "lunch");
    fd.set("description", "rice and stew");
    fd.set("photo_path", "u1/lunch.jpg");
    const out = await logMealAction(undefined, fd);
    expect(out?.error).toMatch(/could not be checked/);
    expect(cleared.mock.calls[0]?.slice(1)).toEqual(["meal-photos", "u1/lunch.jpg"]);
    expect(insertMeal).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
});
