/**
 * "Set up for my parent" server actions (S04, function 1.19, safety case 23).
 *
 * Pinned here:
 *  - the setup is recorded through create_proxy_setup with the TTL and daily cap from versioned config, never from the form;
 *  - the verification code goes to the PARENT's normalised number through a stateless client (the proxy's session is
 *    never touched) and the proxy gets the same answer whether or not the code could be sent (no enumeration), with the
 *    failure reported instead of swallowed;
 *  - the rate limit is keyed on the parent's number and a refusal creates nothing and sends nothing;
 *  - confirming sends only categories from the enum, never an identity from the form, and nothing is granted by the
 *    web layer itself (access exists only because confirm_proxy_setup says so);
 *  - a breached password is refused before anything is confirmed.
 */

jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue(new Map()),
  cookies: jest.fn().mockResolvedValue({ get: () => undefined }),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const captureMessageMock = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureMessage: (...a: unknown[]) => captureMessageMock(...a) }));

const rateLimitMock = jest.fn().mockResolvedValue({ success: true });
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: (...args: unknown[]) => rateLimitMock(...args),
  RATE_LIMIT_MESSAGE: "Too many attempts.",
}));

const getCurrentProfileMock = jest.fn();
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => getCurrentProfileMock() }));

const rpcMock = jest.fn();
const updateUserMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: (...a: unknown[]) => rpcMock(...a),
    auth: { updateUser: (...a: unknown[]) => updateUserMock(...a) },
  }),
}));

const signInWithOtpMock = jest.fn();
jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({ auth: { signInWithOtp: (...a: unknown[]) => signInWithOtpMock(...a) } })),
}));

const passwordCheckMock = jest.fn();
jest.mock("@tarragon/auth/password-check", () => ({
  checkPasswordAcceptable: (...a: unknown[]) => passwordCheckMock(...a),
}));

import { confirmProxySetupAction, declineProxySetupAction, startProxySetupAction } from "./proxy-setup-actions";

const PARENT = "+2348031234567";
const SETUP_ID = "6f1c2a52-8c0e-4d57-9b7f-0d2b6a1f4e11";

function startForm(over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("fullName", "Ngozi Okoro");
  fd.set("countryCode", "+234");
  fd.set("phone", "0803 123 4567");
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

function confirmForm(categories: string[], extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("setupId", SETUP_ID);
  fd.set("requesterName", "Adaeze");
  for (const c of categories) fd.append("categories", c);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  getCurrentProfileMock.mockReset().mockResolvedValue({ id: "proxy-1" });
  rpcMock.mockReset().mockResolvedValue({ data: SETUP_ID, error: null });
  updateUserMock.mockReset().mockResolvedValue({ error: null });
  signInWithOtpMock.mockReset().mockResolvedValue({ error: null });
  rateLimitMock.mockReset().mockResolvedValue({ success: true });
  captureMessageMock.mockReset();
  passwordCheckMock.mockReset().mockResolvedValue({ ok: true, breach: "clean" });
});

describe("startProxySetupAction", () => {
  it("records the setup with config-driven ttl and cap, then texts a code to the normalised parent number only", async () => {
    const result = await startProxySetupAction(undefined, startForm());
    expect(result).toEqual({ sent: true, hours: 72 });
    expect(rpcMock).toHaveBeenCalledWith("create_proxy_setup", {
      p_full_name: "Ngozi Okoro",
      p_phone: PARENT,
      p_ttl_hours: 72,
      p_max_per_day: 5,
    });
    expect(signInWithOtpMock).toHaveBeenCalledTimes(1);
    expect(signInWithOtpMock).toHaveBeenCalledWith({ phone: PARENT, options: { shouldCreateUser: true } });
  });

  it("ignores any ttl, cap or identity smuggled into the form", async () => {
    await startProxySetupAction(undefined, startForm({ ttlHours: "9999", maxPerDay: "9999", p_ttl_hours: "9999", userId: "someone-else" }));
    const args = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_ttl_hours).toBe(72);
    expect(args.p_max_per_day).toBe(5);
    expect(JSON.stringify(args)).not.toContain("someone-else");
  });

  it("refuses without a signed-in proxy and creates and sends nothing", async () => {
    getCurrentProfileMock.mockResolvedValue(null);
    const result = await startProxySetupAction(undefined, startForm());
    expect(result?.error).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(signInWithOtpMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid number or empty name before touching the database or the SMS provider", async () => {
    for (const bad of [{ phone: "12" }, { fullName: "   " }, { countryCode: "234" }]) {
      const result = await startProxySetupAction(undefined, startForm(bad));
      expect(result?.error).toBeTruthy();
    }
    expect(rpcMock).not.toHaveBeenCalled();
    expect(signInWithOtpMock).not.toHaveBeenCalled();
  });

  it("is rate limited on the parent's number and a refusal sends nothing", async () => {
    rateLimitMock.mockResolvedValue({ success: false });
    const result = await startProxySetupAction(undefined, startForm());
    expect(result?.error).toMatch(/several setups|try again/i);
    expect(rateLimitMock.mock.calls[0]![1]).toBe(PARENT);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(signInWithOtpMock).not.toHaveBeenCalled();
  });

  it("maps the database's own daily cap and own-number refusals, without sending a code", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "proxy_setup_rate_limited", code: "P0001" } });
    expect((await startProxySetupAction(undefined, startForm()))?.error).toMatch(/several setups/i);
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "that is your own number", code: "22023" } });
    expect((await startProxySetupAction(undefined, startForm()))?.error).toMatch(/your own number/i);
    expect(signInWithOtpMock).not.toHaveBeenCalled();
  });

  it("gives the same answer when the code could not be sent, and reports the failure without the number", async () => {
    signInWithOtpMock.mockResolvedValue({ error: { code: "sms_send_failed", status: 500, message: `could not text ${PARENT}` } });
    const result = await startProxySetupAction(undefined, startForm());
    expect(result).toEqual({ sent: true, hours: 72 });
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(captureMessageMock.mock.calls[0])).not.toContain("8031234567");
  });
});

describe("confirmProxySetupAction (the parent, on their own signed-in session)", () => {
  it("sends only the chosen categories and no permissions, and never an identity from the form", async () => {
    const result = await confirmProxySetupAction(
      undefined,
      confirmForm(["vitals_readings", "appointments_care_plan"], { userId: "someone-else", granteeId: "someone-else" })
    );
    expect(result).toMatchObject({ done: "confirmed", name: "Adaeze" });
    expect(rpcMock).toHaveBeenCalledWith("confirm_proxy_setup", {
      p_setup_id: SETUP_ID,
      p_categories: ["vitals_readings", "appointments_care_plan"],
      p_permissions: [],
    });
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain("someone-else");
  });

  it("choosing nothing is allowed and grants nothing beyond what the database creates (an empty set)", async () => {
    await confirmProxySetupAction(undefined, confirmForm([]));
    expect(rpcMock.mock.calls[0]![1]).toMatchObject({ p_categories: [] });
  });

  it("rejects a category that is not in the enum instead of ignoring it", async () => {
    const result = await confirmProxySetupAction(undefined, confirmForm(["vitals_readings", "everything"]));
    expect(result?.error).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed setup id", async () => {
    const fd = confirmForm(["vitals_readings"]);
    fd.set("setupId", "not-a-uuid");
    expect((await confirmProxySetupAction(undefined, fd))?.error).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("a refusal from the database is one generic message", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "this setup cannot be confirmed", code: "42501" } });
    const result = await confirmProxySetupAction(undefined, confirmForm(["vitals_readings"]));
    expect(result).toEqual({ error: expect.stringMatching(/no longer available/i) });
  });

  it("refuses a breached password BEFORE confirming anything", async () => {
    passwordCheckMock.mockResolvedValue({ ok: false, reason: "breached", message: "x" });
    const result = await confirmProxySetupAction(undefined, confirmForm(["vitals_readings"], { password: "password123" }));
    expect(result?.passwordError).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("sets the chosen password only after the confirm succeeded", async () => {
    await confirmProxySetupAction(undefined, confirmForm(["vitals_readings"], { password: "a-strong-password-123" }));
    expect(rpcMock.mock.invocationCallOrder[0]!).toBeLessThan(updateUserMock.mock.invocationCallOrder[0]!);
    expect(updateUserMock).toHaveBeenCalledWith({ password: "a-strong-password-123" });
  });

  it("does not set a password when the confirm was refused", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "x", code: "42501" } });
    await confirmProxySetupAction(undefined, confirmForm(["vitals_readings"], { password: "a-strong-password-123" }));
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});

describe("declineProxySetupAction", () => {
  it("declines through the database function and reports it", async () => {
    const fd = new FormData();
    fd.set("setupId", SETUP_ID);
    fd.set("requesterName", "Adaeze");
    const result = await declineProxySetupAction(undefined, fd);
    expect(result).toMatchObject({ done: "declined", name: "Adaeze" });
    expect(rpcMock).toHaveBeenCalledWith("decline_proxy_setup", { p_setup_id: SETUP_ID });
  });
});
