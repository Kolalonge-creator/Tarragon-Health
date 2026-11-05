import { buildHealthStatusDomains, type HealthStatusDomain } from "@tarragon/shared";
import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

/**
 * Mirrors useHealthStatusDomains in apps/web/src/lib/queries/health-status.ts (T2-06): one read of public.patient_health_status(),
 * turned into domains by the same shared, deterministic builder, so web and the phone cannot disagree. No composite score.
 */
export async function getHealthStatusDomains(patientId: string): Promise<QueryResult<HealthStatusDomain[]>> {
  try {
    const { data, error } = await supabase.rpc("patient_health_status", { p_patient: patientId });
    if (error) return { ok: false, error: error.message };
    const d = (data ?? {}) as { labs?: unknown; vitals?: unknown; screening?: unknown };
    return { ok: true, data: buildHealthStatusDomains({ labs: d.labs, vitals: d.vitals, screening: d.screening }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
