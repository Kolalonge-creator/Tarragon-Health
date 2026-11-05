/**
 * The console sign-in action and the 2FA gates. proxy.ts never sees a Server Action's redirect (Next renders the target in the
 * same response), so the action itself must send an account with a factor to the challenge and an account whose group requires
 * 2FA, with no factor, to the set-up page, before its first console page renders.
 */
const redirect = jest.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const aal = jest.fn();
const rpc = jest.fn();
jest.mock("@tarragon/auth/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () => ({ data: { user: { id: "u1" } }, error: null }),
      signOut: async () => ({}),
      mfa: { getAuthenticatorAssuranceLevel: () => aal() },
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: "ngo_admin" } }) }) }) }),
    rpc: (...a: unknown[]) => rpc(...a),
  }),
}));
jest.mock("@tarragon/auth/rate-limit", () => ({ checkAuthRateLimit: async () => ({ success: true }), RATE_LIMIT_MESSAGE: "x" }));
jest.mock("@tarragon/auth/record-login-device", () => ({ recordLoginDevice: async () => undefined }));

import { resetMfaRequirementCache } from "@tarragon/auth/mfa-policy";
import { signInToConsole } from "./actions";

function form() {
  const f = new FormData();
  f.set("email", "staff@example.com");
  f.set("password", "a-long-enough-password");
  return f;
}

beforeEach(() => {
  redirect.mockClear();
  resetMfaRequirementCache();
  rpc.mockResolvedValue({ data: [], error: null });
});

describe("signInToConsole and 2FA", () => {
  it("goes straight to the console home while no group is on and the account has no factor", async () => {
    aal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" } });
    await expect(signInToConsole(undefined, form())).rejects.toThrow("NEXT_REDIRECT:/ngo");
  });

  it("sends an account with a factor to the challenge first", async () => {
    aal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" } });
    await expect(signInToConsole(undefined, form())).rejects.toThrow("NEXT_REDIRECT:/login/mfa-challenge?redirect=%2Fngo");
  });

  it("sends a required account with no factor to the set-up page", async () => {
    aal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" } });
    rpc.mockImplementation(async (fn: string) =>
      fn === "mfa_required_roles"
        ? { data: ["admin", "care_coordinator", "clinician", "ngo_admin", "patient"], error: null }
        : { data: [{ required: true, has_verified_factor: false }], error: null },
    );
    await expect(signInToConsole(undefined, form())).rejects.toThrow("NEXT_REDIRECT:/login/mfa-setup");
  });
});
