/**
 * redirectAfterLogin() used to be a private, copy-pasted helper inside
 * login/actions.ts. Consolidated here (caught in code review while fixing
 * signup/actions.ts's misleading "check your email" copy — see
 * apps/web/src/app/signup/auto-confirm-redirect.test.ts) so signup's own
 * auto-confirm redirect can call the exact same sequence login already used,
 * instead of a third hand-rolled copy. Also runs recordLoginDevice and
 * resolveLoginDestination concurrently rather than sequentially, since
 * neither depends on the other's result.
 */

jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const recordLoginDeviceMock = jest.fn();
jest.mock("./record-login-device", () => ({
  recordLoginDevice: (...args: unknown[]) => recordLoginDeviceMock(...args),
}));

jest.mock("./roles", () => ({
  getRoleHomePath: jest.fn().mockReturnValue("/patient"),
}));

const aal = jest.fn().mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" } });
const rpcStub = jest.fn().mockResolvedValue({ data: false, error: null });
const supabaseStub = {
  auth: { mfa: { getAuthenticatorAssuranceLevel: () => aal() } },
  rpc: (...a: unknown[]) => rpcStub(...a),
  from: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: { role: "patient" } }),
      }),
    }),
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

import { redirect } from "next/navigation";
import { gateLoginDestination, redirectAfterLogin } from "./redirect-after-login";
import { resetMfaRequirementCache } from "@tarragon/auth/mfa-policy";

describe("redirectAfterLogin", () => {
  beforeEach(() => {
    recordLoginDeviceMock.mockReset();
    recordLoginDeviceMock.mockResolvedValue(undefined);
    jest.mocked(redirect).mockClear();
  });

  it("records the login device and redirects to the resolved destination", async () => {
    await expect(
      redirectAfterLogin(supabaseStub, "user-123", null)
    ).rejects.toThrow("NEXT_REDIRECT:/patient");

    expect(recordLoginDeviceMock).toHaveBeenCalledWith(supabaseStub);
    expect(redirect).toHaveBeenCalledWith("/patient");
  });

  it("documents that a rejected recordLoginDevice call still blocks the redirect", async () => {
    // record-login-device.ts's own contract is to never throw (it swallows
    // its own errors — see its module doc), which is what actually keeps a
    // real sign-in from breaking. This only records what Promise.all does if
    // that contract is ever violated, since this refactor is what introduced
    // the concurrent await — a future change here shouldn't silently start
    // relying on recordLoginDevice() never rejecting without this failing.
    recordLoginDeviceMock.mockRejectedValue(new Error("rpc unavailable"));

    await expect(redirectAfterLogin(supabaseStub, "user-123", null)).rejects.toThrow(
      "rpc unavailable"
    );
  });

  it("prefers a sanitized redirectTo over the role home", async () => {
    await expect(
      redirectAfterLogin(supabaseStub, "user-123", "/patient/vitals")
    ).rejects.toThrow("NEXT_REDIRECT:/patient/vitals");
  });

  it("accepts a raw FormDataEntryValue, matching how login/actions.ts calls it", async () => {
    const fd = new FormData();
    fd.set("redirectTo", "/patient/labs");

    await expect(
      redirectAfterLogin(supabaseStub, "user-123", fd.get("redirectTo"))
    ).rejects.toThrow("NEXT_REDIRECT:/patient/labs");
  });
});

describe("gateLoginDestination (a Server Action redirect never passes through proxy.ts)", () => {
  beforeEach(() => {
    resetMfaRequirementCache();
    aal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" } });
    rpcStub.mockReset();
    rpcStub.mockResolvedValue({ data: false, error: null });
  });

  it("keeps the destination for an account with no factor while no group is on (today)", async () => {
    expect(await gateLoginDestination(supabaseStub, "/patient")).toBe("/patient");
  });

  it("sends an account with a factor to the challenge first, keeping the destination", async () => {
    aal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" } });
    expect(await gateLoginDestination(supabaseStub, "/clinician?tab=1")).toBe("/login/mfa-challenge?redirect=%2Fclinician%3Ftab%3D1");
  });

  it("sends a required account with no factor to set-up, keeping the destination", async () => {
    rpcStub.mockImplementation(async (fn: string) =>
      fn === "mfa_any_group_required"
        ? { data: true, error: null }
        : { data: [{ required: true, has_verified_factor: false }], error: null },
    );
    expect(await gateLoginDestination(supabaseStub, "/clinician")).toBe("/account?mfa=required&redirect=%2Fclinician");
  });

  it("lets an AAL2 session through", async () => {
    aal.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" } });
    expect(await gateLoginDestination(supabaseStub, "/clinician")).toBe("/clinician");
  });

  it("keeps the destination if the level cannot be read (the proxy gates the next request)", async () => {
    aal.mockRejectedValue(new Error("boom"));
    expect(await gateLoginDestination(supabaseStub, "/patient")).toBe("/patient");
  });
});
