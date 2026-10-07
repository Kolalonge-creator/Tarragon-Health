/**
 * S85 D2 / OQ-12: setPlanningPregnancyMode writes the opt-in "Planning a pregnancy" choice to the SUBJECT's own
 * reproductive_health_profiles row (the person being looked after when acting for someone, never the caller), validates
 * its input, never leaks a raw database message, and writes nothing else.
 */
const authGetUser = jest.fn();
const profilesSingle = jest.fn();
const profileUpsert = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: authGetUser },
    from: (table: string) => {
      switch (table) {
        case "profiles":
          return { select: () => ({ eq: () => ({ single: profilesSingle }) }) };
        case "reproductive_health_profiles":
          return { upsert: profileUpsert };
        default:
          throw new Error(`unexpected table ${table}`);
      }
    },
  }),
}));

const resolveSubjectId = jest.fn();
jest.mock("@/lib/acting/acting-for", () => ({
  resolveSubjectId: (id: string) => resolveSubjectId(id),
  assertNotActingFor: jest.fn(),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { setPlanningPregnancyMode } from "./womens-health-actions";

const CALLER = "11111111-1111-4111-8111-111111111111";
const SUBJECT = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  jest.clearAllMocks();
  authGetUser.mockResolvedValue({ data: { user: { id: CALLER } } });
  resolveSubjectId.mockResolvedValue(SUBJECT);
  profilesSingle.mockResolvedValue({ data: { organisation_id: ORG } });
  profileUpsert.mockResolvedValue({ error: null });
});

describe("setPlanningPregnancyMode", () => {
  it("turns the mode on for the subject, and touches no other column", async () => {
    expect(await setPlanningPregnancyMode({ enabled: true })).toEqual({ success: true });
    expect(profileUpsert).toHaveBeenCalledWith(
      { patient_id: SUBJECT, organisation_id: ORG, planning_pregnancy_mode: true },
      { onConflict: "patient_id" }
    );
  });

  it("turns it off the same way", async () => {
    await setPlanningPregnancyMode({ enabled: false });
    expect(profileUpsert.mock.calls[0][0].planning_pregnancy_mode).toBe(false);
  });

  it("writes to the subject, never the caller", async () => {
    await setPlanningPregnancyMode({ enabled: true });
    expect(profileUpsert.mock.calls[0][0].patient_id).toBe(SUBJECT);
    expect(profileUpsert.mock.calls[0][0].patient_id).not.toBe(CALLER);
  });

  it("rejects anything that is not a real boolean and writes nothing", async () => {
    for (const bad of [{ enabled: "true" }, { enabled: 1 }, { enabled: null }, {}, null]) {
      const result = await setPlanningPregnancyMode(bad as unknown as { enabled: boolean });
      expect(result?.error).toBeTruthy();
    }
    expect(profileUpsert).not.toHaveBeenCalled();
  });

  it("returns a plain message, not the database error, when the write is refused (a caregiver without the category)", async () => {
    profileUpsert.mockResolvedValue({ error: { message: 'new row violates row-level security policy for table "reproductive_health_profiles"' } });
    const result = await setPlanningPregnancyMode({ enabled: true });
    expect(result?.error).toBe("Could not save that just now. Please try again.");
    expect(result?.error).not.toMatch(/row-level|policy|reproductive/i);
  });

  it("does nothing when signed out", async () => {
    authGetUser.mockResolvedValue({ data: { user: null } });
    expect(await setPlanningPregnancyMode({ enabled: true })).toEqual({ error: "Not signed in" });
    expect(profileUpsert).not.toHaveBeenCalled();
  });
});
