/**
 * The database refuses to complete onboarding without a date of birth, a sex and the required consents. completeOnboarding() used to ignore
 * that refusal and carry on to the dashboard, which sent the person straight back to onboarding with no explanation. It must now send them
 * back to onboarding itself, and must NOT carry on to the dashboard.
 */
const redirect = jest.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
jest.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

let updateError: { code: string; message: string } | null = null;
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "p1", user_metadata: {} } } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          update: () => ({ eq: async () => ({ error: updateError }) }),
          select: () => ({ eq: () => ({ single: async () => ({ data: { receives_care: true } }) }) }),
        };
      }
      return { select: () => ({ eq: async () => ({ data: [] }) }) };
    },
  }),
}));

import { completeOnboarding } from "./actions";

beforeEach(() => {
  redirect.mockClear();
  updateError = null;
});

describe("completeOnboarding", () => {
  it("sends the person back to onboarding when the database refuses to complete it", async () => {
    updateError = { code: "23514", message: "Onboarding cannot complete without date of birth and sex on file" };
    await expect(completeOnboarding()).rejects.toThrow("NEXT_REDIRECT:/onboarding");
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalledWith("/patient");
  });

  it("carries on to the dashboard when it succeeds", async () => {
    await expect(completeOnboarding()).rejects.toThrow("NEXT_REDIRECT:/patient");
    expect(redirect).toHaveBeenCalledWith("/patient");
  });
});
