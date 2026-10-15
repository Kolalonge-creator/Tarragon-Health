import { describe, expect, it } from "@jest/globals";
import { AUDITC_QUESTIONS, EPDS_QUESTIONS, GAD7_QUESTIONS, PHQ9_QUESTIONS } from "./mental-health-screen";

/** Regression (S56): the questionnaire copy carried em dashes, which the copy rules forbid. */
describe("questionnaire copy", () => {
  it("has no em dash", () => {
    const strings = [
      ...PHQ9_QUESTIONS,
      ...GAD7_QUESTIONS,
      ...EPDS_QUESTIONS.flatMap((q) => [q.prompt, ...q.options]),
      ...AUDITC_QUESTIONS.flatMap((q) => [q.prompt, ...q.options]),
    ];
    expect(strings.filter((s) => s.includes("—"))).toEqual([]);
  });
});
