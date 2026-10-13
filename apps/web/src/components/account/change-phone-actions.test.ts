/**
 * Changing the phone number re-verifies it (S03, function 1.2): the profile number only changes after the code sent to
 * the NEW number is entered, and a refusal at any step leaves the stored number untouched.
 */

jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue(new Map()),
  cookies: jest.fn().mockResolvedValue({ get: () => undefined }),
}));

const rateLimitMock = jest.fn().mockResolvedValue({ success: true });
jest.mock("@/lib/rate-limit", () => ({
  checkAuthRateLimit: (...args: unknown[]) => rateLimitMock(...args),
  RATE_LIMIT_MESSAGE: "Too many attempts.",
}));

const updateUserMock = jest.fn();
const verifyOtpMock = jest.fn();
const profileUpdateMock = jest.fn();
const eqMock = jest.fn();
const getCurrentUserMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: () => getCurrentUserMock(),
  createClient: jest.fn().mockResolvedValue({
    auth: { updateUser: updateUserMock, verifyOtp: verifyOtpMock },
    from: () => ({ update: (...a: unknown[]) => (profileUpdateMock(...a), { eq: eqMock }) }),
  }),
}));

const svcRpcMock = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => svcRpcMock(...a) }) }));

jest.mock("@sentry/nextjs", () => ({ captureMessage: jest.fn() }));
import * as Sentry from "@sentry/nextjs";
import { confirmPhoneChange, requestPhoneChange } from "./actions";

const NEW = "+2348099999999";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  updateUserMock.mockReset().mockResolvedValue({ error: null });
  verifyOtpMock.mockReset().mockResolvedValue({ error: null });
  profileUpdateMock.mockReset();
  eqMock.mockReset().mockResolvedValue({ error: null });
  getCurrentUserMock.mockReset().mockResolvedValue({ id: "u1", phone: "2348031234567" });
  rateLimitMock.mockReset().mockResolvedValue({ success: true });
  svcRpcMock.mockReset().mockResolvedValue({ data: true, error: null });
});

describe("requestPhoneChange", () => {
  it("asks Auth to move to the normalised new number and shows the code step; the profile is NOT touched", async () => {
    const result = await requestPhoneChange(undefined, form({ countryCode: "+234", phone: "0809 999 9999" }));
    expect(result).toEqual({ step: "verify", phone: NEW });
    expect(updateUserMock).toHaveBeenCalledWith({ phone: NEW });
    expect(profileUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses the number the account already has", async () => {
    const result = await requestPhoneChange(undefined, form({ countryCode: "+234", phone: "8031234567" }));
    expect(result?.field).toBe("phone");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("needs a signed-in user and is rate limited per account", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    expect((await requestPhoneChange(undefined, form({ countryCode: "+234", phone: "8099999999" })))?.error).toBeTruthy();
    getCurrentUserMock.mockResolvedValue({ id: "u1", phone: null });
    rateLimitMock.mockResolvedValue({ success: false });
    expect((await requestPhoneChange(undefined, form({ countryCode: "+234", phone: "8099999999" })))?.error).toBeTruthy();
    expect(rateLimitMock).toHaveBeenCalledWith("phone-change", "u1", expect.anything(), expect.anything());
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});

describe("requestPhoneChange needs a fresh confirmation when the account has something to confirm with (S03b)", () => {
  const confirmed = { id: "u1", phone: "2348031234567", phone_confirmed_at: "2026-01-01T00:00:00Z" };

  it("asks the database BEFORE Auth and does not call Auth without a fresh confirmation", async () => {
    getCurrentUserMock.mockResolvedValue(confirmed);
    svcRpcMock.mockResolvedValue({ data: false, error: null });
    const result = await requestPhoneChange(undefined, form({ countryCode: "+234", phone: "0809 999 9999" }));
    expect(result).toMatchObject({ field: "confirm", error: expect.stringContaining("confirmation has run out") });
    expect(svcRpcMock).toHaveBeenCalledWith("has_fresh_phone_change_authorisation", { p_user: "u1" });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("goes on to Auth when a fresh confirmation exists", async () => {
    getCurrentUserMock.mockResolvedValue(confirmed);
    svcRpcMock.mockResolvedValue({ data: true, error: null });
    expect(await requestPhoneChange(undefined, form({ countryCode: "+234", phone: "0809 999 9999" }))).toEqual({ step: "verify", phone: NEW });
    expect(updateUserMock).toHaveBeenCalledWith({ phone: NEW });
  });

  it("a resend of the SAME pending number is not asked to confirm again (the database does not gate it either)", async () => {
    getCurrentUserMock.mockResolvedValue({ ...confirmed, new_phone: "2348099999999" });
    svcRpcMock.mockResolvedValue({ data: false, error: null });
    expect(await requestPhoneChange(undefined, form({ countryCode: "+234", phone: "0809 999 9999" }))).toEqual({ step: "verify", phone: NEW });
    expect(svcRpcMock).not.toHaveBeenCalled();
    expect(updateUserMock).toHaveBeenCalledWith({ phone: NEW });
  });

  it("a DIFFERENT number than the pending one is a new request and needs the confirmation", async () => {
    getCurrentUserMock.mockResolvedValue({ ...confirmed, new_phone: "2348011112222" });
    svcRpcMock.mockResolvedValue({ data: false, error: null });
    expect((await requestPhoneChange(undefined, form({ countryCode: "+234", phone: "0809 999 9999" })))?.field).toBe("confirm");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("does not guess when the database cannot be asked", async () => {
    getCurrentUserMock.mockResolvedValue(confirmed);
    svcRpcMock.mockResolvedValue({ data: null, error: { message: "down" } });
    const result = await requestPhoneChange(undefined, form({ countryCode: "+234", phone: "0809 999 9999" }));
    expect(result?.error).toBeTruthy();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("an account with nothing confirmed is not asked to confirm anything", async () => {
    await requestPhoneChange(undefined, form({ countryCode: "+234", phone: "0809 999 9999" }));
    expect(svcRpcMock).not.toHaveBeenCalled();
    expect(updateUserMock).toHaveBeenCalled();
  });

  it("shows the confirm step if the database refuses at the last moment, and a generic failure stays a generic failure", async () => {
    getCurrentUserMock.mockResolvedValue(confirmed);
    updateUserMock.mockResolvedValue({ error: { message: "phone_change_needs_confirmation" } });
    expect((await requestPhoneChange(undefined, form({ countryCode: "+234", phone: "0809 999 9999" })))?.field).toBe("confirm");
    updateUserMock.mockResolvedValue({ error: { message: "Database error updating user" } });
    expect((await requestPhoneChange(undefined, form({ countryCode: "+234", phone: "0809 999 9999" })))?.field).toBe("phone");
  });
});

describe("confirmPhoneChange", () => {
  it("a correct code updates the profile number, and only then", async () => {
    const result = await confirmPhoneChange(undefined, form({ phone: NEW, token: "482913" }));
    expect(result).toEqual({ success: true });
    expect(verifyOtpMock).toHaveBeenCalledWith({ phone: NEW, token: "482913", type: "phone_change" });
    expect(profileUpdateMock).toHaveBeenCalledWith({ phone: NEW });
    expect(eqMock).toHaveBeenCalledWith("id", "u1");
  });

  it("when only the profile copy fails it retries once, reports it without the number, and does not strand the person on a spent code", async () => {
    eqMock.mockResolvedValue({ error: { message: "rls" } });
    const result = await confirmPhoneChange(undefined, form({ phone: NEW, token: "482913" }));
    expect(result).toEqual({ success: true });
    expect(profileUpdateMock).toHaveBeenCalledTimes(2);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls)).not.toContain("8099999999");
  });

  it("a wrong code leaves the stored number untouched and stays on the code step", async () => {
    verifyOtpMock.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
    const result = await confirmPhoneChange(undefined, form({ phone: NEW, token: "000000" }));
    expect(result).toMatchObject({ step: "verify", phone: NEW, field: "token" });
    expect(profileUpdateMock).not.toHaveBeenCalled();
  });

  it("a malformed code never reaches Auth", async () => {
    await confirmPhoneChange(undefined, form({ phone: NEW, token: "12" }));
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });
});
