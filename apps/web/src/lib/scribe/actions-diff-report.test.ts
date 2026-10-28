/**
 * S76-S80 actions. The signed diff goes through record_scribe_signed_diff only (the table is closed to direct writes) and a refusal is
 * thrown so the note is not signed; a problem report returns a result instead of throwing; a drafted follow-up task creates a row only
 * when accepted, through create_clinical_follow_up, and never past the PROPOSED limit.
 */
const NOTE = "11111111-1111-4111-8111-111111111111";
const CONSENT = "22222222-2222-4222-8222-222222222222";
const PATIENT = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64);

const rpcMock = jest.fn();
const fromMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpcMock(...a), from: (...a: unknown[]) => fromMock(...a), auth: { getSession: jest.fn() } }),
}));

import { acceptFollowUpTaskProposal, recordScribeSignedDiff, reportScribeProblem } from "./actions";
import { buildSignedDiff } from "./draft-diff";

const empty = { history: "", examination: "", assessment: "", plan: "", followUp: "", patientSummary: "" };
const base = () => ({
  noteId: NOTE,
  consentId: CONSENT,
  transcriptHash: HASH,
  model: "claude-sonnet-5-5",
  promptVersion: "scribe-facts-draft-v1",
  draftHash: HASH,
  source: "typed" as const,
  aiDraft: { ...empty, plan: "Rest and fluids" },
  diff: buildSignedDiff({ ...empty, plan: "Rest and fluids" }, { ...empty, plan: "Rest, fluids and review" }),
});

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue({ error: null });
  fromMock.mockReset();
});

describe("recordScribeSignedDiff", () => {
  it("sends the draft, hashes and diff to the one function, never the table, and never the signed text", async () => {
    await recordScribeSignedDiff(base());
    expect(rpcMock).toHaveBeenCalledWith("record_scribe_signed_diff", expect.objectContaining({ p_note: NOTE, p_consent: CONSENT, p_transcript_hash: HASH, p_draft_hash: HASH, p_source: "typed" }));
    expect(Object.keys(rpcMock.mock.calls[0][1])).not.toContain("p_signed_text");
    expect(fromMock).not.toHaveBeenCalled();
  });
  it("throws the database's refusal so the note is not signed", async () => {
    rpcMock.mockResolvedValue({ error: { message: "No review record for this draft on this note." } });
    await expect(recordScribeSignedDiff(base())).rejects.toThrow("No review record");
  });
  it("refuses a malformed hash before calling the database", async () => {
    await expect(recordScribeSignedDiff({ ...base(), transcriptHash: "nope" })).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("reportScribeProblem", () => {
  it("records a report from the fixed taxonomy", async () => {
    const r = await reportScribeProblem({ noteId: NOTE, consentId: CONSENT, draftKind: "letter", section: null, category: "wrong_patient" });
    expect(r).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("report_scribe_draft_problem", { p_note: NOTE, p_consent: CONSENT, p_kind: "letter", p_section: null, p_category: "wrong_patient", p_comment: null });
  });
  it("returns a failure result rather than throwing, and refuses a category outside the list", async () => {
    rpcMock.mockResolvedValue({ error: { message: "x" } });
    expect(await reportScribeProblem({ noteId: NOTE, consentId: null, draftKind: "note", section: "plan", category: "other" })).toEqual({ ok: false });
    await expect(reportScribeProblem({ noteId: NOTE, consentId: null, draftKind: "note", section: null, category: "rude" as never })).rejects.toThrow();
  });
});

describe("acceptFollowUpTaskProposal", () => {
  it("creates the follow-up only through create_clinical_follow_up with a future due time", async () => {
    const before = Date.now();
    const r = await acceptFollowUpTaskProposal({ patientId: PATIENT, dueInDays: 14 });
    expect(r).toEqual({ ok: true });
    const args = rpcMock.mock.calls[0];
    expect(args[0]).toBe("create_clinical_follow_up");
    expect(args[1]).toMatchObject({ p_patient: PATIENT, p_kind: "follow_up" });
    expect(new Date(args[1].p_due_at).getTime()).toBeGreaterThan(before + 13 * 86_400_000);
  });
  it("refuses a due date beyond the limit without calling the database", async () => {
    expect(await acceptFollowUpTaskProposal({ patientId: PATIENT, dueInDays: 999 })).toEqual({ ok: false, reason: "too_far" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("reports a refusal (clinician not tied to the patient) as not created", async () => {
    rpcMock.mockResolvedValue({ error: { message: "a follow-up is created by a clinician tied to the patient" } });
    expect(await acceptFollowUpTaskProposal({ patientId: PATIENT, dueInDays: 3 })).toEqual({ ok: false, reason: "refused" });
  });
});
