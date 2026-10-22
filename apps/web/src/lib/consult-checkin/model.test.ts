import { allAnswered, answerInputSchema, checkinViewSchema, clinicianCheckinsSchema, offsetLabel } from "./model";

const view = {
  id: "11111111-1111-4111-8111-111111111111",
  state: "open" as const,
  offset_code: "h48",
  due_at: "2026-10-18T10:00:00Z",
  title: "A quick check-in after your visit",
  intro: "A few short questions.",
  free_text_max_chars: 500,
  questions: [
    { id: "feeling", text: "How are you feeling?", options: [{ code: "better", label: "Better" }, { code: "worse", label: "Worse" }] },
    { id: "unclear", text: "Anything unclear?", options: [{ code: "no", label: "No" }, { code: "yes", label: "Yes" }] },
  ],
  outcome: null,
};

describe("check-in model", () => {
  it("parses the view the database returns", () => {
    expect(checkinViewSchema.safeParse(view).success).toBe(true);
  });

  it("rejects a view with a missing question list instead of rendering an empty form", () => {
    expect(checkinViewSchema.safeParse({ ...view, questions: [] }).success).toBe(false);
  });

  it("allAnswered needs a valid option for every question", () => {
    expect(allAnswered(view, {})).toBe(false);
    expect(allAnswered(view, { feeling: "better" })).toBe(false);
    expect(allAnswered(view, { feeling: "better", unclear: "maybe" })).toBe(false);
    expect(allAnswered(view, { feeling: "better", unclear: "no" })).toBe(true);
  });

  it("answer input must carry a uuid and bounded text", () => {
    expect(answerInputSchema.safeParse({ checkinId: "x", answers: {} }).success).toBe(false);
    expect(answerInputSchema.safeParse({ checkinId: view.id, answers: { feeling: "better" }, note: "a".repeat(2001) }).success).toBe(false);
    expect(answerInputSchema.safeParse({ checkinId: view.id, answers: { feeling: "better" }, note: "fine" }).success).toBe(true);
  });

  it("labels the two offsets and shows an unknown code as it is", () => {
    expect(offsetLabel("h48")).toBe("48 hour check-in");
    expect(offsetLabel("d7")).toBe("7 day check-in");
    expect(offsetLabel("x9")).toBe("x9 check-in");
  });

  it("parses the clinician list including an unanswered row", () => {
    const rows = [{ id: view.id, offset_code: "d7", state: "open", due_at: view.due_at, answered_at: null, red_flag: false, answers: null, free_text: null }];
    expect(clinicianCheckinsSchema.safeParse(rows).success).toBe(true);
  });
});
