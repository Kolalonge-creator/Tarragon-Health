import { requestRecoveryCode, verifyRecoveryCode, type RecoveryAuth } from "./private-lock-recovery";

function fakeAuth(over: Partial<{ user: { id: string; phone?: string | null; email?: string | null } | null; verifyError: string | null; otpError: string | null; afterUserId: string }> = {}) {
  const state = { user: over.user === undefined ? { id: "u1", phone: "2348031234567", email: null } : over.user };
  const calls: unknown[] = [];
  let getUserCalls = 0;
  const auth: RecoveryAuth = {
    getUser: async () => {
      getUserCalls += 1;
      const u = state.user && getUserCalls > 1 && over.afterUserId ? { ...state.user, id: over.afterUserId } : state.user;
      return { data: { user: u } };
    },
    signInWithOtp: (async (args: unknown) => (calls.push(["otp", args]), { error: over.otpError ? { message: over.otpError } : null })) as RecoveryAuth["signInWithOtp"],
    verifyOtp: async (args) => (calls.push(["verify", args]), { error: over.verifyError ? { message: over.verifyError } : null }),
  };
  return { auth, calls };
}

describe("private lock recovery on mobile", () => {
  it("sends the code to the account's own phone, never creating a user", async () => {
    const { auth, calls } = fakeAuth();
    expect(await requestRecoveryCode(auth)).toEqual({ kind: "sent", via: "phone", userId: "u1" });
    expect(calls[0]).toEqual(["otp", { phone: "+2348031234567", options: { shouldCreateUser: false } }]);
  });
  it("falls back to the account email when there is no phone", async () => {
    const { auth, calls } = fakeAuth({ user: { id: "u1", phone: null, email: "a@example.invalid" } });
    expect(await requestRecoveryCode(auth)).toEqual({ kind: "sent", via: "email", userId: "u1" });
    expect(calls[0]).toEqual(["otp", { email: "a@example.invalid", options: { shouldCreateUser: false } }]);
  });
  it("is an error with no user or no contact, and a provider failure maps to a plain key", async () => {
    expect((await requestRecoveryCode(fakeAuth({ user: null }).auth)).kind).toBe("error");
    expect((await requestRecoveryCode(fakeAuth({ user: { id: "u1" } }).auth)).kind).toBe("error");
    const r = await requestRecoveryCode(fakeAuth({ user: { id: "u1", email: "a@example.invalid" }, otpError: "for security purposes wait" }).auth);
    expect(r).toEqual({ kind: "error", key: "auth.error.rate_limited" });
  });
  it("a right code verifies, a short or wrong one does not", async () => {
    expect((await verifyRecoveryCode(fakeAuth().auth, "123 456", "u1")).kind).toBe("verified");
    expect(await verifyRecoveryCode(fakeAuth().auth, "12345", "u1")).toEqual({ kind: "error", key: "auth.error.wrong_code" });
    expect(await verifyRecoveryCode(fakeAuth({ verifyError: "Token has expired or is invalid" }).auth, "123456", "u1")).toEqual({ kind: "error", key: "auth.error.wrong_code" });
  });
  it("refuses when the signed-in account is not the one the code was requested for", async () => {
    expect((await verifyRecoveryCode(fakeAuth().auth, "123456", "someone-else")).kind).toBe("error");
    expect((await verifyRecoveryCode(fakeAuth({ afterUserId: "u2" }).auth, "123456", "u1")).kind).toBe("error");
  });
});
