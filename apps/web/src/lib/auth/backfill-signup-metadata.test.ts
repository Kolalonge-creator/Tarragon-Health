/**
 * Extracted from auth/callback/route.ts so signup/actions.ts's own
 * auto-confirm redirect can apply the same phone/state/account_purpose
 * backfill and referral-code redemption — that redirect never reaches
 * /auth/callback, so without this shared call a referral code typed into
 * the signup form would silently never be redeemed. Caught in code review
 * before merge; see signup/auto-confirm-redirect.test.ts.
 *
 * The never-throw guarantee lives here (internal try/catch, reporting to
 * Sentry) rather than at each call site — a second code-review round found
 * redeem_referral_code can reject outright (not just resolve with
 * { ok:false, error }), and a third round found that trusting every caller
 * to wrap this in runBestEffort left a future third caller free to forget
 * it, exactly the fragility run-best-effort.ts's own doc comment already
 * warns about for other "documented never-throws, not enforced" helpers.
 */

const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

const updateMock = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
const rpcMock = jest.fn().mockResolvedValue({ data: { ok: true }, error: null });
const supabaseStub = {
  from: jest.fn().mockReturnValue({ update: updateMock }),
  rpc: rpcMock,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

import { backfillSignupMetadata } from "./backfill-signup-metadata";

describe("backfillSignupMetadata", () => {
  beforeEach(() => {
    updateMock.mockClear();
    rpcMock.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
    supabaseStub.from.mockClear();
    captureException.mockClear();
  });

  it("backfills phone and state from user_metadata", async () => {
    await backfillSignupMetadata(
      supabaseStub,
      { id: "user-123", user_metadata: { phone: "+2348012345678", state: "Lagos" } },
      "signUp"
    );

    expect(supabaseStub.from).toHaveBeenCalledWith("profiles");
    expect(updateMock).toHaveBeenCalledWith({ phone: "+2348012345678", state: "Lagos" });
  });

  it("marks receives_care false for a support-intent signup", async () => {
    await backfillSignupMetadata(
      supabaseStub,
      { id: "user-123", user_metadata: { account_purpose: "support" } },
      "signUp"
    );

    expect(updateMock).toHaveBeenCalledWith({ receives_care: false });
  });

  it("redeems a carried referral code", async () => {
    await backfillSignupMetadata(
      supabaseStub,
      { id: "user-123", user_metadata: { ref_code: "FRIEND10" } },
      "signUp"
    );

    expect(rpcMock).toHaveBeenCalledWith("redeem_referral_code", { p_code: "FRIEND10" });
  });

  it("touches neither profiles nor the RPC when there is no metadata to apply", async () => {
    await backfillSignupMetadata(supabaseStub, { id: "user-123", user_metadata: {} }, "signUp");

    expect(supabaseStub.from).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ignores a non-string ref_code rather than passing a bad value to the RPC", async () => {
    await backfillSignupMetadata(
      supabaseStub,
      // A hostile or malformed metadata payload should never reach the RPC.
      { id: "user-123", user_metadata: { ref_code: 12345 } },
      "signUp"
    );

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("never throws when the referral RPC rejects outright, reporting to Sentry instead", async () => {
    const rpcError = new Error("redeem_referral_code: fetch failed");
    rpcMock.mockRejectedValue(rpcError);

    // Sabotage check: without the internal try/catch, this would reject
    // instead of resolving — exactly the bug that turned a successful
    // signup into an error page before this fix.
    await expect(
      backfillSignupMetadata(
        supabaseStub,
        { id: "user-123", user_metadata: { ref_code: "FRIEND10" } },
        "signUp"
      )
    ).resolves.toBeUndefined();

    expect(captureException).toHaveBeenCalledWith(
      rpcError,
      expect.objectContaining({
        extra: expect.objectContaining({ action: "signUp", userId: "user-123" }),
      })
    );
  });

  it("tags a Sentry report with the caller-supplied action", async () => {
    const rpcError = new Error("redeem_referral_code: fetch failed");
    rpcMock.mockRejectedValue(rpcError);

    await backfillSignupMetadata(
      supabaseStub,
      { id: "user-123", user_metadata: { ref_code: "FRIEND10" } },
      "authCallback"
    );

    expect(captureException).toHaveBeenCalledWith(
      rpcError,
      expect.objectContaining({ extra: expect.objectContaining({ action: "authCallback" }) })
    );
  });
});
