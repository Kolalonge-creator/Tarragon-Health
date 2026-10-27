import { describe, expect, it } from "@jest/globals";
import { emptyDiaryRow, type DiaryDraftRow } from "./diary-import";
import { applySaveAnswer, isBlankRow, summarise, type SaveAnswer } from "./diary-sheet";

const NOW = Date.UTC(2026, 9, 20, 13, 0);
const bp = (key: string, over: Partial<DiaryDraftRow> = {}): DiaryDraftRow => emptyDiaryRow(key, "blood_pressure", { date: "2026-10-18", time: "08:30", systolic: "132", diastolic: "84", ...over });

describe("summarise", () => {
  it("a fresh blank row is nothing: it is neither ready nor broken", () => {
    const s = summarise([emptyDiaryRow("a")], NOW);
    expect(s).toMatchObject({ ready: [], blocked: [], unconfirmed: 0, tooMany: false });
    expect(isBlankRow(emptyDiaryRow("a"))).toBe(true);
  });
  it("a complete typed row is ready", () => {
    expect(summarise([bp("a")], NOW).ready.map((r) => r.key)).toEqual(["a"]);
  });
  it("a complete SUGGESTED row waits for the person's check: it is counted as unconfirmed, not broken, and never ready", () => {
    const s = summarise([bp("a", { suggested: true, confirmed: false })], NOW);
    expect(s.ready).toEqual([]);
    expect(s.blocked).toEqual([]);
    expect(s.unconfirmed).toBe(1);
  });
  it("a checked suggested row is ready", () => {
    expect(summarise([bp("a", { suggested: true, confirmed: true })], NOW).ready).toHaveLength(1);
  });
  it("a row with something to change says what, in the order the rows appear", () => {
    const s = summarise([bp("a", { date: "2026-08-01" }), bp("b", { systolic: "80", diastolic: "130" })], NOW);
    expect(s.blocked).toEqual([
      { key: "a", problems: ["date_too_old"] },
      { key: "b", problems: ["systolic_not_above_diastolic"] },
    ]);
  });
  it("an unconfirmed suggestion that also has a problem is shown as broken (the person must fix it AND check it)", () => {
    const s = summarise([bp("a", { suggested: true, confirmed: false, time: "" })], NOW);
    expect(s.blocked).toEqual([{ key: "a", problems: ["time_missing"] }]);
    expect(s.unconfirmed).toBe(1);
  });
  it("more ready rows than one save may carry is flagged", () => {
    const rows = Array.from({ length: 21 }, (_, i) => bp(`r${i}`));
    expect(summarise(rows, NOW).tooMany).toBe(true);
  });
});

describe("applySaveAnswer: nothing the person typed is lost by a failed save", () => {
  const rows = [bp("a"), bp("b"), bp("c"), bp("d")];
  const sent = new Set(["a", "b", "c", "d"]);

  it("removes only the rows the server says are in the record", () => {
    const answer: SaveAnswer = {
      status: "done",
      results: [
        { key: "a", status: "saved" },
        { key: "b", status: "duplicate" },
        { key: "c", status: "held" },
        { key: "d", status: "failed" },
      ],
    };
    const out = applySaveAnswer(rows, sent, answer);
    expect(out.rows.map((r) => r.key)).toEqual(["c", "d"]);
    expect(out.saved).toBe(2);
    expect(out.matched).toBe(0);
    expect(out.notSaved).toBe(2);
    expect(out.feedback).toEqual({ c: { kind: "held" }, d: { kind: "failed" } });
  });

  it("a row the server did not mention is NOT assumed saved: it stays, as a failure to retry", () => {
    const out = applySaveAnswer(rows, sent, { status: "done", results: [{ key: "a", status: "saved" }] });
    expect(out.rows.map((r) => r.key)).toEqual(["b", "c", "d"]);
    expect(out.feedback).toEqual({ b: { kind: "failed" }, c: { kind: "failed" }, d: { kind: "failed" } });
    expect(out.notSaved).toBe(3);
  });

  it("a refused row keeps its reasons; a closed guard says so", () => {
    const out = applySaveAnswer(rows, sent, {
      status: "done",
      results: [
        { key: "a", status: "refused", problems: ["date_too_old"] },
        { key: "b", status: "refused", closed: true },
        { key: "c", status: "held" },
        { key: "d", status: "refused" },
      ],
    });
    expect(out.rows).toHaveLength(4);
    expect(out.feedback).toEqual({ a: { kind: "problems", problems: ["date_too_old"] }, b: { kind: "closed" }, c: { kind: "held" }, d: { kind: "failed" } });
    expect(out.saved).toBe(0);
  });

  it("a row that matched a reading already in the record leaves the sheet (retrying would only say so again), and is counted apart", () => {
    const out = applySaveAnswer(rows, sent, {
      status: "done",
      results: [
        { key: "a", status: "saved" },
        { key: "b", status: "merged" },
        { key: "c", status: "failed" },
        { key: "d", status: "duplicate" },
      ],
    });
    expect(out.rows.map((r) => r.key)).toEqual(["c"]);
    expect(out.saved).toBe(2);
    expect(out.matched).toBe(1);
    expect(out.notSaved).toBe(1);
    expect(out.feedback).toEqual({ c: { kind: "failed" } });
  });
});
