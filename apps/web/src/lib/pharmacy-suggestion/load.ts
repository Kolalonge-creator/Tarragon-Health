import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { ROUTINE_CHART_READ_REASON } from "@/lib/clinical/audited-chart";
import { optionRowsSchema, routingRowsSchema, type PharmacyOption, type RoutingRow } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false };

/** Signed prescriptions awaiting a pharmacy and what became of any suggestion. A refusal or error is "not available", never "none". The read is audited. */
export async function loadRoutingRows(patientId: string): Promise<Loaded<RoutingRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("care_team_prescriptions_for_routing", { p_patient: patientId, p_reason: ROUTINE_CHART_READ_REASON });
  if (error) return { ok: false };
  const parsed = routingRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

/** Neutral facts about listable pharmacies near the patient. Audited. The order comes from the database (proximity, then name). */
export async function loadOptions(patientId: string, prescriptionId: string): Promise<Loaded<PharmacyOption[]>> {
  const { data, error } = await loose(await createClient()).rpc("care_team_pharmacy_options", {
    p_patient: patientId,
    p_prescription: prescriptionId,
    p_reason: ROUTINE_CHART_READ_REASON,
  });
  if (error) return { ok: false };
  const parsed = optionRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}
