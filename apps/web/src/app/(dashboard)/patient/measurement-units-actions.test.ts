import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const update = jest.fn();
const eq = jest.fn<(col: string, val: string) => Promise<{ error: { message: string } | null }>>();
const getUser = jest.fn<() => Promise<{ data: { user: { id: string } | null } }>>();

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ update: (v: unknown) => { update(v); return { eq }; } }),
  }),
}));

import { updateMeasurementUnits } from "./measurement-units-actions";

function form(v: Record<string, string>) {
  const f = new FormData();
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
}
const GOOD = { weight_display_unit: "lb", temperature_display_unit: "f", length_display_unit: "in" };

describe("updateMeasurementUnits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    eq.mockResolvedValue({ error: null });
  });

  it("saves valid units for the signed-in person only", async () => {
    expect(await updateMeasurementUnits(undefined, form(GOOD))).toEqual({ success: true });
    expect(update).toHaveBeenCalledWith(GOOD);
    expect(eq).toHaveBeenCalledWith("id", "u1");
  });

  it.each([
    { ...GOOD, weight_display_unit: "stone" },
    { ...GOOD, temperature_display_unit: "k" },
    { ...GOOD, length_display_unit: "ft" },
  ])("refuses an unknown unit without writing", async (bad) => {
    expect(await updateMeasurementUnits(undefined, form(bad))).toEqual({ error: "Pick one option for each unit." });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a missing field", async () => {
    const rest: Record<string, string> = { ...GOOD };
    delete rest.length_display_unit;
    expect((await updateMeasurementUnits(undefined, form(rest)))?.error).toBeDefined();
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses when signed out and does not write", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await updateMeasurementUnits(undefined, form(GOOD)))?.error).toMatch(/signed in/);
    expect(update).not.toHaveBeenCalled();
  });

  it("reports a failed save instead of claiming success", async () => {
    eq.mockResolvedValue({ error: { message: "boom" } });
    expect(await updateMeasurementUnits(undefined, form(GOOD))).toEqual({ error: "Couldn't save that. Please try again." });
  });
});
