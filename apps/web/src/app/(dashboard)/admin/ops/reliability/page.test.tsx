/** @jest-environment node */
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const profile = jest.fn();
const perm = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => profile() }));
jest.mock("@/lib/auth/permissions", () => ({ hasPermission: (k: string) => perm(k) }));
jest.mock("@/components/reliability/reliability-page", () => ({ ReliabilityPage: (p: { viewer: string }) => `viewer:${p.viewer}` }));

import Page from "./page";

beforeEach(() => redirect.mockClear());

describe("/admin/ops/reliability", () => {
  it("sends a signed-out visitor to login", async () => {
    profile.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("REDIRECT:/login");
  });
  it("sends someone without ops.console.view away", async () => {
    profile.mockResolvedValue({ language: "en" });
    perm.mockResolvedValue(false);
    await expect(Page()).rejects.toThrow("REDIRECT:/admin");
    expect(perm).toHaveBeenCalledWith("ops.console.view");
  });
  it("shows an ops holder the aggregate view only", async () => {
    profile.mockResolvedValue({ language: "en" });
    perm.mockResolvedValue(true);
    expect(await Page()).toEqual(expect.objectContaining({ props: expect.objectContaining({ viewer: "ops" }) }));
  });
});
