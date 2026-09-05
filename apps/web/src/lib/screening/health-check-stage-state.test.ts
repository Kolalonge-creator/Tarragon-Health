import { screeningStageState } from "./health-check-stage-state";

/**
 * These tests exist for one reason: the page must never tell a patient their
 * screenings are up to date on the strength of a count that only reads zero
 * because there is nothing to count. Every case below asserts the direction of
 * the failure, not the wording.
 */

describe("screeningStageState", () => {
  it("only claims 'up to date' when a real screening calendar exists and is clear", () => {
    const state = screeningStageState({ hasRiskAssessment: true, screeningsDue: 0 });
    expect(state.kind).toBe("done");
    expect(state.label).toBe("Up to date");
  });

  it("never claims 'up to date' for a patient with no risk assessment", () => {
    // No risk assessment means no screening_schedules rows, so the count is 0
    // for a patient who has never been screened in their life.
    const state = screeningStageState({ hasRiskAssessment: false, screeningsDue: 0 });
    expect(state.kind).toBe("neutral");
    expect(state.label).not.toMatch(/up to date/i);
  });

  it("never claims 'up to date' when the count did not come back", () => {
    for (const screeningsDue of [null, undefined]) {
      const state = screeningStageState({ hasRiskAssessment: true, screeningsDue });
      expect(state.kind).toBe("neutral");
      expect(state.label).not.toMatch(/up to date/i);
    }
  });

  it("a failed count is neutral even when the patient has a calendar", () => {
    // Belt and braces: hasRiskAssessment must not be able to rescue a null
    // count into a green tick.
    expect(screeningStageState({ hasRiskAssessment: true, screeningsDue: null }).kind).toBe(
      "neutral"
    );
    expect(screeningStageState({ hasRiskAssessment: false, screeningsDue: null }).kind).toBe(
      "neutral"
    );
  });

  it("counts outstanding screenings, singular and plural", () => {
    expect(screeningStageState({ hasRiskAssessment: true, screeningsDue: 1 })).toEqual({
      kind: "todo",
      label: "1 screening due, book now",
    });
    expect(screeningStageState({ hasRiskAssessment: true, screeningsDue: 3 })).toEqual({
      kind: "todo",
      label: "3 screenings due, book now",
    });
  });
});
