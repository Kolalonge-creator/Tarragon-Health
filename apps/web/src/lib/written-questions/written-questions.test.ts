import { mapWrittenQuestionError } from "./errors";
import { checkPhoto, targetSize } from "./photos";
import { viewWrittenQuestion } from "./status";
import { sendWrittenQuestion, type PhotoToSend, type WrittenQuestionGateway } from "./submit";
import { clearDraft, loadDraft, newClientId, saveDraft } from "./draft";
import { groupNotes, noteSections, parseNoteIndex, parseReleasedNotes } from "./notes";
import type { WrittenQuestion } from "./types";

const CID = "11111111-1111-4111-8111-111111111111";

function gateway(): jest.Mocked<WrittenQuestionGateway> {
  return {
    submitQuestion: jest.fn().mockResolvedValue({ id: "c1", error: null }),
    uploadPhoto: jest.fn().mockResolvedValue({ path: "u/c1/p.jpg", error: null }),
    attachPhoto: jest.fn().mockResolvedValue({ error: null }),
  };
}
const base = { category: "general" as const, durationNote: "", photos: [] as PhotoToSend[], clientId: "client-1", redFlagAcknowledged: false };

describe("mapWrittenQuestionError", () => {
  it("maps database messages by prefix", () => {
    expect(mapWrittenQuestionError("Written messages to your care team are part of Membership.").key).toBe("wq.members_only");
    expect(mapWrittenQuestionError("Written questions are for adults only").key).toBe("wq.adults_only");
    expect(mapWrittenQuestionError("You have used your written messages for this month.").key).toBe("wq.allowance.none");
    expect(mapWrittenQuestionError("question must be at least 10 characters").key).toBe("wq.error.length");
    expect(mapWrittenQuestionError("boom").key).toBe("wq.error.generic");
    expect(mapWrittenQuestionError(null).key).toBe("wq.error.generic");
  });
});

describe("photo checks", () => {
  const limits = { maxPhotos: 3, maxBytes: 8388608 };
  it("enforces count, type and size", () => {
    expect(checkPhoto({ type: "image/jpeg", size: 100 }, 0, limits)).toEqual({ ok: true });
    expect(checkPhoto({ type: "image/jpeg", size: 100 }, 3, limits)).toEqual({ ok: false, reason: "limit" });
    expect(checkPhoto({ type: "application/pdf", size: 100 }, 0, limits)).toEqual({ ok: false, reason: "type" });
    expect(checkPhoto({ type: "image/png", size: 8388609 }, 0, limits)).toEqual({ ok: false, reason: "size" });
    expect(checkPhoto({ type: "image/png", size: 8388608 }, 2, limits)).toEqual({ ok: true });
  });
  it("scales down to 1600 wide and never up", () => {
    expect(targetSize(3200, 2400)).toEqual({ width: 1600, height: 1200 });
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("viewWrittenQuestion", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const q = (o: Partial<WrittenQuestion>): WrittenQuestion => ({
    id: "1", category: "general", question: "q", status: "submitted", answer: null, answer_kind: null,
    created_at: "2026-10-06T00:00:00Z", answered_at: null, window_due_at: null, follow_up_until: null, window_missed_at: null, ...o,
  });
  it("maps each state", () => {
    expect(viewWrittenQuestion(q({}), now).labelKey).toBe("wq.status.waiting");
    expect(viewWrittenQuestion(q({ status: "answered", answer: "a", answer_kind: "guidance" }), now).labelKey).toBe("wq.status.answered");
    const info = viewWrittenQuestion(q({ status: "in_review", answer: "more?", answer_kind: "needs_more_information" }), now);
    expect(info.labelKey).toBe("wq.status.info_needed");
    expect(info.canReply).toBe(true);
    expect(viewWrittenQuestion(q({ answer_kind: "needs_call" }), now).labelKey).toBe("wq.status.call");
    expect(viewWrittenQuestion(q({ window_missed_at: "2026-10-06T01:00:00Z" }), now).missed).toBe(true);
  });
  it("opens the reply box only inside the follow-up window", () => {
    const answered = { status: "answered" as const, answer: "a", answer_kind: "guidance" as const };
    const open = viewWrittenQuestion(q({ ...answered, follow_up_until: "2026-10-10T00:00:00Z" }), now);
    expect(open.canReply && open.followUpOpen).toBe(true);
    const ended = viewWrittenQuestion(q({ ...answered, follow_up_until: "2026-10-01T00:00:00Z" }), now);
    expect(ended.canReply).toBe(false);
    expect(ended.followUpEnded).toBe(true);
  });
});

describe("sendWrittenQuestion red-flag gate", () => {
  it("does not call the network on a red flag until acknowledged", async () => {
    const g = gateway();
    const held = await sendWrittenQuestion(g, { ...base, question: "I have chest pain since this morning" });
    expect(held).toEqual({ kind: "red_flag" });
    expect(g.submitQuestion).not.toHaveBeenCalled();
    const sent = await sendWrittenQuestion(g, { ...base, question: "I have chest pain since this morning", redFlagAcknowledged: true });
    expect(sent.kind).toBe("sent");
    expect(g.submitQuestion).toHaveBeenCalledTimes(1);
  });
  it("screens the duration note too", async () => {
    const g = gateway();
    const r = await sendWrittenQuestion(g, { ...base, question: "Is my dose correct for me", durationNote: "I can't breathe at night" });
    expect(r.kind).toBe("red_flag");
    expect(g.submitQuestion).not.toHaveBeenCalled();
  });
  it("rejects a too-short question before anything else", async () => {
    const g = gateway();
    const r = await sendWrittenQuestion(g, { ...base, question: "short" });
    expect(r.kind).toBe("invalid");
    expect(g.submitQuestion).not.toHaveBeenCalled();
  });
  it("submits first, then uploads and registers each photo; counts failures", async () => {
    const g = gateway();
    g.uploadPhoto.mockResolvedValueOnce({ path: null, error: "x" });
    const r = await sendWrittenQuestion(g, { ...base, question: "A normal question about my medicine", photos: [{ id: "p1", blob: new Blob(["a"]) }, { id: "p2", blob: new Blob(["b"]) }] });
    expect(r).toEqual({ kind: "sent", consultId: "c1", photoFailures: 1 });
    expect(g.attachPhoto).toHaveBeenCalledTimes(1);
  });
  it("maps a database refusal and uploads nothing", async () => {
    const g = gateway();
    g.submitQuestion.mockResolvedValue({ id: null, error: "You have used your written messages for this month." });
    const r = await sendWrittenQuestion(g, { ...base, question: "A normal question about my medicine", photos: [{ id: "p1", blob: new Blob(["a"]) }] });
    expect(r).toEqual({ kind: "error", error: { key: "wq.allowance.none" } });
    expect(g.uploadPhoto).not.toHaveBeenCalled();
  });
});

describe("draft storage", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  it("round-trips and survives a throwing store", () => {
    const s = mem();
    expect(saveDraft("p", { category: "general", question: "hello there", duration: "", clientId: CID }, s)).toBe(true);
    expect(loadDraft("p", s)?.question).toBe("hello there");
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(loadDraft("p", bad)).toBeNull();
    expect(saveDraft("p", { category: "general", question: "x", duration: "", clientId: CID }, bad)).toBe(false);
  });
});

describe("notes", () => {
  it("skips empty sections and groups amendments beside the original", () => {
    const released = parseReleasedNotes([
      { id: "n1", reason: "Cough", history: " ", plan: "Rest", signed_at: "2026-10-01T00:00:00Z" },
      { id: "n2", amends_note_id: "n1", amendment_kind: "correction", amendment_reason: "typo", plan: "Rest and fluids", signed_at: "2026-10-02T00:00:00Z" },
      { bad: true },
    ]);
    expect(released).toHaveLength(2);
    expect(noteSections(released[0]).map((s) => s.key)).toEqual(["notes.section.reason", "notes.section.plan"]);
    const index = parseNoteIndex([
      { id: "n1", release_state: "released", signed_at: "2026-10-01T00:00:00Z" },
      { id: "n2", release_state: "released", signed_at: "2026-10-02T00:00:00Z" },
      { id: "n3", release_state: "not_requested", signed_at: "2026-10-03T00:00:00Z" },
    ]);
    const groups = groupNotes(index, released);
    expect(groups.map((g) => g.entry.id)).toEqual(["n1", "n3"]);
    expect(groups[0].amendments.map((a) => a.id)).toEqual(["n2"]);
    expect(groups[1].note).toBeNull();
  });
});

describe("client id for a safe retry", () => {
  const long = "A normal question about my medicine";
  it("sends the client id with the question", async () => {
    const g = gateway();
    await sendWrittenQuestion(g, { ...base, question: long, clientId: CID });
    expect(g.submitQuestion).toHaveBeenCalledWith(expect.objectContaining({ clientId: CID }));
  });
  it("a retry after a lost reply reuses the same id and the same photo ids", async () => {
    const g = gateway();
    g.submitQuestion.mockResolvedValueOnce({ id: null, error: "network" });
    const photos = [{ id: "photo-1", blob: new Blob(["a"]) }];
    const first = await sendWrittenQuestion(g, { ...base, question: long, clientId: CID, photos });
    expect(first.kind).toBe("error");
    const second = await sendWrittenQuestion(g, { ...base, question: long, clientId: CID, photos });
    expect(second.kind).toBe("sent");
    const ids = g.submitQuestion.mock.calls.map((c) => c[0].clientId);
    expect(ids).toEqual([CID, CID]);
    expect(g.uploadPhoto).toHaveBeenCalledWith("c1", photos[0]);
  });
  it("a new question gets a new id", () => {
    expect(newClientId()).not.toBe(newClientId());
  });
});

describe("draft client id", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  it("round-trips the id so a refresh retries with the same one", () => {
    const s = store();
    saveDraft("p", { category: "general", question: "hello there", duration: "", clientId: CID }, s);
    expect(loadDraft("p", s)?.clientId).toBe(CID);
  });
  it("gives an old draft with no id a fresh valid one", () => {
    const s = store();
    s.setItem("tarragon.wq.draft.p", JSON.stringify({ category: "general", question: "hello", duration: "" }));
    const d = loadDraft("p", s);
    expect(d?.clientId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("clears the id with the draft after a successful send", () => {
    const s = store();
    saveDraft("p", { category: "general", question: "hello there", duration: "", clientId: CID }, s);
    clearDraft("p", s);
    expect(loadDraft("p", s)).toBeNull();
  });
});
