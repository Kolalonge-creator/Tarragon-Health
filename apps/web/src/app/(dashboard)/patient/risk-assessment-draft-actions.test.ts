const mockActing = jest.fn();
const mockFrom = jest.fn();
const mockUpsert = jest.fn();
let mockDraftRead: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock("@/lib/acting/acting-for", () => ({ getActingFor: () => mockActing() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    from: (table: string) => {
      mockFrom(table);
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organisation_id: "org1" }, error: null }) }) }) };
      }
      return {
        select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ ...mockDraftRead, _id: id }) }) }),
        upsert: async (row: unknown, opts: unknown) => {
          mockUpsert(row, opts);
          return { error: null };
        },
        delete: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  }),
}));

import { discardRiskAssessmentDraft, loadRiskAssessmentDraft, saveRiskAssessmentDraft } from "./risk-assessment-draft-actions";

beforeEach(() => {
  jest.clearAllMocks();
  mockActing.mockResolvedValue(null);
  mockDraftRead = { data: null, error: null };
});

describe("risk assessment draft actions (P14)", () => {
  it("saves the draft on the signed-in patient's own record", async () => {
    expect(await saveRiskAssessmentDraft({ answers: { smoking_status: "never" }, step: 2 })).toEqual({ ok: true });
    expect(mockUpsert).toHaveBeenCalledWith(
      { patient_id: "me", organisation_id: "org1", answers: { smoking_status: "never" }, step: 2 },
      { onConflict: "patient_id" },
    );
  });

  it("refuses to save, load or clear while acting for someone, touching nothing", async () => {
    mockActing.mockResolvedValue({ profileId: "mum", fullName: "Mum" });
    expect(await saveRiskAssessmentDraft({ answers: {}, step: 1 })).toEqual({ ok: false, error: expect.stringMatching(/own account/) });
    expect(await discardRiskAssessmentDraft()).toEqual({ ok: false, error: expect.stringMatching(/own account/) });
    expect(await loadRiskAssessmentDraft()).toEqual({ ok: true, draft: null });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a malformed draft before reaching the database", async () => {
    expect((await saveRiskAssessmentDraft({ answers: { "drop table": "x" }, step: 9 })).ok).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("reports a failed load as a failure, never as 'no draft'", async () => {
    mockDraftRead = { data: null, error: { message: "boom" } };
    expect(await loadRiskAssessmentDraft()).toEqual({ ok: false, error: "Couldn't load your saved answers." });
  });

  it("returns a saved draft", async () => {
    mockDraftRead = { data: { answers: { smoking_status: "never" }, step: 3, updated_at: "2026-11-06T10:00:00Z" }, error: null };
    expect(await loadRiskAssessmentDraft()).toEqual({
      ok: true,
      draft: { answers: { smoking_status: "never" }, step: 3, updatedAt: "2026-11-06T10:00:00Z" },
    });
  });
});
