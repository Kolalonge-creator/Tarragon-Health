/**
 * INV-11 / INV-10: an AI draft is attached to a draft encounter note only through attach_scribe_draft_to_note (the table
 * is closed to direct writes), and the database refuses it when consent is revoked or belongs to another encounter. The
 * action must surface that refusal instead of swallowing it, and must never write to the table directly.
 * Sabotage check: change attachScribeDraftToNote to catch and ignore the RPC error and the "refusal" case fails.
 */

const NOTE = "11111111-1111-4111-8111-111111111111";
const CONSENT = "22222222-2222-4222-8222-222222222222";

const rpcMock = jest.fn();
const fromMock = jest.fn();
const getSessionMock = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: (...a: unknown[]) => fromMock(...a),
    auth: { getSession: () => getSessionMock() },
  }),
}));

import { attachScribeDraftToNote, draftScribeFromText } from "./actions";

describe("attachScribeDraftToNote", () => {
  beforeEach(() => {
    rpcMock.mockReset().mockResolvedValue({ error: null });
    fromMock.mockReset();
  });

  it("calls the audited function with the consent and summary, and never touches the table directly", async () => {
    await attachScribeDraftToNote({
      encounterNoteId: NOTE,
      scribeConsentId: CONSENT,
      patientSummary: "Rest.",
    });
    expect(rpcMock).toHaveBeenCalledWith("attach_scribe_draft_to_note", {
      p_note: NOTE,
      p_consent: CONSENT,
      p_patient_summary: "Rest.",
      p_summary_language: "en-NG",
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("surfaces the database's refusal (revoked consent, other encounter, finalized note)", async () => {
    rpcMock.mockResolvedValue({ error: { message: "Scribe consent is not active for this encounter." } });
    await expect(
      attachScribeDraftToNote({
        encounterNoteId: NOTE,
        scribeConsentId: CONSENT,
        patientSummary: "",
      })
    ).rejects.toThrow("not active");
  });

  it("rejects malformed ids before any call", async () => {
    await expect(
      attachScribeDraftToNote({
        encounterNoteId: "nope",
        scribeConsentId: CONSENT,
        patientSummary: "",
      })
    ).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("draftScribeFromText", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    getSessionMock.mockReset().mockResolvedValue({ data: { session: { access_token: "t" } } });
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  });

  it("sends parsed segments marked as typed notes", async () => {
    await draftScribeFromText({
      scribeConsentId: CONSENT,
      encounterNoteId: NOTE,
      text: "Patient: headache for two weeks\nDoctor: BP 164/98, review in two weeks",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.source).toBe("typed");
    expect(body.segments).toHaveLength(2);
    expect(body.segments[0]).toMatchObject({ speaker: "patient", text: "headache for two weeks" });
  });

  it("refuses text that is too short to draft from, without calling the function", async () => {
    await expect(
      draftScribeFromText({ scribeConsentId: CONSENT, encounterNoteId: NOTE, text: "short" })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
