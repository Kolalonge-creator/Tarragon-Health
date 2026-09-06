import { countStageState, screeningStageState } from "./health-check-stage-state";

/**
 * These tests exist for one reason: the page must never tell a patient
 * something about their check on the strength of a read that did not come
 * back. Every case below asserts the direction of the failure, not the
 * wording.
 */

describe("screeningStageState", () => {
  it("only claims 'up to date' when a real screening calendar exists and is clear", () => {
    const state = screeningStageState({ riskCount: 1, screeningsDue: 0 });
    expect(state.kind).toBe("done");
    expect(state.label).toBe("Up to date");
  });

  it("never claims 'up to date' for a patient with no risk assessment", () => {
    // No risk assessment means no screening_schedules rows, so the count is 0
    // for a patient who has never been screened in their life.
    const state = screeningStageState({ riskCount: 0, screeningsDue: 0 });
    expect(state.kind).toBe("neutral");
    expect(state.label).not.toMatch(/up to date/i);
  });

  it("never claims 'up to date' when the count did not come back", () => {
    for (const screeningsDue of [null, undefined]) {
      const state = screeningStageState({ riskCount: 1, screeningsDue });
      expect(state.kind).toBe("neutral");
      expect(state.label).not.toMatch(/up to date/i);
    }
  });

  it("a failed count is neutral even when the patient has a calendar", () => {
    // Belt and braces: a known risk assessment must not be able to rescue a
    // null count into a green tick.
    expect(screeningStageState({ riskCount: 1, screeningsDue: null }).kind).toBe("neutral");
    expect(screeningStageState({ riskCount: 0, screeningsDue: null }).kind).toBe("neutral");
  });

  it("does not blame the patient's health profile when the risk count failed", () => {
    // A null riskCount used to collapse into "no risk assessment", which told
    // a patient who finished their profile months ago to go and finish it.
    for (const riskCount of [null, undefined]) {
      const state = screeningStageState({ riskCount, screeningsDue: 0 });
      expect(state.kind).toBe("neutral");
      expect(state.label).not.toMatch(/finish your health profile/i);
      expect(state.label).toMatch(/could not check/i);
    }
  });

  it("counts outstanding screenings, singular and plural", () => {
    expect(screeningStageState({ riskCount: 1, screeningsDue: 1 })).toEqual({
      kind: "todo",
      label: "1 screening due, book now",
    });
    expect(screeningStageState({ riskCount: 1, screeningsDue: 3 })).toEqual({
      kind: "todo",
      label: "3 screenings due, book now",
    });
  });
});

describe("countStageState", () => {
  const labels = {
    doneLabel: "Completed",
    todoLabel: "Tell us your history and lifestyle",
    unknownLabel: "We could not check your health profile just now. Please refresh and try again.",
  };

  it("is done when the count is positive and to-do when it is zero", () => {
    expect(countStageState({ count: 2, ...labels })).toEqual({ kind: "done", label: labels.doneLabel });
    expect(countStageState({ count: 0, ...labels })).toEqual({ kind: "todo", label: labels.todoLabel });
  });

  it("is neutral, never to-do, when the count did not come back", () => {
    for (const count of [null, undefined]) {
      const state = countStageState({ count, ...labels });
      expect(state.kind).toBe("neutral");
      expect(state.label).toBe(labels.unknownLabel);
    }
  });
});
