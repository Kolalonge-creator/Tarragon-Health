import { editCounts, normalise, reportByLanguage, scoreSample } from "./wer";

describe("normalise", () => {
  it("lower-cases, drops punctuation and apostrophes, keeps digits", () => {
    expect(normalise("Don't take 500mg, twice-daily!")).toEqual(["dont", "take", "500mg", "twice", "daily"]);
  });
});

describe("editCounts", () => {
  it("is zero for identical text", () => {
    expect(editCounts(["a", "b"], ["a", "b"])).toEqual({ substitutions: 0, deletions: 0, insertions: 0 });
  });
  it("counts a substitution, a deletion and an insertion", () => {
    expect(editCounts(["a", "b", "c"], ["a", "x", "c"])).toEqual({ substitutions: 1, deletions: 0, insertions: 0 });
    expect(editCounts(["a", "b", "c"], ["a", "c"])).toEqual({ substitutions: 0, deletions: 1, insertions: 0 });
    expect(editCounts(["a", "c"], ["a", "b", "c"])).toEqual({ substitutions: 0, deletions: 0, insertions: 1 });
  });
  it("handles an empty reference and an empty hypothesis", () => {
    expect(editCounts([], ["a", "b"])).toEqual({ substitutions: 0, deletions: 0, insertions: 2 });
    expect(editCounts(["a", "b"], [])).toEqual({ substitutions: 0, deletions: 2, insertions: 0 });
  });
});

describe("scoreSample", () => {
  const base = { id: "s1", language: "pcm" };
  it("gives WER 0 for a perfect transcript", () => {
    expect(scoreSample({ ...base, reference: "I get headache", hypothesis: "i get headache" }).wer).toBe(0);
  });
  it("computes errors over reference words", () => {
    const r = scoreSample({ ...base, reference: "one two three four", hypothesis: "one two three" });
    expect(r.wer).toBe(0.25);
  });
  it("flags a dropped negation even when WER is small", () => {
    const r = scoreSample({ ...base, reference: "the patient does not have chest pain and no fever", hypothesis: "the patient does have chest pain and no fever" });
    expect(r.negationsInReference).toBe(2);
    expect(r.negationsDropped).toBe(1);
    expect(r.wer).toBeLessThan(0.2);
  });
  it("lists protected terms the transcript lost", () => {
    const r = scoreSample({ ...base, reference: "take amlodipine 5 mg daily", hypothesis: "take amlodipine 5 mg daily", protectedTerms: ["amlodipine", "5 mg"] });
    expect(r.protectedTermsMissed).toEqual([]);
    const bad = scoreSample({ ...base, reference: "take amlodipine 5 mg daily", hypothesis: "take amlodipin 10 mg daily", protectedTerms: ["amlodipine", "5 mg"] });
    expect(bad.protectedTermsMissed).toEqual(["amlodipine", "5 mg"]);
  });
  it("an empty reference with an empty transcript is 0 and with text is 1", () => {
    expect(scoreSample({ ...base, reference: "", hypothesis: "" }).wer).toBe(0);
    expect(scoreSample({ ...base, reference: "", hypothesis: "noise" }).wer).toBe(1);
  });
});

describe("negations in Pidgin", () => {
  it("does not treat the Pidgin copula 'na' as a negation, and does count 'neva'", () => {
    const keep = scoreSample({ id: "p1", language: "pcm", reference: "na headache I get", hypothesis: "headache I get" });
    expect(keep.negationsInReference).toBe(0);
    const never = scoreSample({ id: "p2", language: "pcm", reference: "I neva see doctor", hypothesis: "I see doctor" });
    expect(never.negationsInReference).toBe(1);
    expect(never.negationsDropped).toBe(1);
  });
});

describe("reportByLanguage", () => {
  it("pools errors over words per language, not the mean of rates", () => {
    const rows = [
      scoreSample({ id: "a", language: "pcm", reference: "a b c d e f g h i j", hypothesis: "a b c d e f g h i x" }),
      scoreSample({ id: "b", language: "pcm", reference: "a", hypothesis: "x" }),
      scoreSample({ id: "c", language: "en-NG", reference: "a b", hypothesis: "a b" }),
    ];
    const out = reportByLanguage(rows);
    expect(out.map((r) => r.language)).toEqual(["en-NG", "pcm"]);
    expect(out[1]?.wer).toBeCloseTo(2 / 11);
    expect(out[0]?.wer).toBe(0);
  });
});
