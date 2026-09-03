/**
 * Per-patient "Care Plan Status" tile a clinician sees (Care Management
 * Engine spec §3.11: "Completed: 84%, Overdue: 2, High priority: 1"). Pure
 * function over a patient's own care_tasks rows — no RPC needed, since
 * care_management_kpis (packages/shared) is org-wide, not per-patient.
 */

export type SummarizableTask = {
  status: string;
  priority: number;
};

export type CareTaskSummary = {
  /** How many tasks have ever reached a closed state (denominator for completedPct). */
  totalClosed: number;
  /** Null rather than 0 when nothing has closed yet — an empty plan isn't "0% complete". */
  completedPct: number | null;
  overdueCount: number;
  highPriorityOverdueCount: number;
};

const CLOSED_STATUSES = new Set([
  "completed",
  "missed",
  "expired",
  "unable_to_complete",
  "cancelled",
]);

export function computeCareTaskSummary(tasks: SummarizableTask[]): CareTaskSummary {
  const closed = tasks.filter((t) => CLOSED_STATUSES.has(t.status));
  const completed = closed.filter((t) => t.status === "completed").length;
  const overdue = tasks.filter((t) => t.status === "missed");

  return {
    totalClosed: closed.length,
    completedPct: closed.length === 0 ? null : Math.round((completed / closed.length) * 100),
    overdueCount: overdue.length,
    highPriorityOverdueCount: overdue.filter((t) => t.priority === 1).length,
  };
}
