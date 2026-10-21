/**
 * S48a: the activity actions record the kind and distance of a workout and the weekly goal, and the weekly goal is validated.
 * (Safety is not decided here: the gate lives in the database and is proven in packages/db/tests/s48a_activity_safety_gate.sql.)
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/lifestyle/weekly-plan-progress", () => ({ recordWeeklyPlanProgress: jest.fn().mockResolvedValue(undefined) }));

const insert = jest.fn().mockResolvedValue({ error: null });
const upsert = jest.fn().mockResolvedValue({ error: null });

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "p-1" } } }) },
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" } }) }) }) };
      if (table === "activity_log_entries") return { insert };
      if (table === "patient_activity_goals") return { upsert };
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { logWorkoutAction, setWeeklyGoalAction } from "./actions";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  insert.mockClear();
  upsert.mockClear();
});

describe("logWorkoutAction", () => {
  it("records the kind for a named activity and the distance in whole metres", async () => {
    const r = await logWorkoutAction(undefined, form({ activity_name: "Dancing", duration_minutes: "40", distance_km: "2.5" }));
    expect(r).toEqual({ success: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ entry_type: "workout", activity_kind: "dancing", distance_m: 2500, duration_minutes: 40 }));
  });

  it("maps farm and manual work and chair-based exercise to their kinds", async () => {
    await logWorkoutAction(undefined, form({ activity_name: "Farm or manual work", duration_minutes: "90" }));
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ activity_kind: "farm_manual_work", distance_m: null }));
    await logWorkoutAction(undefined, form({ activity_name: "Chair-based exercise", duration_minutes: "15" }));
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ activity_kind: "chair_based" }));
  });

  it("logs a name with no kind (Yoga) as before, and free text with no kind", async () => {
    await logWorkoutAction(undefined, form({ activity_name: "Yoga", duration_minutes: "20" }));
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ activity_kind: null }));
    await logWorkoutAction(undefined, form({ activity_name: "Carrying water", duration_minutes: "20" }));
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ activity_kind: null }));
  });

  it("never blocks logging something that already happened, whatever the gate says", async () => {
    // The action does not consult the gate at all: a workout that was done is recorded as it was.
    const r = await logWorkoutAction(undefined, form({ activity_name: "Run", duration_minutes: "30" }));
    expect(r).toEqual({ success: true });
  });

  it("refuses a negative distance", async () => {
    const r = await logWorkoutAction(undefined, form({ activity_name: "Run", duration_minutes: "30", distance_km: "-1" }));
    expect(r?.error).toBeDefined();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("setWeeklyGoalAction", () => {
  it("saves the weekly minutes goal against the patient", async () => {
    const r = await setWeeklyGoalAction(undefined, form({ weekly_active_minutes_goal: "120" }));
    expect(r).toEqual({ success: true });
    expect(upsert).toHaveBeenCalledWith({ organisation_id: "org-1", patient_id: "p-1", weekly_active_minutes_goal: 120 }, { onConflict: "patient_id" });
  });

  it("refuses zero, a fraction of nothing, and more minutes than a week holds", async () => {
    for (const v of ["0", "-5", "10081", "abc"]) {
      const r = await setWeeklyGoalAction(undefined, form({ weekly_active_minutes_goal: v }));
      expect(r?.error).toBeDefined();
    }
    expect(upsert).not.toHaveBeenCalled();
  });
});
