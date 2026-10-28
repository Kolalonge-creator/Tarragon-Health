/**
 * Regression test (2026-10-28): createVaccinationScheduleDraftAction inserted a draft with a catalogue snapshot but no schedule_config.
 * The table's CHECK vaccination_schedule_signoffs_v2_active_needs_config refuses to activate any version 2 or later without one, so every
 * draft the button made (versions 3, 4 and 5 live) failed when the Chief Medical Officer pressed sign. The draft must carry the in-force
 * configuration forward, and must refuse to create an unsignable draft when there is none to carry.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: jest.fn().mockResolvedValue({ role: "admin" }),
  getCurrentClinicalStaff: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: jest.fn().mockReturnValue(false) }));
jest.mock("@/lib/clinical/refuse-superseded-draft", () => ({ refuseSupersededDraft: jest.fn() }));

const insert = jest.fn();
let configRow: { schedule_config: unknown } | null = { schedule_config: { doses: { hpv: 2 } } };

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockImplementation(async () => ({
    from: (table: string) => {
      if (table === "vaccination_catalog") {
        return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ code: "child_ipv" }], error: null }) }) }) };
      }
      return {
        select: (cols: string) =>
          cols === "version"
            ? { order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { version: 2 }, error: null }) }) }) }
            : { eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: configRow, error: null }) }) }) },
        insert: (row: unknown) => {
          insert(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  })),
}));

import { createVaccinationScheduleDraftAction } from "./actions";

const form = () => new FormData();

describe("createVaccinationScheduleDraftAction", () => {
  beforeEach(() => {
    insert.mockClear();
    configRow = { schedule_config: { doses: { hpv: 2 } } };
  });

  it("carries the in-force schedule_config into the new draft, so it can be signed", async () => {
    const res = await createVaccinationScheduleDraftAction(undefined, form());
    expect(res).toEqual({ success: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ version: 3, schedule_config: { doses: { hpv: 2 } } }));
  });

  it("refuses to create a draft that could never be signed when there is no configuration to carry", async () => {
    configRow = null;
    const res = await createVaccinationScheduleDraftAction(undefined, form());
    expect(res?.error).toMatch(/no schedule configuration/i);
    expect(insert).not.toHaveBeenCalled();
  });
});
