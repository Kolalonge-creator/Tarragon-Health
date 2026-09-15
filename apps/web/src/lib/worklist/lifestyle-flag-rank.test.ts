import { describe, expect, it } from "@jest/globals";
import {
  compareLifestyleFlags,
  lifestyleSeverityLabel,
  lifestyleSeverityRank,
  lifestyleSeverityVariant,
} from "./lifestyle-flag-rank";

describe("lifestyleSeverityRank", () => {
  it("orders emergency ahead of red ahead of amber", () => {
    expect(lifestyleSeverityRank("emergency")).toBeLessThan(lifestyleSeverityRank("red"));
    expect(lifestyleSeverityRank("red")).toBeLessThan(lifestyleSeverityRank("amber"));
  });

  it("ranks an unrecognised severity behind every known one", () => {
    expect(lifestyleSeverityRank("unknown")).toBeGreaterThan(lifestyleSeverityRank("amber"));
  });
});

describe("lifestyleSeverityVariant / lifestyleSeverityLabel", () => {
  it("gives emergency and red the same red chip colour but a different label", () => {
    expect(lifestyleSeverityVariant("emergency")).toBe("red");
    expect(lifestyleSeverityVariant("red")).toBe("red");
    expect(lifestyleSeverityLabel("emergency")).toBe("Emergency");
    expect(lifestyleSeverityLabel("red")).toBe("Red flag");
  });

  it("passes an unrecognised severity through as its own label", () => {
    expect(lifestyleSeverityLabel("mystery")).toBe("mystery");
    expect(lifestyleSeverityVariant("mystery")).toBe("grey");
  });
});

describe("compareLifestyleFlags", () => {
  it("sorts severity first regardless of how old the lower-severity flag is", () => {
    // The bug this guards against: the page used to sort strictly by
    // opened_at, so an emergency flag raised this morning rendered below
    // last week's amber one.
    const emergencyToday = { severity: "emergency", escalationLevel: 0, openedAt: "2026-09-14T09:00:00Z" };
    const amberLastWeek = { severity: "amber", escalationLevel: 0, openedAt: "2026-09-07T09:00:00Z" };
    expect(compareLifestyleFlags(emergencyToday, amberLastWeek)).toBeLessThan(0);
  });

  it("breaks a same-severity tie by the engine's numeric escalation level, higher first", () => {
    const higher = { severity: "red", escalationLevel: 3, openedAt: "2026-09-14T09:00:00Z" };
    const lower = { severity: "red", escalationLevel: 1, openedAt: "2026-09-14T09:00:00Z" };
    expect(compareLifestyleFlags(higher, lower)).toBeLessThan(0);
  });

  it("breaks a same-severity, same-level tie by oldest first — the one that has slipped", () => {
    const older = { severity: "amber", escalationLevel: 1, openedAt: "2026-09-01T09:00:00Z" };
    const newer = { severity: "amber", escalationLevel: 1, openedAt: "2026-09-10T09:00:00Z" };
    expect(compareLifestyleFlags(older, newer)).toBeLessThan(0);
  });
});
