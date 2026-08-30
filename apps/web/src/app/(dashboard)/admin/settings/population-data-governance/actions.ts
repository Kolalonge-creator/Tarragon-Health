"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@tarragon/shared";

type GateKey = Database["public"]["Enums"]["population_data_gate_key"];

export type AttestGateState = { error?: string; success?: boolean } | undefined;

/**
 * Attest one of the 3 population-data governance gates
 * (docs/Tarragon_Health_Master_Operating_Plan_v4.md:378-382). The DB RPC is
 * the real gate — it only succeeds for private.is_admin() and stamps
 * attested_by/attested_at server-side from the caller's own session, never
 * from client input. This action just forwards the form.
 */
export async function attestGateAction(
  _prev: AttestGateState,
  formData: FormData
): Promise<AttestGateState> {
  const gateKey = String(formData.get("gate_key") ?? "") as GateKey;
  const met = formData.get("met") === "true";
  const evidence = String(formData.get("evidence") ?? "").trim() || undefined;

  const supabase = await createClient();
  const { error } = await supabase.rpc("attest_population_data_governance_gate", {
    p_gate_key: gateKey,
    p_met: met,
    p_evidence: evidence,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/population-data-governance");
  return { success: true };
}
