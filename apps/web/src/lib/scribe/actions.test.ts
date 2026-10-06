/**
 * INV-11: an AI-drafted note only reaches the patient record through signScribeDraft, and only while the scribe
 * consent is still granted, unrevoked and bound to the same encounter. Sabotage check: delete the consent guard in
 * signScribeDraft and the "revoked" and "other encounter" cases fail.
 */

const ENCOUNTER = "11111111-1111-4111-8111-111111111111";
const OTHER_ENCOUNTER = "33333333-3333-4333-8333-333333333333";
const CONSENT = "22222222-2222-4222-8222-222222222222";

const consentRow = jest.fn();
const updateMock = jest.fn();
const deleteEqMock = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    from: (table: string) => {
      if (table === "scribe_consents") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => consentRow() }) }) };
      }
      if (table === "scribe_transcripts") {
        return { delete: () => ({ eq: (...a: unknown[]) => deleteEqMock(...a) }) };
      }
      return { update: (v: unknown) => ({ eq: () => updateMock(v) }) };
    },
  }),
}));

import { signScribeDraft } from "./actions";

const input = {
  encounterNoteId: ENCOUNTER,
  scribeConsentId: CONSENT,
  history: "h",
  examinationFindings: "e",
  assessment: "a",
  plan: "p",
  followUpInstructions: "f",
  patientSummary: "s",
  patientSummaryLanguage: "en-NG" as const,
};

describe("signScribeDraft", () => {
  beforeEach(() => {
    consentRow.mockReset();
    updateMock.mockReset().mockResolvedValue({ error: null });
  });

  it("finalizes the note as AI-drafted when consent is active for this encounter", async () => {
    consentRow.mockResolvedValue({
      data: { granted: true, revoked_at: null, encounter_note_id: ENCOUNTER },
      error: null,
    });
    await signScribeDraft(input);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "finalized", ai_drafted: true }));
  });

  it("refuses to write when consent was revoked after the draft was generated", async () => {
    consentRow.mockResolvedValue({
      data: { granted: true, revoked_at: "2026-10-06T10:00:00Z", encounter_note_id: ENCOUNTER },
      error: null,
    });
    await expect(signScribeDraft(input)).rejects.toThrow("not active");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses to write when the consent belongs to another encounter", async () => {
    consentRow.mockResolvedValue({
      data: { granted: true, revoked_at: null, encounter_note_id: OTHER_ENCOUNTER },
      error: null,
    });
    await expect(signScribeDraft(input)).rejects.toThrow("not active");
    expect(updateMock).not.toHaveBeenCalled();
  });
});
