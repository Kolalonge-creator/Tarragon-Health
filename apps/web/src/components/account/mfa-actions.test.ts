/**
 * turnOffMfa and the 2FA group requirement (/admin/settings/two-factor).
 *
 * Pinned here: while an admin has required 2FA for the account's group, the factor cannot be turned off from Profile &
 * settings (turning it off would hold the account on that page until it set one up again, and would leave a required account
 * with no factor). An unreadable answer refuses too. When the group is not required, or the requirement functions do not exist
 * yet (code deployed before the migration), turning it off works exactly as before.
 */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const rpc = jest.fn();
const unenroll = jest.fn();
const getCurrentUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: () => getCurrentUser(),
  createClient: jest.fn().mockResolvedValue({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { mfa: { unenroll: (...a: unknown[]) => unenroll(...a) } },
  }),
}));

import { turnOffMfa } from "./mfa-actions";

const form = () => {
  const fd = new FormData();
  fd.set("factorId", "factor-1");
  return fd;
};

beforeEach(() => {
  jest.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1" });
  unenroll.mockResolvedValue({ error: null });
});

describe("turnOffMfa", () => {
  it("turns the factor off when the account's group does not require 2FA", async () => {
    rpc.mockResolvedValue({ data: [{ required: false, has_verified_factor: true }], error: null });
    expect(await turnOffMfa(undefined, form())).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("my_mfa_requirement");
    expect(unenroll).toHaveBeenCalledWith({ factorId: "factor-1" });
  });

  it("refuses, and never calls unenroll, when the group requires 2FA", async () => {
    rpc.mockResolvedValue({ data: [{ required: true, has_verified_factor: true }], error: null });
    const res = await turnOffMfa(undefined, form());
    expect(res?.error).toContain("required");
    expect(unenroll).not.toHaveBeenCalled();
  });

  it("refuses when the requirement cannot be read", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    const res = await turnOffMfa(undefined, form());
    expect(res?.error).toContain("could not check");
    expect(unenroll).not.toHaveBeenCalled();
  });

  it("works as before when the requirement functions are not deployed yet", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });
    expect(await turnOffMfa(undefined, form())).toEqual({ success: true });
    expect(unenroll).toHaveBeenCalled();
  });
});
