/**
 * Supporter join path: a Care Circle link opened before onboarding is carried through it, and completeOnboarding() returns there.
 * Only a join link is ever honoured: any other destination, an absolute URL, a protocol-relative path or a bad token is ignored, and
 * the person lands where they always did.
 */
const redirect = jest.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
jest.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

let updateError: { code: string; message: string } | null = null;
let receivesCare = false;
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "p1", user_metadata: {} } } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          update: () => ({ eq: async () => ({ error: updateError }) }),
          select: () => ({ eq: () => ({ single: async () => ({ data: { receives_care: receivesCare } }) }) }),
        };
      }
      return { select: () => ({ eq: async () => ({ data: [] }) }) };
    },
  }),
}));

import { completeOnboarding } from "./actions";

const JOIN = "/patient/supporting/join/abcdefghijklmnopqrstuvwxyz0123456789_-AB";

beforeEach(() => {
  redirect.mockClear();
  updateError = null;
  receivesCare = false;
});

describe("completeOnboarding with a Care Circle join link", () => {
  it("returns a new supporter to the invite, not to the supporting page", async () => {
    await expect(completeOnboarding({ redirect: JOIN })).rejects.toThrow(`NEXT_REDIRECT:${JOIN}`);
  });

  it("returns a new patient to the invite too", async () => {
    receivesCare = true;
    await expect(completeOnboarding({ redirect: JOIN })).rejects.toThrow(`NEXT_REDIRECT:${JOIN}`);
  });

  it("keeps the join link when the database refuses, so the retry still ends at the invite", async () => {
    updateError = { code: "23514", message: "Please accept the terms of service to continue" };
    await expect(completeOnboarding({ redirect: JOIN })).rejects.toThrow(`NEXT_REDIRECT:/onboarding?redirect=${encodeURIComponent(JOIN)}`);
  });

  it.each([
    "https://evil.example/patient/supporting/join/abcdefghijklmnopqrstuvwxyz",
    "//evil.example/patient/supporting/join/abcdefghijklmnopqrstuvwxyz",
    "/patient/vitals",
    "/patient/supporting/join/short",
    "/patient/supporting/join/abcdefghijklmnopqrstuvwxyz/../../admin",
    "/patient/supporting/join/abcdefghijklmnopqrstuvwxyz?x=1",
    "/patient/supporting/join/abc%2Fdefghijklmnopqrstuvwxyz",
  ])("ignores %s and lands where it always did", async (bad) => {
    await expect(completeOnboarding({ redirect: bad })).rejects.toThrow("NEXT_REDIRECT:/patient/supporting");
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("ignores a payload that is not the expected shape", async () => {
    await expect(completeOnboarding({ redirect: 42 } as unknown as { redirect: string })).rejects.toThrow("NEXT_REDIRECT:/patient/supporting");
  });
});
