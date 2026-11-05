/**
 * Regression test for assessment finding S7 (2026-11-05): joinAsPatientToo()
 * discarded the result of its profiles update, so a failed switch (an error,
 * or RLS matching no row, which PostgREST reports as success) still sent the
 * supporter to onboarding with receives_care unchanged and no explanation.
 */

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`redirect:${url}`);
  }
}

jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string) => {
    throw new RedirectSignal(url);
  }),
}));
jest.mock("next/headers", () => ({ headers: jest.fn() }));
jest.mock("@/lib/billing/sponsored-subscription-checkout", () => ({}));
jest.mock("@/lib/billing/sponsor-bill-checkout", () => ({}));
jest.mock("@/lib/billing/subsidy-checkout", () => ({}));
jest.mock("@/lib/billing/sponsored-service-reservation-checkout", () => ({}));
jest.mock("@/lib/acting/acting-for", () => ({
  startActingFor: jest.fn(),
  stopActingFor: jest.fn(),
}));

let updateResult: { data: { id: string }[] | null; error: { code: string } | null };
const updateSpy = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: jest.fn(async () => ({ id: "supporter-1" })),
  createClient: jest.fn(async () => ({
    from: () => ({
      update: (values: unknown) => {
        updateSpy(values);
        return { eq: () => ({ select: async () => updateResult }) };
      },
    }),
  })),
}));

import { joinAsPatientToo } from "./actions";

async function run(): Promise<string> {
  try {
    await joinAsPatientToo();
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

describe("joinAsPatientToo", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    updateSpy.mockClear();
  });

  it("goes to onboarding when the row was updated", async () => {
    updateResult = { data: [{ id: "supporter-1" }], error: null };
    expect(await run()).toBe("/onboarding");
    expect(updateSpy).toHaveBeenCalledWith({ receives_care: true, onboarding_completed_at: null });
  });

  it("returns to the page with an error when the update fails", async () => {
    updateResult = { data: null, error: { code: "42501" } };
    expect(await run()).toBe("/patient/supporting?join=failed");
  });

  it("returns to the page with an error when no row was updated", async () => {
    updateResult = { data: [], error: null };
    expect(await run()).toBe("/patient/supporting?join=failed");
  });
});
