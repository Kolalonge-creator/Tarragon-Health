import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@tarragon/shared";
import { ROUTINE_CHART_READ_REASON } from "./audited-chart";

/**
 * Reads of the mental-health tables through `public.read_patient_mental_health_audited` (INV-10, INV-12, S56).
 *
 * Nobody but the patient (and a Care Circle supporter holding the explicit 'mental_health' consent) can read these tables directly.
 * A clinician reads through this function: it needs a tie to the patient (task, assignment, acknowledged page, appointment) or an
 * active break-glass grant, and it writes an audit row for every read and every refusal. The patient reading their own record goes
 * through the same function with no audit row, so one path serves every viewer.
 *
 * A refusal or an error must show as "not available to you", never as "no results": callers branch on `status`, and the throwing
 * variant (for react-query hooks) throws on both. No `server-only` import on purpose: the clinician chart reads from the browser.
 */

export type MentalHealthScreenRow = Pick<
  Tables<"mental_health_screens">,
  "id" | "patient_id" | "instrument" | "total_score" | "severity_band" | "hazardous" | "crisis_flagged" | "item_responses" | "created_at"
>;
export type MentalHealthSection = "screens" | "checkins" | "therapy_sessions" | "schedules" | "handoffs";

export interface MentalHealthPayload {
  screens?: MentalHealthScreenRow[];
  checkins?: Tables<"wellbeing_checkins">[];
  therapy_sessions?: Record<string, unknown>[];
  schedules?: { id: string; patient_id: string; instrument: string; due_date: string }[];
  handoffs?: { id: string; patient_id: string; screen_id: string | null; summary: Record<string, unknown>; patient_note: string | null; state: string; task_id: string | null; created_at: string }[];
}

export type MentalHealthResult =
  | { status: "ok"; data: MentalHealthPayload }
  | { status: "denied" }
  | { status: "error"; message: string };

/** Turns the function's response into a result. A malformed response is an error, never an empty list. */
export function parseMentalHealthPayload(raw: unknown): MentalHealthResult {
  const payload = raw as (MentalHealthPayload & { status?: unknown }) | null;
  if (!payload || typeof payload !== "object") return { status: "error", message: "unexpected mental health response" };
  if (payload.status === "denied") return { status: "denied" };
  if (payload.status !== "ok") return { status: "error", message: "unexpected mental health response" };
  for (const key of ["screens", "checkins", "therapy_sessions", "schedules", "handoffs"] as const) {
    const v = payload[key];
    if (v !== undefined && !Array.isArray(v)) return { status: "error", message: "unexpected mental health response" };
  }
  const { status: _status, ...data } = payload;
  void _status;
  return { status: "ok", data };
}

export async function readPatientMentalHealthAudited(
  supabase: SupabaseClient<Database>,
  patientId: string,
  options: { sections?: MentalHealthSection[]; reason?: string; limit?: number } = {},
): Promise<MentalHealthResult> {
  const { data, error } = await supabase.rpc("read_patient_mental_health_audited", {
    p_patient: patientId,
    p_reason: options.reason ?? ROUTINE_CHART_READ_REASON,
    p_sections: options.sections ?? ["screens"],
    ...(options.limit === undefined ? {} : { p_limit: options.limit }),
  });
  if (error) return { status: "error", message: error.message };
  return parseMentalHealthPayload(data);
}

/** For react-query hooks: a refusal or error throws, so it can never read as "no results". */
export async function readPatientMentalHealthOrThrow(
  supabase: SupabaseClient<Database>,
  patientId: string,
  options: { sections?: MentalHealthSection[]; reason?: string; limit?: number } = {},
): Promise<MentalHealthPayload> {
  const result = await readPatientMentalHealthAudited(supabase, patientId, options);
  if (result.status === "ok") return result.data;
  throw new Error(result.status === "denied" ? "mental health information not available to you" : result.message);
}
