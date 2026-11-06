import { describe, expect, it } from "@jest/globals";
import { cmoOversightView } from "./cmo-oversight";
import type { DoctorWorklistRow } from "./doctor-worklist";

const NOW = new Date("2026-11-06T12:00:00Z");

function row(over: Partial<DoctorWorklistRow> & Pick<DoctorWorklistRow, "key">): DoctorWorklistRow {
  return {
    source: "escalation",
    patientId: "p",
    patientName: "A Patient",
    patientNumber: "TH-000001",
    issue: "Issue",
    priority: "routine",
    receivedAt: "2026-11-06T08:00:00Z",
    dueAt: null,
    assignedName: "Dr Ada",
    assignedToMe: false,
    unassigned: false,
    status: "New",
    nextAction: "Start the review",
    href: "/x",
    ...over,
  };
}

describe("cmoOversightView (DW-14)", () => {
  const rows = [
    row({ key: "e1", priority: "critical", dueAt: "2026-11-06T18:00:00Z" }),
    row({ key: "e2", priority: "routine", dueAt: "2026-11-06T10:00:00Z" }), // overdue
    row({ key: "a1", source: "alert", assignedName: "Dr Bayo", priority: "urgent", dueAt: "2026-11-05T10:00:00Z" }), // overdue
    row({ key: "e3", unassigned: true, assignedName: null }),
    row({ key: "q1", source: "queue", unassigned: true, assignedName: null }),
  ];

  it("puts critical work first, then overdue, then priority, and leaves shared queues out", () => {
    const view = cmoOversightView(rows, [], NOW);
    expect(view.teamRows.map((r) => r.key)).toEqual(["e1", "a1", "e2", "e3"]);
    expect(view.teamTotal).toBe(4);
  });

  it("counts overdue and unassigned team work", () => {
    const view = cmoOversightView(rows, [], NOW);
    expect(view.overdue).toBe(2);
    expect(view.unassigned).toBe(1);
  });

  it("ranks doctors by overdue, then open", () => {
    const view = cmoOversightView(rows, [], NOW);
    expect(view.byDoctor).toEqual([
      { name: "Dr Ada", open: 2, overdue: 1 },
      { name: "Dr Bayo", open: 1, overdue: 1 },
    ]);
  });

  it("unknown is not zero: a failed escalation or alert read gives null figures", () => {
    expect(cmoOversightView(rows, ["alert"], NOW).overdue).toBeNull();
    expect(cmoOversightView(rows, ["escalation"], NOW).unassigned).toBeNull();
    // A failed shared queue does not make the team figures unknown.
    expect(cmoOversightView(rows, ["queue"], NOW).overdue).toBe(2);
  });

  it("limits the table but not the totals", () => {
    const many = Array.from({ length: 15 }, (_, i) => row({ key: `e${i}` }));
    const view = cmoOversightView(many, [], NOW);
    expect(view.teamRows).toHaveLength(10);
    expect(view.teamTotal).toBe(15);
  });
});
