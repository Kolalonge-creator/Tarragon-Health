import { describe, expect, it, jest } from "@jest/globals";

jest.mock("./supabase", () => ({ supabase: {} }));

import { AUDITC_QUESTIONS, EPDS_QUESTIONS, GAD7_QUESTIONS, PHQ9_QUESTIONS } from "./mental-health";

/** Regression (S56): the questionnaire copy carried em dashes, which the copy rules forbid. */
describe("questionnaire copy", () => {
  const strings = [
    ...PHQ9_QUESTIONS,
    ...GAD7_QUESTIONS,
    ...EPDS_QUESTIONS.flatMap((q) => [q.prompt, ...q.options]),
    ...AUDITC_QUESTIONS.flatMap((q) => [q.prompt, ...q.options]),
  ];
  it("has no em dash", () => {
    expect(strings.filter((s) => s.includes("—"))).toEqual([]);
  });
  it("keeps the self-harm items last (the crisis route depends on their position)", () => {
    expect(PHQ9_QUESTIONS).toHaveLength(9);
    expect(PHQ9_QUESTIONS[8]).toMatch(/hurting yourself/);
    expect(EPDS_QUESTIONS[9]?.prompt).toMatch(/harming myself/);
  });
});
