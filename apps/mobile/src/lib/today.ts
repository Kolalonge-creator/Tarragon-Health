import { lagosLocalDate } from "./lagos-date";
import { loadTodaysDoses } from "./medications";
import { pullChangesThrottled, readLocalTasks } from "./offline-store";
import { supabase } from "./supabase";
import { buildTodayList, toTodayTasks, type TodayList, type TodayTask } from "./today-model";
import { loadRecentBpReadings } from "./vitals";

/**
 * Gathers what the Today list needs and builds it. Every source can fail on its
 * own without taking the list down:
 * - tasks: the patient_tasks view, falling back to the copy mirrored on the phone;
 * - dose slots: lib/medications.ts, which already reads offline;
 * - whether a reading was logged today: the recent readings (this phone's unsent
 *   ones included).
 *
 * A view that does not exist yet (the S07 migration is applied to production on
 * the founder's go-ahead) is not an error the patient should see: the list simply
 * has no task source yet and shows doses only. A real failure with nothing
 * mirrored is reported as `partial`, so the screen can say some items may be
 * missing instead of showing an empty list as if it were a fact.
 */
export interface TodayLoad {
  list: TodayList;
  /** True when a source failed and there was no earlier copy to use. */
  partial: boolean;
}

/** PostgREST and Postgres codes for "that table or view is not there". */
const MISSING_RELATION_CODES = new Set(["PGRST205", "42P01", "PGRST200"]);

const TASK_COLUMNS = "id, kind, title, priority, due_at, recurrence, owner_role, state, status, updated_at";

async function loadTasks(patientId: string): Promise<{ tasks: TodayTask[]; partial: boolean }> {
  try {
    const { data, error } = await supabase
      .from("patient_tasks")
      .select(TASK_COLUMNS)
      .eq("patient_id", patientId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (!error) {
      pullChangesThrottled(patientId);
      return { tasks: toTodayTasks(data ?? []), partial: false };
    }
    if (error.code && MISSING_RELATION_CODES.has(error.code)) return { tasks: [], partial: false };
  } catch {
    // fall through to the mirrored copy
  }
  try {
    const local = await readLocalTasks<Parameters<typeof toTodayTasks>[0][number]>(patientId);
    if (local.length > 0) return { tasks: toTodayTasks(local), partial: false };
  } catch {
    // no mirror either
  }
  return { tasks: [], partial: true };
}

export async function loadToday(patientId: string, nowMs: number = Date.now()): Promise<TodayLoad> {
  const [tasksRes, dosesRes, bpRes] = await Promise.allSettled([
    loadTasks(patientId),
    loadTodaysDoses(patientId),
    loadRecentBpReadings(patientId, 5),
  ]);

  const tasks = tasksRes.status === "fulfilled" ? tasksRes.value : { tasks: [], partial: true };
  const dosesOk = dosesRes.status === "fulfilled" && dosesRes.value.ok;
  const doses = dosesRes.status === "fulfilled" && dosesRes.value.ok ? dosesRes.value.data : [];
  const today = lagosLocalDate(nowMs);
  const bpLoggedToday =
    bpRes.status === "fulfilled" &&
    bpRes.value.some((r) => {
      const ms = Date.parse(r.takenAt);
      return Number.isFinite(ms) && lagosLocalDate(ms) === today;
    });

  return {
    list: buildTodayList({ nowMs, tasks: tasks.tasks, doses, bpLoggedToday }),
    partial: tasks.partial || !dosesOk,
  };
}
