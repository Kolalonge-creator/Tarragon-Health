import { OFFLINE_BUDGET } from "./offline-budget";
import { addDays, lagosDayStartUtcMs, lagosLocalDate } from "./lagos-date";
import { supabase } from "./supabase";

/**
 * One place that reads the patient's tasks from the patient_tasks view, used by
 * both the Today list and the offline mirror so they can never disagree about
 * which tasks count.
 *
 * Two queries, not one capped list, on purpose: every OPEN task is read (newest
 * change first, up to taskPullLimit), plus only the tasks that changed since the
 * start of yesterday in Lagos (enough to show "done today"). A single list capped
 * by most recent change would let a pile of recently closed recurring tasks push
 * an older open one out, and it would silently never be shown.
 */
export const TASK_COLUMNS = "id, kind, title, priority, due_at, recurrence, owner_role, state, status, updated_at, source";

export type RawTaskRow = { id: string; [key: string]: unknown };

export interface TaskFetch {
  rows: RawTaskRow[];
  error: { code?: string; message: string } | null;
}

export async function fetchPatientTasks(patientId: string, nowMs: number = Date.now()): Promise<TaskFetch> {
  const cutoff = new Date(lagosDayStartUtcMs(addDays(lagosLocalDate(nowMs), -1))).toISOString();
  const base = () => supabase.from("patient_tasks").select(TASK_COLUMNS).eq("patient_id", patientId);
  const [open, recent] = await Promise.all([
    base().eq("state", "open").order("updated_at", { ascending: false }).limit(OFFLINE_BUDGET.taskPullLimit),
    base().neq("state", "open").gte("updated_at", cutoff).order("updated_at", { ascending: false }).limit(OFFLINE_BUDGET.taskRecentLimit),
  ]);
  const error = open.error ?? recent.error;
  if (error) return { rows: [], error: { code: error.code, message: error.message } };
  const byId = new Map<string, RawTaskRow>();
  for (const r of [...((open.data ?? []) as unknown as RawTaskRow[]), ...((recent.data ?? []) as unknown as RawTaskRow[])]) {
    byId.set(r.id, r);
  }
  return { rows: [...byId.values()], error: null };
}
