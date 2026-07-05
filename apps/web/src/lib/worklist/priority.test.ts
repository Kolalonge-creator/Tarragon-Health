import { describe, expect, it } from "@jest/globals";
import { compareAlerts } from "./priority";

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
});
