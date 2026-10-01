import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@tarragon/shared";
import { ROUTINE_CHART_READ_REASON } from "./audited-chart";

/**
 * Reads of the `vitals_readings` table through the audited, tie-gated function (INV-10, INV-12, S05f piece D).
 *
 * Staff no longer read the table directly. For the patient, a caregiver with a grant and the service role the same function returns
 * what the table policy admitted (no audit row), so the shared hooks and loaders use one path for every viewer. A refusal or an error
 * must show as "not available to you", never as "no readings": callers branch on `status` (or use the throwing variant in hooks).
 *
 * No `server-only` import on purpose: the clinician chart reads from the browser.
 */

export type VitalsRow = Tables<"vitals_readings">;
type VitalType = Database["public"]["Enums"]["vital_type"];
type VitalSource = Database["public"]["Enums"]["vital_source"];

export type VitalsResult =
  | { status: "ok"; rows: VitalsRow[] }
  | { status: "denied" }
  | { status: "error"; message: string };

export interface VitalsReadOptions {
  vitalType?: VitalType;
  /** Only readings taken at or after this instant (ISO string). */
  since?: string;
  /** Page size (default 20, at most 5000). The newest rows are selected; `ascending` only reorders them. */
  limit?: number;
  offset?: number;
  /** Oldest first (charts). Default: newest first. */
  ascending?: boolean;
  source?: VitalSource;
  reason?: string;
}

/** Turns the audited read's response into a result; a malformed response is an error, never an empty list. */
export function parseVitalsPayload(data: unknown): VitalsResult {
  const payload = data as { status?: unknown; rows?: unknown } | null;
  if (!payload || typeof payload !== "object") return { status: "error", message: "unexpected vitals response" };
  if (payload.status === "denied") return { status: "denied" };
  if (payload.status !== "ok" || !Array.isArray(payload.rows)) return { status: "error", message: "unexpected vitals response" };
  return { status: "ok", rows: payload.rows as VitalsRow[] };
}

export async function readPatientVitalsAudited(
  supabase: SupabaseClient<Database>,
  patientId: string,
  options: VitalsReadOptions = {},
): Promise<VitalsResult> {
  const { data, error } = await supabase.rpc("read_patient_vitals_audited", {
    p_patient: patientId,
    p_reason: options.reason ?? ROUTINE_CHART_READ_REASON,
    ...(options.vitalType === undefined ? {} : { p_vital_type: options.vitalType }),
    ...(options.since === undefined ? {} : { p_since: options.since }),
    ...(options.limit === undefined ? {} : { p_limit: options.limit }),
    ...(options.offset === undefined ? {} : { p_offset: options.offset }),
    ...(options.ascending === undefined ? {} : { p_ascending: options.ascending }),
    ...(options.source === undefined ? {} : { p_source: options.source }),
  });
  if (error) return { status: "error", message: error.message };
  return parseVitalsPayload(data);
}

/** For react-query hooks: a refusal or error throws, so it can never read as "no readings". */
export async function readPatientVitalsOrThrow(
  supabase: SupabaseClient<Database>,
  patientId: string,
  options: VitalsReadOptions = {},
): Promise<VitalsRow[]> {
  const result = await readPatientVitalsAudited(supabase, patientId, options);
  if (result.status === "ok") return result.rows;
  throw new Error(result.status === "denied" ? "vitals not available to you" : result.message);
}
