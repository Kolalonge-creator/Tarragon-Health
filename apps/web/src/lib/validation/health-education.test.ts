import {
  parseKnowledgeCheck,
  scoreKnowledgeCheck,
  statusFromCheck,
} from "./health-education";

const twoQuestions = [
  { question: "Q1", options: ["a", "b", "c"], answer_index: 0 },
  { question: "Q2", options: ["a", "b"], answer_index: 1 },
];

describe("parseKnowledgeCheck", () => {
  it("parses a well-formed check", () => {
    expect(parseKnowledgeCheck(twoQuestions)).toHaveLength(2);
  });

  it("returns null for non-array / empty / malformed input", () => {
    expect(parseKnowledgeCheck(null)).toBeNull();
    expect(parseKnowledgeCheck([])).toBeNull();
    expect(parseKnowledgeCheck("nope")).toBeNull();
    expect(parseKnowledgeCheck([{ question: "x" }])).toBeNull();
    expect(parseKnowledgeCheck([{ question: "x", options: ["only-one"], answer_index: 0 }])).toBeNull();
  });

  it("drops a question whose answer_index is out of range, keeping valid ones", () => {
    const parsed = parseKnowledgeCheck([
      { question: "ok", options: ["a", "b"], answer_index: 1 },
      { question: "bad", options: ["a", "b"], answer_index: 5 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].question).toBe("ok");
  });
});

describe("scoreKnowledgeCheck", () => {
  it("scores all correct", () => {
    const r = scoreKnowledgeCheck(twoQuestions, [0, 1]);
    expect(r).toEqual({ score: 2, total: 2, allCorrect: true });
    expect(statusFromCheck(r)).toBe("understood");
  });

  it("scores partial as needs_review", () => {
    const r = scoreKnowledgeCheck(twoQuestions, [0, 0]);
    expect(r).toEqual({ score: 1, total: 2, allCorrect: false });
    expect(statusFromCheck(r)).toBe("needs_review");
  });

  it("treats unanswered questions as wrong", () => {
    const r = scoreKnowledgeCheck(twoQuestions, [0]);
    expect(r).toEqual({ score: 1, total: 2, allCorrect: false });
  });

  it("never reports allCorrect for an empty question set", () => {
    const r = scoreKnowledgeCheck([], []);
    expect(r.allCorrect).toBe(false);
  });
});
