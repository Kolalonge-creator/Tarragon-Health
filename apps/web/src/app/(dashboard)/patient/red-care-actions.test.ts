import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>>();
let user: { id: string } | null = { id: "u1" };
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) }, rpc: (fn: string, a: Record<string, unknown>) => rpc(fn, a) }),
}));
import { recordRedCareResponse } from "./red-care-actions";

const EV = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ error: null }); user = { id: "u1" }; });

describe("recordRedCareResponse", () => {
  it("stores the answer with a client id and returns the same id for a retry", async () => {
    const first = await recordRedCareResponse({ eventId: EV, response: "could_not_get_care" });
    expect(first.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("record_red_care_response", { p_client_id: first.clientId, p_response: "could_not_get_care", p_emergency_event: EV });
    await recordRedCareResponse({ eventId: EV, response: "could_not_get_care", clientId: first.clientId });
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({ p_client_id: first.clientId });
  });
  it("refuses a bad event id or answer without calling the database", async () => {
    expect((await recordRedCareResponse({ eventId: "nope", response: "sought_care" })).ok).toBe(false);
    expect((await recordRedCareResponse({ eventId: EV, response: "maybe" as never })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("needs a signed-in person", async () => {
    user = null;
    expect(await recordRedCareResponse({ eventId: EV, response: "sought_care" })).toMatchObject({ ok: false, error: "Please sign in again." });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("never shows a database message", async () => {
    rpc.mockResolvedValue({ error: { message: "relation red_care_responses does not exist" } });
    const r = await recordRedCareResponse({ eventId: EV, response: "sought_care" });
    expect(r).toMatchObject({ ok: false, error: "We could not save your answer just now. Please try again." });
    expect(JSON.stringify(r)).not.toContain("relation");
  });
});
