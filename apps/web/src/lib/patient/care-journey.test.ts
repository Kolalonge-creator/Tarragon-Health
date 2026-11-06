import { describe, expect, it } from "@jest/globals";
import { buildCareJourney, JOURNEY_STATE_LABEL, type JourneyFacts } from "./care-journey";

const member: JourneyFacts = {
  isMember: true,
  assessmentDone: true,
  baselineState: "submitted",
  carePlanActive: false,
  openTestCount: 2,
  resultedTestCount: 0,
  resultsAwaitingDoctor: 1,
  resultsReviewed: 0,
  recentReading: true,
  anyReading: true,
};

const byId = (f: JourneyFacts) => Object.fromEntries(buildCareJourney(f).map((s) => [s.id, s]));

describe("buildCareJourney", () => {
  it("always returns the six stages in order", () => {
    expect(buildCareJourney(member).map((s) => s.id)).toEqual(["assessment", "review", "plan", "tests", "results", "monitoring"]);
  });

  it("reads each stage from its fact for a Member", () => {
    const s = byId(member);
    expect(s.assessment!.state).toBe("done");
    expect(s.review!.state).toBe("care_team");
    expect(s.plan!.state).toBe("not_started");
    expect(s.tests!.state).toBe("in_progress");
    expect(s.tests!.detail).toBe("2 tests in progress.");
    expect(s.results!.state).toBe("care_team");
    expect(s.results!.detail).toBe("1 result waiting for a doctor.");
    expect(s.monitoring!.state).toBe("in_progress");
  });

  it("shows the doctor stages as part of Membership on Free, whatever the facts say (PD-03)", () => {
    const s = byId({ ...member, isMember: false, baselineState: "authorised", carePlanActive: true, resultsReviewed: 3 });
    for (const id of ["review", "plan", "results"]) {
      expect(s[id]!.state).toBe("membership");
      expect(s[id]!.href).toBe("/patient/membership");
    }
    // The self-service stages still read the record.
    expect(s.assessment!.state).toBe("done");
    expect(s.tests!.state).toBe("in_progress");
    expect(s.monitoring!.state).toBe("in_progress");
  });

  it("never turns a failed read into 'not started' or 'done'", () => {
    const failed: JourneyFacts = {
      isMember: true,
      assessmentDone: null,
      baselineState: null,
      carePlanActive: null,
      openTestCount: null,
      resultedTestCount: 0,
      resultsAwaitingDoctor: 0,
      resultsReviewed: null,
      recentReading: null,
      anyReading: true,
    };
    for (const stage of buildCareJourney(failed)) {
      expect(stage.state).toBe("unknown");
      expect(stage.detail).toBe("We could not check this just now.");
    }
  });

  it("asks for the assessment, the review, and a first reading on an empty Member account", () => {
    const s = byId({
      isMember: true,
      assessmentDone: false,
      baselineState: "none",
      carePlanActive: false,
      openTestCount: 0,
      resultedTestCount: 0,
      resultsAwaitingDoctor: 0,
      resultsReviewed: 0,
      recentReading: false,
      anyReading: false,
    });
    expect(s.assessment!.state).toBe("on_you");
    expect(s.review!.state).toBe("on_you");
    expect(s.tests!.state).toBe("not_started");
    expect(s.results!.state).toBe("not_started");
    expect(s.monitoring!.detail).toBe("Log your first reading.");
  });

  it("marks reviewed results and authorised reviews as done", () => {
    const s = byId({ ...member, baselineState: "adjusted", carePlanActive: true, resultsAwaitingDoctor: 0, resultsReviewed: 2, openTestCount: 0, resultedTestCount: 2 });
    expect(s.review!.state).toBe("done");
    expect(s.plan!.state).toBe("done");
    expect(s.results!.state).toBe("done");
    expect(s.tests!.state).toBe("done");
  });

  it("does not call the doctor stages 'Membership' when the Membership read failed", () => {
    const s = byId({ ...member, isMember: null });
    for (const id of ["review", "plan", "results"]) expect(s[id]!.state).toBe("unknown");
    expect(s.tests!.state).toBe("in_progress");
  });

  it("has a word label for every state", () => {
    for (const label of Object.values(JOURNEY_STATE_LABEL)) expect(label.length).toBeGreaterThan(0);
  });
});
