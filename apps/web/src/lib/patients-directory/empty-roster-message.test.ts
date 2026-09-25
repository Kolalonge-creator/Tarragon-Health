import { describe, expect, it } from "@jest/globals";
import { emptyRosterMessage } from "./empty-roster-message";

/**
 * Regression test for the bug this function's own header comment
 * documents: before this fix, the clinician-directory empty state picked
 * exactly one of filter/condition/q to blame, in a fixed priority order —
 * a name or condition search that matched nothing on a tab that genuinely
 * had patients rendered that tab's own EMPTY_STATE line ("No patients are
 * assigned to you on the care team yet...") instead, falsely claiming the
 * whole tab was empty rather than that the search just didn't match.
 */
describe("emptyRosterMessage", () => {
  it("blames the search, not the tab, when q matches nothing on a non-empty tab", () => {
    const message = emptyRosterMessage({
      filter: "mine",
      filterAloneEmpty: false,
      condition: undefined,
      q: "Zzzz",
    });
    expect(message).toContain("Zzzz");
    expect(message).not.toContain("assigned to you");
  });

  it("blames the search, not the tab, when condition matches nothing on a non-empty tab", () => {
    const message = emptyRosterMessage({
      filter: "mine",
      filterAloneEmpty: false,
      condition: "some rare condition",
      q: undefined,
    });
    expect(message).toContain("some rare condition");
    expect(message).not.toContain("assigned to you");
  });

  it("names both q and condition when both are active and neither matches", () => {
    const message = emptyRosterMessage({
      filter: undefined,
      filterAloneEmpty: false,
      condition: "diabetes",
      q: "Adaeze",
    });
    expect(message).toContain("Adaeze");
    expect(message).toContain("diabetes");
  });

  it("shows the tab's own EMPTY_STATE line when the tab itself has zero patients, ignoring an unevaluated condition search", () => {
    const message = emptyRosterMessage({
      filter: "mine",
      filterAloneEmpty: true,
      condition: "diabetes",
      q: undefined,
    });
    expect(message).toContain("assigned to you");
    expect(message).not.toContain("diabetes");
  });

  it("falls back to the plain enrolment message with nothing active", () => {
    expect(
      emptyRosterMessage({ filter: undefined, filterAloneEmpty: false, condition: undefined, q: undefined })
    ).toBe("No patients enrolled yet.");
  });
});
