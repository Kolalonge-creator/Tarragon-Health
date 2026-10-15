/**
 * Private section PIN recovery (S66): a code to the ACCOUNT'S OWN phone is the only way to reset the lock. Nobody else's number is
 * ever used, a wrong code resets nothing, the verified user must be the signed-in one, and every step is rate limited per account.
 */
jest.mock("next/headers", () => ({ headers: jest.fn().mockResolvedValue(new Map()), cookies: jest.fn().mockResolvedValue({ get: () => undefined }) }));
const rateLimitMock = jest.fn().mockResolvedValue({ success: true });
jest.mock("@/lib/rate-limit", () => ({ checkAuthRateLimit: (...a: unknown[]) => rateLimitMock(...a), RATE_LIMIT_MESSAGE: "Too many attempts." }));
const signInWithOtpMock = jest.fn();
const verifyOtpMock = jest.fn();
const getCurrentUserMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: () => getCurrentUserMock(),
  createClient: jest.fn().mockResolvedValue({ auth: { signInWithOtp: signInWithOtpMock, verifyOtp: verifyOtpMock } }),
}));
import { requestPrivateSectionRecoveryCode, verifyPrivateSectionRecoveryCode } from "./recovery-actions";

const form = (token: string) => {
  const fd = new FormData();
  fd.set("token", token);
  return fd;
};

beforeEach(() => {
  signInWithOtpMock.mockReset().mockResolvedValue({ error: null });
  verifyOtpMock.mockReset().mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  getCurrentUserMock.mockReset().mockResolvedValue({ id: "u1", phone: "2348031234567", email: null });
  rateLimitMock.mockReset().mockResolvedValue({ success: true });
});

describe("requestPrivateSectionRecoveryCode", () => {
  it("sends the code to the signed-in account's own phone, never creates a user, and does not echo the number", async () => {
    const r = await requestPrivateSectionRecoveryCode();
    expect(r).toEqual({ step: "code", sentTo: "phone" });
    expect(signInWithOtpMock).toHaveBeenCalledWith({ phone: "+2348031234567", options: { shouldCreateUser: false } });
    expect(JSON.stringify(r)).not.toContain("2348031234567");
  });
  it("falls back to the account email when there is no phone", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "u1", phone: null, email: "a@example.invalid" });
    expect(await requestPrivateSectionRecoveryCode()).toEqual({ step: "code", sentTo: "email" });
    expect(signInWithOtpMock).toHaveBeenCalledWith({ email: "a@example.invalid", options: { shouldCreateUser: false } });
  });
  it("needs a signed-in user, a contact, and is rate limited per account", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    expect((await requestPrivateSectionRecoveryCode())?.error).toBeTruthy();
    getCurrentUserMock.mockResolvedValue({ id: "u1", phone: null, email: null });
    expect((await requestPrivateSectionRecoveryCode())?.error).toBeTruthy();
    getCurrentUserMock.mockResolvedValue({ id: "u1", phone: "2348031234567" });
    rateLimitMock.mockResolvedValue({ success: false });
    expect((await requestPrivateSectionRecoveryCode())?.error).toBeTruthy();
    expect(rateLimitMock).toHaveBeenCalledWith("private-section-recovery", "u1", expect.anything(), expect.anything());
    expect(signInWithOtpMock).not.toHaveBeenCalled();
  });
  it("surfaces a provider failure as a plain message, not the provider text", async () => {
    signInWithOtpMock.mockResolvedValue({ error: { message: "sms provider exploded 500 secret-detail" } });
    const r = await requestPrivateSectionRecoveryCode();
    expect(r?.error).toBeTruthy();
    expect(r?.error).not.toContain("secret-detail");
  });
});

describe("verifyPrivateSectionRecoveryCode", () => {
  it("a right code succeeds", async () => {
    expect(await verifyPrivateSectionRecoveryCode(undefined, form("123456"))).toEqual({ success: true });
    expect(verifyOtpMock).toHaveBeenCalledWith({ phone: "+2348031234567", token: "123456", type: "sms" });
  });
  it("a wrong, short or non-numeric code does not succeed and stays on the code step", async () => {
    for (const bad of ["12345", "abcdef", "", "1234567"]) {
      const r = await verifyPrivateSectionRecoveryCode(undefined, form(bad));
      expect(r?.success).toBeUndefined();
      expect(r?.step).toBe("code");
    }
    expect(verifyOtpMock).not.toHaveBeenCalled();
    verifyOtpMock.mockResolvedValue({ data: null, error: { message: "Token has expired or is invalid" } });
    const r = await verifyPrivateSectionRecoveryCode(undefined, form("999999"));
    expect(r?.success).toBeUndefined();
    expect(r?.step).toBe("code");
  });
  it("refuses when the verified user is not the signed-in account", async () => {
    verifyOtpMock.mockResolvedValue({ data: { user: { id: "someone-else" } }, error: null });
    expect((await verifyPrivateSectionRecoveryCode(undefined, form("123456")))?.success).toBeUndefined();
  });
  it("is rate limited per account and needs a signed-in user", async () => {
    rateLimitMock.mockResolvedValue({ success: false });
    expect((await verifyPrivateSectionRecoveryCode(undefined, form("123456")))?.error).toBeTruthy();
    expect(verifyOtpMock).not.toHaveBeenCalled();
    rateLimitMock.mockResolvedValue({ success: true });
    getCurrentUserMock.mockResolvedValue(null);
    expect((await verifyPrivateSectionRecoveryCode(undefined, form("123456")))?.success).toBeUndefined();
  });
});
