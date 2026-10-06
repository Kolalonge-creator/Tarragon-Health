import { parseAllowance, parseWrittenQuestions } from "./parse";
import { viewQuestion } from "./status";
import type { WrittenQuestion } from "./types";

const NOW = new Date("2026-10-06T12:00:00Z");

function q(over: Partial<WrittenQuestion>): WrittenQuestion {
  return {
    id: "1",
    category: "general",
    question: "A question here",
    status: "submitted",
    answer: null,
    answerKind: null,
    createdAt: "2026-10-06T08:00:00Z",
    answeredAt: null,
    windowDueAt: "2026-10-07T08:00:00Z",
    followUpUntil: null,
    windowMissedAt: null,
    photos: 0,
    messages: [],
    ...over,
  };
}

describe("parseWrittenQuestions", () => {
  it("parses rows and drops malformed ones", () => {
    const rows = parseWrittenQuestions([
      { id: "a", question: "Hello there friend", status: "answered", answer: "ok", answer_kind: "guidance", created_at: "2026-10-01T00:00:00Z", photos: 2, messages: [{ id: "m", author_role: "care_team", body: "hi", created_at: "2026-10-02T00:00:00Z" }, { id: "x" }] },
      { id: "b", status: "nonsense", question: "x", created_at: "2026-10-01T00:00:00Z" },
      "junk",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].photos).toBe(2);
    expect(rows[0].messages).toHaveLength(1);
    expect(rows[0].answerKind).toBe("guidance");
  });
  it("returns an empty list for a non-array", () => {
    expect(parseWrittenQuestions(null)).toEqual([]);
    expect(parseWrittenQuestions({ a: 1 })).toEqual([]);
  });
});

describe("parseAllowance", () => {
  it("reads the allowance and falls back to safe limits", () => {
    const a = parseAllowance({ is_member: true, allowance: 4, used: 1, remaining: 3 });
    expect(a).toMatchObject({ isMember: true, remaining: 3, maxPhotos: 3, maxPhotoBytes: 8_388_608, windowMinutes: 1440 });
    expect(parseAllowance(null)).toBeNull();
  });
  it("treats a non-member as not a member", () => {
    expect(parseAllowance({})?.isMember).toBe(false);
  });
});

describe("viewQuestion", () => {
  it("waiting while the care team has it", () => {
    const v = viewQuestion(q({}), NOW);
    expect(v.statusKey).toBe("wq.status.waiting");
    expect(v.canReply).toBe(false);
  });
  it("answered guidance shows the answer and the follow-up reply box until the window ends", () => {
    const open = viewQuestion(q({ status: "answered", answer: "Take it with food", answerKind: "guidance", followUpUntil: "2026-10-12T00:00:00Z" }), NOW);
    expect(open).toMatchObject({ statusKey: "wq.status.answered", showAnswer: true, canReply: true, showFollowUpUntil: true, followUpEnded: false });
    const ended = viewQuestion(q({ status: "answered", answer: "Take it with food", answerKind: "guidance", followUpUntil: "2026-10-05T00:00:00Z" }), NOW);
    expect(ended).toMatchObject({ canReply: false, followUpEnded: true, showFollowUpUntil: false });
  });
  it("needs more information opens the reply box even without a follow-up window", () => {
    const v = viewQuestion(q({ status: "in_review", answerKind: "needs_more_information", answer: "How long?" }), NOW);
    expect(v).toMatchObject({ statusKey: "wq.status.info_needed", canReply: true });
  });
  it("needs a call shows the call note and no reply box", () => {
    const v = viewQuestion(q({ status: "answered", answerKind: "needs_call" }), NOW);
    expect(v).toMatchObject({ statusKey: "wq.status.call", showCallNote: true, canReply: false });
  });
  it("a missed window shows the neutral apology", () => {
    expect(viewQuestion(q({ windowMissedAt: "2026-10-07T09:00:00Z" }), NOW).statusKey).toBe("wq.status.missed");
  });
});
