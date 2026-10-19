import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const getUser = jest.fn<() => Promise<unknown>>();
const getClaims = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser, getClaims } }),
}));

const { updateSession } = await import("./middleware");
const { NextRequest } = await import("next/server");

const request = () => new NextRequest("http://localhost/patient");

beforeEach(() => {
  getUser.mockReset();
  getClaims.mockReset();
});

describe("updateSession", () => {
  it("defaults to the server check and never reads claims", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const { user } = await updateSession(request());
    expect(user).toEqual({ id: "u1" });
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("claims mode returns the verified subject without a server round trip", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u2" } }, error: null });
    const { user } = await updateSession(request(), { verify: "claims" });
    expect(user).toEqual({ id: "u2" });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("claims mode fails closed when the token cannot be verified", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("bad jwt") });
    const { user } = await updateSession(request(), { verify: "claims" });
    expect(user).toBeNull();
  });
});
