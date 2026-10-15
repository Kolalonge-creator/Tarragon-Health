/** @jest-environment node */
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const profile = jest.fn();
const perm = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => profile() }));
jest.mock("@/lib/auth/permissions", () => ({ hasPermission: (k: string) => perm(k) }));
jest.mock("@/components/ops-wall/operations-wall", () => ({ OperationsWall: () => "wall" }));

import Page from "./page";

beforeEach(() => redirect.mockClear());

describe("/admin/ops/wall", () => {
  it("sends a signed-out visitor to login", async () => {
    profile.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("REDIRECT:/login");
  });
  it("sends someone without ops.console.view away", async () => {
    profile.mockResolvedValue({});
    perm.mockResolvedValue(false);
    await expect(Page()).rejects.toThrow("REDIRECT:/admin");
    expect(perm).toHaveBeenCalledWith("ops.console.view");
  });
  it("shows the wall to an ops holder", async () => {
    profile.mockResolvedValue({});
    perm.mockResolvedValue(true);
    expect(await Page()).toBeTruthy();
  });
});
