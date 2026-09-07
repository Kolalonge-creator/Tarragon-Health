import { supabase } from "./supabase";
import { todayIsoDate } from "./medications";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";

export type ScreeningSchedule = Tables<"screening_schedules"> & {
  screen_type: { name: string; code: string } | null;
};

/** Mirrors apps/web/src/lib/queries/screening.ts's useScreeningSchedules. */
export async function loadScreeningSchedules(patientId: string): Promise<QueryResult<ScreeningSchedule[]>> {
  const { data, error } = await supabase
    .from("screening_schedules")
    .select("*, screen_type:screen_types(name, code)")
    .eq("patient_id", patientId)
    .neq("status", "cancelled")
    .order("due_date", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as ScreeningSchedule[] };
}

/** Patient confirms a due screening was already done — mirrors
 * useLogScreeningCompletion. The next cycle is scheduled from performedDate
 * server-side (private.refresh_screening_schedule_on_completion), not from
 * today. */
export async function confirmScreeningDone(input: {
  patientId: string;
  organisationId: string;
  screenTypeId: string;
  scheduleId?: string;
  performedDate: string;
  note?: string;
}): Promise<QueryResult<null>> {
  if (input.performedDate > todayIsoDate()) {
    return { ok: false, error: "That date can't be in the future" };
  }
  const { error } = await supabase.from("screening_completions").insert({
    patient_id: input.patientId,
    organisation_id: input.organisationId,
    screen_type_id: input.screenTypeId,
    schedule_id: input.scheduleId ?? null,
    performed_date: input.performedDate,
    note: input.note?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Patient declines a recommended screening, with a reason — mirrors
 * useDeclineScreeningSchedule. */
export async function declineScreening(
  patientId: string,
  scheduleId: string,
  reason: string
): Promise<QueryResult<null>> {
  if (!reason.trim()) {
    return { ok: false, error: "A reason is required" };
  }
  const { error } = await supabase
    .from("screening_schedules")
    .update({
      status: "declined",
      declined_at: new Date().toISOString(),
      declined_reason: reason.trim(),
    })
    .eq("id", scheduleId)
    .eq("patient_id", patientId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
