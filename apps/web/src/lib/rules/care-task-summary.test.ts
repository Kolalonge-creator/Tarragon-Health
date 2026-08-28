import { computeCareTaskSummary } from "./care-task-summary";

describe("computeCareTaskSummary", () => {
  it("returns null completedPct when nothing has closed yet", () => {
    const result = computeCareTaskSummary([
      { status: "not_started", priority: 2 },
      { status: "scheduled", priority: 1 },
    ]);
    expect(result.completedPct).toBeNull();
    expect(result.totalClosed).toBe(0);
  });

  it("computes completion percentage against closed tasks only", () => {
    const result = computeCareTaskSummary([
      { status: "completed", priority: 2 },
      { status: "completed", priority: 2 },
      { status: "completed", priority: 2 },
      { status: "missed", priority: 2 },
      { status: "not_started", priority: 2 }, // not closed, excluded from denominator
    ]);
    expect(result.totalClosed).toBe(4);
    expect(result.completedPct).toBe(75);
  });

  it("counts overdue as status=missed regardless of priority", () => {
    const result = computeCareTaskSummary([
      { status: "missed", priority: 1 },
      { status: "missed", priority: 2 },
      { status: "missed", priority: 3 },
    ]);
    expect(result.overdueCount).toBe(3);
  });

  it("counts high-priority overdue as priority=1 AND status=missed only", () => {
    const result = computeCareTaskSummary([
      { status: "missed", priority: 1 },
      { status: "missed", priority: 2 },
      { status: "not_started", priority: 1 }, // not yet missed — doesn't count
    ]);
    expect(result.highPriorityOverdueCount).toBe(1);
  });

  it("rounds completedPct to the nearest whole number", () => {
    const result = computeCareTaskSummary([
      { status: "completed", priority: 2 },
      { status: "missed", priority: 2 },
      { status: "missed", priority: 2 },
    ]);
    expect(result.completedPct).toBe(33);
  });
});
