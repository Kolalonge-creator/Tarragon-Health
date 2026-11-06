import { describe, expect, it } from "@jest/globals";
import {
  countByPriority,
  filterWorklist,
  isOverdue,
  parseWorklistFilter,
  priorityFromAlertLevel,
  sortWorklist,
  type DoctorWorklistRow,
} from "./doctor-worklist";

const NOW = new Date("2026-11-06T10:00:00Z");

const row = (key: string, over: Partial<DoctorWorklistRow> = {}): DoctorWorklistRow => ({
  key,
  source: "alert",
  patientId: "p",
  patientName: "Ada Obi",
  patientNumber: "TH-0001",
  issue: "i",
  priority: "routine",
  receivedAt: "2026-11-06T08:00:00Z",
  dueAt: null,
  assignedName: null,
  assignedToMe: false,
  unassigned: true,
  status: "Open",
  nextAction: "Review",
  href: "/x",
  ...over,
});

describe("priorityFromAlertLevel", () => {
  it("maps the governed levels onto the four priority words", () => {
    expect(priorityFromAlertLevel("emergency")).toBe("critical");
    expect(priorityFromAlertLevel("urgent_escalation")).toBe("urgent");
    expect(priorityFromAlertLevel("specialist_review")).toBe("urgent");
    expect(priorityFromAlertLevel("clinician_review")).toBe("priority");
    expect(priorityFromAlertLevel("routine")).toBe("routine");
  });
  it("never invents a grade for an ungraded row", () => {
    expect(priorityFromAlertLevel(null)).toBe("not_graded");
    expect(priorityFromAlertLevel(undefined)).toBe("not_graded");
  });
});

describe("sortWorklist", () => {
  it("orders by priority, with ungraded above routine", () => {
    const out = sortWorklist(
      [row("r", { priority: "routine" }), row("n", { priority: "not_graded" }), row("c", { priority: "critical" }), row("u", { priority: "urgent" })],
      NOW,
    );
    expect(out.map((r) => r.key)).toEqual(["c", "u", "n", "r"]);
  });
  it("within a priority, overdue first, then nearest due, then longest waiting", () => {
    const out = sortWorklist(
      [
        row("later", { dueAt: "2026-11-06T15:00:00Z" }),
        row("nodue-old", { receivedAt: "2026-11-01T00:00:00Z" }),
        row("overdue", { dueAt: "2026-11-06T09:00:00Z" }),
        row("sooner", { dueAt: "2026-11-06T11:00:00Z" }),
        row("nodue-new", { receivedAt: "2026-11-05T00:00:00Z" }),
      ],
      NOW,
    );
    expect(out.map((r) => r.key)).toEqual(["overdue", "sooner", "later", "nodue-old", "nodue-new"]);
  });
  it("a bad date neither crashes nor jumps the queue", () => {
    const out = sortWorklist([row("bad", { dueAt: "nope", receivedAt: "nope" }), row("ok", { receivedAt: "2026-11-01T00:00:00Z" })], NOW);
    expect(out.map((r) => r.key)).toEqual(["ok", "bad"]);
    expect(isOverdue({ dueAt: "nope" }, NOW)).toBe(false);
  });
});

describe("filterWorklist", () => {
  const rows = [
    row("mine", { assignedToMe: true, unassigned: false, priority: "urgent", source: "escalation" }),
    row("free", { patientName: "Bola Ade", patientNumber: "TH-0042" }),
    row("theirs", { unassigned: false }),
  ];
  it("filters by assignee, priority, source and patient name or number", () => {
    expect(filterWorklist(rows, { assigned: "me" }).map((r) => r.key)).toEqual(["mine"]);
    expect(filterWorklist(rows, { assigned: "unassigned" }).map((r) => r.key)).toEqual(["free"]);
    expect(filterWorklist(rows, { priority: "urgent" }).map((r) => r.key)).toEqual(["mine"]);
    expect(filterWorklist(rows, { source: "escalation" }).map((r) => r.key)).toEqual(["mine"]);
    expect(filterWorklist(rows, { q: "bola" }).map((r) => r.key)).toEqual(["free"]);
    expect(filterWorklist(rows, { q: "th-0042" }).map((r) => r.key)).toEqual(["free"]);
    expect(filterWorklist(rows, {})).toHaveLength(3);
  });
});

describe("parseWorklistFilter", () => {
  it("accepts known values and falls back to all for anything else", () => {
    expect(parseWorklistFilter({ priority: "critical", source: "queue", assigned: "me", q: "ada" })).toEqual({
      priority: "critical",
      source: "queue",
      assigned: "me",
      q: "ada",
    });
    expect(parseWorklistFilter({ priority: "toString", source: "x", assigned: ["unassigned"], q: undefined })).toEqual({
      priority: "all",
      source: "all",
      assigned: "unassigned",
      q: "",
    });
  });
});

describe("countByPriority", () => {
  it("counts every priority, zero included", () => {
    expect(countByPriority([row("a", { priority: "critical" }), row("b")])).toEqual({ critical: 1, urgent: 0, priority: 0, routine: 1, not_graded: 0 });
  });
});
