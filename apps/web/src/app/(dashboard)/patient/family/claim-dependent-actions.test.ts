/**
 * Hand-over of a dependant's record (S04b-1, R3 and OQ-48). Pinned here:
 *  - the action only STARTS a hand-over through public.start_dependant_handover; it never flips is_dependent_account or
 *    edits the profile (that is accept_dependant_handover, which only the person themselves can call);
 *  - nothing is queued on the sms channel or any other channel (INV-08: SMS is a verification code only);
 *  - the phone is attached to the auth user UNCONFIRMED, and a failure to attach cancels the pending hand-over;
 *  - the database's refusal (not yet 18) is reported calmly and nothing is attached.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const getCurrentProfileMock = jest.fn();
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => getCurrentProfileMock() }));

const rpcMock = jest.fn();
const grantResult = { current: { data: { id: "grant-1" } as { id: string } | null } };
const dependentResult = {
  current: {
    data: { full_name: "Tolu Adebayo", is_dependent_account: true, dependent_kind: "minor_child", majority_review_at: "2026-10-01T00:00:00Z" } as Record<string, unknown> | null,
  },
};

function chain(result: { current: { data: unknown } }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in"]) c[m] = () => c;
  c.maybeSingle = async () => result.current;
  c.single = async () => result.current;
  return c;
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    from: (table: string) => (table === "profile_access" ? chain(grantResult) : chain(dependentResult)),
    rpc: (...a: unknown[]) => rpcMock(...a),
  }),
}));

const updateUserByIdMock = jest.fn();
const svcFromMock = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    auth: { admin: { updateUserById: (...a: unknown[]) => updateUserByIdMock(...a) } },
    from: (table: string) => {
      svcFromMock(table);
      return { insert: async () => ({ error: null }), update: async () => ({ error: null }) };
    },
  }),
}));

import { claimDependentAccountAction } from "./claim-dependent-actions";

const DEP = "6f1c2a52-8c0e-4d57-9b7f-0d2b6a1f4e11";
const PHONE = "+2348031234567";

beforeEach(() => {
  getCurrentProfileMock.mockReset().mockResolvedValue({ id: "guardian-1", organisation_id: "org-1" });
  // find_profile_by_phone is used as rpc(...).maybeSingle(); every other rpc is awaited directly
  rpcMock.mockReset().mockImplementation((fn: string) => {
    if (fn === "find_profile_by_phone") return { maybeSingle: async () => ({ data: null }) };
    return Promise.resolve({ data: "handover-1", error: null });
  });
  updateUserByIdMock.mockReset().mockResolvedValue({ error: null });
  svcFromMock.mockReset();
  grantResult.current = { data: { id: "grant-1" } };
  dependentResult.current = {
    data: { full_name: "Tolu Adebayo", is_dependent_account: true, dependent_kind: "minor_child", majority_review_at: "2026-10-01T00:00:00Z" },
  };
});

describe("claimDependentAccountAction", () => {
  it("starts the hand-over, attaches the number unconfirmed, and changes nothing about who owns the record", async () => {
    const result = await claimDependentAccountAction({ dependent_id: DEP, phone: PHONE });
    expect(result).toEqual({ message: expect.stringContaining("their record stays with you") });
    expect(rpcMock).toHaveBeenCalledWith("start_dependant_handover", { p_dependent: DEP, p_phone: PHONE });
    expect(updateUserByIdMock).toHaveBeenCalledWith(DEP, { phone: PHONE, phone_confirm: false });
    // never a profile edit, and never a notification of any channel (OQ-48)
    const tablesTouched = svcFromMock.mock.calls.map((c) => c[0]);
    expect(tablesTouched).not.toContain("profiles");
    expect(tablesTouched).not.toContain("notifications");
  });

  it("reports the database's refusal calmly and attaches nothing", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "find_profile_by_phone") return { maybeSingle: async () => ({ data: null }) };
      return Promise.resolve({ data: null, error: { message: "this record cannot be handed over" } });
    });
    const result = await claimDependentAccountAction({ dependent_id: DEP, phone: PHONE });
    expect(result).toEqual({ error: expect.stringContaining("18") });
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });

  it("cancels the pending hand-over when the number cannot be attached", async () => {
    updateUserByIdMock.mockResolvedValue({ error: { message: "phone already used" } });
    const result = await claimDependentAccountAction({ dependent_id: DEP, phone: PHONE });
    expect(result).toEqual({ error: "phone already used" });
    expect(rpcMock).toHaveBeenCalledWith("cancel_dependant_handover", { p_dependent: DEP });
  });

  it("refuses a child who has not been flagged as 18 yet, and someone with no grant", async () => {
    dependentResult.current = { data: { full_name: "Small", is_dependent_account: true, dependent_kind: "minor_child", majority_review_at: null } };
    expect(await claimDependentAccountAction({ dependent_id: DEP, phone: PHONE })).toEqual({
      error: "This record hasn't been flagged for majority review yet",
    });
    grantResult.current = { data: null };
    expect(await claimDependentAccountAction({ dependent_id: DEP, phone: PHONE })).toEqual({
      error: "You don't have access to this record",
    });
    expect(rpcMock).not.toHaveBeenCalledWith("start_dependant_handover", expect.anything());
  });

  it("refuses a number that already belongs to another account", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "find_profile_by_phone") return { maybeSingle: async () => ({ data: { id: "x" } }) };
      return Promise.resolve({ data: "h", error: null });
    });
    expect(await claimDependentAccountAction({ dependent_id: DEP, phone: PHONE })).toEqual({
      error: "That phone number is already on a different Tarragon account",
    });
    expect(updateUserByIdMock).not.toHaveBeenCalled();
  });
});
