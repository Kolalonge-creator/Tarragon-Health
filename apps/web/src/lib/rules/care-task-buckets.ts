/**
 * Groups a patient's care_tasks into the Today / This week / Upcoming /
 * Overdue buckets the "My Care Plan" dashboard renders (Care Management
 * Engine spec §3.11). Pure function, no Date.now()/timezone assumptions
 * baked in beyond "now" being passed in — callers supply `now` so this stays
 * testable and stays correct across the Africa/Lagos-vs-server-clock gap.
 *
 * A task with no due_at (undated) lands in Upcoming — it needs doing, just
 * not by a specific day, so it shouldn't disappear from the list.
 */

export type BucketableTask = {
  id: string;
  status: string;
  due_at: string | null;
};

export type CareTaskBuckets<T extends BucketableTask> = {
  overdue: T[];
  today: T[];
  thisWeek: T[];
  upcoming: T[];
};

const OPEN_STATUSES = new Set(["not_started", "scheduled", "in_progress", "missed"]);

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function groupCareTasksByBucket<T extends BucketableTask>(
  tasks: T[],
  now: Date,
): CareTaskBuckets<T> {
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const buckets: CareTaskBuckets<T> = { overdue: [], today: [], thisWeek: [], upcoming: [] };

  for (const task of tasks) {
    if (!OPEN_STATUSES.has(task.status)) {
      continue;
    }
    if (!task.due_at) {
      buckets.upcoming.push(task);
      continue;
    }
    const dueAt = new Date(task.due_at);
    if (task.status === "missed" || dueAt < todayStart) {
      buckets.overdue.push(task);
    } else if (dueAt < tomorrowStart) {
      buckets.today.push(task);
    } else if (dueAt < weekEnd) {
      buckets.thisWeek.push(task);
    } else {
      buckets.upcoming.push(task);
    }
  }

  return buckets;
}
