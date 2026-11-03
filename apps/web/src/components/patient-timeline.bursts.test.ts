import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/queries/patient-timeline", () => ({ usePatientTimeline: jest.fn() }));
jest.mock("@/components/item-note", () => ({ canAnnotate: () => false, ItemNote: () => null }));
jest.mock("@/components/doctor-name-link", () => ({ DoctorNameLink: () => null }));
jest.mock("@/components/timeline-trust-tier", () => ({ TimelineTrustTier: () => null }));

import { collapseScreeningBursts } from "./patient-timeline";
import type { TimelineEvent } from "@/lib/queries/patient-timeline";

function ev(partial: Partial<TimelineEvent> & { id: string; event_type: TimelineEvent["event_type"]; occurred_at: string }): TimelineEvent {
  return {
    title: partial.event_type === "screening_due" ? "Screening due" : "x",
    summary: null,
    source_table: "screening_schedules",
    source_id: partial.id,
    actor: null,
    ...partial,
  } as TimelineEvent;
}

describe("collapseScreeningBursts", () => {
  it("folds three or more same-day screening rows into one, naming the first two and counting the rest", () => {
    const rows = [
      ev({ id: "a", event_type: "screening_due", occurred_at: "2026-10-30T09:55:00Z", summary: "Blood Pressure Check · due 2026-10-30" }),
      ev({ id: "b", event_type: "screening_due", occurred_at: "2026-10-30T09:55:00Z", summary: "Liver Function Test · due 2026-10-30" }),
      ev({ id: "c", event_type: "screening_due", occurred_at: "2026-10-30T09:55:00Z", summary: "HbA1c · due 2026-10-30" }),
      ev({ id: "d", event_type: "screening_due", occurred_at: "2026-10-30T09:55:00Z", summary: "Lipid Panel · due 2026-10-30" }),
    ];
    const out = collapseScreeningBursts(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("4 screenings scheduled");
    expect(out[0]!.summary).toBe("Blood Pressure Check, Liver Function Test and 2 more. Book them together in your Health Check.");
    expect(out[0]!.burst).toHaveLength(4);
  });

  it("leaves one or two screenings, other event types and a different day alone", () => {
    const rows = [
      ev({ id: "v", event_type: "vitals_recorded", occurred_at: "2026-11-01T08:00:00Z" }),
      ev({ id: "a", event_type: "screening_due", occurred_at: "2026-10-30T09:55:00Z", summary: "Blood Pressure Check · due 2026-10-30" }),
      ev({ id: "b", event_type: "screening_due", occurred_at: "2026-10-30T09:55:00Z", summary: "HbA1c · due 2026-10-30" }),
      ev({ id: "c", event_type: "screening_due", occurred_at: "2026-09-01T09:55:00Z", summary: "Lipid Panel · due 2026-09-01" }),
    ];
    const out = collapseScreeningBursts(rows);
    expect(out.map((e) => e.id)).toEqual(["v", "a", "b", "c"]);
    expect(out.every((e) => !e.burst)).toBe(true);
  });
});
