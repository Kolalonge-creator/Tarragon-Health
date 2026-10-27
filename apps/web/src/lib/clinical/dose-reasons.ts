import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ROUTINE_CHART_READ_REASON } from "./audited-chart";
import type { DoseLogEntry } from "./dose-log";

/**
 * The private reason ("I ran out, or cannot afford it this month") for a dose, for the tied care team only. It lives apart from the dose
 * row (medication_dose_reasons), so the clinician chart reads it through its own audited, tie-gated function (INV-10, INV-12; S54d).
 * A refusal or an error must show as such, never as "no reason given".
 *
 * No `server-only` import on purpose, same as dose-log.ts.
 */

export interface DoseReasonEntry {
  medication_log_id: string;
  reason_code: string;
  status: string;
  logged_at: string;
  scheduled_for_date: string | null;
  scheduled_time: string | null;
}

export type DoseReasonsResult =
  | { status: "ok"; rows: DoseReasonEntry[]; hasMore: boolean }
  | { status: "denied" }
  | { status: "error"; message: string };

const LABEL: Record<string, string> = {
  ran_out: "ran out, or could not afford it",
  cannot_afford: "could not afford it",
};

export function privateReasonLabel(code: string): string {
  return LABEL[code] ?? "a private reason";
}

export function parseDoseReasonsPayload(data: unknown): DoseReasonsResult {
  const payload = data as { status?: unknown; rows?: unknown; has_more?: unknown } | null;
  if (!payload || typeof payload !== "object") return { status: "error", message: "unexpected dose reasons response" };
  if (payload.status === "denied") return { status: "denied" };
  if (payload.status !== "ok" || !Array.isArray(payload.rows)) return { status: "error", message: "unexpected dose reasons response" };
  return { status: "ok", rows: payload.rows as DoseReasonEntry[], hasMore: payload.has_more === true };
}

export async function readDoseReasonsAudited(
  supabase: SupabaseClient<Database>,
  patientId: string,
  reason: string = ROUTINE_CHART_READ_REASON,
): Promise<DoseReasonsResult> {
  const { data, error } = await supabase.rpc("read_dose_reasons_audited", { p_patient: patientId, p_reason: reason });
  if (error) return { status: "error", message: error.message };
  return parseDoseReasonsPayload(data);
}

/** The private reason (a label) for each dose-log entry that has one, keyed by the entry id. */
export function privateReasonByLog(result: DoseReasonsResult): Map<string, string> {
  const map = new Map<string, string>();
  if (result.status !== "ok") return map;
  for (const r of result.rows) map.set(r.medication_log_id, privateReasonLabel(r.reason_code));
  return map;
}

/** Entries of the dose log that are no longer the current entry for their slot never get a private reason shown. */
export function reasonLabelFor(entry: Pick<DoseLogEntry, "id">, byLog: Map<string, string>): string | null {
  return byLog.get(entry.id) ?? null;
}
