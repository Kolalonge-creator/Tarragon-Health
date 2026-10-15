import { describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn(async (..._args: unknown[]) => ({ data: [], error: null }));
let staff: { doctor_tier: string } | null = { doctor_tier: "medical_officer" };
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: async () => staff }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { loadReviewQueueAction, readSampleAction, recordReviewAction } from "./actions";

const ID = "7b1a6f2e-6f0d-4e8e-9f55-0c6a3b2f9c11";

describe("the monthly assistant review actions (S52, 7.13)", () => {
  it("refuse everyone below the Chief Medical Officer without calling the database", async () => {
    staff = { doctor_tier: "senior_medical_officer" };
    rpc.mockClear();
    expect((await loadReviewQueueAction()).ok).toBe(false);
    expect((await readSampleAction({ id: ID, reason: "Monthly clinical review" })).ok).toBe(false);
    expect((await recordReviewAction({ id: ID, verdict: "appropriate", category: "none" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuse a signed-out caller", async () => {
    staff = null;
    expect((await loadReviewQueueAction()).ok).toBe(false);
  });

  it("the CMO needs a real reason to open a conversation", async () => {
    staff = { doctor_tier: "chief_medical_officer" };
    rpc.mockClear();
    const r = await readSampleAction({ id: ID, reason: "no" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the CMO reads through the audited database door with the reason", async () => {
    staff = { doctor_tier: "chief_medical_officer" };
    rpc.mockClear();
    rpc.mockResolvedValueOnce({ data: { id: ID, state: "pending", verdict: null, note: null, messages: [{ role: "user", content: "hi" }] }, error: null } as never);
    const r = await readSampleAction({ id: ID, reason: "Monthly clinical review of the assistant" });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("assistant_review_read", { p_sample: ID, p_reason: "Monthly clinical review of the assistant" });
  });

  it("an unknown verdict or category never reaches the database", async () => {
    staff = { doctor_tier: "chief_medical_officer" };
    rpc.mockClear();
    expect((await recordReviewAction({ id: ID, verdict: "fine", category: "none" })).ok).toBe(false);
    expect((await recordReviewAction({ id: ID, verdict: "appropriate", category: "other_thing" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
