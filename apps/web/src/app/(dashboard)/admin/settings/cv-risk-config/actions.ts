"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SignCvRiskConfigState = { error?: string; success?: boolean } | undefined;

/**
 * Sign and activate a CV-risk configuration. The DB RPC
 * (sign_cv_risk_config) is the real gate — it only succeeds for an active
 * Clinical Director in the config's organisation, stamps approved_by from the
 * caller's own clinical_staff record, and deactivates any prior active config.
 * A signature cannot be forged from the app layer.
 */
export async function signCvRiskConfigAction(
  configId: string
): Promise<SignCvRiskConfigState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_cv_risk_config", { p_config_id: configId });
  if (error) return { error: error.message };
  revalidatePath("/admin/settings/cv-risk-config");
  return { success: true };
}
