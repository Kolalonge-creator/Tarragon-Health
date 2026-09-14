import { describe, expect, it } from "@jest/globals";
import { compareResultRows, isHighSeverityResult } from "./results-inbox-rank";

describe("isHighSeverityResult", () => {
  it("is true for an urgent or more severe linked alert", () => {
    expect(isHighSeverityResult({ created_at: "x", clinician_alert: { level: "emergency" } })).toBe(
      true
    );
    expect(
      isHighSeverityResult({ created_at: "x", clinician_alert: { level: "urgent_escalation" } })
    ).toBe(true);
  });

  it("is false for a routine or clinician-review alert", () => {
    expect(
      isHighSeverityResult({ created_at: "x", clinician_alert: { level: "clinician_review" } })
    ).toBe(false);
    expect(isHighSeverityResult({ created_at: "x", clinician_alert: { level: "routine" } })).toBe(
      false
    );
  });

  it("is false, not thrown, for a document with no linked alert at all", () => {
    expect(() => isHighSeverityResult({ created_at: "x", clinician_alert: null })).not.toThrow();
    expect(isHighSeverityResult({ created_at: "x", clinician_alert: null })).toBe(false);
  });
});

describe("compareResultRows", () => {
  it("sorts severity first regardless of upload age", () => {
    // The bug this guards against: the page fetched created_at ascending
    // only, so an emergency-level result could land pages below a routine
    // one uploaded earlier that morning.
    const emergencyLater = {
      created_at: "2026-09-14T09:00:00Z",
      clinician_alert: { level: "emergency" as const },
    };
    const routineEarlier = {
      created_at: "2026-09-14T07:00:00Z",
      clinician_alert: { level: "routine" as const },
    };
    expect(compareResultRows(emergencyLater, routineEarlier)).toBeLessThan(0);
  });

  it("sorts an unclassified document (no alert) behind every classified row", () => {
    // Unclassified is a different fact from routine, not a synonym for it —
    // it must never be guessed into the "routine" bucket by sorting equal.
    const unclassified = { created_at: "2020-01-01T00:00:00Z", clinician_alert: null };
    const routine = {
      created_at: "2026-09-14T09:00:00Z",
      clinician_alert: { level: "routine" as const },
    };
    expect(compareResultRows(unclassified, routine)).toBeGreaterThan(0);
  });

  it("breaks a same-severity tie by upload age, oldest first", () => {
    const older = {
      created_at: "2026-09-01T09:00:00Z",
      clinician_alert: { level: "urgent_escalation" as const },
    };
    const newer = {
      created_at: "2026-09-10T09:00:00Z",
      clinician_alert: { level: "urgent_escalation" as const },
    };
    expect(compareResultRows(older, newer)).toBeLessThan(0);
  });
});
