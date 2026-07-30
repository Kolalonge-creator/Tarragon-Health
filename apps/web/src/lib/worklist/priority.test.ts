import { describe, expect, it } from "@jest/globals";
import { compareAlerts, compareByAlert, effectiveAlertLevel } from "./priority";

describe("compareAlerts", () => {
  it("sorts a more severe level before a less severe one, regardless of SLA", () => {
    const emergency = { level: "emergency" as const, sla_due_at: null };
    const routine = {
      level: "routine" as const,
      sla_due_at: "2020-01-01T00:00:00.000Z",
    };
    expect(compareAlerts(emergency, routine)).toBeLessThan(0);
    expect(compareAlerts(routine, emergency)).toBeGreaterThan(0);
  });

  it("orders the full severity ladder correctly", () => {
    const levels = [
      "routine",
      "emergency",
      "clinician_review",
      "urgent_escalation",
    ] as const;
    const alerts = levels.map((level) => ({ level, sla_due_at: null }));
    const sorted = [...alerts].sort(compareAlerts).map((a) => a.level);
    expect(sorted).toEqual([
      "emergency",
      "urgent_escalation",
      "clinician_review",
      "routine",
    ]);
  });

  it("breaks ties within the same level by earlier sla_due_at first", () => {
    const earlier = {
      level: "urgent_escalation" as const,
      sla_due_at: "2026-01-01T00:00:00.000Z",
    };
    const later = {
      level: "urgent_escalation" as const,
      sla_due_at: "2026-01-02T00:00:00.000Z",
    };
    expect(compareAlerts(earlier, later)).toBeLessThan(0);
    expect(compareAlerts(later, earlier)).toBeGreaterThan(0);
  });

  it("sorts a null sla_due_at after any set date within the same level", () => {
    const withDate = {
      level: "routine" as const,
      sla_due_at: "2026-01-01T00:00:00.000Z",
    };
    const withoutDate = { level: "routine" as const, sla_due_at: null };
    expect(compareAlerts(withDate, withoutDate)).toBeLessThan(0);
    expect(compareAlerts(withoutDate, withDate)).toBeGreaterThan(0);
  });

  it("treats two null sla_due_at values within the same level as equal", () => {
    const a = { level: "routine" as const, sla_due_at: null };
    const b = { level: "routine" as const, sla_due_at: null };
    expect(compareAlerts(a, b)).toBe(0);
  });

  it("ranks by a clinician's override, not the system's original level", () => {
    // A clinician downgraded a system-flagged emergency to routine (e.g. a
    // false positive) -- it must no longer jump the queue ahead of a real,
    // un-overridden urgent case.
    const overriddenDown = {
      level: "emergency" as const,
      override_level: "routine" as const,
      sla_due_at: null,
    };
    const stillUrgent = { level: "urgent_escalation" as const, sla_due_at: null };
    expect(compareAlerts(overriddenDown, stillUrgent)).toBeGreaterThan(0);

    // The reverse: a clinician upgraded a routine case -- it should now
    // outrank an un-overridden urgent one.
    const overriddenUp = {
      level: "routine" as const,
      override_level: "emergency" as const,
      sla_due_at: null,
    };
    expect(compareAlerts(overriddenUp, stillUrgent)).toBeLessThan(0);
  });
});

describe("effectiveAlertLevel", () => {
  it("prefers the override when one is set", () => {
    expect(
      effectiveAlertLevel({ level: "routine", override_level: "emergency" })
    ).toBe("emergency");
  });

  it("falls back to the system level when there is no override", () => {
    expect(effectiveAlertLevel({ level: "urgent_escalation", override_level: null })).toBe(
      "urgent_escalation"
    );
    expect(effectiveAlertLevel({ level: "urgent_escalation" })).toBe("urgent_escalation");
  });
});

describe("compareByAlert", () => {
  it("ranks escalations by their joined clinician_alert's effective level", () => {
    const emergencyRow = {
      clinician_alert: { level: "emergency" as const, override_level: null, sla_due_at: null },
    };
    const routineRow = {
      clinician_alert: { level: "routine" as const, override_level: null, sla_due_at: null },
    };
    expect(compareByAlert(emergencyRow, routineRow)).toBeLessThan(0);
  });

  it("treats a missing clinician_alert join as routine with no SLA, never throwing", () => {
    const noAlert = { clinician_alert: null };
    const urgentRow = {
      clinician_alert: { level: "urgent_escalation" as const, override_level: null, sla_due_at: null },
    };
    expect(() => compareByAlert(noAlert, urgentRow)).not.toThrow();
    expect(compareByAlert(noAlert, urgentRow)).toBeGreaterThan(0);
  });
});
