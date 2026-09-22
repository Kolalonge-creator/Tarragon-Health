/**
 * Two related regressions around verifyGuestCheckoutOtp/startGuestCheckout,
 * a THIRD passwordless sign-in entry point (email OTP) alongside password
 * and phone-OTP login:
 *
 * 1. Bypass (fixed): per startGuestCheckout's own doc comment, signInWithOtp
 *    with shouldCreateUser:true silently authenticates a returning guest
 *    whose email matches an EXISTING account — including one locked via 5
 *    failed password attempts on /login. Both functions now READ
 *    is_account_locked before proceeding, so a locked account can't be
 *    reached through checkout either.
 *
 * 2. Griefing vector (found and reverted before merge, NOT built): an
 *    earlier version of this fix also called record_failed_login on a wrong
 *    OTP guess here, the same way login/actions.ts and forgot-password/
 *    actions.ts do for THEIR verify failures. That is wrong for THIS entry
 *    point specifically — unlike password or phone-OTP login, which both
 *    require the caller to already know something about the account (the
 *    password itself, or control of the phone number an OTP was sent to),
 *    startGuestCheckout needs only a PUBLIC email address to trigger a real
 *    OTP send. If wrong guesses here also counted toward the shared lockout
 *    counter, any stranger who knows nothing else about a victim could
 *    submit 5 guesses they can never get right (the code goes to the
 *    victim's own inbox) and lock the victim out of password AND phone-OTP
 *    login too — repeatable indefinitely with nothing but a public email
 *    address as input. verifyGuestCheckoutOtp deliberately never calls
 *    record_failed_login at all; this file proves that stays true even
 *    across repeated wrong guesses.
 */

const redirectMock = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => redirectMock(...args) }));
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ success: true, retryAfterSeconds: 0 }),
  RATE_LIMIT_MESSAGE: "Too many attempts. Please wait a moment, then try again.",
}));
const purchaseServiceProduct = jest.fn().mockResolvedValue({ activated: true });
jest.mock("@/lib/billing/purchase-service-product", () => ({
  purchaseServiceProduct: (...args: unknown[]) => purchaseServiceProduct(...args),
}));

const recordLoginDevice = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/auth/record-login-device", () => ({
  recordLoginDevice: (...args: unknown[]) => recordLoginDevice(...args),
}));

const anonRpc = jest.fn();
const verifyOtp = jest.fn();
const signInWithOtp = jest.fn();
const profilesUpdate = jest.fn().mockReturnValue({ eq: jest.fn() });
// Defaults to "no step-up needed" (aal1 -> aal1), matching an account with
// no MFA factor enrolled — the overwhelming majority of guest-checkout
// callers. Individual tests override this to simulate an MFA-enrolled
// account being reached through this flow.
const getAuthenticatorAssuranceLevel = jest
  .fn()
  .mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: anonRpc,
    auth: { verifyOtp, signInWithOtp, mfa: { getAuthenticatorAssuranceLevel } },
    from: () => ({ update: profilesUpdate }),
  }),
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
  verifyOtp.mockReset();
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  recordLoginDevice.mockReset().mockResolvedValue(undefined);
  redirectMock.mockReset();
  purchaseServiceProduct.mockReset().mockResolvedValue({ activated: true });
  getAuthenticatorAssuranceLevel
    .mockReset()
    .mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
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

  it("clears failures and records the login device on a successful verify", async () => {
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
    // Same new-device security alert every other real sign-in path fires
    // (redirectAfterLogin in login/actions.ts) — this flow authenticates
    // into a real account too and deserves the same coverage.
    expect(recordLoginDevice).toHaveBeenCalledTimes(1);
  });
});

describe("verifyGuestCheckoutOtp — griefing-vector regression (must NEVER record a failure)", () => {
  const errorShapes = [
    { message: "Invalid otp" },
    { message: "Token has expired or is invalid" },
    { message: "For security purposes, you can only request this after 47 seconds" },
    { message: "TypeError: fetch failed" },
  ];

  it.each(errorShapes)(
    "never calls record_failed_login for a %j verifyOtp failure",
    async (errorShape) => {
      anonRpc.mockResolvedValue({ data: false, error: null });
      verifyOtp.mockResolvedValue({ data: { user: null }, error: errorShape });

      await verifyGuestCheckoutOtp(
        PRODUCT_CODE,
        undefined,
        otpFormData("victim@example.com", "00000000")
      );

      const anonRpcCalls = anonRpc.mock.calls.map((call) => call[0]);
      expect(anonRpcCalls).not.toContain("record_failed_login");
    }
  );

  it("an anonymous actor with only a victim's public email cannot lock the victim out via repeated wrong guesses", async () => {
    // Simulates the exact attack: attacker knows only victim@example.com
    // (no password, no phone), triggers one real OTP send via
    // startGuestCheckout, then submits 5 deliberately-wrong codes — the
    // number that would lock the account via the password/phone-OTP path.
    anonRpc.mockResolvedValue({ data: false, error: null }); // never locked
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "Invalid otp" } });

    for (let i = 0; i < 5; i++) {
      await verifyGuestCheckoutOtp(
        PRODUCT_CODE,
        undefined,
        otpFormData("victim@example.com", "00000000")
      );
    }

    const anonRpcCalls = anonRpc.mock.calls.map((call) => call[0]);
    expect(anonRpcCalls).not.toContain("record_failed_login");
    expect(anonRpcCalls).not.toContain("record_failed_login_by_phone");
  });
});

describe("verifyGuestCheckoutOtp — MFA step-up gate (account-takeover regression)", () => {
  // This flow can silently authenticate into an EXISTING account by email
  // match (see the module's own doc comment). If that account has TOTP
  // enrolled, purchaseServiceProduct() must never run in the same request
  // as OTP verification — proxy.ts's own MFA gate only catches the NEXT
  // request, and there is no next request before this function would
  // otherwise charge the account. Found in review: money could move before
  // MFA was ever checked.
  it("does NOT purchase and redirects to the MFA challenge when the account needs step-up", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null }); // not locked
    verifyOtp.mockResolvedValue({
      data: { user: { id: "user-1", user_metadata: {} } },
      error: null,
    });
    getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });

    await verifyGuestCheckoutOtp(
      PRODUCT_CODE,
      undefined,
      otpFormData("mfa-enrolled@example.com", "12345678")
    );

    expect(purchaseServiceProduct).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledTimes(1);
    const [target] = redirectMock.mock.calls[0]!;
    expect(target).toMatch(/^\/login\/mfa-challenge\?redirect=/);
    // Resume target carries the guest's product code straight back into the
    // pre-existing "resume an authenticated checkout" page, which itself
    // reuses purchaseServiceProduct() and is covered by proxy.ts's own MFA
    // gate — the charge only ever executes once TOTP is verified.
    expect(decodeURIComponent(target)).toBe(
      `/login/mfa-challenge?redirect=/checkout/continue?code=${PRODUCT_CODE}`
    );
  });

  it("still purchases normally when the account has no MFA factor enrolled (aal1 -> aal1)", async () => {
    anonRpc.mockResolvedValue({ data: false, error: null });
    verifyOtp.mockResolvedValue({
      data: { user: { id: "user-1", user_metadata: {} } },
      error: null,
    });
    // Default mock is already aal1 -> aal1; asserted explicitly here for clarity.
    getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal1" },
      error: null,
    });

    await verifyGuestCheckoutOtp(
      PRODUCT_CODE,
      undefined,
      otpFormData("no-mfa@example.com", "12345678")
    );

    expect(purchaseServiceProduct).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/checkout/receipt");
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
