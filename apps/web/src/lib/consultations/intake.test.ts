import { describe, expect, it } from "@jest/globals";
import { cleanAnswers, INTAKE_ANSWER_KEYS, INTAKE_MAX_ANSWER_CHARS, INTAKE_MAX_REASON_CHARS, problemsBeforeSend } from "./intake";

describe("manual intake rules (S64, 15.3)", () => {
  it("a complete draft has no problems", () => {
    expect(problemsBeforeSend({ reason: "Headaches", duration: "few_days", answers: { allergies: "None" } })).toEqual([]);
  });
  it("sending needs a reason and a duration, but saving a half-done draft is not blocked here", () => {
    expect(problemsBeforeSend({ reason: "   ", duration: "", answers: {} })).toEqual(["reason_missing", "duration_missing"]);
  });
  it("refuses over-long text the database would refuse", () => {
    expect(problemsBeforeSend({ reason: "x".repeat(INTAKE_MAX_REASON_CHARS + 1), duration: "today", answers: {} })).toEqual(["reason_too_long"]);
    expect(problemsBeforeSend({ reason: "ok", duration: "today", answers: { main_worry: "y".repeat(INTAKE_MAX_ANSWER_CHARS + 1) } })).toEqual(["answer_too_long"]);
  });
  it("cleans answers: trims, drops blanks, keeps only known keys", () => {
    expect(cleanAnswers({ allergies: "  none ", main_worry: "   " })).toEqual({ allergies: "none" });
    expect(cleanAnswers({ bogus: "x" } as never)).toEqual({});
  });
  it("has the same answer keys as the database check", () => {
    expect([...INTAKE_ANSWER_KEYS].sort()).toEqual(["allergies", "main_worry", "medicines_now", "question_for_visit", "tried_so_far"]);
  });
});
