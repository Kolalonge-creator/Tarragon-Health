/**
 * saveHomePins writes only the signed-in patient's own layout, drops anything
 * that is not a known pin, and always keeps a locked pin (today's doses for
 * anyone on a medication) even if the request leaves it out.
 */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const upsert = jest.fn();
let user: { id: string } | null = { id: "patient-1" };
let activeMeds = 0;
let orgId: string | null = "org-1";

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: orgId ? { organisation_id: orgId } : null }) }) }) };
      }
      if (table === "medications") {
        return { select: () => ({ eq: () => ({ eq: async () => ({ count: activeMeds }) }) }) };
      }
      if (table === "patient_home_layout") return { upsert };
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

import { saveHomePins } from "./home-pins-actions";

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({ error: null });
  user = { id: "patient-1" };
  activeMeds = 0;
  orgId = "org-1";
});

describe("saveHomePins", () => {
  it("saves the patient's own list in order, for their own id", async () => {
    const result = await saveHomePins(["sleep", "bp", "weight"]);
    expect(result).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      { patient_id: "patient-1", organisation_id: "org-1", pinned: ["sleep", "bp", "weight"] },
      { onConflict: "patient_id" },
    );
  });

  it("drops unknown keys and duplicates instead of failing", async () => {
    await saveHomePins(["bp", "nonsense", "bp", "labs"]);
    expect(upsert.mock.calls[0][0].pinned).toEqual(["bp", "labs"]);
  });

  it("keeps an empty list: the patient chose to show nothing", async () => {
    await saveHomePins([]);
    expect(upsert.mock.calls[0][0].pinned).toEqual([]);
  });

  it("adds today's doses back for someone taking a medication, even if the request left it out", async () => {
    activeMeds = 2;
    await saveHomePins(["bp"]);
    expect(upsert.mock.calls[0][0].pinned).toEqual(["bp", "doses_today"]);
  });

  it("does not add it for someone with no active medication", async () => {
    activeMeds = 0;
    await saveHomePins(["bp"]);
    expect(upsert.mock.calls[0][0].pinned).toEqual(["bp"]);
  });

  it("refuses input that is not a list of strings, and writes nothing", async () => {
    for (const bad of [null, "bp", { 0: "bp" }, [1, 2], ["x".repeat(41)]]) {
      const result = await saveHomePins(bad);
      expect(result.ok).toBe(false);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses when nobody is signed in", async () => {
    user = null;
    const result = await saveHomePins(["bp"]);
    expect(result.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports a failed save instead of pretending it worked", async () => {
    upsert.mockResolvedValue({ error: { message: "boom" } });
    const result = await saveHomePins(["bp"]);
    expect(result).toEqual({ ok: false, error: "Couldn't save that. Please try again." });
  });
});
