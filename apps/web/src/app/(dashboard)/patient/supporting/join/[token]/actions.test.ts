const redirect = jest.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
jest.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
const signOut = jest.fn(async () => ({ error: null }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signOut } }) }));

import { signOutAndReturnToInvite } from "./actions";

const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-AB";
const form = (token: unknown) => {
  const f = new FormData();
  if (typeof token === "string") f.set("token", token);
  return f;
};

beforeEach(() => {
  redirect.mockClear();
  signOut.mockClear();
});

describe("signOutAndReturnToInvite", () => {
  it("signs out and returns to the landing for the same link", async () => {
    await expect(signOutAndReturnToInvite(form(TOKEN))).rejects.toThrow(`NEXT_REDIRECT:/circle/join/${TOKEN}`);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it.each(["https://evil.example", "../../admin", "short", "x".repeat(200)])("never puts %s into a URL", async (bad) => {
    await expect(signOutAndReturnToInvite(form(bad))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("still signs out when no token was sent", async () => {
    await expect(signOutAndReturnToInvite(form(undefined))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
