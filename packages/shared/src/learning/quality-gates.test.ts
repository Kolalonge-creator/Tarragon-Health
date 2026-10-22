import { describe, expect, it } from "@jest/globals";
import {
  READING_GRADE_VECTORS,
  bpLessonLevel,
  glucoseLessonLevel,
  checkReadingGrade,
  countSyllables,
  gatedReadingGrade,
  isPortionGuideBody,
  markTeachback,
  parsePortionGuide,
  parseRecordLessonConfig,
  portionAudienceFor,
  parseTeachback,
  portionFor,
  readingGrade,
  selectRecordLesson,
  splitByGlossary,
  type BandedReading,
  type LabItemInput,
  type RecordLessonConfig,
} from "./index";

describe("reading grade", () => {
  for (const v of READING_GRADE_VECTORS) {
    it(`golden vector: ${v.name}`, () => expect(readingGrade(v.text).grade).toBe(v.grade));
  }
  it("counts syllables with the vowel-group estimate", () => {
    expect(countSyllables("salt")).toBe(1);
    expect(countSyllables("tablet")).toBe(2);
    expect(countSyllables("pressure")).toBe(2);
    expect(countSyllables("hypertension")).toBe(4);
    expect(countSyllables("123")).toBe(0);
  });
  it("an apostrophe word is one word and numbers are not words", () => {
    const r = readingGrade("Don't worry. Your reading was 135 over 85.");
    expect(r.words).toBe(6);
    expect(r.sentences).toBe(2);
  });
  it("the gate blocks above the maximum unless a long enough reason is recorded", () => {
    const cfg = { max_grade: 8, min_override_reason_chars: 15 };
    expect(checkReadingGrade(7.9, cfg)).toEqual({ ok: true, grade: 7.9, overridden: false });
    expect(checkReadingGrade(8, cfg)).toEqual({ ok: true, grade: 8, overridden: false });
    expect(checkReadingGrade(8.1, cfg)).toEqual({ ok: false, grade: 8.1, reason: "too_hard" });
    expect(checkReadingGrade(12, cfg, "  ")).toEqual({ ok: false, grade: 12, reason: "too_hard" });
    expect(checkReadingGrade(12, cfg, "too short")).toEqual({ ok: false, grade: 12, reason: "override_reason_too_short" });
    expect(checkReadingGrade(12, cfg, "Drug name cannot be simplified")).toEqual({ ok: true, grade: 12, overridden: true });
  });
});

const NOW = "2026-10-22T10:00:00.000Z";
const cfg: RecordLessonConfig = {
  suppress_hours_after_urgent: 72,
  vitals: { sustained_readings: 3, window_days: 14 },
  lab: { sustained_results: 2 },
  lessons: {
    blood_pressure: { in_target: "bp-in", above_target: "bp-above" },
    glucose: { in_target: "gl-in", above_target: "gl-above" },
    lab: { hba1c: { normal: "lab-hba1c-normal", high: "lab-hba1c-high" } },
  },
};
const r = (id: string, daysAgo: number, level: BandedReading["level"]): BandedReading => ({
  id,
  takenAt: new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString(),
  level,
});
const lab = (id: string, resultId: string, daysAgo: number, flag: LabItemInput["flag"], extra: Partial<LabItemInput> = {}): LabItemInput => ({
  id,
  resultId,
  analyteCode: "hba1c",
  flag,
  sensitivePositive: false,
  releaseState: "released",
  receivedAt: new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString(),
  ...extra,
});
const empty = { now: NOW, bloodPressure: [], glucose: [], labItems: [] };

describe("record-triggered lesson selection", () => {
  it("shows an in-target lesson from a single green reading (the lowest band)", () => {
    const d = selectRecordLesson({ ...empty, bloodPressure: [r("a", 0, "green")] }, cfg);
    expect(d).toMatchObject({ kind: "lesson", band: "in_target", lessonCode: "bp-in", sourceIds: ["a"] });
  });
  it("never shows an above-target lesson from one amber reading", () => {
    expect(selectRecordLesson({ ...empty, bloodPressure: [r("a", 0, "amber")] }, cfg)).toEqual({ kind: "none", reason: "not_sustained" });
    expect(selectRecordLesson({ ...empty, glucose: [r("a", 0, "amber"), r("b", 1, "amber")] }, cfg)).toEqual({ kind: "none", reason: "not_sustained" });
  });
  it("shows the above-target lesson once the amber pattern is sustained inside the window", () => {
    const d = selectRecordLesson({ ...empty, bloodPressure: [r("a", 0, "amber"), r("b", 3, "amber"), r("c", 9, "amber")] }, cfg);
    expect(d).toMatchObject({ kind: "lesson", band: "above_target", lessonCode: "bp-above", sourceIds: ["a", "b", "c"] });
  });
  it("amber readings older than the window do not count", () => {
    const d = selectRecordLesson({ ...empty, bloodPressure: [r("a", 0, "amber"), r("b", 3, "amber"), r("c", 20, "amber")] }, cfg);
    expect(d.kind).toBe("none");
  });
  it("a red or emergency latest reading is urgent and never a lesson", () => {
    for (const level of ["red", "emergency"] as const) {
      expect(selectRecordLesson({ ...empty, bloodPressure: [r("a", 0, level), r("b", 1, "green")] }, cfg)).toEqual({ kind: "urgent", source: "blood_pressure", sourceId: "a" });
    }
  });
  it("a red reading inside the suppression window blocks a later green lesson; after the window it does not", () => {
    expect(selectRecordLesson({ ...empty, bloodPressure: [r("g", 0, "green"), r("x", 1, "red")] }, cfg).kind).toBe("urgent");
    expect(selectRecordLesson({ ...empty, bloodPressure: [r("g", 0, "green"), r("x", 4, "red")] }, cfg).kind).toBe("lesson");
  });
  it("urgent in one source outranks a lesson in another", () => {
    const d = selectRecordLesson({ ...empty, bloodPressure: [r("g", 0, "green")], glucose: [r("x", 0, "emergency")] }, cfg);
    expect(d).toEqual({ kind: "urgent", source: "glucose", sourceId: "x" });
  });
  it("unknown levels are ignored", () => {
    expect(selectRecordLesson({ ...empty, bloodPressure: [r("a", 0, "unknown")] }, cfg)).toEqual({ kind: "none", reason: "no_data" });
  });
  it("no configured lesson code means no lesson", () => {
    const bare: RecordLessonConfig = { ...cfg, lessons: { blood_pressure: {}, glucose: {}, lab: {} } };
    expect(selectRecordLesson({ ...empty, bloodPressure: [r("a", 0, "green")] }, bare)).toEqual({ kind: "none", reason: "no_lesson_configured" });
  });
  it("picks the most recent source when two have a lesson", () => {
    const d = selectRecordLesson({ ...empty, bloodPressure: [r("a", 2, "green")], glucose: [r("b", 0, "green")] }, cfg);
    expect(d).toMatchObject({ source: "glucose", lessonCode: "gl-in" });
  });

  describe("labs", () => {
    it("a single normal released value may show a lesson", () => {
      expect(selectRecordLesson({ ...empty, labItems: [lab("l1", "r1", 1, "normal")] }, cfg)).toMatchObject({ kind: "lesson", source: "lab", band: "normal", lessonCode: "lab-hba1c-normal" });
    });
    it("one high value alone never produces a lesson; two successive highs do", () => {
      expect(selectRecordLesson({ ...empty, labItems: [lab("l1", "r1", 1, "high")] }, cfg)).toEqual({ kind: "none", reason: "not_sustained" });
      expect(selectRecordLesson({ ...empty, labItems: [lab("l1", "r1", 1, "high"), lab("l2", "r2", 90, "high")] }, cfg)).toMatchObject({ kind: "lesson", band: "high", lessonCode: "lab-hba1c-high", sourceIds: ["l1", "l2"] });
      expect(selectRecordLesson({ ...empty, labItems: [lab("l1", "r1", 1, "high"), lab("l2", "r2", 90, "normal")] }, cfg).kind).toBe("none");
    });
    it("a critical value is urgent, never a lesson", () => {
      expect(selectRecordLesson({ ...empty, labItems: [lab("l1", "r1", 1, "critical")] }, cfg)).toEqual({ kind: "urgent", source: "lab", sourceId: "l1" });
    });
    it("an unreleased result is never used (INV-03)", () => {
      expect(selectRecordLesson({ ...empty, labItems: [lab("l1", "r1", 1, "normal", { releaseState: "awaiting_review" })] }, cfg)).toEqual({ kind: "none", reason: "no_data" });
    });
    it("a result holding a sensitive positive is dropped whole, even its normal items (INV-04)", () => {
      const items = [lab("l1", "r1", 1, "normal"), { ...lab("l2", "r1", 1, "positive"), analyteCode: "hiv", sensitivePositive: true }];
      expect(selectRecordLesson({ ...empty, labItems: items }, cfg)).toEqual({ kind: "none", reason: "no_data" });
    });
    it("a qualitative positive or negative is never a trigger", () => {
      expect(selectRecordLesson({ ...empty, labItems: [lab("l1", "r1", 1, "negative"), lab("l2", "r2", 2, "positive")] }, cfg)).toEqual({ kind: "none", reason: "no_data" });
    });
  });
});

describe("glossary matching", () => {
  const terms = [
    { term: "hypertension", definition: "High blood pressure.", aliases: ["high blood pressure"] },
    { term: "systolic", definition: "The top number." },
    { term: "HbA1c", definition: "Your average sugar over about three months." },
  ];
  it("marks a term once, case-insensitively, whole words only", () => {
    const segs = splitByGlossary("Systolic is the top number. Another systolic mention. Antisystolic is not a word.", terms);
    expect(segs.filter((s) => s.term).map((s) => s.text)).toEqual(["Systolic"]);
    expect(segs.map((s) => s.text).join("")).toBe("Systolic is the top number. Another systolic mention. Antisystolic is not a word.");
  });
  it("finds an alias and resolves it to the term", () => {
    const segs = splitByGlossary("You have high blood pressure today.", terms);
    expect(segs.find((s) => s.term)?.term?.term).toBe("hypertension");
  });
  it("handles digits in a term and special characters", () => {
    expect(splitByGlossary("Your HbA1c is due.", terms).find((s) => s.term)?.text).toBe("HbA1c");
  });
  it("returns plain text when there are no terms", () => {
    expect(splitByGlossary("Hello", [])).toEqual([{ text: "Hello" }]);
    expect(splitByGlossary("", terms)).toEqual([]);
  });
});

describe("gated reading grade", () => {
  it("does not gate a text too short to be a sentence, and gates a longer one in full", () => {
    expect(gatedReadingGrade("Teaser")).toBe(0);
    expect(gatedReadingGrade("Hypertension is a long term condition")).toBe(readingGrade("Hypertension is a long term condition").grade);
    expect(gatedReadingGrade("Hypertension is a long term condition")).toBeGreaterThan(8);
    expect(gatedReadingGrade("Hypertension pharmacotherapy")).toBe(0);
    expect(gatedReadingGrade("Hypertension is a chronic cardiovascular condition characterised by persistently elevated arterial pressure.")).toBe(21.5);
  });
});

describe("portion guide format", () => {
  const body = ["Use your own hand.", "", "[portion swallow fist] Pounded yam, eba", "Eat it with soup.", "More tip.", "", "[portion fruit cupped_hand] Fruit", "", "Last note."].join("\n");
  it("parses intro, foods, tips and notes", () => {
    const p = parsePortionGuide(body);
    expect(p.intro).toEqual(["Use your own hand."]);
    expect(p.foods).toEqual([
      { ref: "swallow", hand: "fist", name: "Pounded yam, eba", tip: "Eat it with soup. More tip." },
      { ref: "fruit", hand: "cupped_hand", name: "Fruit", tip: "" },
    ]);
    expect(p.notes).toEqual(["Last note."]);
    expect(isPortionGuideBody(body)).toBe(true);
  });
  it("an unknown hand is not a food line, so the body still reads as text", () => {
    expect(isPortionGuideBody("[portion swallow elbow] Yam")).toBe(false);
  });
  it("a long hostile line finishes fast and is not a food line", () => {
    const hostile = ["[portion 0 _]" + " ".repeat(200000) + "x", "[portion " + " ".repeat(200000), "[portion a" + "_".repeat(200000), "[portion " + "0 ".repeat(100000)].join("\n");
    const start = Date.now();
    expect(isPortionGuideBody(hostile)).toBe(false);
    const parsed = parsePortionGuide(hostile);
    expect(parsed.foods).toEqual([]);
    expect(Date.now() - start).toBeLessThan(1000);
  });
  it("accepts extra spacing and tabs around the marker parts", () => {
    const p = parsePortionGuide("[portion   a1\tfist]    Rice  ");
    expect(p.foods).toEqual([{ ref: "a1", hand: "fist", name: "Rice", tip: "" }]);
  });
  it("amounts come only from the config", () => {
    const c = { portions: { swallow: { diabetes: { amount: 1, unit: "fist", per: "meal" as const } } } };
    expect(portionFor(c, "swallow", "diabetes")).toEqual({ amount: 1, unit: "fist", per: "meal" });
    expect(portionFor(c, "swallow", "blood_pressure")).toBeNull();
    expect(portionFor(c, "rice", "diabetes")).toBeNull();
  });
});

describe("teach-back", () => {
  const limits = { min_questions: 1, max_questions: 3, min_options: 2, max_options: 4 };
  const q = { question: "Which number is on top?", options: ["Systolic", "Diastolic"], answer_index: 0, explanation: "The top number is systolic." };
  it("accepts one to three well-formed questions", () => {
    expect(parseTeachback([q], limits)).toHaveLength(1);
    expect(parseTeachback([q, q, q], limits)).toHaveLength(3);
  });
  it("rejects none, four, bad options, a bad answer index or a missing explanation", () => {
    expect(parseTeachback([], limits)).toBeNull();
    expect(parseTeachback([q, q, q, q], limits)).toBeNull();
    expect(parseTeachback([{ ...q, options: ["Only one"] }], limits)).toBeNull();
    expect(parseTeachback([{ ...q, answer_index: 5 }], limits)).toBeNull();
    expect(parseTeachback([{ ...q, explanation: " " }], limits)).toBeNull();
    expect(parseTeachback(null, limits)).toBeNull();
  });
  it("marks answers and always carries the kind explanation", () => {
    const marks = markTeachback([q, q], [1, 0]);
    expect(marks.map((m) => m.correct)).toEqual([false, true]);
    expect(marks[0]).toMatchObject({ correctIndex: 0, explanation: "The top number is systolic." });
    expect(markTeachback([q], [null])[0]?.correct).toBe(false);
  });
});

describe("record lesson configuration parsing", () => {
  it("accepts the shape of the versioned row and drops empty lesson codes", () => {
    const parsed = parseRecordLessonConfig({
      suppress_hours_after_urgent: 72,
      vitals: { sustained_readings: 3, window_days: 14 },
      lab: { sustained_results: 2 },
      lessons: { blood_pressure: { in_target: "a", above_target: "" }, glucose: {}, lab: { hba1c: { normal: "n", high: "h" } } },
    });
    expect(parsed?.lessons.blood_pressure).toEqual({ in_target: "a", above_target: undefined });
    expect(parsed?.lessons.lab.hba1c).toEqual({ normal: "n", high: "h", low: undefined });
  });
  it("rejects a malformed row, so no lesson is shown on a bad configuration", () => {
    expect(parseRecordLessonConfig(null)).toBeNull();
    expect(parseRecordLessonConfig({})).toBeNull();
    expect(parseRecordLessonConfig({ suppress_hours_after_urgent: 0, vitals: { sustained_readings: 3, window_days: 14 }, lab: { sustained_results: 2 }, lessons: {} })).toBeNull();
    expect(parseRecordLessonConfig({ suppress_hours_after_urgent: 72, vitals: { sustained_readings: "3", window_days: 14 }, lab: { sustained_results: 2 }, lessons: {} })).toBeNull();
  });
});

describe("portion audience", () => {
  it("is decided by the item's own category or condition", () => {
    expect(portionAudienceFor("diabetes", null)).toBe("diabetes");
    expect(portionAudienceFor("nutrition", "diabetes")).toBe("diabetes");
    expect(portionAudienceFor("hypertension", "hypertension")).toBe("blood_pressure");
  });
});

describe("review fixes: urgent window, lesson levels", () => {
  it("a red latest reading older than the suppression window no longer shows the urgent box, and still never yields a lesson", () => {
    const d = selectRecordLesson({ ...empty, bloodPressure: [r("x", 5, "red"), r("a", 6, "amber"), r("b", 7, "amber"), r("c", 8, "amber")] }, cfg);
    expect(d.kind).toBe("none");
  });
  it("a critical lab older than the window is not urgent forever, and its analyte shows no lesson", () => {
    expect(selectRecordLesson({ ...empty, labItems: [lab("l1", "r1", 30, "critical")] }, cfg)).toEqual({ kind: "none", reason: "no_data" });
    expect(selectRecordLesson({ ...empty, labItems: [lab("l1", "r1", 1, "critical")] }, cfg).kind).toBe("urgent");
  });
  it("a very low blood pressure is not 'in a good range' and a glucose reading is never in range for a lesson", () => {
    expect(bpLessonLevel("green", 75, 45)).toBe("unknown");
    expect(bpLessonLevel("green", 118, 76)).toBe("green");
    expect(bpLessonLevel("amber", 142, 90)).toBe("amber");
    expect(glucoseLessonLevel("green")).toBe("unknown");
    expect(glucoseLessonLevel("amber")).toBe("unknown");
    expect(glucoseLessonLevel("red")).toBe("red");
    expect(glucoseLessonLevel("emergency")).toBe("emergency");
    // urgent glucose still outranks a BP lesson
    expect(selectRecordLesson({ ...empty, bloodPressure: [r("g", 0, "green")], glucose: [r("x", 0, glucoseLessonLevel("emergency"))] }, cfg).kind).toBe("urgent");
  });
});

describe("review fix: glossary on an engine without lookbehind", () => {
  it("returns the plain text instead of throwing", () => {
    const Real = RegExp;
    const Fake = function (src: string | RegExp, flags?: string) {
      if (typeof src === "string" && src.includes("(?<!")) throw new SyntaxError("Invalid regular expression: invalid group specifier name");
      return new Real(src, flags);
    } as unknown as RegExpConstructor;
    (globalThis as { RegExp: RegExpConstructor }).RegExp = Fake;
    try {
      expect(splitByGlossary("Your blood pressure is fine", [{ term: "blood pressure", definition: "The force of blood in your arteries" }])).toEqual([{ text: "Your blood pressure is fine" }]);
    } finally {
      (globalThis as { RegExp: RegExpConstructor }).RegExp = Real;
    }
  });
});
