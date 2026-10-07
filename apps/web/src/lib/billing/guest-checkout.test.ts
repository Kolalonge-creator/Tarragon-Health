/**
 * Regression test for the same data-loss bug class the signup and patient
 * location forms were fixed for: React resets every uncontrolled field in
 * an action-bound <form> once the action returns, success or failure.
 * `startGuestCheckout`/`verifyGuestCheckoutOtp` originally returned only
 * `{error}` (or `{error, field}`/`{error, step, email}`) on failure, so
 * GuestCheckoutForm's fullName/email/countryCode/phone/token
 * <Input>/<Select> defaultValues had nothing fresh to fall back to — a
 * rate-limit hit, a duplicate-email OTP-send error, a wrong/expired code,
 * or a plain validation failure on one field would silently wipe
 * everything the visitor had just typed into this paid checkout flow. This
 * proves both actions echo back exactly what was submitted on every way
 * they can fail before a session/purchase exists — including the
 * unrecognised-product-code guard at the top of each, which is easy to
 * forget to wire up since it sits before the rest of each function's logic.
 */

const checkAuthRateLimit = jest.fn();
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: (...args: unknown[]) => checkAuthRateLimit(...args),
  RATE_LIMIT_MESSAGE: "Too many attempts. Please wait a moment, then try again.",
}));

const signInWithOtp = jest.fn();
const verifyOtp = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      signInWithOtp: (...args: unknown[]) => signInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => verifyOtp(...args),
    },
    from: () => ({ update: () => ({ eq: jest.fn() }) }),
  }),
}));

import { startGuestCheckout, verifyGuestCheckoutOtp } from "./guest-checkout";

const PRODUCT_CODE = "async_consult_credit";
const UNKNOWN_PRODUCT_CODE = "not_a_real_product";

function formDataFor(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("fullName", "Ada Guest");
  fd.set("email", "ada.guest@example.com");
  fd.set("countryCode", "+234");
  fd.set("phone", "8012345678");
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

describe("startGuestCheckout — submitted values survive a failed submission", () => {
  beforeEach(() => {
    checkAuthRateLimit.mockReset();
    signInWithOtp.mockReset();
    checkAuthRateLimit.mockResolvedValue({ success: true });
  });

  it("echoes back every submitted field when the product code isn't guest-checkout-eligible", async () => {
    const result = await startGuestCheckout(UNKNOWN_PRODUCT_CODE, undefined, formDataFor());

    expect(result?.error).toBeTruthy();
    expect(result?.values).toEqual({
      fullName: "Ada Guest",
      email: "ada.guest@example.com",
      countryCode: "+234",
      phone: "8012345678",
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("echoes back every submitted field when Zod validation fails", async () => {
    const result = await startGuestCheckout(
      PRODUCT_CODE,
      undefined,
      formDataFor({ email: "not-an-email" })
    );

    expect(result?.error).toBeTruthy();
    expect(result?.field).toBe("email");
    expect(result?.values).toEqual({
      fullName: "Ada Guest",
      email: "not-an-email",
      countryCode: "+234",
      phone: "8012345678",
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("echoes back every submitted field when the rate limit is hit", async () => {
    checkAuthRateLimit.mockResolvedValue({ success: false });

    const result = await startGuestCheckout(PRODUCT_CODE, undefined, formDataFor());

    expect(result?.error).toBe("Too many attempts. Please wait a moment, then try again.");
    expect(result?.values).toEqual({
      fullName: "Ada Guest",
      email: "ada.guest@example.com",
      countryCode: "+234",
      phone: "8012345678",
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("echoes back every submitted field when Supabase's own OTP send fails", async () => {
    signInWithOtp.mockResolvedValue({
      data: null,
      error: { message: "Email rate limit exceeded", status: 429 },
    });

    const result = await startGuestCheckout(PRODUCT_CODE, undefined, formDataFor());

    expect(result?.error).toBeTruthy();
    expect(result?.values).toEqual({
      fullName: "Ada Guest",
      email: "ada.guest@example.com",
      countryCode: "+234",
      phone: "8012345678",
    });
  });

  it("returns no values on a genuine success, since the form is replaced by the verify step", async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: null });

    const result = await startGuestCheckout(PRODUCT_CODE, undefined, formDataFor());

    expect(result).toEqual({ step: "verify", email: "ada.guest@example.com" });
  });
});

function verifyFormDataFor(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("email", "ada.guest@example.com");
  fd.set("token", "12345678");
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

describe("verifyGuestCheckoutOtp — the typed code survives a failed submission", () => {
  beforeEach(() => {
    checkAuthRateLimit.mockReset();
    verifyOtp.mockReset();
    checkAuthRateLimit.mockResolvedValue({ success: true });
  });

  it("echoes back the typed code when the product code isn't guest-checkout-eligible", async () => {
    const result = await verifyGuestCheckoutOtp(UNKNOWN_PRODUCT_CODE, undefined, verifyFormDataFor());

    expect(result?.error).toBeTruthy();
    expect(result?.step).toBe("verify");
    expect(result?.email).toBe("ada.guest@example.com");
    expect(result?.values).toEqual({ token: "12345678" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("echoes back the typed code when Zod validation fails", async () => {
    const result = await verifyGuestCheckoutOtp(
      PRODUCT_CODE,
      undefined,
      verifyFormDataFor({ token: "123" })
    );

    expect(result?.error).toBeTruthy();
    expect(result?.step).toBe("verify");
    expect(result?.values).toEqual({ token: "123" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("echoes back the typed code when the verify rate limit is hit", async () => {
    checkAuthRateLimit.mockResolvedValue({ success: false });

    const result = await verifyGuestCheckoutOtp(PRODUCT_CODE, undefined, verifyFormDataFor());

    expect(result?.error).toBe("Too many attempts. Please wait a moment, then try again.");
    expect(result?.step).toBe("verify");
    expect(result?.values).toEqual({ token: "12345678" });
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("echoes back the typed code when the code is wrong or expired", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: "Token has expired or is invalid", status: 403 },
    });

    const result = await verifyGuestCheckoutOtp(PRODUCT_CODE, undefined, verifyFormDataFor());

    expect(result?.error).toBeTruthy();
    expect(result?.step).toBe("verify");
    expect(result?.values).toEqual({ token: "12345678" });
  });
});
