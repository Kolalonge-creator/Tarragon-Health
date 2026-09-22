/**
 * Regression: verifyGuestCheckoutOtp is a THIRD passwordless sign-in entry
 * point (email OTP, via signInWithOtp/verifyOtp) that used to have no
 * integration with the account-lockout feature at all
 * (20260918111442_account_lockout_after_repeated_failed_logins.sql). Per
 * startGuestCheckout's own doc comment, signInWithOtp with
 * shouldCreateUser:true silently authenticates a returning guest whose email
 * matches an EXISTING account — including one just locked via 5 failed
 * password attempts on /login. An attacker could lock a victim's account via
 * the password path, then walk straight through guest checkout at /checkout
 * to fully authenticate into that same account during the lock window — a
 * complete side-channel bypass of the whole feature. Proves, against the
 * real verifyGuestCheckoutOtp:
 *  - a locked account is refused BEFORE verifyOtp is ever called;
 *  - record_failed_login fires via the SERVICE-ROLE client on a genuine
 *    wrong-code result, never the anon-key client;
 *  - a successful verify clears the failure counter.
 */

jest.mock("next/navigation", () => ({ redirect: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ success: true, retryAfterSeconds: 0 }),
  RATE_LIMIT_MESSAGE: "Too many attempts. Please wait a moment, then try again.",
}));
jest.mock("@/lib/billing/purchase-service-product", () => ({
  purchaseServiceProduct: jest.fn().mockResolvedValue({ activated: true }),
}));

const anonRpc = jest.fn();
const serviceRoleRpc = jest.fn();
const verifyOtp = jest.fn();
const signInWithOtp = jest.fn();
const profilesUpdate = jest.fn().mockReturnValue({ eq: jest.fn() });

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: anonRpc,
    auth: { verifyOtp, signInWithOtp },
    from: () => ({ update: profilesUpdate }),
  }),
}));

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: jest.fn(() => ({ rpc: serviceRoleRpc })),
}));

import { startGuestCheckout, verifyGuestCheckoutOtp } from "./guest-checkout";

const PRODUCT_CODE = "video_visit_credit";

function otpFormData(email: string, token: string) {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("token", token);
  return fd;
}

function startFormData(email: string) {
  const fd = new FormData();
  fd.set("fullName", "Guest Patient");
  fd.set("email", email);
  // countryCode/phone are optional but the schema only accepts undefined or
  // "" for a blank value — formData.get() returns null for an absent key,
  // which fails validation, so the real form always sends "" when left blank.
  fd.set("countryCode", "");
  fd.set("phone", "");
  return fd;
}

beforeEach(() => {
  anonRpc.mockReset();
  serviceRoleRpc.mockReset().mockResolvedValue({ data: null, error: null });
  verifyOtp.mockReset();
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
});

describe("verifyGuestCheckoutOtp — account lockout (bypass regression)", () => {
  it("refuses a locked account before ever calling verifyOtp", async () => {
    anonRpc.mockResolvedValue({ data: true, error: null }); // is_account_locked -> true

    const result = await verifyGuestCheckoutOtp(
      PRODUCT_CODE,
      undefined,
      otpFormData("locked@example.com", "12345678")
    );

    expect(result?.error).toBe("Too many attempts. Please wait a moment, then try again.");
    expect(anonRpc).toHaveBeenCalledWith("is_account_locked", { p_email: "locked@example.com" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("records a failure via the SERVICE-ROLE client on a genuine wrong-code result", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "Invalid otp" } });

    await verifyGuestCheckoutOtp(
      PRODUCT_CODE,
      undefined,
      otpFormData("guest@example.com", "00000000")
    );

    expect(serviceRoleRpc).toHaveBeenCalledWith("record_failed_login", {
      p_email: "guest@example.com",
    });
    const anonRpcCalls = anonRpc.mock.calls.map((call) => call[0]);
    expect(anonRpcCalls).not.toContain("record_failed_login");
  });

  it("does NOT record a failure for a rate-limit error", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: "For security purposes, you can only request this after 47 seconds" },
    });

    await verifyGuestCheckoutOtp(
      PRODUCT_CODE,
      undefined,
      otpFormData("guest@example.com", "12345678")
    );

    expect(serviceRoleRpc).not.toHaveBeenCalled();
  });

  it("clears failures via the ordinary client on a successful verify", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    verifyOtp.mockResolvedValue({
      data: { user: { id: "user-1", user_metadata: {} } },
      error: null,
    });

    await verifyGuestCheckoutOtp(
      PRODUCT_CODE,
      undefined,
      otpFormData("guest@example.com", "12345678")
    );

    expect(anonRpc).toHaveBeenCalledWith("clear_login_failures");
  });
});

describe("startGuestCheckout — account lockout", () => {
  it("refuses to send an OTP to a locked account", async () => {
    anonRpc.mockResolvedValue({ data: true, error: null });

    const result = await startGuestCheckout(
      PRODUCT_CODE,
      undefined,
      startFormData("locked@example.com")
    );

    expect(result?.error).toBe("Too many attempts. Please wait a moment, then try again.");
    expect(anonRpc).toHaveBeenCalledWith("is_account_locked", { p_email: "locked@example.com" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends the OTP when the account is not locked", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });

    const result = await startGuestCheckout(
      PRODUCT_CODE,
      undefined,
      startFormData("guest@example.com")
    );

    expect(result?.step).toBe("verify");
    expect(signInWithOtp).toHaveBeenCalled();
  });
});
