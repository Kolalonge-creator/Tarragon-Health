import { isSupportViewSessionActive } from "./support-view-as";

describe("isSupportViewSessionActive", () => {
  it("is active when ended_at is null and expires_at is in the future", () => {
    expect(
      isSupportViewSessionActive({ ended_at: null, expires_at: new Date(Date.now() + 60_000).toISOString() })
    ).toBe(true);
  });

  it("is not active once ended_at is set, even if expires_at is still in the future", () => {
    expect(
      isSupportViewSessionActive({
        ended_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
    ).toBe(false);
  });

  it("is not active once expires_at has passed, even if ended_at is null", () => {
    expect(
      isSupportViewSessionActive({ ended_at: null, expires_at: new Date(Date.now() - 1_000).toISOString() })
    ).toBe(false);
  });

  it("SABOTAGE: proves the test actually discriminates — a session both unended and unexpired must read as active", () => {
    // Same shape as the negative cases but genuinely still active — if this read false the
    // function (or the test) would be vacuously always returning false.
    const active = isSupportViewSessionActive({
      ended_at: null,
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    expect(active).not.toBe(false);
  });
});
