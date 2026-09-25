/**
 * Extracted from auth/callback/route.ts so signup/actions.ts's own
 * auto-confirm redirect can apply the same phone/state/account_purpose
 * backfill and referral-code redemption — that redirect never reaches
 * /auth/callback, so without this shared call a referral code typed into
 * the signup form would silently never be redeemed. Caught in code review
 * before merge; see signup/auto-confirm-redirect.test.ts.
 */

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
    rpcMock.mockClear();
    supabaseStub.from.mockClear();
  });

  it("backfills phone and state from user_metadata", async () => {
    await backfillSignupMetadata(supabaseStub, {
      id: "user-123",
      user_metadata: { phone: "+2348012345678", state: "Lagos" },
    });

    expect(supabaseStub.from).toHaveBeenCalledWith("profiles");
    expect(updateMock).toHaveBeenCalledWith({ phone: "+2348012345678", state: "Lagos" });
  });

  it("marks receives_care false for a support-intent signup", async () => {
    await backfillSignupMetadata(supabaseStub, {
      id: "user-123",
      user_metadata: { account_purpose: "support" },
    });

    expect(updateMock).toHaveBeenCalledWith({ receives_care: false });
  });

  it("redeems a carried referral code", async () => {
    await backfillSignupMetadata(supabaseStub, {
      id: "user-123",
      user_metadata: { ref_code: "FRIEND10" },
    });

    expect(rpcMock).toHaveBeenCalledWith("redeem_referral_code", { p_code: "FRIEND10" });
  });

  it("touches neither profiles nor the RPC when there is no metadata to apply", async () => {
    await backfillSignupMetadata(supabaseStub, { id: "user-123", user_metadata: {} });

    expect(supabaseStub.from).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ignores a non-string ref_code rather than passing a bad value to the RPC", async () => {
    await backfillSignupMetadata(supabaseStub, {
      id: "user-123",
      // A hostile or malformed metadata payload should never reach the RPC.
      user_metadata: { ref_code: 12345 },
    });

    expect(rpcMock).not.toHaveBeenCalled();
  });
});
