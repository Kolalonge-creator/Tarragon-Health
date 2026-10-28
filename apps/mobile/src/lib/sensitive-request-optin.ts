import { supabase } from "./supabase";

export interface SensitiveOptin {
  available: boolean;
  optedIn: boolean;
}

/** "hidden" while the feature is not available and the patient has not opted in; otherwise the current choice. Mirrors the web card. */
export function sensitiveOptinView(s: SensitiveOptin | null): "hidden" | "off" | "on" {
  if (!s) return "hidden";
  if (s.optedIn) return "on";
  return s.available ? "off" : "hidden";
}

export async function loadSensitiveOptin(): Promise<{ ok: true; data: SensitiveOptin } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.rpc("my_sensitive_request_optin");
    if (error) return { ok: false, error: error.message };
    const row = data?.[0];
    return { ok: true, data: { available: Boolean(row?.available), optedIn: Boolean(row?.opted_in) } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setSensitiveOptin(optIn: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await supabase.rpc("set_my_sensitive_request_optin", { p_opt_in: optIn });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
