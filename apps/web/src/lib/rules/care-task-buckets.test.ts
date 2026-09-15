import { groupCareTasksByBucket, type BucketableTask } from "./care-task-buckets";

const NOW = new Date("2026-08-27T09:00:00.000Z");

function task(id: string, status: string, dueAt: string | null): BucketableTask {
  return { id, status, due_at: dueAt };
}

describe("groupCareTasksByBucket", () => {
  it("puts a task due later today in today", () => {
    const result = groupCareTasksByBucket(
      [task("a", "not_started", "2026-08-27T18:00:00.000Z")],
      NOW,
    );
    expect(result.today.map((t) => t.id)).toEqual(["a"]);
    expect(result.overdue).toHaveLength(0);
  });

  it("puts a task due tomorrow in this week, not today", () => {
    const result = groupCareTasksByBucket(
      [task("a", "scheduled", "2026-08-28T08:00:00.000Z")],
      NOW,
    );
    expect(result.today).toHaveLength(0);
    expect(result.thisWeek.map((t) => t.id)).toEqual(["a"]);
  });

  it("puts a task due 10 days out in upcoming", () => {
    const result = groupCareTasksByBucket(
      [task("a", "not_started", "2026-09-06T08:00:00.000Z")],
      NOW,
    );
    expect(result.thisWeek).toHaveLength(0);
    expect(result.upcoming.map((t) => t.id)).toEqual(["a"]);
  });

  it("puts a past-due, still-open task in overdue regardless of status", () => {
    const result = groupCareTasksByBucket(
      [
        task("a", "not_started", "2026-08-20T08:00:00.000Z"),
        task("b", "missed", "2026-08-27T18:00:00.000Z"),
      ],
      NOW,
    );
    expect(result.overdue.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("puts an undated task in upcoming", () => {
    const result = groupCareTasksByBucket([task("a", "not_started", null)], NOW);
    expect(result.upcoming.map((t) => t.id)).toEqual(["a"]);
  });

  it("excludes closed tasks entirely", () => {
    const result = groupCareTasksByBucket(
      [
        task("a", "completed", "2026-08-27T08:00:00.000Z"),
        task("b", "cancelled", "2026-08-27T08:00:00.000Z"),
        task("c", "expired", "2026-08-01T08:00:00.000Z"),
        task("d", "unable_to_complete", "2026-08-27T08:00:00.000Z"),
      ],
      NOW,
    );
    expect(result.overdue).toHaveLength(0);
    expect(result.today).toHaveLength(0);
    expect(result.thisWeek).toHaveLength(0);
    expect(result.upcoming).toHaveLength(0);
  });
});
