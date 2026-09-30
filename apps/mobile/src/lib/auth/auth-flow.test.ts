import {
  authErrorKey,
  isOtpComplete,
  isPhoneNotConfirmed,
  isUnknownUserOtpError,
  requestPhoneCode,
  resendPhoneCode,
  sanitiseOtp,
  secondsUntilResend,
  signInWithPhonePassword,
  startPhoneSignUp,
  verifyPhoneCode,
  RESEND_COOLDOWN_SECONDS,
  type AuthApi,
} from "./auth-flow";

type Result = { error: { message: string } | null };
const ok: Result = { error: null };
const fail = (message: string): Result => ({ error: { message } });

function fakeAuth(overrides: Partial<Record<keyof AuthApi, Result>> = {}) {
  const calls: Record<string, unknown[]> = {};
  const make = (name: keyof AuthApi) =>
    jest.fn(async (args: unknown) => {
      (calls[name] ??= []).push(args);
      return overrides[name] ?? ok;
    });
  const auth = {
    signUp: make("signUp"),
    verifyOtp: make("verifyOtp"),
    resend: make("resend"),
    signInWithPassword: make("signInWithPassword"),
    signInWithOtp: make("signInWithOtp"),
  } as unknown as AuthApi & Record<keyof AuthApi, jest.Mock>;
  return { auth, calls };
}

describe("otp helpers", () => {
  it("cleans pasted codes to six digits", () => {
    expect(sanitiseOtp("123 456")).toBe("123456");
    expect(sanitiseOtp("12-34-56-78")).toBe("123456");
    expect(isOtpComplete("12345")).toBe(false);
    expect(isOtpComplete("123 456")).toBe(true);
  });
});

describe("resend countdown", () => {
  it("counts whole seconds down and never goes negative", () => {
    const start = 1_000_000;
    const availableAt = start + RESEND_COOLDOWN_SECONDS * 1000;
    expect(secondsUntilResend(start, availableAt)).toBe(60);
    expect(secondsUntilResend(start + 59_001, availableAt)).toBe(1);
    expect(secondsUntilResend(availableAt, availableAt)).toBe(0);
    expect(secondsUntilResend(availableAt + 5000, availableAt)).toBe(0);
  });
});

describe("error classification", () => {
  it("recognises phone-not-confirmed and unknown-user messages", () => {
    expect(isPhoneNotConfirmed("Phone not confirmed")).toBe(true);
    expect(isPhoneNotConfirmed("Invalid login credentials")).toBe(false);
    expect(isUnknownUserOtpError("Signups not allowed for otp")).toBe(true);
    expect(isUnknownUserOtpError("rate limit")).toBe(false);
  });

  it("never returns a raw provider string and is identical for account-exists vs not", () => {
    expect(authErrorKey("Invalid login credentials", "sign_in")).toBe("auth.error.sign_in_failed");
    expect(authErrorKey("User not found", "sign_in")).toBe("auth.error.sign_in_failed");
    expect(authErrorKey("Token has expired or is invalid", "verify")).toBe("auth.error.wrong_code");
    expect(authErrorKey("For security purposes, you can only request this after 59 seconds", "resend")).toBe(
      "auth.error.rate_limited",
    );
    expect(authErrorKey("Failed to fetch", "sign_up")).toBe("auth.error.offline");
    expect(authErrorKey("boom", "sign_up")).toBe("auth.error.generic");
  });
});

describe("phone sign-up", () => {
  it("moves to the verify step and sends the profile metadata", async () => {
    const { auth, calls } = fakeAuth();
    const out = await startPhoneSignUp(auth, {
      phone: "+2348031234567",
      password: "a-long-password",
      fullName: "Ada Obi",
      state: "Lagos",
    });
    expect(out).toEqual({ kind: "verify" });
    expect(calls.signUp?.[0]).toMatchObject({
      phone: "+2348031234567",
      options: { data: { full_name: "Ada Obi", phone: "+2348031234567", state: "Lagos" } },
    });
  });

  it("looks identical when the number already has an account (no enumeration)", async () => {
    const { auth } = fakeAuth({ signUp: fail("User already registered") });
    expect(
      await startPhoneSignUp(auth, { phone: "+2348031234567", password: "x".repeat(10), fullName: "A B" }),
    ).toEqual({ kind: "verify" });
  });

  it("maps other failures to an auth.error key", async () => {
    const { auth } = fakeAuth({ signUp: fail("Something odd") });
    expect(
      await startPhoneSignUp(auth, { phone: "+2348031234567", password: "x".repeat(10), fullName: "A B" }),
    ).toEqual({ kind: "error", key: "auth.error.generic" });
  });
});

describe("verify and resend", () => {
  it("rejects an incomplete code without calling the server", async () => {
    const { auth } = fakeAuth();
    const out = await verifyPhoneCode(auth, { phone: "+2348031234567", code: "123" });
    expect(out).toEqual({ kind: "error", key: "auth.error.wrong_code" });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("verifies a pasted code after cleaning it", async () => {
    const { auth, calls } = fakeAuth();
    expect(await verifyPhoneCode(auth, { phone: "+2348031234567", code: "123 456" })).toEqual({
      kind: "verified",
    });
    expect(calls.verifyOtp?.[0]).toEqual({ phone: "+2348031234567", token: "123456", type: "sms" });
  });

  it("maps a wrong code", async () => {
    const { auth } = fakeAuth({ verifyOtp: fail("Token has expired or is invalid") });
    expect(await verifyPhoneCode(auth, { phone: "+2348031234567", code: "000000" })).toEqual({
      kind: "error",
      key: "auth.error.wrong_code",
    });
  });

  it("resend calls auth.resend with type sms and maps a throttle", async () => {
    const { auth, calls } = fakeAuth();
    expect(await resendPhoneCode(auth, "+2348031234567")).toEqual({ kind: "sent" });
    expect(calls.resend?.[0]).toEqual({ type: "sms", phone: "+2348031234567" });
    const throttled = fakeAuth({ resend: fail("For security purposes, wait 60 seconds") });
    expect(await resendPhoneCode(throttled.auth, "+2348031234567")).toEqual({
      kind: "error",
      key: "auth.error.rate_limited",
    });
  });
});

describe("code request is not a rate-limit oracle", () => {
  it("a registered number inside GoTrue's resend gap looks exactly like an unknown number", async () => {
    const registered = fakeAuth({ signInWithOtp: fail("For security purposes, you can only request this after 47 seconds") });
    const unknown = fakeAuth({ signInWithOtp: fail("Signups not allowed for otp") });
    expect(await requestPhoneCode(registered.auth, "+2348031234567")).toEqual(
      await requestPhoneCode(unknown.auth, "+2348031234567"),
    );
    expect(await requestPhoneCode(registered.auth, "+2348031234567")).toEqual({ kind: "sent" });
  });
});

describe("phone sign-in", () => {
  it("signs in with a confirmed number", async () => {
    const { auth } = fakeAuth();
    expect(await signInWithPhonePassword(auth, { phone: "+2348031234567", password: "pw" })).toEqual({
      kind: "signed_in",
    });
    expect(auth.resend).not.toHaveBeenCalled();
  });

  it("'Phone not confirmed' requests a new code and moves to verify", async () => {
    const { auth, calls } = fakeAuth({ signInWithPassword: fail("Phone not confirmed") });
    expect(await signInWithPhonePassword(auth, { phone: "+2348031234567", password: "pw" })).toEqual({
      kind: "needs_verification",
    });
    expect(calls.resend?.[0]).toEqual({ type: "sms", phone: "+2348031234567" });
  });

  it("does not announce a code that could not be sent: a failed resend is an error", async () => {
    const { auth } = fakeAuth({ signInWithPassword: fail("Phone not confirmed") });
    auth.resend.mockRejectedValueOnce(new Error("offline"));
    const outcome = await signInWithPhonePassword(auth, { phone: "+2348031234567", password: "pw" });
    expect(outcome.kind).toBe("error");
  });

  it("a throttled resend still moves to verify (a code from the last minute is on its way)", async () => {
    const { auth } = fakeAuth({
      signInWithPassword: fail("Phone not confirmed"),
      resend: fail("For security purposes, you can only request this after 40 seconds"),
    });
    expect(await signInWithPhonePassword(auth, { phone: "+2348031234567", password: "pw" })).toEqual({
      kind: "needs_verification",
    });
  });

  it("uses one wording for wrong password and unknown number", async () => {
    const a = fakeAuth({ signInWithPassword: fail("Invalid login credentials") });
    const b = fakeAuth({ signInWithPassword: fail("User not found") });
    const args = { phone: "+2348031234567", password: "pw" };
    expect(await signInWithPhonePassword(a.auth, args)).toEqual(await signInWithPhonePassword(b.auth, args));
  });
});

describe("recovery / code sign-in request", () => {
  it("never creates a user and treats success as sent", async () => {
    const { auth, calls } = fakeAuth();
    expect(await requestPhoneCode(auth, "+2348031234567")).toEqual({ kind: "sent" });
    expect(calls.signInWithOtp?.[0]).toEqual({
      phone: "+2348031234567",
      options: { shouldCreateUser: false },
    });
  });

  it("treats an unknown number as success so recovery never reveals who is registered", async () => {
    const { auth } = fakeAuth({ signInWithOtp: fail("Signups not allowed for otp") });
    expect(await requestPhoneCode(auth, "+2348031234567")).toEqual({ kind: "sent" });
  });

  it("reports a throttle as 'sent' (surfacing it would tell an attacker the number is registered)", async () => {
    const { auth } = fakeAuth({ signInWithOtp: fail("Too many requests") });
    expect(await requestPhoneCode(auth, "+2348031234567")).toEqual({ kind: "sent" });
  });
});
