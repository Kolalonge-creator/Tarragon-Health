import { describe, expect, it } from "@jest/globals";
import { parseSessionCsv, percentScore, scoreLessons, type PassRule, type SessionRow } from "./understandability";

const RULE: PassRule = { minParticipants: 10, minRecall: 0.8, maxUnsafe: 0 };
const row = (p: number, over: Partial<SessionRow> = {}): SessionRow => ({
  participant: `P${p}`,
  lesson: "BPC-01",
  recalledMessage: true,
  namedAction: true,
  unsafeMisunderstanding: false,
  interviewerRead: false,
  ...over,
});
const many = (n: number, over: (i: number) => Partial<SessionRow> = () => ({})): SessionRow[] => Array.from({ length: n }, (_, i) => row(i + 1, over(i)));

describe("scoreLessons", () => {
  it("passes ten participants who all give the message and the action with nothing unsafe", () => {
    const [s] = scoreLessons(many(10), RULE);
    expect(s).toMatchObject({ verdict: "pass", participants: 10, both: 10, unsafe: 0, reasons: [] });
  });

  it("is exactly at the line at 80 percent and under it at 70", () => {
    expect(scoreLessons(many(10, (i) => ({ recalledMessage: i >= 2 })), RULE)[0].verdict).toBe("pass");
    const low = scoreLessons(many(10, (i) => ({ namedAction: i >= 3 })), RULE)[0];
    expect(low.verdict).toBe("fail");
    expect(low.reasons.join(" ")).toMatch(/70 percent/);
  });

  it("needs both the message and the action from the same person", () => {
    // 5 people give only the message and 5 give only the action: every one of them has half of it.
    const rows = many(10, (i) => ({ recalledMessage: i < 5, namedAction: i >= 5 }));
    const [s] = scoreLessons(rows, RULE);
    expect(s).toMatchObject({ recalledMessage: 5, namedAction: 5, both: 0, verdict: "fail" });
  });

  it("fails on one unsafe misunderstanding, whatever the recall", () => {
    const [s] = scoreLessons(many(12, (i) => ({ unsafeMisunderstanding: i === 0 })), RULE);
    expect(s.verdict).toBe("fail");
    expect(s.reasons[0]).toMatch(/unsafe/);
  });

  it("says too few rather than pass when fewer than the minimum were tested, but still fails an unsafe one", () => {
    expect(scoreLessons(many(6), RULE)[0].verdict).toBe("too_few");
    expect(scoreLessons(many(3, (i) => ({ unsafeMisunderstanding: i === 0 })), RULE)[0].verdict).toBe("fail");
  });

  it("keeps lessons apart and counts a participant once", () => {
    const rows = [...many(10), ...many(10, () => ({ lesson: "BPC-02" })), row(1)];
    const scores = scoreLessons(rows, RULE);
    expect(scores.map((s) => `${s.lesson}/${s.participants}`)).toEqual(["BPC-01/10", "BPC-02/10"]);
  });

  it("lets a repeated row replace, never add to, the participant's earlier one", () => {
    const rows = [...many(10, (i) => ({ recalledMessage: i >= 3 })), ...many(10, (i) => ({ recalledMessage: i >= 3 }))];
    const [s] = scoreLessons(rows, RULE);
    expect(s).toMatchObject({ participants: 10, recalledMessage: 7, both: 7, verdict: "fail" });
    // the correction wins: a later row that fixes a typo changes the result
    const fixed = scoreLessons([...many(10, () => ({ recalledMessage: false })), ...many(10)], RULE)[0];
    expect(fixed.verdict).toBe("pass");
  });

  it("counts interviewer-read sessions so reading ability is visible in the result", () => {
    expect(scoreLessons(many(10, (i) => ({ interviewerRead: i < 4 })), RULE)[0].interviewerRead).toBe(4);
  });
});

describe("percentScore", () => {
  it("scores yes over applicable items and ignores not applicable", () => {
    expect(percentScore([true, true, false, null])).toBe(67);
    expect(percentScore([null, null])).toBeNull();
    expect(percentScore([])).toBeNull();
    expect(percentScore([true, true, true])).toBe(100);
  });
});

describe("parseSessionCsv", () => {
  const csv = [
    "# comment line",
    "participant,site,lesson,recalled_message,named_action,unsafe_misunderstanding,interviewer_read,hard_word,notes",
    'P1,Lagos,BPC-01,Y,Y,N,N,,"said ""fine"", then more"',
    "P2,Kano,BPC-01,yes,no,N,Y,pressure,",
  ].join("\n");

  it("reads the sheet, including quoted commas and case", () => {
    const rows = parseSessionCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ participant: "P1", lesson: "BPC-01", recalledMessage: true, namedAction: true, unsafeMisunderstanding: false });
    expect(rows[1]).toMatchObject({ participant: "P2", namedAction: false, interviewerRead: true });
  });

  it("fails loudly if a column is missing, so a bad sheet cannot score as a pass", () => {
    expect(() => parseSessionCsv("participant,lesson\nP1,BPC-01")).toThrow(/recalled_message/);
  });

  it("keeps a quoted note with a line break in one record", () => {
    const rows = parseSessionCsv('participant,lesson,recalled_message,named_action,unsafe_misunderstanding,interviewer_read,notes\nP1,BPC-01,Y,Y,N,N,"line one\nline two"\nP2,BPC-01,Y,N,N,N,');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ participant: "P2", namedAction: false });
  });

  it("returns nothing for an empty sheet", () => {
    expect(parseSessionCsv("")).toEqual([]);
  });
});
