import { supabase } from "./supabase";
import { setConsentCell } from "./consent-matrix";

export type FeatureConsentType = "reproductive" | "mental_health" | "device_data";

/**
 * S47d: has this person said yes to a feature that handles reproductive health, mental health or device data? The database refuses the write without it
 * (trigger), so this is only the friendly half: it decides whether to show the screen or the question. A failed lookup is "no" (fail closed).
 */
export async function loadFeatureConsentOn(dataType: FeatureConsentType): Promise<boolean> {
  const { data, error } = await supabase.rpc("feature_consent_state", { p_data_type: dataType });
  if (error || typeof data !== "object" || data === null) return false;
  return (data as { on?: unknown }).on === true;
}

/** The yes. Grants only the care cell of that one data type. "Not now" records nothing. */
export async function grantFeatureConsent(dataType: FeatureConsentType): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await setConsentCell(dataType, "care", true);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** A database refusal turned into a sentence; anything else is passed through. */
export function isFeatureConsentRefusal(message: string | null | undefined): boolean {
  return /consent_required:(reproductive|mental_health|device_data)/.test(message ?? "");
}
