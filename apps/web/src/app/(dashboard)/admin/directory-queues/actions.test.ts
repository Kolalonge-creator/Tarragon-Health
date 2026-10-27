const rpc = jest.fn();
const getCurrentProfile = jest.fn();

jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => getCurrentProfile() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { moderateRatingAction, recordCheckAction } from "./actions";

const UUID = "11111111-1111-4111-8111-111111111111";

function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  rpc.mockReset();
  getCurrentProfile.mockReset();
  getCurrentProfile.mockResolvedValue({ id: UUID, role: "admin" });
  rpc.mockResolvedValue({ error: null });
});

describe("moderateRatingAction", () => {
  it("asks for a reason before rejecting and never calls the database without one", async () => {
    const r = await moderateRatingAction(undefined, form({ rating: UUID, decision: "reject" }));
    expect(r?.error).toMatch(/reason/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes a publish decision straight to the database function", async () => {
    const r = await moderateRatingAction(undefined, form({ rating: UUID, decision: "publish" }));
    expect(r).toEqual({ done: "Rating published." });
    expect(rpc).toHaveBeenCalledWith("moderate_facility_rating", { p_rating: UUID, p_decision: "publish", p_reason: undefined });
  });

  it("reports the database's refusal (a held comment cannot be published whole) instead of pretending it worked", async () => {
    rpc.mockResolvedValue({ error: { message: "this comment was held" } });
    const r = await moderateRatingAction(undefined, form({ rating: UUID, decision: "publish" }));
    expect(r).toEqual({ error: "this comment was held" });
  });

  it("rejects an unknown decision and a malformed id without calling the database", async () => {
    expect((await moderateRatingAction(undefined, form({ rating: UUID, decision: "delete" })))?.error).toBeDefined();
    expect((await moderateRatingAction(undefined, form({ rating: "nope", decision: "publish" })))?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("needs a signed-in person", async () => {
    getCurrentProfile.mockResolvedValue(null);
    expect((await moderateRatingAction(undefined, form({ rating: UUID, decision: "publish" })))?.error).toMatch(/sign in/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("recordCheckAction", () => {
  it("requires a note saying how the listing was checked", async () => {
    const r = await recordCheckAction(undefined, form({ table: "facilities", listing: UUID, tier: "phone_confirmed", note: "" }));
    expect(r?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("only accepts the two listing types the queue holds and the two check tiers", async () => {
    expect((await recordCheckAction(undefined, form({ table: "pharmacy_partners", listing: UUID, tier: "phone_confirmed", note: "rang them" })))?.error).toBeDefined();
    expect((await recordCheckAction(undefined, form({ table: "facilities", listing: UUID, tier: "seed_only", note: "rang them" })))?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records a phone check through the database function", async () => {
    const r = await recordCheckAction(undefined, form({ table: "facilities", listing: UUID, tier: "phone_confirmed", note: "Rang the front desk" }));
    expect(r).toEqual({ done: "Check recorded." });
    expect(rpc).toHaveBeenCalledWith("record_directory_check", { p_listing_table: "facilities", p_listing_id: UUID, p_note: "Rang the front desk", p_tier: "phone_confirmed" });
  });

  it("surfaces a refusal from the database", async () => {
    rpc.mockResolvedValue({ error: { message: "not allowed" } });
    expect(await recordCheckAction(undefined, form({ table: "specialist_providers", listing: UUID, tier: "licence_checked", note: "MDCN register" }))).toEqual({ error: "not allowed" });
  });
});
