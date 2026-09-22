/**
 * React resets every uncontrolled field in an action-bound <form> once the
 * action returns, success or failure — so before this fix, a single invalid
 * field (a bad phone number, say) wiped the whole signup form, including the
 * name and email the visitor had already typed correctly. The fix is the
 * `values` the action now echoes back alongside the error, which
 * signup-form.tsx uses to repopulate everything except the password. This
 * proves signUp() actually returns those values, on both the ways it can
 * fail before ever reaching Supabase's own signUp call.
 */

jest.mock("next/headers", () => ({
  headers: async () => ({ get: () => "https://tarragonhealth.ng" }),
}));

jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ success: true }),
  RATE_LIMIT_MESSAGE: "Too many attempts. Please wait a moment, then try again.",
}));

const signUpMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { signUp: signUpMock },
  }),
}));

import { signUp } from "./actions";

function formDataFor(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("firstName", "Test");
  fd.set("lastName", "User");
  fd.set("email", "test.user@example.com");
  fd.set("countryCode", "+234");
  fd.set("phone", "123"); // too short - fails signupSchema's regex
  fd.set("state", "Lagos");
  fd.set("password", "TestPassword123!");
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

describe("signUp — submitted values survive a failed submission", () => {
  beforeEach(() => {
    signUpMock.mockReset();
  });

  it("echoes back every non-password field when Zod validation fails", async () => {
    const result = await signUp(undefined, formDataFor());

    expect(result?.field).toBe("phone");
    expect(result?.values).toEqual({
      firstName: "Test",
      lastName: "User",
      email: "test.user@example.com",
      countryCode: "+234",
      phone: "123",
      state: "Lagos",
    });
    // The whole point: password is never round-tripped back through state.
    expect(result?.values).not.toHaveProperty("password");
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("still echoes back the submitted values when Supabase's own signUp call fails", async () => {
    signUpMock.mockResolvedValue({
      data: null,
      error: { message: "User already registered", status: 422, code: "user_already_exists" },
    });

    const result = await signUp(undefined, formDataFor({ phone: "8012345678" }));

    expect(result?.error).toBeTruthy();
    expect(result?.values).toMatchObject({
      firstName: "Test",
      lastName: "User",
      email: "test.user@example.com",
      phone: "8012345678",
    });
  });

  it("returns no values on a genuine success, since the form is replaced by a confirmation message", async () => {
    signUpMock.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

    const result = await signUp(undefined, formDataFor({ phone: "8012345678" }));

    expect(result).toEqual({ success: true });
  });
});
