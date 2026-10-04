import { lagosLocalDate } from "./lagos-date";
import { loadTodaysDoses } from "./medications";
import { pullChangesThrottled, readLocalTasks } from "./offline-store";
import { fetchPatientTasks } from "./task-source";
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
 * has no task source yet and shows doses only. A real failure is reported as
 * `partial`, whether or not a mirrored copy was used, so the screen can say some
 * items may be missing or out of date instead of passing an old or empty list
 * off as current.
 */
export interface TodayLoad {
  list: TodayList;
  /** True when a source failed: what is shown may be missing or out of date. */
  partial: boolean;
}

/** PostgREST and Postgres codes for "that table or view is not there". */
const MISSING_RELATION_CODES = new Set(["PGRST205", "42P01", "PGRST200"]);

async function loadTasks(patientId: string, nowMs: number): Promise<{ tasks: TodayTask[]; partial: boolean }> {
  try {
    const { rows, error } = await fetchPatientTasks(patientId, nowMs);
    if (!error) {
      pullChangesThrottled(patientId);
      return { tasks: toTodayTasks(rows), partial: false };
    }
    if (error.code && MISSING_RELATION_CODES.has(error.code)) return { tasks: [], partial: false };
  } catch {
    // fall through to the mirrored copy
  }
  // The request failed. A mirrored copy is better than nothing, but it may be out of date, so say so.
  try {
    const local = await readLocalTasks<Parameters<typeof toTodayTasks>[0][number]>(patientId);
    if (local.length > 0) return { tasks: toTodayTasks(local), partial: true };
  } catch {
    // no mirror either
  }
  return { tasks: [], partial: true };
}

export async function loadToday(patientId: string, nowMs: number = Date.now()): Promise<TodayLoad> {
  const [tasksRes, dosesRes, bpRes] = await Promise.allSettled([
    loadTasks(patientId, nowMs),
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
