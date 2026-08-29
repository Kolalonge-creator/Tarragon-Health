"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SignTriageProtocolState = { error?: string; success?: boolean } | undefined;

/**
 * Sign and activate a symptom-triage protocol version. The DB RPC
 * (sign_triage_protocol) is the real gate — same discipline as
 * sign_cv_risk_config: it only succeeds for an active Clinical Director,
 * stamps approved_by from the caller's own clinical_staff record, and
 * deactivates any prior active version. A signature cannot be forged from
 * the app layer.
 */
export async function signTriageProtocolAction(protocolId: string): Promise<SignTriageProtocolState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_triage_protocol", { p_protocol_id: protocolId });
  if (error) return { error: error.message };
  revalidatePath("/admin/settings/symptom-triage-protocol");
  return { success: true };
}
