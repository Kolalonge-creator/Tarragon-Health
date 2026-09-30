/**
 * Assisted recovery server actions: authorisation refusal, link goes only to the email on file, the admin never
 * receives a secret, failure paths do not leak provider text, and nothing is burned on a bad phone input.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn().mockResolvedValue(new Map([["origin", "https://app.tarragonhealth.ng"]])) }));

const getCurrentProfile = jest.fn();
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: (...a: unknown[]) => getCurrentProfile(...a) }));

const rpc = jest.fn();
const maybeSingle = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }) }),
  }),
}));

const getUserById = jest.fn();
const updateUserById = jest.fn();
const generateLink = jest.fn();
const resetPasswordForEmail = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ auth: { resetPasswordForEmail, admin: { getUserById, updateUserById, generateLink } } }),
}));

import { approveRecovery, executeRecovery, requestRecovery } from "./actions";

const RID = "11111111-1111-4111-8111-111111111111";
const SUBJECT = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  jest.clearAllMocks();
  getCurrentProfile.mockResolvedValue({ id: "a1", role: "admin" });
  maybeSingle.mockResolvedValue({ data: { method: "email_link_to_verified_email" } });
});

describe("authorisation", () => {
  it.each(["patient", "clinician", "lab_partner"])("refuses %s before touching the database", async (role) => {
    getCurrentProfile.mockResolvedValue({ id: "x", role });
    const res = await approveRecovery({ requestId: RID });
    expect(res.ok).toBe(false);
    await executeRecovery({ requestId: RID });
    expect(rpc).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    getCurrentProfile.mockResolvedValue(null);
    expect((await requestRecovery({})).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("validates input with Zod (one identity check is not enough)", async () => {
    const res = await requestRecovery({ subjectId: SUBJECT, reason: "x".repeat(25), identityChecks: { date_of_birth: true }, method: "email_link_to_verified_email" });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a database refusal to plain copy, not the raw error", async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: "requester_cannot_approve" }, error: null });
    const res = await approveRecovery({ requestId: RID });
    expect(res).toEqual({ ok: false, error: expect.stringContaining("different admin") });
  });
});

describe("executeRecovery, email method", () => {
  beforeEach(() => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "execute_assisted_recovery"
        ? { data: { ok: true, method: "email_link_to_verified_email", subject_user_id: SUBJECT }, error: null }
        : { data: { ok: true }, error: null });
    resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it("sends only to the email on file, never generates a link, and returns no secret", async () => {
    getUserById.mockResolvedValue({ data: { user: { email: "owner@example.com", email_confirmed_at: "2026-01-01" } }, error: null });
    const res = await executeRecovery({ requestId: RID, email: "attacker@evil.test", newPhone: "+2348000000000" });
    expect(res.ok).toBe(true);
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(resetPasswordForEmail.mock.calls[0][0]).toBe("owner@example.com");
    expect(JSON.stringify(resetPasswordForEmail.mock.calls)).not.toContain("attacker");
    expect(generateLink).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
    const text = JSON.stringify(res);
    expect(text).not.toMatch(/owner@example\.com|token|https?:/i);
    expect(rpc).toHaveBeenCalledWith("record_assisted_recovery_outcome", { p_request: RID, p_ok: true });
  });

  it("records failure and leaks no provider text when the email is unverified", async () => {
    getUserById.mockResolvedValue({ data: { user: { email: "owner@example.com", email_confirmed_at: null } }, error: null });
    const res = await executeRecovery({ requestId: RID });
    expect(res.ok).toBe(false);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("record_assisted_recovery_outcome", { p_request: RID, p_ok: false });
  });

  it("does not leak the provider error when sending fails", async () => {
    getUserById.mockResolvedValue({ data: { user: { email: "owner@example.com", email_confirmed_at: "x" } }, error: null });
    resetPasswordForEmail.mockResolvedValue({ error: { message: "SMTP secret-host 10.0.0.5 refused" } });
    const res = await executeRecovery({ requestId: RID });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toMatch(/SMTP|10\.0\.0\.5|secret/);
  });

  it("does not call Auth at all when the database refuses the step", async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: "wrong_state" }, error: null });
    const res = await executeRecovery({ requestId: RID });
    expect(res.ok).toBe(false);
    expect(getUserById).not.toHaveBeenCalled();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("executeRecovery, phone method", () => {
  it("refuses, without marking the request executed, when no new number is supplied", async () => {
    maybeSingle.mockResolvedValue({ data: { method: "new_phone_reverification" } });
    const res = await executeRecovery({ requestId: RID });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed number by schema", async () => {
    expect((await executeRecovery({ requestId: RID, newPhone: "08012345678" })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sets the number UNCONFIRMED, never sets a password, and returns no secret", async () => {
    maybeSingle.mockResolvedValue({ data: { method: "new_phone_reverification" } });
    rpc.mockImplementation(async (fn: string) =>
      fn === "execute_assisted_recovery"
        ? { data: { ok: true, method: "new_phone_reverification", subject_user_id: SUBJECT }, error: null }
        : { data: { ok: true }, error: null });
    updateUserById.mockResolvedValue({ error: null });
    const res = await executeRecovery({ requestId: RID, newPhone: "+2348012345678" });
    expect(res.ok).toBe(true);
    expect(updateUserById).toHaveBeenCalledWith(SUBJECT, { phone: "+2348012345678", phone_confirm: false });
    expect(Object.keys(updateUserById.mock.calls[0][1])).not.toContain("password");
    expect(JSON.stringify(res)).not.toContain("+2348012345678");
  });
});
