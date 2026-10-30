/**
 * OQ-555: the fertility request update is only visible to (and so only changes for) the clinician tied to the patient. An update that matches no visible
 * row returns NO error from the database, so the action must not report it as saved.
 */
const selectResult = jest.fn();
const getUser = jest.fn();
const update = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: (...a: unknown[]) => getUser(...a) },
    from: () => ({
      update: (...a: unknown[]) => {
        update(...a);
        return { eq: () => ({ select: () => selectResult() }) };
      },
    }),
  }),
}));

import { updateFertilityRequestStatus } from "./womens-health-actions";

function form(status: string): FormData {
  const f = new FormData();
  f.set("status", status);
  return f;
}

beforeEach(() => {
  selectResult.mockReset();
  getUser.mockReset();
  update.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("updateFertilityRequestStatus", () => {
  it("reports success when a row was updated", async () => {
    selectResult.mockResolvedValue({ data: [{ id: "r1" }], error: null });
    expect(await updateFertilityRequestStatus("r1", undefined, form("closed"))).toEqual({ success: true });
    expect(update).toHaveBeenCalledWith({ status: "closed" });
  });

  it("an update that matched no visible row is an error, never a saved status", async () => {
    selectResult.mockResolvedValue({ data: [], error: null });
    const r = await updateFertilityRequestStatus("r1", undefined, form("closed"));
    expect(r?.success).toBeUndefined();
    expect(r?.error).toMatch(/not changed/);
  });

  it("passes a database error through", async () => {
    selectResult.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await updateFertilityRequestStatus("r1", undefined, form("closed")))?.error).toBe("boom");
  });

  it("refuses an unknown status without touching the database", async () => {
    const r = await updateFertilityRequestStatus("r1", undefined, form("bogus"));
    expect(r?.error).toBe("Invalid status");
    expect(update).not.toHaveBeenCalled();
  });
});
