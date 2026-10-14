/**
 * Step 0 of changing the sign-in number (S03b, OQ-43): prove control of the current number or the verified email first.
 *
 * Pinned here:
 *  - a code goes only to a CONFIRMED channel read from Auth (never one from the form), by the right Auth call;
 *  - a wrong code, or a code that signs in a DIFFERENT account, records no authorisation;
 *  - only a correct code for THIS account makes the server (service role) record the authorisation, for the method used;
 *  - a failure to record it is reported without the number or address and the person is not told they succeeded;
 *  - everything is limited per account.
 */

jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue(new Map()),
  cookies: jest.fn().mockResolvedValue({ get: () => undefined }),
}));

const rateLimitMock = jest.fn();
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: (...a: unknown[]) => rateLimitMock(...a),
  RATE_LIMIT_MESSAGE: "Too many attempts.",
}));

const signInWithOtp = jest.fn();
const verifyOtp = jest.fn();
const getCurrentUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: () => getCurrentUser(),
  createClient: jest.fn().mockResolvedValue({ auth: { signInWithOtp, verifyOtp } }),
}));

const svcRpc = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => svcRpc(...a) }) }));

const reportMock = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureMessage: (...a: unknown[]) => reportMock(...a) }));

import { confirmPhoneChangeIdentity, sendPhoneChangeConfirmationCode } from "./phone-change-confirm-actions";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const BOTH = {
  id: "u1",
  phone: "2348031234567",
  phone_confirmed_at: "2026-01-01T00:00:00Z",
  email: "ada@example.ng",
  email_confirmed_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  rateLimitMock.mockResolvedValue({ success: true });
  signInWithOtp.mockResolvedValue({ error: null });
  verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  svcRpc.mockResolvedValue({ data: { ok: true }, error: null });
  getCurrentUser.mockResolvedValue(BOTH);
});

describe("sendPhoneChangeConfirmationCode", () => {
  it("sends the code to the CURRENT confirmed number from Auth, with shouldCreateUser false", async () => {
    const res = await sendPhoneChangeConfirmationCode(undefined, form({ method: "old_phone", phone: "+2340000000000" }));
    expect(res).toEqual({ step: "code", method: "old_phone" });
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: "+2348031234567", options: { shouldCreateUser: false } });
  });

  it("sends the code to the VERIFIED email from Auth", async () => {
    const res = await sendPhoneChangeConfirmationCode(undefined, form({ method: "email", email: "attacker@example.ng" }));
    expect(res).toEqual({ step: "code", method: "email" });
    expect(signInWithOtp).toHaveBeenCalledWith({ email: "ada@example.ng", options: { shouldCreateUser: false } });
  });

  it("refuses a channel that is not confirmed, and an unknown method, without sending anything", async () => {
    getCurrentUser.mockResolvedValue({ ...BOTH, phone_confirmed_at: null, email: null });
    expect((await sendPhoneChangeConfirmationCode(undefined, form({ method: "old_phone" })))?.error).toBeTruthy();
    expect((await sendPhoneChangeConfirmationCode(undefined, form({ method: "email" })))?.error).toBeTruthy();
    expect((await sendPhoneChangeConfirmationCode(undefined, form({ method: "sms" })))?.error).toBeTruthy();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("needs a signed-in user and is rate limited per account", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await sendPhoneChangeConfirmationCode(undefined, form({ method: "email" })))?.error).toBeTruthy();
    getCurrentUser.mockResolvedValue(BOTH);
    rateLimitMock.mockResolvedValue({ success: false });
    expect((await sendPhoneChangeConfirmationCode(undefined, form({ method: "email" })))?.error).toBeTruthy();
    expect(rateLimitMock).toHaveBeenCalledWith("phone-change-confirm", "u1", expect.anything(), expect.anything());
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});

describe("confirmPhoneChangeIdentity", () => {
  it("a correct code for this account makes the server record the authorisation for that method", async () => {
    const res = await confirmPhoneChangeIdentity(undefined, form({ method: "email", token: "123 456" }));
    expect(res).toMatchObject({ confirmed: true });
    expect(verifyOtp).toHaveBeenCalledWith({ email: "ada@example.ng", token: "123456", type: "email" });
    expect(svcRpc).toHaveBeenCalledWith("authorise_phone_change", { p_user: "u1", p_method: "email" });
  });

  it("verifies the old number with type sms", async () => {
    await confirmPhoneChangeIdentity(undefined, form({ method: "old_phone", token: "123456" }));
    expect(verifyOtp).toHaveBeenCalledWith({ phone: "+2348031234567", token: "123456", type: "sms" });
    expect(svcRpc).toHaveBeenCalledWith("authorise_phone_change", { p_user: "u1", p_method: "old_phone" });
  });

  it("a wrong code records nothing and stays on the code step", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "Token has expired or is invalid" } });
    const res = await confirmPhoneChangeIdentity(undefined, form({ method: "email", token: "000000" }));
    expect(res).toMatchObject({ step: "code", method: "email", field: "token" });
    expect(svcRpc).not.toHaveBeenCalled();
  });

  it("a code that signs in a DIFFERENT account proves nothing", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "someone-else" } }, error: null });
    const res = await confirmPhoneChangeIdentity(undefined, form({ method: "email", token: "123456" }));
    expect(res?.confirmed).toBeUndefined();
    expect(svcRpc).not.toHaveBeenCalled();
  });

  it("a malformed code never reaches Auth, and a limit refuses before Auth", async () => {
    await confirmPhoneChangeIdentity(undefined, form({ method: "email", token: "12" }));
    expect(verifyOtp).not.toHaveBeenCalled();
    rateLimitMock.mockResolvedValue({ success: false });
    await confirmPhoneChangeIdentity(undefined, form({ method: "email", token: "123456" }));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(rateLimitMock).toHaveBeenCalledWith("phone-change-confirm-verify", "u1", expect.anything(), expect.anything());
  });

  it("when the authorisation cannot be recorded the person is not told it worked, and the report carries nothing identifying", async () => {
    svcRpc.mockResolvedValue({ data: null, error: { message: "db" } });
    const res = await confirmPhoneChangeIdentity(undefined, form({ method: "email", token: "123456" }));
    expect(res?.confirmed).toBeUndefined();
    expect(res?.error).toBeTruthy();
    const reported = JSON.stringify(reportMock.mock.calls);
    for (const secret of ["ada@example.ng", "8031234567", "u1"]) expect(reported).not.toContain(secret);
  });
});
