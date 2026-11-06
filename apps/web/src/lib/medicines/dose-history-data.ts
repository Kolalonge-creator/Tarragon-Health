import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadAdherenceInputs } from "@/lib/medicines/adherence-report-data";
import { buildDoseHistory, type DoseHistory } from "@/lib/medicines/dose-history";

/**
 * The patient's dose history for the charts, read with their own session (row level security keeps it to their record).
 * `{ ok: false }` when any read failed, so a chart says it could not load rather than drawing a month of "nothing due".
 */
export async function loadDoseHistory(
  supabase: SupabaseClient<Database>,
  patientId: string,
  nowMs: number = Date.now(),
): Promise<{ ok: true; history: DoseHistory } | { ok: false }> {
  const inputs = await loadAdherenceInputs(supabase, patientId, nowMs, 31);
  if (!inputs.ok) return { ok: false };
  return { ok: true, history: buildDoseHistory(inputs.medicines, nowMs, inputs.cfg) };
}
