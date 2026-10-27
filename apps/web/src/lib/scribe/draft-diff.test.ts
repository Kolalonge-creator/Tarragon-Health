import { buildSignedDiff, diffWords, editRate, sectionChanged } from "./draft-diff";
import type { DraftFields } from "./draft-review";

const empty: DraftFields = { history: "", examination: "", assessment: "", plan: "", followUp: "", patientSummary: "" };

describe("diffWords", () => {
  it("an unchanged section is one equal run and no changes", () => {
    const d = diffWords("rest and fluids", "rest and fluids");
    expect(d).toEqual({ draft_words: 3, signed_words: 3, words_added: 0, words_removed: 0, ops: [{ op: "eq", n: 3 }] });
    expect(sectionChanged(d)).toBe(false);
  });

  it("counts an insertion and a replacement, and keeps equal runs as counts", () => {
    const d = diffWords("take rest and fluids today", "take bed rest and fluids today");
    expect(d.words_added).toBe(1);
    expect(d.words_removed).toBe(0);
    expect(d.ops).toEqual([{ op: "eq", n: 1 }, { op: "ins", text: "bed" }, { op: "eq", n: 4 }]);
    const r = diffWords("headache for two days", "headache for three days");
    expect(r.words_added).toBe(1);
    expect(r.words_removed).toBe(1);
    expect(r.ops.filter((o) => o.op !== "eq")).toHaveLength(2);
  });

  it("treats whitespace differences as no change", () => {
    expect(sectionChanged(diffWords("a  b\n c", "a b c"))).toBe(false);
  });

  it("an emptied section removes every word; a section written from nothing adds every word", () => {
    expect(diffWords("one two three", "")).toMatchObject({ words_removed: 3, words_added: 0 });
    expect(diffWords("", "one two")).toMatchObject({ words_removed: 0, words_added: 2 });
    expect(diffWords("", "")).toMatchObject({ words_removed: 0, words_added: 0, ops: [] });
  });

  it("a section over the limit is stored as one replacement, counted in full", () => {
    const d = diffWords("a b c d", "a b c e", 3);
    expect(d.ops).toEqual([{ op: "del", text: "a b c d" }, { op: "ins", text: "a b c e" }]);
    expect(d.words_removed).toBe(4);
    expect(d.words_added).toBe(4);
  });

  it("replaying the ops over the draft reproduces the signed text", () => {
    const before = "patient reports cough for three days with mild fever and no chest pain";
    const after = "patient reports dry cough for two days with fever and no chest pain or wheeze";
    const d = diffWords(before, after);
    const src = before.split(" ");
    let i = 0;
    const out: string[] = [];
    for (const op of d.ops) {
      if (op.op === "eq") {
        out.push(...src.slice(i, i + op.n));
        i += op.n;
      } else if (op.op === "del") i += op.text.split(" ").length;
      else out.push(...op.text.split(" "));
    }
    expect(out.join(" ")).toBe(after);
  });
});

describe("buildSignedDiff / editRate", () => {
  it("has all six sections", () => {
    const d = buildSignedDiff({ ...empty, plan: "rest" }, { ...empty, plan: "rest and fluids", followUp: "return if worse" });
    expect(Object.keys(d).sort()).toEqual(["assessment", "examination", "followUp", "history", "patientSummary", "plan"]);
    expect(d.plan.words_added).toBe(2);
    expect(d.followUp.words_added).toBe(3);
  });
  it("edit rate is counts in, bounded ratio out", () => {
    expect(editRate(0, 5)).toBe(0);
    expect(editRate(100, 25)).toBe(0.25);
    expect(editRate(10, 99)).toBe(1);
  });
});
