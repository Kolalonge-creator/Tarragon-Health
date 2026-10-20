/**
 * S47a server actions: web entry for water, sleep, mood and inhaler use, and the patient's own correction of a logged number.
 */
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/acting/acting-for", () => ({ resolveSubjectId: async (id: string) => id }));

const insert = jest.fn();
const rpc = jest.fn();
const moduleRow = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "patient-1" } } }) },
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" } }) }) }) };
      if (table === "vitals_readings") return { insert };
      if (table === "platform_modules") return { select: () => ({ eq: () => ({ maybeSingle: moduleRow }) }) };
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (...a: unknown[]) => rpc(...a),
  }),
}));

import { correctOwnReading, logInhalerUse, logObservation } from "./observation-actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const ID = "5b1f1b6e-2d6c-4b7e-8d57-1f0e7d0c9a11";

beforeEach(() => {
  insert.mockReset().mockResolvedValue({ error: null });
  rpc.mockReset().mockResolvedValue({ data: {}, error: null });
  moduleRow.mockReset().mockResolvedValue({ data: { is_enabled: true }, error: null });
});

describe("logObservation", () => {
  it("saves water into value_numeric for the signed-in person", async () => {
    const r = await logObservation(undefined, fd({ vital_type: "water_ml", water_ml: "250" }));
    expect(r).toEqual({ success: true });
    expect(insert.mock.calls[0][0]).toMatchObject({ patient_id: "patient-1", organisation_id: "org-1", vital_type: "water_ml", value_numeric: 250, source: "manual" });
  });

  it("refuses an impossible number with the plain sentence and writes nothing", async () => {
    const r = await logObservation(undefined, fd({ vital_type: "water_ml", water_ml: "9000" }));
    expect(r?.error).toContain("millilitres");
    expect(insert).not.toHaveBeenCalled();
    expect((await logObservation(undefined, fd({ vital_type: "mood", mood: "7" })))?.error).toContain("1 to 5");
  });

  it("an unusual number asks for a second tap, then saves once confirmed", async () => {
    const first = await logObservation(undefined, fd({ vital_type: "sleep_hours", sleep_hours: "1" }));
    expect(first?.confirm).toContain("very little sleep");
    expect(insert).not.toHaveBeenCalled();
    const second = await logObservation(undefined, fd({ vital_type: "sleep_hours", sleep_hours: "1", confirm_unusual: "yes" }));
    expect(second).toEqual({ success: true });
  });

  it("says plainly that the log is not switched on, and writes nothing, while the module is off or unreadable", async () => {
    moduleRow.mockResolvedValue({ data: { is_enabled: false }, error: null });
    expect((await logObservation(undefined, fd({ vital_type: "mood", mood: "3" })))?.error).toContain("not switched on");
    moduleRow.mockResolvedValue({ data: null, error: { message: "x" } });
    expect((await logObservation(undefined, fd({ vital_type: "mood", mood: "3" })))?.error).toContain("not switched on");
    expect(insert).not.toHaveBeenCalled();
  });

  it("a thrown network error is a friendly retry, not an unhandled exception", async () => {
    insert.mockRejectedValue(new Error("network"));
    expect((await logObservation(undefined, fd({ vital_type: "water_ml", water_ml: "250" })))?.error).toContain("Check your connection");
  });
});

describe("logInhalerUse", () => {
  it("logs through log_inhaler_use", async () => {
    const r = await logInhalerUse(undefined, fd({ puffs: "2", reason: "before_exercise" }));
    expect(r).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("log_inhaler_use", { p_puffs: 2, p_reason: "before_exercise" });
  });
  it("refuses 25 puffs and an unknown reason", async () => {
    expect((await logInhalerUse(undefined, fd({ puffs: "25", reason: "other" })))?.error).toContain("1 to 20");
    expect((await logInhalerUse(undefined, fd({ puffs: "2", reason: "fun" })))?.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("asks to confirm an unusual number of puffs", async () => {
    expect((await logInhalerUse(undefined, fd({ puffs: "12", reason: "other" })))?.confirm).toContain("lot of puffs");
  });
});

describe("correctOwnReading", () => {
  it("corrects a weight through correct_clinical_value with only the changed column", async () => {
    const r = await correctOwnReading(undefined, fd({ reading_id: ID, vital_type: "weight", new_value: "71.5", reason: "typed the wrong number" }));
    expect(r).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("correct_clinical_value", {
      p_table: "vitals_readings",
      p_id: ID,
      p_status: "corrected",
      p_reason: "typed the wrong number",
      p_replacement: { weight_kg: 71.5 },
    });
  });

  it("converts a glucose typed in mg/dL to the stored mmol/L", async () => {
    await correctOwnReading(undefined, fd({ reading_id: ID, vital_type: "glucose", glucose_unit: "mg_dl", new_value: "108", reason: "misread the meter" }));
    expect((rpc.mock.calls[0][1] as { p_replacement: { glucose_mmol_l: number } }).p_replacement.glucose_mmol_l).toBeCloseTo(5.99, 1);
  });

  it("will not change a blood pressure here, and refuses an implausible replacement", async () => {
    expect((await correctOwnReading(undefined, fd({ reading_id: ID, vital_type: "blood_pressure", new_value: "120", reason: "wrong number" })))?.error).toContain("care team");
    expect((await correctOwnReading(undefined, fd({ reading_id: ID, vital_type: "water_ml", new_value: "99999", reason: "wrong number" })))?.error).toContain("millilitres");
    expect((await correctOwnReading(undefined, fd({ reading_id: ID, vital_type: "weight", new_value: "70", reason: "x" })))?.error).toContain("at least 5");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the database refusals to plain words", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "no" } });
    expect((await correctOwnReading(undefined, fd({ reading_id: ID, vital_type: "weight", new_value: "70", reason: "wrong number" })))?.error).toContain("care team");
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "already" } });
    expect((await correctOwnReading(undefined, fd({ reading_id: ID, vital_type: "weight", new_value: "70", reason: "wrong number" })))?.error).toContain("already changed");
  });
});
