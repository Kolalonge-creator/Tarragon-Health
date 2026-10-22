const rpc = jest.fn();
const getCurrentUser = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
  getCurrentUser: () => getCurrentUser(),
}));

import { saveEmergencyCardCoverageAction } from "./actions";

beforeEach(() => {
  rpc.mockReset();
  getCurrentUser.mockReset();
  getCurrentUser.mockResolvedValue({ id: "p1" });
  rpc.mockResolvedValue({ data: { status: "saved" }, error: null });
});

describe("saveEmergencyCardCoverageAction (S09y)", () => {
  it("writes only through the database function, with no patient argument", async () => {
    const r = await saveEmergencyCardCoverageAction({ scheme: "hmo", member_number: " REL/12345 ", plan_name: "Reliance Gold" });
    expect(rpc).toHaveBeenCalledWith("set_emergency_card_coverage", { p_scheme: "hmo", p_member_number: "REL/12345", p_plan_name: "Reliance Gold" });
    expect(r).toEqual({ success: true, message: "saved" });
  });

  it("both blank is a removal", async () => {
    const r = await saveEmergencyCardCoverageAction({ scheme: "nhia", member_number: "", plan_name: "  " });
    expect(r.message).toBe("removed");
  });

  it("names the field that is wrong and does not call the database", async () => {
    expect((await saveEmergencyCardCoverageAction({ scheme: "hmo", member_number: "12; drop" })).field).toBe("member_number");
    expect((await saveEmergencyCardCoverageAction({ scheme: "hmo", plan_name: "<script>" })).field).toBe("plan_name");
    expect((await saveEmergencyCardCoverageAction({ scheme: "visa", member_number: "ABC123" })).field).toBe("scheme");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a database error is an error, never a saved message", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await saveEmergencyCardCoverageAction({ scheme: "hmo", member_number: "ABC123" });
    expect(r.success).toBeUndefined();
    expect(r.error).toBeDefined();
  });

  it("refuses when nobody is signed in", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await saveEmergencyCardCoverageAction({ scheme: "hmo", member_number: "ABC123" })).error).toBe("Not signed in");
    expect(rpc).not.toHaveBeenCalled();
  });
});
