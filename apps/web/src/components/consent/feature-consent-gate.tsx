import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { FeatureConsentPrompt, type FeatureConsentType } from "./feature-consent-prompt";

/**
 * Shows its children only when the person has said yes to this feature (S47). Otherwise it shows the consent prompt instead. Reading what is already on file for
 * care is NOT behind this: only the screens that create new reproductive health, mental health or device records are wrapped. A failed lookup fails closed
 * (the prompt is shown), and the database refuses the write anyway.
 *
 * `onBehalfOf = false` (a carer looking at someone else's page) skips the prompt: consent belongs to the person themselves and the database still refuses.
 */
export async function FeatureConsentGate({
  dataType,
  children,
  onBehalfOf = false,
}: {
  dataType: FeatureConsentType;
  children: ReactNode;
  onBehalfOf?: boolean;
}) {
  if (onBehalfOf) return <>{children}</>;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("feature_consent_state", { p_data_type: dataType });
  const on = !error && typeof data === "object" && data !== null && (data as { on?: unknown }).on === true;
  if (on) return <>{children}</>;
  return <FeatureConsentPrompt dataType={dataType} />;
}
