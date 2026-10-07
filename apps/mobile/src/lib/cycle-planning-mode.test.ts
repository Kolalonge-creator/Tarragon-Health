/**
 * S85 D2 / OQ-12 on the phone: reading and saving the "Planning a pregnancy" choice. Off is the safe state, and only the
 * person themselves may change it.
 */
const mockMaybeSingle = jest.fn();
const mockUpsert = jest.fn();
const mockGetUser = jest.fn();

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => mockMaybeSingle() }) }),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    }),
  },
}));

import { loadPlanningMode, savePlanningMode } from "./cycle";

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: ME } } });
  mockUpsert.mockResolvedValue({ error: null });
});

describe("loadPlanningMode: off is the safe state", () => {
  it("is on only for a real true", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { planning_pregnancy_mode: true }, error: null });
    expect(await loadPlanningMode(ME)).toBe(true);
  });

  it.each([
    ["no row", { data: null, error: null }],
    ["false", { data: { planning_pregnancy_mode: false }, error: null }],
    ["null", { data: { planning_pregnancy_mode: null }, error: null }],
    ["a missing column", { data: null, error: { message: "column does not exist" } }],
  ])("is off for %s", async (_name, result) => {
    mockMaybeSingle.mockResolvedValue(result);
    expect(await loadPlanningMode(ME)).toBe(false);
  });

  it("is off when the read throws", async () => {
    mockMaybeSingle.mockRejectedValue(new Error("network"));
    expect(await loadPlanningMode(ME)).toBe(false);
  });
});

describe("savePlanningMode", () => {
  it("saves the choice on the person's own row, and only that column", async () => {
    const result = await savePlanningMode({ patientId: ME, organisationId: ORG, enabled: true });
    expect(result.ok).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith(
      { patient_id: ME, organisation_id: ORG, planning_pregnancy_mode: true },
      { onConflict: "patient_id" }
    );
  });

  it("refuses when the screen is open for someone being supported, and writes nothing", async () => {
    const result = await savePlanningMode({ patientId: SOMEONE_ELSE, organisationId: ORG, enabled: true });
    expect(result.ok).toBe(false);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("refuses when signed out", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await savePlanningMode({ patientId: ME, organisationId: ORG, enabled: true })).ok).toBe(false);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("gives a plain message, not the database error, when the write is refused", async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'violates row-level security policy for table "reproductive_health_profiles"' } });
    const result = await savePlanningMode({ patientId: ME, organisationId: ORG, enabled: true });
    expect(result).toEqual({ ok: false, error: "Could not save that just now. Please try again." });
  });
});
